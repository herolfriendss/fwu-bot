import { AuditLogEvent, EmbedBuilder, MessageFlags, PermissionFlagsBits } from "discord.js";
import { db } from "./database.js";
import { isSysPlus } from "./systems/sysplus/permissions.js";
import { recordSysPlusAudit } from "./systems/sysplus/audit.js";
import { findUniqueAntiMoveEntry, isSuppressedAntiMoveReturn } from "./anti-move-policy.js";

const P = PermissionFlagsBits;
const suppressedReturns = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function personalEnabled(guildId, userId) {
  return db.prepare("SELECT enabled FROM sysplus_anti_move_preferences WHERE guild_id=? AND user_id=?").get(guildId, userId)?.enabled === 1;
}
function globalEnabled(guildId) {
  const row = db.prepare("SELECT enabled FROM sysplus_anti_move_config WHERE guild_id=?").get(guildId);
  return row ? row.enabled === 1 : true;
}
function addLog(guildId, protectedId, actorId, fromId, toId, action, details = null) {
  db.prepare("INSERT INTO sysplus_anti_move_logs(guild_id,protected_user_id,actor_id,from_channel_id,to_channel_id,action,details,created_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(guildId, protectedId, actorId ?? null, fromId ?? null, toId ?? null, action, details ? JSON.stringify(details).slice(0, 1000) : null, Date.now());
  db.prepare("DELETE FROM sysplus_anti_move_logs WHERE guild_id=? AND id NOT IN (SELECT id FROM sysplus_anti_move_logs WHERE guild_id=? ORDER BY id DESC LIMIT 200)").run(guildId, guildId);
}
async function fetchMember(guild, id) { return guild.members.fetch({ user: id, force: true }).catch(() => null); }
function userIdsFromMessage(message) { return [...(message.mentions.users?.values?.() ?? [])].map((user) => user.id); }

async function perform({ guild, actor, settings, group, action, options, send, record = () => {} }) {
  const sysPlus = isSysPlus(actor, settings?.sysPlus?.roleId ?? null);

  if (action === "on") {
    const bot = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!bot?.permissions.has(P.ViewAuditLog) || !bot?.permissions.has(P.MoveMembers)) {
      await send("❌ Le bot doit avoir les permissions Voir les logs du serveur et Déplacer des membres.");
      return true;
    }
    db.prepare("INSERT INTO sysplus_anti_move_preferences(guild_id,user_id,enabled,updated_at) VALUES(?,?,1,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET enabled=1,updated_at=excluded.updated_at").run(guild.id, actor.id, Date.now());
    recordSysPlusAudit(guild.id, actor.id, "anti_move.enabled", actor.id);
    await send("🛡️ ANTI-MOVE activé sur ton compte. Tes déplacements volontaires restent autorisés.");
    return true;
  }
  if (action === "off") {
    db.prepare("INSERT INTO sysplus_anti_move_preferences(guild_id,user_id,enabled,updated_at) VALUES(?,?,0,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET enabled=0,updated_at=excluded.updated_at").run(guild.id, actor.id, Date.now());
    recordSysPlusAudit(guild.id, actor.id, "anti_move.disabled", actor.id);
    await send("✅ ANTI-MOVE désactivé sur ton compte.");
    return true;
  }
  if (action === "status") {
    await send("🛡️ Ta protection : " + (personalEnabled(guild.id, actor.id) ? "activée" : "désactivée") + "\nSystème serveur : " + (globalEnabled(guild.id) ? "actif" : "suspendu") + "\nTes changements de vocal volontaires restent autorisés.");
    return true;
  }
  if (action === "config") {
    if (!sysPlus) { await send("⛔ La configuration générale est réservée à la SYS+."); return true; }
    const enabled = options.state === "on";
    db.prepare("INSERT INTO sysplus_anti_move_config(guild_id,enabled,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=excluded.updated_at").run(guild.id, enabled ? 1 : 0, actor.id, Date.now());
    recordSysPlusAudit(guild.id, actor.id, "anti_move.config", guild.id, { enabled });
    await send(enabled ? "✅ ANTI-MOVE global activé pour les membres inscrits." : "⏸️ ANTI-MOVE global suspendu. Les préférences personnelles sont conservées.");
    return true;
  }
  if (group === "whitelist") {
    const protectedId = options.memberId ?? actor.id;
    if (protectedId !== actor.id && !sysPlus) { await send("⛔ Tu peux gérer uniquement ta propre liste blanche."); return true; }
    const protectedMember = await fetchMember(guild, protectedId);
    if (!protectedMember || protectedMember.user.bot) { await send("❌ Membre protégé introuvable."); return true; }
    if (action === "list") {
      const rows = db.prepare("SELECT allowed_actor_id FROM sysplus_anti_move_whitelist WHERE guild_id=? AND protected_user_id=? ORDER BY allowed_actor_id").all(guild.id, protectedId);
      await send(rows.length ? "📋 Personnes autorisées à déplacer <@" + protectedId + "> : " + rows.map((row) => "<@" + row.allowed_actor_id + ">").join(", ") : "Aucune exception pour <@" + protectedId + ">.");
      return true;
    }
    const allowedId = options.allowedId;
    const allowed = await fetchMember(guild, allowedId);
    if (!allowed || allowed.user.bot || allowedId === protectedId) { await send("❌ Mentionne un autre membre humain présent sur le serveur."); return true; }
    if (action === "add") {
      db.prepare("INSERT OR IGNORE INTO sysplus_anti_move_whitelist(guild_id,protected_user_id,allowed_actor_id,created_by,created_at) VALUES(?,?,?,?,?)").run(guild.id, protectedId, allowedId, actor.id, Date.now());
      recordSysPlusAudit(guild.id, actor.id, "anti_move.whitelist.add", protectedId, { allowedActorId: allowedId });
      await send("✅ <@" + allowedId + "> pourra te déplacer sans déclencher ta protection.");
      return true;
    }
    if (action === "remove") {
      const result = db.prepare("DELETE FROM sysplus_anti_move_whitelist WHERE guild_id=? AND protected_user_id=? AND allowed_actor_id=?").run(guild.id, protectedId, allowedId);
      if (result.changes) recordSysPlusAudit(guild.id, actor.id, "anti_move.whitelist.remove", protectedId, { allowedActorId: allowedId });
      await send(result.changes ? "✅ Exception supprimée." : "Aucune exception trouvée.");
      return true;
    }
  }
  if (action === "logs") {
    const targetId = options.memberId ?? null;
    if (targetId && targetId !== actor.id && !sysPlus) { await send("⛔ Tu peux consulter uniquement ton propre journal."); return true; }
    const rows = targetId
      ? db.prepare("SELECT * FROM sysplus_anti_move_logs WHERE guild_id=? AND protected_user_id=? ORDER BY id DESC LIMIT 10").all(guild.id, targetId)
      : sysPlus
        ? db.prepare("SELECT * FROM sysplus_anti_move_logs WHERE guild_id=? ORDER BY id DESC LIMIT 10").all(guild.id)
        : db.prepare("SELECT * FROM sysplus_anti_move_logs WHERE guild_id=? AND protected_user_id=? ORDER BY id DESC LIMIT 10").all(guild.id, actor.id);
    const lines = rows.map((row) => "• <t:" + Math.floor(Number(row.created_at) / 1000) + ":R> — <@" + row.protected_user_id + "> · " + row.action + (row.actor_id ? " · auteur probable : <@" + row.actor_id + ">" : "") + (row.from_channel_id ? " · <#" + row.from_channel_id + ">" : "") + (row.to_channel_id ? " → <#" + row.to_channel_id + ">" : ""));
    await send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🛡️ Journal ANTI-MOVE").setDescription(lines.length ? lines.join("\n") : "Aucun incident enregistré.").setFooter({ text: "Les incidents ambigus ne déclenchent aucun retour automatique." })], allowedMentions: { parse: [] } });
    return true;
  }
  await send("Commandes : +anti-move on, off, status, config on|off, whitelist add|remove|list, logs.");
  return true;
}

