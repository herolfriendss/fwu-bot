// MALUS (SUCK ME) : /malus <type> membre [minutes], /malus stop, /malus liste.
// Garde-fous : SYS+ seulement, hiérarchie (hierarchy-guard central), owner/propriétaire/tier 0
// intouchables, durée 1 à 60 min, 5 malus actifs au plus par SYS+, journalisé, levée à tout moment.
import { PermissionFlagsBits } from "discord.js";
import { db } from "../../database.js";
import { sendCentralLog, systemLogEmbed } from "../../logs.js";
import { parsePndOwnerId } from "../../pnd-owner-policy.js";
import { recordSysPlusAudit } from "../sysplus/audit.js";
import { isSysPlus } from "../sysplus/permissions.js";
import { isTier0Protected } from "../../tier0-shield.js";
import { ALL_KINDS, KIND_LABELS, MAX_ACTIVE_PER_ACTOR, MESSAGE_KINDS, canStartMalus, decideMessage, parseMinutes, signature } from "./policy.js";

const P = PermissionFlagsBits;

db.exec(`CREATE TABLE IF NOT EXISTS malus_active (
  guild_id TEXT NOT NULL, member_id TEXT NOT NULL, kind TEXT NOT NULL,
  started_by TEXT NOT NULL, started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, data TEXT,
  PRIMARY KEY (guild_id, member_id, kind)
)`);
db.exec("CREATE INDEX IF NOT EXISTS malus_active_expiry_idx ON malus_active(expires_at)");

const sablierStamps = new Map();
/** Hooks for kinds handled elsewhere (voice, role, economy): start/stop side effects. */
const kindHooks = new Map();
export function registerMalusKind(kind, hooks) { kindHooks.set(kind, hooks); }

export function activeKinds(guildId, memberId, now = Date.now()) {
  return db.prepare("SELECT kind FROM malus_active WHERE guild_id=? AND member_id=? AND expires_at>?").all(guildId, memberId, now).map((r) => r.kind);
}
export function activeMalus(guildId, memberId, kind, now = Date.now()) {
  return db.prepare("SELECT * FROM malus_active WHERE guild_id=? AND member_id=? AND kind=? AND expires_at>?").get(guildId, memberId, kind, now) ?? null;
}
export function listActiveMalus(guildId, kind = null, now = Date.now()) {
  return kind
    ? db.prepare("SELECT * FROM malus_active WHERE guild_id=? AND kind=? AND expires_at>? ORDER BY expires_at").all(guildId, kind, now)
    : db.prepare("SELECT * FROM malus_active WHERE guild_id=? AND expires_at>? ORDER BY expires_at LIMIT 50").all(guildId, now);
}
function countByActor(guildId, actorId, now = Date.now()) {
  return db.prepare("SELECT COUNT(*) AS n FROM malus_active WHERE guild_id=? AND started_by=? AND expires_at>?").get(guildId, actorId, now).n;
}

async function log(guild, settings, title, description) {
  await sendCentralLog(guild, settings, systemLogEmbed({ category: "moderation", title, description, color: 0x8b5cf6 })).catch(() => {});
}

export class MalusError extends Error {}

/** Checks shared by every malus aimed at a member. Returns { actor, target }. */
export async function requireMalusTarget(interaction, guildSettings, { optionName = "membre" } = {}) {
  const guild = interaction.guild;
  const actor = await guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
  if (!actor || !isSysPlus(actor, guildSettings?.sysPlus?.roleId ?? null)) throw new MalusError("⛔ Les malus sont réservés aux membres SYS+.");
  const user = interaction.options.getUser(optionName, true);
  const target = await guild.members.fetch({ user: user.id, force: true }).catch(() => null);
  if (!target) throw new MalusError("❌ Ce membre n'est pas sur le serveur.");
  if (target.user.bot) throw new MalusError("❌ Pas de malus sur un bot.");
  if (target.id === actor.id) throw new MalusError("❌ Pas de malus sur toi-même.");
  const pndOwnerId = parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);
  if (target.id === guild.ownerId || (pndOwnerId && target.id === pndOwnerId)) throw new MalusError("⛔ Cette personne est intouchable.");
  if (await isTier0Protected(target).catch(() => false)) throw new MalusError("⛔ Ce membre est protégé (tier 0).");
  return { actor, target };
}

