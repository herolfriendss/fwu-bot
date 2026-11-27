// LE FISC — braquage en équipe (/braquage, -braquage par le pont préfixe).
//   /braquage : ouvre une équipe dans le salon (bouton « Rejoindre », 3 minutes).
//   De 3 à 5 membres ; l'organisateur lance dès 3, départ automatique à 5.
//   Réussite : butin pris dans la caisse du serveur (LE FISC), partagé à parts égales.
//   Échec : chaque membre paie une amende, versée à la caisse.
//   Garde-fous : caisse minimale, un braquage toutes les 2 h par serveur, 6 h de repos
//   par membre, butin plafonné. Monnaie exclusivement virtuelle (PND).
import { randomInt } from "node:crypto";
import { db, transaction } from "../database.js";
import { changeTreasury, treasury } from "./fisc-config.js";
import { move, seize } from "./fisc.js";
import { respondInPlaceSafe } from "../interaction-reply.js";

export const HEIST_COMMANDS = new Set(["braquage"]);
export const HEIST = Object.freeze({
  minMembers: 3, maxMembers: 5, lobbyMs: 3 * 60_000, guildCooldownMs: 2 * 60 * 60_000, memberCooldownMs: 6 * 60 * 60_000,
  minTreasury: 1_000, lootShare: 0.1, lootCap: 20_000, fine: 200,
});

db.exec(`
  CREATE TABLE IF NOT EXISTS fisc_heists (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, organizer_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL, finished_at INTEGER, success INTEGER, loot INTEGER
  );
  CREATE TABLE IF NOT EXISTS fisc_heist_members (heist_id INTEGER NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (heist_id, user_id));
  CREATE INDEX IF NOT EXISTS fisc_heists_guild_idx ON fisc_heists(guild_id, created_at DESC);
`);

const fmt = (n) => `${Number(n).toLocaleString("fr-FR")} PND`;

/** Chance de réussite : 35 % à 3, +7 points par membre en plus (49 % à 5). */
export function successChance(members) {
  return Math.min(0.49, 0.35 + Math.max(0, members - HEIST.minMembers) * 0.07);
}

/** Butin : 10 % de la caisse, plafonné, jamais plus que la caisse. */
export function lootFor(treasuryAmount) {
  return Math.max(0, Math.min(HEIST.lootCap, Math.floor(Number(treasuryAmount) * HEIST.lootShare)));
}

export function membersOf(heistId) {
  return db.prepare("SELECT user_id FROM fisc_heist_members WHERE heist_id = ? ORDER BY rowid").all(heistId).map((r) => r.user_id);
}

function memberCooldown(guildId, userId, now) {
  const row = db.prepare(`SELECT h.finished_at FROM fisc_heists h JOIN fisc_heist_members m ON m.heist_id = h.id
    WHERE h.guild_id = ? AND m.user_id = ? AND h.status = 'done' ORDER BY h.finished_at DESC LIMIT 1`).get(guildId, userId);
  const left = row ? Number(row.finished_at) + HEIST.memberCooldownMs - now : 0;
  return left > 0 ? left : 0;
}

const hours = (ms) => `${Math.ceil(ms / 3_600_000)} h`;

