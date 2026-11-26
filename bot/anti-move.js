import { db } from "./database.js";
import { isVoiceRelocation, matchVoiceAuditEntries, restoreBudget, snapshotAuditCounts } from "./anti-move-policy.js";
import { isSysPlus } from "./systems/sysplus/permissions.js";
import { recordSysPlusAudit } from "./systems/sysplus/audit.js";
import { sendCentralLog, systemLogEmbed } from "./logs.js";

const CONFIG_SQL = `SELECT enabled FROM anti_move_config WHERE guild_id=?`;
const getConfigRow = db.prepare(CONFIG_SQL);
const getProtectedRow = db.prepare("SELECT 1 FROM anti_move_protected_members WHERE guild_id=? AND member_id=?");
const getExemptRow = db.prepare("SELECT 1 FROM anti_move_exemptions WHERE guild_id=? AND member_id=?");

export function getAntiMoveConfig(guildId) {
  if (!guildId) return { enabled: false };
  const row = getConfigRow.get(guildId);
  return { enabled: row?.enabled === 1 };
}

export function setAntiMoveEnabled(guildId, enabled, actorId) {
  if (!guildId || !actorId || typeof enabled !== "boolean") throw new Error("Configuration Anti-Move invalide.");
  db.prepare(`INSERT INTO anti_move_config(guild_id,enabled,updated_by,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(guild_id) DO UPDATE SET enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
    .run(guildId, enabled ? 1 : 0, actorId, Date.now());
  return getAntiMoveConfig(guildId);
}

export function protectAntiMoveMember(guildId, memberId, actorId) {
  if (!guildId || !memberId || !actorId) throw new Error("Membre ou serveur invalide.");
  const result = db.prepare(`INSERT OR IGNORE INTO anti_move_protected_members(guild_id,member_id,protected_by,created_at)
    VALUES(?,?,?,?)`).run(guildId, memberId, actorId, Date.now());
  return Number(result.changes) > 0;
}

export function unprotectAntiMoveMember(guildId, memberId) {
  if (!guildId || !memberId) throw new Error("Membre ou serveur invalide.");
  return Number(db.prepare("DELETE FROM anti_move_protected_members WHERE guild_id=? AND member_id=?").run(guildId, memberId).changes) > 0;
}

export function isAntiMoveProtected(guildId, memberId) {
  return Boolean(guildId && memberId && getProtectedRow.get(guildId, memberId));
}

export function listAntiMoveProtectedMembers(guildId) {
  return db.prepare("SELECT member_id,protected_by,created_at FROM anti_move_protected_members WHERE guild_id=? ORDER BY created_at DESC LIMIT 50").all(guildId);
}

export function addAntiMoveExemption(guildId, memberId, actorId) {
  if (!guildId || !memberId || !actorId) throw new Error("Membre ou serveur invalide.");
  const result = db.prepare(`INSERT OR IGNORE INTO anti_move_exemptions(guild_id,member_id,created_by,created_at)
    VALUES(?,?,?,?)`).run(guildId, memberId, actorId, Date.now());
  return Number(result.changes) > 0;
}

export function removeAntiMoveExemption(guildId, memberId) {
  if (!guildId || !memberId) throw new Error("Membre ou serveur invalide.");
  return Number(db.prepare("DELETE FROM anti_move_exemptions WHERE guild_id=? AND member_id=?").run(guildId, memberId).changes) > 0;
}

export function listAntiMoveExemptions(guildId) {
  return db.prepare("SELECT member_id,created_by,created_at FROM anti_move_exemptions WHERE guild_id=? ORDER BY created_at DESC LIMIT 50").all(guildId);
}

// Per guild+type snapshot of audit entry counts, used to detect aggregated
// MEMBER_MOVE/MEMBER_DISCONNECT increments (Discord reuses one entry per
// executor and bumps its count instead of creating a new one).
const auditSnapshots = new Map();
const guildQueues = new Map();
const restoreHistory = new Map();
const loopWarnings = new Map();

function snapshotKey(guildId, type) { return `${guildId}:${type}`; }

async function auditTypes() {
  const { AuditLogEvent } = await import("discord.js");
  return { move: AuditLogEvent.MemberMove, disconnect: AuditLogEvent.MemberDisconnect };
}

function serializeForGuild(guildId, task) {
  const previous = guildQueues.get(guildId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  guildQueues.set(guildId, next.finally(() => { if (guildQueues.get(guildId) === next) guildQueues.delete(guildId); }));
  return next;
}

async function refreshSnapshot(guild, type) {
  const logs = await guild.fetchAuditLogs({ type, limit: 25 }).catch(() => null);
  if (!logs) return null;
  const entries = [...logs.entries.values()];
  auditSnapshots.set(snapshotKey(guild.id, type), { at: Date.now(), counts: snapshotAuditCounts(entries) });
  return entries;
}

/** Primes/refreshes snapshots for guilds where Anti-Move protects someone. */
export async function primeAntiMoveAuditSnapshots(client) {
  const types = await auditTypes();
  let primed = 0;
  for (const guild of client?.guilds?.cache?.values?.() ?? []) {
    if (!getAntiMoveConfig(guild.id).enabled || !listAntiMoveProtectedMembers(guild.id).length) continue;
    const bot = guild.members?.me;
    if (!bot?.permissions?.has?.("ViewAuditLog")) continue;
    await serializeForGuild(guild.id, async () => {
      await refreshSnapshot(guild, types.move);
      await refreshSnapshot(guild, types.disconnect);
    });
    primed += 1;
  }
  return primed;
}

async function findAuditActor(guild, targetId, botId, destinationChannelId) {
  const types = await auditTypes();
  const type = destinationChannelId ? types.move : types.disconnect;
  const key = snapshotKey(guild.id, type);
  // Discord audit logs can lag slightly behind the gateway event. Retry twice,
  // but never infer an actor when the matching record is absent or ambiguous.
  return serializeForGuild(guild.id, async () => {
    const previous = auditSnapshots.get(key)?.counts ?? null;
    for (const waitMs of [0, 400, 900]) {
      if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
      const logs = await guild.fetchAuditLogs({ type, limit: 25 }).catch(() => null);
      if (!logs) continue;
      const entries = [...logs.entries.values()];
      const match = matchVoiceAuditEntries(entries, { targetId, botId, destinationChannelId, now: Date.now(), previousCounts: previous });
      if (match) {
        // Consume the increment so the same activity cannot be reused.
        auditSnapshots.set(key, { at: Date.now(), counts: snapshotAuditCounts(entries) });
        return match;
      }
      if (waitMs === 900) auditSnapshots.set(key, { at: Date.now(), counts: snapshotAuditCounts(entries) });
    }
    return null;
  });
}

export function resetAntiMoveRuntimeState() {
  auditSnapshots.clear();
  guildQueues.clear();
  restoreHistory.clear();
  loopWarnings.clear();
}

/**
 * Restores an individually protected member only when Discord's audit log
 * proves another human moved them. Forced disconnects cannot be undone by a
 * bot (a member outside voice cannot be moved), so they are logged only.
 * Missing permissions, audit ambiguity, self-moves, configured exemptions
 * and repeated ping-pong all fail closed.
 */
/**
 * `force: true` (rôle 0 % intouchable) : protège le membre même si l'Anti-Move
 * est désactivé sur le serveur ou si le membre n'est pas dans sa liste.
 */
export async function handleAntiMoveVoiceState(oldState, newState, rawSettings = null, { force = false } = {}) {
  if (!isVoiceRelocation(oldState, newState)) return false;
  const guild = newState.guild ?? oldState.guild;
  const memberId = newState.id ?? oldState.id;
  if (!force && (!getAntiMoveConfig(guild.id).enabled || !isAntiMoveProtected(guild.id, memberId))) return false;

  const bot = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!bot?.id || !bot.permissions?.has?.("ViewAuditLog") || !bot.permissions?.has?.("MoveMembers")) return false;
  const member = newState.member ?? await guild.members.fetch(memberId).catch(() => null);
  if (!member || member.user?.bot || !oldState.channelId) return false;

  const destinationChannelId = newState.channelId ?? null;
  const audit = await findAuditActor(guild, memberId, bot.id, destinationChannelId).catch(() => null);
  if (!audit?.actorId || audit.actorId === memberId || audit.actorId === bot.id) return false;
  if (getExemptRow.get(guild.id, audit.actorId)) return false;

  if (!destinationChannelId) {
    recordSysPlusAudit(guild.id, bot.id, "anti_move.disconnect_detected", memberId, { actorId: audit.actorId, fromChannelId: oldState.channelId });
    void sendCentralLog(guild, rawSettings, systemLogEmbed({
      title: "🛡️ ANTI-MOVE — déconnexion forcée",
      description: `Membre protégé : <@${memberId}>\nAuteur identifié : <@${audit.actorId}>\nSalon quitté : <#${oldState.channelId}>\nDiscord ne permet pas de reconnecter un membre : aucune restauration possible.`,
      color: 0xf59e0b,
    })).catch(() => {});
    return false;
  }

  const historyKey = `${guild.id}:${memberId}`;
  const budget = restoreBudget(restoreHistory.get(historyKey));
  restoreHistory.set(historyKey, budget.timestamps);
  if (!budget.allowed) {
    const lastWarning = loopWarnings.get(historyKey) ?? 0;
    if (Date.now() - lastWarning > 60_000) {
      loopWarnings.set(historyKey, Date.now());
      recordSysPlusAudit(guild.id, bot.id, "anti_move.loop_stopped", memberId, { actorId: audit.actorId });
      void sendCentralLog(guild, rawSettings, systemLogEmbed({
        title: "🛡️ ANTI-MOVE — restauration suspendue",
        description: `Membre protégé : <@${memberId}>\nAuteur répété : <@${audit.actorId}>\nTrop de déplacements en 60 s : le bot arrête de restaurer pour éviter une boucle. Intervention humaine requise.`,
        color: 0xdc2626,
      })).catch(() => {});
    }
    return false;
  }

  const origin = guild.channels?.cache?.get?.(oldState.channelId) ?? oldState.channel ?? await guild.channels?.fetch?.(oldState.channelId).catch(() => null);
  if (!origin) return false;
  // The member may have moved again (or left) while the audit log was read.
  const current = await guild.members.fetch({ user: memberId, force: true }).catch(() => member);
  if ((current?.voice?.channelId ?? null) !== destinationChannelId) return false;
  try {
    await current.voice.setChannel(oldState.channelId, `Anti-Move : déplacement individuel protégé (acteur ${audit.actorId})`);
  } catch (error) {
    void sendCentralLog(guild, rawSettings, systemLogEmbed({
      title: "🛡️ ANTI-MOVE — restauration impossible",
      description: `Membre protégé : <@${memberId}>\nAuteur identifié : <@${audit.actorId}>\nDiscord a refusé le retour dans <#${oldState.channelId}> (permissions ou salon plein).`,
      color: 0xdc2626,
    })).catch(() => {});
    return false;
  }
  recordSysPlusAudit(guild.id, bot.id, "anti_move.restore", memberId, {
    actorId: audit.actorId,
    fromChannelId: oldState.channelId,
    attemptedChannelId: destinationChannelId,
    action: audit.action,
  });
  void sendCentralLog(guild, rawSettings, systemLogEmbed({
    title: "🛡️ ANTI-MOVE — déplacement bloqué",
    description: `Membre protégé : <@${memberId}>\nAuteur identifié : <@${audit.actorId}>\nRetour dans : <#${oldState.channelId}>`,
    color: 0x16a34a,
  })).catch(() => {});
  return true;
}