export async function handleAntiMoveInteraction(interaction, settings, { record = () => {} } = {}) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "anti-move" || !interaction.inGuild()) return false;
  const guild = interaction.guild;
  const actor = await fetchMember(guild, interaction.user.id);
  if (!actor) { await interaction.reply({ content: "❌ Profil membre introuvable.", flags: MessageFlags.Ephemeral }); return true; }
  const group = interaction.options.getSubcommandGroup(false);
  const action = interaction.options.getSubcommand();
  const send = (payload) => typeof payload === "string"
    ? interaction.reply({ content: payload, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } })
    : interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  await perform({ guild, actor, settings, group, action, options: { state: interaction.options.getString("etat"), memberId: interaction.options.getUser("membre")?.id ?? null, allowedId: interaction.options.getUser("autorise")?.id ?? null }, send, record });
  return true;
}

export async function handleAntiMoveMessage(message, settings, { record = () => {} } = {}) {
  const parts = String(message.content ?? "").trim().split(/\s+/);
  if (!/^[=+]anti-move$/i.test(parts[0] ?? "")) return false;
  const group = parts[1]?.toLowerCase() === "whitelist" ? "whitelist" : null;
  const action = group ? (parts[2]?.toLowerCase() ?? "list") : (parts[1]?.toLowerCase() ?? "status");
  const ids = userIdsFromMessage(message);
  const memberId = ids[0] ?? null;
  const allowedId = ids[1] ?? null;
  const state = group ? parts[3]?.toLowerCase() : parts[2]?.toLowerCase();
  const send = (payload) => message.reply(typeof payload === "string" ? { content: payload, allowedMentions: { parse: [] } } : { ...payload, allowedMentions: { parse: [] } });
  return perform({ guild: message.guild, actor: message.member, settings, group, action, options: { memberId, allowedId, state }, send, record });
}