/** Stores a malus after the checks. Returns the expiry timestamp. */
export async function startMalus({ guild, actor, target, kind, minutes, data = null, guildSettings }) {
  const now = Date.now();
  if (!activeMalus(guild.id, target.id, kind, now) && !canStartMalus(countByActor(guild.id, actor.id, now))) {
    throw new MalusError(`⛔ Tu as déjà ${MAX_ACTIVE_PER_ACTOR} malus actifs. Lève-en un avec \`/malus stop\` d'abord.`);
  }
  const expiresAt = now + minutes * 60_000;
  const hooks = kindHooks.get(kind);
  if (hooks?.start) await hooks.start({ guild, actor, target, minutes, data, guildSettings });
  db.prepare(`INSERT INTO malus_active(guild_id, member_id, kind, started_by, started_at, expires_at, data) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(guild_id, member_id, kind) DO UPDATE SET started_by=excluded.started_by, started_at=excluded.started_at, expires_at=excluded.expires_at, data=excluded.data`)
    .run(guild.id, target.id, kind, actor.id, now, expiresAt, data === null ? null : JSON.stringify(data));
  try { recordSysPlusAudit(guild.id, actor.id, `malus.${kind}`, target.id, { minutes }); } catch { /* audit best effort */ }
  await log(guild, guildSettings, `${KIND_LABELS[kind]} — malus posé`, `Acteur SYS+ : <@${actor.id}>\nMembre : <@${target.id}>\nDurée : **${minutes} min**`);
  return expiresAt;
}

/** Removes malus rows (all kinds when kind is null) and runs their stop hooks. */
export async function stopMalus({ guild, memberId, kind = null, actorId = null, guildSettings, reason = "levé" }) {
  const rows = kind
    ? db.prepare("SELECT * FROM malus_active WHERE guild_id=? AND member_id=? AND kind=?").all(guild.id, memberId, kind)
    : db.prepare("SELECT * FROM malus_active WHERE guild_id=? AND member_id=?").all(guild.id, memberId);
  for (const row of rows) {
    db.prepare("DELETE FROM malus_active WHERE guild_id=? AND member_id=? AND kind=?").run(guild.id, memberId, row.kind);
    const hooks = kindHooks.get(row.kind);
    if (hooks?.stop) await hooks.stop({ guild, row, data: row.data ? JSON.parse(row.data) : null, guildSettings }).catch(() => {});
  }
  if (rows.length && actorId) {
    try { recordSysPlusAudit(guild.id, actorId, "malus.stop", memberId, { kinds: rows.map((r) => r.kind) }); } catch { /* best effort */ }
  }
  if (rows.length) await log(guild, guildSettings, "🛑 Malus — fin", `Membre : <@${memberId}>\nMalus : ${rows.map((r) => KIND_LABELS[r.kind] ?? r.kind).join(", ")}\nRaison : ${reason}${actorId ? ` par <@${actorId}>` : ""}`);
  return rows.map((r) => r.kind);
}

/** Expires finished malus (called every minute). */
export async function expireMalus(client, settingsByGuild = {}) {
  const rows = db.prepare("SELECT guild_id, member_id, kind FROM malus_active WHERE expires_at<=?").all(Date.now());
  for (const row of rows) {
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) { db.prepare("DELETE FROM malus_active WHERE guild_id=? AND member_id=? AND kind=?").run(row.guild_id, row.member_id, row.kind); continue; }
    await stopMalus({ guild, memberId: row.member_id, kind: row.kind, guildSettings: settingsByGuild[row.guild_id], reason: "durée écoulée" });
  }
  return rows.length;
}

/** Subcommands owned by other modules (voice, games, economy) register here. */
const extraSubcommands = new Map();
export function registerMalusSubcommand(name, handler) { extraSubcommands.set(name, handler); }

