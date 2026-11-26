// FWU V2 — smash or pass (SUCK ME : /smash, =smash par le pont préfixe).
// Garde-fous : participation uniquement sur inscription volontaire avec confirmation de
// majorité, désinscription à tout moment (profil et votes effacés), votes anonymes (le
// nom d'un votant n'est jamais affiché), signalement ; 3 signalements suspendent le
// profil en attendant le staff (mesure réversible) ; le staff retire un profil.
import { PermissionFlagsBits as P } from "discord.js";
import { db } from "../database.js";
import { logEvent } from "../log-events.js";
import { respondInPlaceSafe } from "../interaction-reply.js";

export const SMASH_COMMANDS = new Set(["smash"]);
const REPORT_LIMIT = 3;

db.exec(`
  CREATE TABLE IF NOT EXISTS smash_players (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, joined_at INTEGER NOT NULL, suspended INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guild_id, user_id));
  CREATE TABLE IF NOT EXISTS smash_votes (guild_id TEXT NOT NULL, voter_id TEXT NOT NULL, target_id TEXT NOT NULL, vote TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (guild_id, voter_id, target_id));
  CREATE TABLE IF NOT EXISTS smash_reports (guild_id TEXT NOT NULL, reporter_id TEXT NOT NULL, target_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (guild_id, reporter_id, target_id));
`);

export const isPlayer = (guildId, userId) => Boolean(db.prepare("SELECT 1 FROM smash_players WHERE guild_id = ? AND user_id = ? AND suspended = 0").get(guildId, userId));

export function join(guildId, userId, adult, now = Date.now()) {
  if (adult !== true) return "⛔ Le jeu est réservé aux personnes majeures : confirme avec `majeur: oui`.";
  db.prepare("INSERT INTO smash_players(guild_id, user_id, joined_at) VALUES (?,?,?) ON CONFLICT(guild_id, user_id) DO NOTHING").run(guildId, userId, now);
  return "✅ Tu participes au smash or pass. Tu peux te retirer à tout moment avec `/smash desinscrire`.";
}