/** Ouvre une équipe. Rend l'identifiant du braquage ou lève une erreur claire. */
export function openHeist(guildId, organizerId, now = Date.now()) {
  db.prepare("UPDATE fisc_heists SET status = 'expired' WHERE guild_id = ? AND status = 'open' AND created_at < ?").run(guildId, now - HEIST.lobbyMs);
  if (db.prepare("SELECT 1 FROM fisc_heists WHERE guild_id = ? AND status = 'open'").get(guildId)) throw new Error("Une équipe de braquage est déjà en train de se former sur ce serveur.");
  const last = db.prepare("SELECT finished_at FROM fisc_heists WHERE guild_id = ? AND status = 'done' ORDER BY finished_at DESC LIMIT 1").get(guildId);
  if (last && now - Number(last.finished_at) < HEIST.guildCooldownMs) throw new Error(`🚨 La police surveille encore la caisse : prochain braquage possible dans ${hours(Number(last.finished_at) + HEIST.guildCooldownMs - now)}.`);
  if (treasury(guildId) < HEIST.minTreasury) throw new Error(`La caisse du serveur est presque vide (moins de ${fmt(HEIST.minTreasury)}) : rien à braquer.`);
  const wait = memberCooldown(guildId, organizerId, now);
  if (wait) throw new Error(`Tu te fais oublier après ton dernier braquage : encore ${hours(wait)}.`);
  const id = Number(db.prepare("INSERT INTO fisc_heists(guild_id, organizer_id, created_at) VALUES (?,?,?)").run(guildId, organizerId, now).lastInsertRowid);
  db.prepare("INSERT INTO fisc_heist_members(heist_id, user_id) VALUES (?,?)").run(id, organizerId);
  return id;
}

function openRow(guildId, heistId, now) {
  const row = db.prepare("SELECT * FROM fisc_heists WHERE id = ? AND guild_id = ?").get(heistId, guildId);
  if (!row || row.status !== "open") throw new Error("Ce braquage est terminé.");
  if (now - Number(row.created_at) > HEIST.lobbyMs) {
    db.prepare("UPDATE fisc_heists SET status = 'expired' WHERE id = ?").run(heistId);
    throw new Error("⌛ L'équipe ne s'est pas formée à temps : braquage annulé.");
  }
  return row;
}

export function joinHeist(guildId, heistId, userId, now = Date.now()) {
  openRow(guildId, heistId, now);
  const members = membersOf(heistId);
  if (members.includes(String(userId))) throw new Error("Tu fais déjà partie de l'équipe.");
  if (members.length >= HEIST.maxMembers) throw new Error("L'équipe est complète.");
  const wait = memberCooldown(guildId, userId, now);
  if (wait) throw new Error(`Tu te fais oublier après ton dernier braquage : encore ${hours(wait)}.`);
  db.prepare("INSERT INTO fisc_heist_members(heist_id, user_id) VALUES (?,?)").run(heistId, String(userId));
  return members.length + 1;
}

export function leaveHeist(guildId, heistId, userId, now = Date.now()) {
  const row = openRow(guildId, heistId, now);
  if (row.organizer_id === String(userId)) {
    db.prepare("UPDATE fisc_heists SET status = 'cancelled' WHERE id = ?").run(heistId);
    return "cancelled";
  }
  db.prepare("DELETE FROM fisc_heist_members WHERE heist_id = ? AND user_id = ?").run(heistId, String(userId));
  return "left";
}

/**
 * Lance le braquage (transaction : la caisse et les soldes bougent ensemble).
 * `roll` dans [0, 1[ pour les tests. Rend { success, members, loot, share, fines }.
 */
export function runHeist(guildId, heistId, actorId, { roll = randomInt(1_000_000) / 1_000_000, now = Date.now(), force = false } = {}) {
  const row = openRow(guildId, heistId, now);
  if (!force && row.organizer_id !== String(actorId)) throw new Error("Seul l'organisateur lance le braquage.");
  const members = membersOf(heistId);
  if (members.length < HEIST.minMembers) throw new Error(`Il faut au moins ${HEIST.minMembers} membres (vous êtes ${members.length}).`);
  return transaction(() => {
    const claimed = db.prepare("UPDATE fisc_heists SET status = 'running' WHERE id = ? AND status = 'open'").run(heistId);
    if (!Number(claimed.changes)) throw new Error("Ce braquage est déjà lancé.");
    const success = roll < successChance(members.length);
    let loot = 0; let share = 0; const fines = {};
    if (success) {
      share = Math.floor(lootFor(treasury(guildId)) / members.length);
      loot = share * members.length;
      if (loot > 0) {
        changeTreasury(guildId, -loot);
        for (const id of members) move(guildId, id, share, "heist_loot");
      }
    } else {
      let collected = 0;
      for (const id of members) { fines[id] = seize(guildId, id, HEIST.fine, "heist_fine"); collected += fines[id]; }
      if (collected) changeTreasury(guildId, collected);
    }
    db.prepare("UPDATE fisc_heists SET status = 'done', finished_at = ?, success = ?, loot = ? WHERE id = ?").run(now, success ? 1 : 0, loot, heistId);
    return { success, members, loot, share, fines };
  });
}