async function execute(interaction, guildSettings) {
  const guild = interaction.guild;
  const sub = interaction.options.getSubcommand();
  if (sub === "liste") {
    const rows = listActiveMalus(guild.id);
    if (!rows.length) return "Aucun malus actif.";
    return rows.map((r) => `• ${KIND_LABELS[r.kind] ?? r.kind} — <@${r.member_id}> par <@${r.started_by}>, fin <t:${Math.floor(r.expires_at / 1000)}:R>`).join("\n").slice(0, 1900);
  }
  if (sub === "stop") {
    const actor = await guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
    if (!actor || !isSysPlus(actor, guildSettings?.sysPlus?.roleId ?? null)) throw new MalusError("⛔ Réservé aux membres SYS+.");
    const user = interaction.options.getUser("membre", true);
    const kind = interaction.options.getString("type") ?? null;
    const stopped = await stopMalus({ guild, memberId: user.id, kind, actorId: actor.id, guildSettings });
    return stopped.length ? `🛑 Malus levé(s) pour <@${user.id}> : ${stopped.map((k) => KIND_LABELS[k] ?? k).join(", ")}.` : "Aucun malus actif pour ce membre.";
  }
  if (extraSubcommands.has(sub)) return extraSubcommands.get(sub)(interaction, guildSettings);
  if (!ALL_KINDS.includes(sub)) throw new MalusError("Sous-commande inconnue.");
  const { actor, target } = await requireMalusTarget(interaction, guildSettings);
  const minutes = parseMinutes(interaction.options.getInteger("minutes"));
  const expiresAt = await startMalus({ guild, actor, target, kind: sub, minutes, guildSettings });
  if (MESSAGE_KINDS.includes(sub) && interaction.channel?.send) {
    await interaction.channel.send({ content: `${KIND_LABELS[sub]} : <@${target.id}> est sous malus jusqu'à <t:${Math.floor(expiresAt / 1000)}:t>.`, allowedMentions: { parse: [] } }).catch(() => {});
  }
  return `${KIND_LABELS[sub]} posé sur <@${target.id}> pour ${minutes} min.`;
}

export async function handleMalusInteraction(interaction, guildSettings = {}, record = () => {}) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== "malus") return false;
  if (!interaction.inGuild()) { await interaction.reply({ content: "Les malus marchent seulement dans un serveur.", ephemeral: true }); return true; }
  await interaction.deferReply({ ephemeral: true });
  try {
    await interaction.editReply({ content: await execute(interaction, guildSettings), allowedMentions: { parse: [] } });
  } catch (error) {
    if (!(error instanceof MalusError)) record("malus_error");
    await interaction.editReply({ content: error instanceof MalusError || /durée/.test(error.message) ? error.message : "❌ Le malus n'a pas pu être posé. Vérifie mes permissions.", allowedMentions: { parse: [] } }).catch(() => {});
  }
  return true;
}

/** Applies message malus to one message. Returns true when the message was handled. */
export async function handleMalusMessage(message, record = () => {}, { random = Math.random } = {}) {
  if (!message.guild || message.author?.bot || !message.channel) return false;
  const kinds = activeKinds(message.guild.id, message.author.id).filter((k) => MESSAGE_KINDS.includes(k));
  if (!kinds.length) return false;
  const stampKey = `${message.guild.id}:${message.author.id}`;
  const decision = decideMessage({ kinds, text: message.content, hasAttachments: (message.attachments?.size ?? 0) > 0, lastSablierAt: sablierStamps.get(stampKey) ?? 0, random });
  if (!decision.kind && !decision.sablierStamp) return false;
  const me = message.guild.members.me;
  const perms = me ? message.channel.permissionsFor?.(me) : null;
  if (!perms?.has(P.ManageMessages) || !perms?.has(P.SendMessages)) { record("malus_permission_error"); return false; }
  if (decision.sablierStamp) sablierStamps.set(stampKey, Date.now());
  if (sablierStamps.size > 5_000) sablierStamps.clear();
  let visible = message;
  try {
    if (decision.remove) {
      await message.delete();
      visible = null;
      if (decision.repost) {
        const name = signature(message.member?.displayName ?? message.author.globalName ?? message.author.username);
        visible = await message.channel.send({ content: `**${name}** : ${decision.repost}`, allowedMentions: { parse: [] } });
      }
    }
    if (visible && decision.react) await visible.react(decision.react).catch(() => {});
    if (visible && decision.removeAfterMs) {
      const target = visible;
      setTimeout(() => { void target.delete().catch(() => {}); }, decision.removeAfterMs).unref?.();
    }
    record("malus_applied");
  } catch { record("malus_error"); }
  return decision.remove;
}