/** Désinscription : profil, votes reçus et donnés, signalements effacés. */
export function leave(guildId, userId) {
  db.prepare("DELETE FROM smash_players WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
  db.prepare("DELETE FROM smash_votes WHERE guild_id = ? AND (target_id = ? OR voter_id = ?)").run(guildId, userId, userId);
  db.prepare("DELETE FROM smash_reports WHERE guild_id = ? AND target_id = ?").run(guildId, userId);
  return "✅ Tu ne participes plus : ton profil et tes votes sont effacés.";
}

/** Prochain profil à noter : un inscrit (non suspendu), pas soi-même, pas encore noté. */
export function nextTarget(guildId, voterId, random = Math.random) {
  const rows = db.prepare(`SELECT user_id FROM smash_players p WHERE guild_id = ? AND suspended = 0 AND user_id <> ?
    AND NOT EXISTS (SELECT 1 FROM smash_votes v WHERE v.guild_id = p.guild_id AND v.voter_id = ? AND v.target_id = p.user_id)`).all(guildId, voterId, voterId);
  return rows.length ? rows[Math.floor(random() * rows.length)].user_id : null;
}

export function vote(guildId, voterId, targetId, choice, now = Date.now()) {
  if (!["smash", "pass"].includes(choice)) throw new Error("Vote inconnu.");
  if (voterId === targetId) throw new Error("Tu ne peux pas voter pour toi.");
  if (!isPlayer(guildId, voterId)) throw new Error("Inscris-toi d'abord avec `/smash inscrire`.");
  if (!isPlayer(guildId, targetId)) throw new Error("Ce profil ne participe plus.");
  db.prepare("INSERT INTO smash_votes(guild_id, voter_id, target_id, vote, at) VALUES (?,?,?,?,?) ON CONFLICT(guild_id, voter_id, target_id) DO UPDATE SET vote = excluded.vote, at = excluded.at").run(guildId, voterId, targetId, choice, now);
}

/** Score d'un profil : compteurs seulement, jamais les noms des votants. */
export function score(guildId, userId) {
  const rows = db.prepare("SELECT vote, COUNT(*) AS n FROM smash_votes WHERE guild_id = ? AND target_id = ? GROUP BY vote").all(guildId, userId);
  const get = (v) => Number(rows.find((r) => r.vote === v)?.n ?? 0);
  return { smash: get("smash"), pass: get("pass") };
}

/** Signalement ; au 3e, le profil est suspendu en attendant le staff. Retourne true si suspendu. */
export function report(guildId, reporterId, targetId, now = Date.now()) {
  db.prepare("INSERT OR IGNORE INTO smash_reports(guild_id, reporter_id, target_id, at) VALUES (?,?,?,?)").run(guildId, reporterId, targetId, now);
  const n = Number(db.prepare("SELECT COUNT(*) AS n FROM smash_reports WHERE guild_id = ? AND target_id = ?").get(guildId, targetId).n);
  if (n >= REPORT_LIMIT) {
    db.prepare("UPDATE smash_players SET suspended = 1 WHERE guild_id = ? AND user_id = ?").run(guildId, targetId);
    return true;
  }
  return false;
}

const isStaff = (member, settings) => Boolean(member?.permissions?.has?.(P.ModerateMembers) || member?.permissions?.has?.(P.Administrator)
  || [settings?.sysPlus?.roleId, settings?.adminPlus?.roleId].filter(Boolean).some((id) => member?.roles?.cache?.has?.(id)));

function card(guild, targetId) {
  const member = guild.members?.cache?.get?.(targetId);
  const avatar = member?.displayAvatarURL?.({ size: 256 }) ?? null;
  return {
    embeds: [{ title: "🔥 Smash or pass ?", description: `<@${targetId}>\nVote anonyme : personne ne saura ce que tu as choisi.`, ...(avatar ? { thumbnail: { url: avatar } } : {}) }],
    components: [{ type: 1, components: [
      { type: 2, style: 3, label: "Smash", emoji: { name: "🔥" }, custom_id: `smash:vote:smash:${targetId}` },
      { type: 2, style: 2, label: "Pass", emoji: { name: "👋" }, custom_id: `smash:vote:pass:${targetId}` },
      { type: 2, style: 4, label: "Signaler", emoji: { name: "🚩" }, custom_id: `smash:report:${targetId}` },
    ] }],
    allowedMentions: { parse: [] },
  };
}

export async function handleSmashInteraction(interaction, settings = null) {
  const guild = interaction?.guild;
  if (!guild) return false;
  const userId = interaction.user?.id;
  if (interaction.isButton?.() && String(interaction.customId).startsWith("smash:")) {
    const [, kind, a, b] = interaction.customId.split(":");
    try {
      if (kind === "vote") {
        vote(guild.id, userId, b, a);
        const next = nextTarget(guild.id, userId);
        await interaction.reply({ ...(next ? card(guild, next) : { content: "✅ Vote enregistré. Tu as vu tous les profils pour l'instant." }), ephemeral: true });
      } else if (kind === "report") {
        const suspended = report(guild.id, userId, a);
        if (suspended) void logEvent(guild, settings, { category: "moderation", action: "smash_suspended", severity: "warning", targetId: a, details: "Profil de smash or pass suspendu après 3 signalements : à vérifier (`/smash retirer` ou `/smash retablir`)." }).catch(() => {});
        await interaction.reply({ content: "🚩 Merci, le signalement est transmis au staff.", ephemeral: true });
      }
    } catch (error) {
      await respondInPlaceSafe(interaction, { content: `❌ ${error.message}`, ephemeral: true });
    }
    return true;
  }
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== "smash") return false;
  const sub = interaction.options.getSubcommand();
  const reply = (content) => interaction.reply({ content, ephemeral: true, allowedMentions: { parse: [] } });
  if (sub === "inscrire") return reply(join(guild.id, userId, interaction.options.getBoolean("majeur", true))).then(() => true);
  if (sub === "desinscrire") return reply(leave(guild.id, userId)).then(() => true);
  if (sub === "score") { const s = score(guild.id, userId); return reply(`🔥 ${s.smash} smash · 👋 ${s.pass} pass (votes anonymes)`).then(() => true); }
  if (sub === "jouer") {
    if (!isPlayer(guild.id, userId)) return reply("ℹ️ Inscris-toi d'abord avec `/smash inscrire majeur: oui`.").then(() => true);
    const next = nextTarget(guild.id, userId);
    await interaction.reply({ ...(next ? card(guild, next) : { content: "ℹ️ Aucun profil à noter pour l'instant." }), ephemeral: true });
    return true;
  }
  if (!isStaff(interaction.member, settings)) return reply("⛔ Réservé au staff.").then(() => true);
  const target = interaction.options.getUser("membre", true);
  if (sub === "retirer") { leave(guild.id, target.id); void logEvent(guild, settings, { category: "moderation", action: "smash_removed", severity: "notice", actorId: userId, targetId: target.id }).catch(() => {}); return reply(`✅ <@${target.id}> retiré du jeu.`).then(() => true); }
  if (sub === "retablir") { db.prepare("UPDATE smash_players SET suspended = 0 WHERE guild_id = ? AND user_id = ?").run(guild.id, target.id); db.prepare("DELETE FROM smash_reports WHERE guild_id = ? AND target_id = ?").run(guild.id, target.id); return reply(`✅ Profil de <@${target.id}> rétabli.`).then(() => true); }
  return false;
}