export async function handleAntiMoveVoiceState(oldState, newState, record = () => {}) {
  const guild = newState.guild ?? oldState.guild;
  const member = newState.member ?? oldState.member;
  if (!guild || !member || member.user?.bot || !oldState.channelId || !newState.channelId || oldState.channelId === newState.channelId) return false;
  if (isSuppressedAntiMoveReturn(suppressedReturns, guild.id, member.id, newState.channelId)) return false;
  if (!globalEnabled(guild.id) || !personalEnabled(guild.id, member.id)) return false;
  const bot = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!bot?.permissions.has(P.ViewAuditLog) || !bot?.permissions.has(P.MoveMembers)) return false;
  const origin = oldState.channel ?? await guild.channels.fetch(oldState.channelId).catch(() => null);
  const destination = newState.channel ?? await guild.channels.fetch(newState.channelId).catch(() => null);
  if (!origin || !destination) return false;
  await sleep(700);
  const audit = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberMove, limit: 10 }).catch(() => null);
  const entry = findUniqueAntiMoveEntry(audit?.entries?.values?.() ?? [], { destinationChannelId: newState.channelId, actorId: member.id, eventAt: Date.now() - 700 });
  if (!entry?.executor?.id || entry.executor.id === bot.id || entry.executor.bot) return false;
  const allowed = db.prepare("SELECT 1 FROM sysplus_anti_move_whitelist WHERE guild_id=? AND protected_user_id=? AND allowed_actor_id=?").get(guild.id, member.id, entry.executor.id);
  if (allowed || member.voice.channelId !== newState.channelId) return false;
  if (!origin.permissionsFor(member)?.has(P.Connect) || !origin.permissionsFor(bot)?.has(P.Connect) || !origin.permissionsFor(bot)?.has(P.MoveMembers)) return false;
  const key = guild.id + ":" + member.id + ":" + oldState.channelId;
  suppressedReturns.set(key, Date.now() + 5_000);
  try {
    await member.voice.setChannel(origin, "ANTI-MOVE individuel activé");
    addLog(guild.id, member.id, entry.executor.id, origin.id, destination.id, "retour effectué", { auditEntryId: entry.id });
    record("anti_move_returned");
    return true;
  } catch (error) {
    suppressedReturns.delete(key);
    addLog(guild.id, member.id, entry.executor.id, origin.id, destination.id, "retour impossible", { reason: error?.message ?? "unknown" });
    record("anti_move_return_error");
    return false;
  }
}