function lobbyPayload(heistId, guildId, { closed = false } = {}) {
  const members = membersOf(heistId);
  return {
    content: [
      `🏦 **Braquage de la caisse** (${fmt(treasury(guildId))} dedans)`,
      `Équipe (${members.length}/${HEIST.maxMembers}) : ${members.map((id) => `<@${id}>`).join(", ")}`,
      `Il faut ${HEIST.minMembers} membres au moins. Réussite : ${Math.round(successChance(Math.max(HEIST.minMembers, members.length)) * 100)} % ; butin partagé à parts égales. Échec : amende de ${fmt(HEIST.fine)} chacun, versée à la caisse.`,
      closed ? null : "L'organisateur lance quand l'équipe est prête (départ automatique à 5). 3 minutes pour se former.",
    ].filter(Boolean).join("\n"),
    components: closed ? [] : [{ type: 1, components: [
      { type: 2, style: 1, label: "Rejoindre", emoji: { name: "🔫" }, custom_id: `heist:join:${heistId}` },
      { type: 2, style: 2, label: "Quitter", custom_id: `heist:leave:${heistId}` },
      { type: 2, style: 3, label: "Lancer", emoji: { name: "🚗" }, custom_id: `heist:go:${heistId}` },
    ] }],
    allowedMentions: { parse: [] },
  };
}

function resultText(result) {
  const team = result.members.map((id) => `<@${id}>`).join(", ");
  if (result.success) return `💰 **Braquage réussi !** ${team} repartent avec **${fmt(result.loot)}** pris dans la caisse, soit **${fmt(result.share)}** chacun.`;
  const paid = Object.values(result.fines).reduce((a, b) => a + b, 0);
  return `🚔 **Braquage raté !** ${team} se font arrêter : **${fmt(paid)}** d'amendes versées à la caisse.`;
}

export async function handleHeistInteraction(interaction) {
  const guild = interaction?.guild;
  if (!guild) return false;
  if (interaction.isButton?.() && /^heist:(join|leave|go):\d+$/.test(interaction.customId ?? "")) {
    const [, action, raw] = interaction.customId.split(":");
    const heistId = Number(raw);
    try {
      if (action === "join") {
        const count = joinHeist(guild.id, heistId, interaction.user.id);
        if (count >= HEIST.maxMembers) {
          const result = runHeist(guild.id, heistId, interaction.user.id, { force: true });
          await interaction.update({ ...lobbyPayload(heistId, guild.id, { closed: true }), content: resultText(result) });
        } else await interaction.update(lobbyPayload(heistId, guild.id));
      } else if (action === "leave") {
        const outcome = leaveHeist(guild.id, heistId, interaction.user.id);
        if (outcome === "cancelled") await interaction.update({ content: "🏳️ L'organisateur a annulé le braquage.", components: [], allowedMentions: { parse: [] } });
        else await interaction.update(lobbyPayload(heistId, guild.id));
      } else {
        const result = runHeist(guild.id, heistId, interaction.user.id);
        await interaction.update({ content: resultText(result), components: [], allowedMentions: { parse: [] } });
      }
    } catch (error) {
      await respondInPlaceSafe(interaction, { content: `❌ ${error.message}`, ephemeral: true, allowedMentions: { parse: [] } });
    }
    return true;
  }
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== "braquage") return false;
  try {
    const id = openHeist(guild.id, interaction.user.id);
    await interaction.reply(lobbyPayload(id, guild.id));
  } catch (error) {
    await respondInPlaceSafe(interaction, { content: `❌ ${error.message}`, ephemeral: true, allowedMentions: { parse: [] } });
  }
  return true;
}