function targetIdFromMessage(message) {
  const parts = message.content.trim().split(/\s+/);
  return message.mentions?.members?.first?.()?.id
    ?? parts.slice(2).join(" ").match(/^<@!?(\d{5,25})>$/)?.[1]
    ?? parts[2]?.match(/^(\d{5,25})$/)?.[1]
    ?? null;
}

function settingsFor(rawSettings, guildId) {
  return rawSettings?.[guildId] ?? rawSettings ?? {};
}

function formatMemberRows(rows) {
  return rows.length ? rows.map((row) => `• <@${row.member_id}>`).join("\n") : "Aucun membre enregistré.";
}

export async function handleAntiMoveMessage(message, rawSettings = null) {
  if (!message?.guild || !message?.member) return true;
  const settings = settingsFor(rawSettings, message.guild.id);
  if (!isSysPlus(message.member, settings?.sysPlus?.roleId ?? null)) {
    await message.reply("⛔ La configuration ANTI-MOVE est réservée au SYS+.");
    return true;
  }

  const parts = message.content.trim().split(/\s+/);
  const subcommand = (parts[1] ?? "config").toLowerCase();
  const targetId = targetIdFromMessage(message);
  const guildId = message.guild.id;
  const actorId = message.author.id;

  try {
    if (subcommand === "config") {
      const state = parts[2]?.toLowerCase();
      if (state && !["on", "off", "activer", "desactiver"].includes(state)) {
        throw new Error("Utilisation : `=anti-moove config on|off`.");
      }
      if (state && ["on", "activer"].includes(state)) {
        const bot = await message.guild.members.fetchMe().catch(() => null);
        if (!bot?.permissions?.has?.("ViewAuditLog") || !bot?.permissions?.has?.("MoveMembers")) {
          throw new Error("Pour activer ANTI-MOVE, donne au bot les permissions Discord « Voir le journal d’audit » et « Déplacer des membres ».");
        }
      }
      const config = state ? setAntiMoveEnabled(guildId, ["on", "activer"].includes(state), actorId) : getAntiMoveConfig(guildId);
      if (state) recordSysPlusAudit(guildId, actorId, "anti_move.config", null, { enabled: config.enabled });
      await message.reply(`🛡️ **ANTI-MOVE individuel** : ${config.enabled ? "✅ activé" : "⏸️ désactivé"}.\nUtilise =anti-moove proteger @membre, retirer @membre ou liste.`);
      return true;
    }

    if (["proteger", "protéger", "retirer", "exception-ajouter", "exception-retirer"].includes(subcommand)) {
      if (!targetId) throw new Error(`Utilisation : =anti-moove ${subcommand} @membre.`);
      const target = await message.guild.members.fetch(targetId).catch(() => null);
      if (!target) throw new Error("Je ne trouve pas ce membre sur le serveur.");
      if (target.user?.bot) throw new Error("ANTI-MOVE ne s’applique pas aux bots.");

      if (["proteger", "protéger"].includes(subcommand)) {
        const inserted = protectAntiMoveMember(guildId, target.id, actorId);
        if (inserted) recordSysPlusAudit(guildId, actorId, "anti_move.protect", target.id);
        await message.reply({ content: inserted ? `🔒 <@${target.id}> est maintenant protégé contre les déplacements vocaux forcés.` : `ℹ️ <@${target.id}> est déjà protégé.`, allowedMentions: { parse: [] } });
      } else if (subcommand === "retirer") {
        const removed = unprotectAntiMoveMember(guildId, target.id);
        if (removed) recordSysPlusAudit(guildId, actorId, "anti_move.unprotect", target.id);
        await message.reply({ content: removed ? `🔓 Protection ANTI-MOVE retirée pour <@${target.id}>.` : `ℹ️ <@${target.id}> n’était pas protégé.`, allowedMentions: { parse: [] } });
      } else if (subcommand === "exception-ajouter") {
        const inserted = addAntiMoveExemption(guildId, target.id, actorId);
        if (inserted) recordSysPlusAudit(guildId, actorId, "anti_move.exemption_add", target.id);
        await message.reply({ content: inserted ? `✅ <@${target.id}> peut maintenant déplacer les membres protégés.` : `ℹ️ <@${target.id}> est déjà une exception.`, allowedMentions: { parse: [] } });
      } else {
        const removed = removeAntiMoveExemption(guildId, target.id);
        if (removed) recordSysPlusAudit(guildId, actorId, "anti_move.exemption_remove", target.id);
        await message.reply({ content: removed ? `✅ L’exception de <@${target.id}> a été retirée.` : `ℹ️ <@${target.id}> n’était pas une exception.`, allowedMentions: { parse: [] } });
      }
      return true;
    }

    if (subcommand === "liste") {
      const members = listAntiMoveProtectedMembers(guildId);
      const exceptions = listAntiMoveExemptions(guildId);
      await message.reply({ content: `🛡️ **Membres protégés**\n${formatMemberRows(members)}\n\n**Exceptions**\n${formatMemberRows(exceptions)}`, allowedMentions: { parse: [] } });
      return true;
    }

    if (subcommand === "exceptions") {
      await message.reply({ content: `**Exceptions ANTI-MOVE**\n${formatMemberRows(listAntiMoveExemptions(guildId))}`, allowedMentions: { parse: [] } });
      return true;
    }
    throw new Error("Sous-commande inconnue. Utilise `config`, `proteger`, `retirer`, `liste`, `exception-ajouter` ou `exception-retirer`.");
  } catch (error) {
    await message.reply(`❌ ${error.message}`).catch(() => {});
    return true;
  }
}
