// FWU blacklist (on FWU, next to /ban). A blacklisted account is banned now,
// even if it is not on the server (ban by ID), and banned again automatically
// if it ever comes back (manual unban, other invite…).
//
// Access: the OWNER and SYS+. Discord's hierarchy still applies to a present
// member: nobody blacklists the owner, a higher role, the bot or themselves.
// Removing someone from the blacklist also lifts their Discord ban (owner
// decision, 23/11/2026).
import { db } from "./database.js";
import { sendCentralLog, systemLogEmbed } from "./logs.js";
import { parsePndOwnerId } from "./pnd-owner-policy.js";
import { recordSysPlusAudit } from "./systems/sysplus/audit.js";
import { isSysPlus } from "./systems/sysplus/permissions.js";
import { evaluateTargetHierarchy } from "./target-hierarchy-policy.js";
import { openModerationGate } from "./shared/moderation-gate.js";
import { recordSanction } from "./shared/audit.js";

db.exec(`CREATE TABLE IF NOT EXISTS blacklist_entries (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
  added_by TEXT NOT NULL, added_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);`);

const SNOWFLAKE = /^\d{5,25}$/;
export const BLACKLIST_DENIED = "⛔ La blacklist est réservée à l'OWNER et aux SYS+.";

export function isBlacklisted(guildId, userId) {
  return Boolean(db.prepare("SELECT 1 FROM blacklist_entries WHERE guild_id=? AND user_id=?").get(guildId, userId));
}

export function getBlacklistEntry(guildId, userId) {
  return db.prepare("SELECT user_id, reason, added_by, added_at FROM blacklist_entries WHERE guild_id=? AND user_id=?").get(guildId, userId) ?? null;
}

export function listBlacklist(guildId, limit = 25) {
  return db.prepare("SELECT user_id, reason, added_by, added_at FROM blacklist_entries WHERE guild_id=? ORDER BY added_at DESC LIMIT ?").all(guildId, limit);
}

export function countBlacklist(guildId) {
  return Number(db.prepare("SELECT COUNT(*) AS n FROM blacklist_entries WHERE guild_id=?").get(guildId)?.n ?? 0);
}

export function canUseBlacklist(member, guildSettings) {
  if (!member?.id) return false;
  if (parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID) === member.id) return true;
  return isSysPlus(member, guildSettings?.sysPlus?.roleId ?? null);
}

function banReason(reason, actorId) {
  return `FWU blacklist (par ${actorId})${reason ? ` : ${reason}` : ""}`.slice(0, 500);
}

/**
 * Adds an account and bans it. Throws user-facing errors; nothing is stored
 * if a check fails. Returns { added, alreadyListed, banned }.
 */
export async function addToBlacklist({ guild, actor, userId, reason = "", now = Date.now() }) {
  if (!SNOWFLAKE.test(String(userId ?? ""))) throw new Error("Identifiant Discord invalide.");
  const pndOwnerId = parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);
  if (userId === actor.id) throw new Error("Tu ne peux pas te blacklister toi-même.");
  if (userId === guild.ownerId || userId === pndOwnerId) throw new Error("Cette personne est protégée (propriétaire) : action refusée.");
  if (userId === guild.client?.user?.id) throw new Error("Je ne peux pas me blacklister moi-même.");
  const cleanReason = String(reason ?? "").trim().slice(0, 300);
  let target;
  try {
    target = await guild.members.fetch({ user: userId, force: true });
    if (!target) throw new Error("Member lookup returned no member");
  } catch (error) {
    // A ban by ID is allowed only when Discord explicitly confirms Unknown Member.
    // Network failures, rate limits and other API errors must never skip hierarchy.
    if (Number(error?.code ?? error?.rawError?.code) === 10007) target = null;
    else throw new Error("Hiérarchie illisible : impossible de vérifier ce compte auprès de Discord. Blacklist refusée par sécurité.");
  }
  if (target) {
    const bot = await guild.members.fetchMe();
    const decision = evaluateTargetHierarchy({ actor, target, bot, guildOwnerId: guild.ownerId, pndOwnerId, enforceActorRank: actor.id !== pndOwnerId });
    if (!decision.allowed) throw new Error(decision.reason);
  }
  const already = isBlacklisted(guild.id, userId);
  db.prepare(`INSERT INTO blacklist_entries(guild_id,user_id,reason,added_by,added_at) VALUES(?,?,?,?,?)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET reason=excluded.reason, added_by=excluded.added_by, added_at=excluded.added_at`)
    .run(guild.id, userId, cleanReason, actor.id, now);
  let banned = false;
  try {
    await guild.bans.create(userId, { reason: banReason(cleanReason, actor.id) });
    banned = true;
  } catch {
    banned = false; // Missing Ban Members permission: the entry still bans at the next join attempt.
  }
  return { added: !already, alreadyListed: already, banned, present: Boolean(target) };
}

export function removeFromBlacklist(guildId, userId) {
  return Number(db.prepare("DELETE FROM blacklist_entries WHERE guild_id=? AND user_id=?").run(guildId, userId).changes) > 0;
}

/** Lifts the Discord ban. Returns "unbanned", "not_banned" or "failed". */
export async function liftBlacklistBan(guild, userId, actorId) {
  try {
    await guild.bans.remove(userId, `FWU : retiré de la blacklist par ${actorId}`.slice(0, 500));
    return "unbanned";
  } catch (error) {
    return error?.code === 10026 ? "not_banned" : "failed";
  }
}

/** guildMemberAdd: a blacklisted account is banned again at once. */
export async function enforceBlacklistOnJoin(member, record = () => {}) {
  if (!member?.guild || !isBlacklisted(member.guild.id, member.id)) return false;
  const entry = getBlacklistEntry(member.guild.id, member.id);
  try {
    await member.ban({ reason: banReason(entry?.reason, entry?.added_by ?? "FWU") });
    record("blacklist_rebanned");
    return true;
  } catch {
    record("blacklist_reban_error");
    return false;
  }
}

function formatEntry(row) {
  return `• <@${row.user_id}> (\`${row.user_id}\`) — ${row.reason || "sans raison"} · par <@${row.added_by}> <t:${Math.floor(row.added_at / 1000)}:R>`;
}

/** Shared logic for slash and prefix. Returns the reply text. */
export async function runBlacklistAction({ guild, actor, action, userId = null, reason = "", settings = null, bot = "guard" }) {
  if (action === "list") {
    const rows = listBlacklist(guild.id);
    const total = countBlacklist(guild.id);
    return rows.length ? `⛔ **Blacklist (${total})**\n${rows.map(formatEntry).join("\n")}${total > rows.length ? `\n… et ${total - rows.length} autre(s).` : ""}` : "La blacklist est vide.";
  }
  if (!SNOWFLAKE.test(String(userId ?? ""))) throw new Error("Indique un membre ou un identifiant Discord.");
  if (action === "check") {
    const entry = getBlacklistEntry(guild.id, userId);
    return entry ? `⛔ Blacklisté :\n${formatEntry(entry)}` : `✅ <@${userId}> n'est pas blacklisté.`;
  }
  if (action === "add") {
    // Quota partagé « blacklist » (base centrale ; injoignable = refus).
    const gate = await openModerationGate({ member: actor, command: "blacklist", bot, targetId: userId });
    if (!gate.ok) throw new Error(gate.message.replace(/^\S+\s/, ""));
    let result;
    try {
      result = await addToBlacklist({ guild, actor, userId, reason });
    } catch (error) {
      await gate.fail(error);
      throw error;
    }
    await recordSanction({ guildId: guild.id, targetId: userId, moderatorId: actor.id, action: "blacklist", reason: String(reason ?? "").slice(0, 300), bot }).catch(() => null);
    await gate.succeed(result.banned ? "banni" : "non banni");
    recordSysPlusAudit(guild.id, actor.id, "blacklist.add", userId, { reason: String(reason ?? "").slice(0, 300), banned: result.banned });
    await sendCentralLog(guild, settings, systemLogEmbed({
      title: "⛔ Blacklist — compte ajouté",
      description: `Compte : <@${userId}> (\`${userId}\`)\nPar : <@${actor.id}>\nRaison : ${reason || "non précisée"}\nBanni : ${result.banned ? "oui" : "non (permission Bannir manquante)"}`,
      color: 0xef4444,
    })).catch(() => {});
    if (!result.banned) return `⚠️ <@${userId}> est blacklisté, mais je n'ai pas pu le bannir (permission « Bannir des membres » ?). Il sera banni dès qu'il essaiera de revenir, si j'ai la permission.`;
    return `${result.alreadyListed ? "♻️ Déjà blacklisté : raison mise à jour et bannissement confirmé" : "⛔ Blacklisté et banni"} : <@${userId}>.`;
  }
  if (action === "remove") {
    const removed = removeFromBlacklist(guild.id, userId);
    if (!removed) return `ℹ️ <@${userId}> n'était pas blacklisté.`;
    const unban = await liftBlacklistBan(guild, userId, actor.id);
    recordSysPlusAudit(guild.id, actor.id, "blacklist.remove", userId, { unban });
    const unbanText = unban === "unbanned" ? "Débanni" : unban === "not_banned" ? "N'était plus banni" : "Débannissement impossible (permission « Bannir des membres » ?)";
    await sendCentralLog(guild, settings, systemLogEmbed({
      title: "✅ Blacklist — compte retiré",
      description: `Compte : <@${userId}> (\`${userId}\`)\nPar : <@${actor.id}>\n${unbanText}.`,
      color: 0x22c55e,
    })).catch(() => {});
    if (unban === "failed") return `⚠️ <@${userId}> est retiré de la blacklist, mais je n'ai pas pu le débannir (permission « Bannir des membres » ?). Débannis-le depuis Discord.`;
    return `✅ <@${userId}> est retiré de la blacklist${unban === "unbanned" ? " et débanni" : " (il n'était plus banni)"}.`;
  }
  throw new Error("Action inconnue : add, remove, list ou check.");
}

export async function handleBlacklistInteraction(interaction, settings) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== "blacklist") return false;
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: "Cette commande s'utilise sur un serveur.", ephemeral: true });
    return true;
  }
  if (!canUseBlacklist(interaction.member, settings)) {
    await interaction.reply({ content: BLACKLIST_DENIED, ephemeral: true });
    return true;
  }
  const action = interaction.options.getSubcommand(false) ?? "list";
  const user = interaction.options.getUser?.("membre") ?? null;
  const rawId = interaction.options.getString?.("id") ?? null;
  await interaction.deferReply({ ephemeral: true });
  try {
    const content = await runBlacklistAction({
      guild: interaction.guild,
      actor: interaction.member,
      action,
      userId: user?.id ?? rawId?.trim() ?? null,
      reason: interaction.options.getString?.("raison") ?? "",
      settings,
    });
    await interaction.editReply({ content: content.slice(0, 2000), allowedMentions: { parse: [] } });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error instanceof Error ? error.message : "Action impossible."}`, allowedMentions: { parse: [] } });
  }
  return true;
}

export function parseBlacklistPrefix(content) {
  const match = /^=blacklist(?:\s+(add|remove|list|check|liste|ajouter|retirer|verifier|vérifier))?(?:\s+(?:<@!?(\d{5,25})>|(\d{5,25})))?(?:\s+([\s\S]*))?$/i.exec(String(content ?? "").trim());
  if (!match) return null;
  const aliases = { liste: "list", ajouter: "add", retirer: "remove", verifier: "check", "vérifier": "check" };
  const word = (match[1] ?? (match[2] || match[3] ? "check" : "list")).toLowerCase();
  return { action: aliases[word] ?? word, userId: match[2] ?? match[3] ?? null, reason: String(match[4] ?? "").trim() };
}

export async function handleBlacklistMessage(message, settings) {
  if (!message?.guild || !message.member) return false;
  const parsed = parseBlacklistPrefix(message.content);
  if (!parsed) return false;
  const mentions = { parse: [] };
  if (!canUseBlacklist(message.member, settings)) {
    await message.reply({ content: BLACKLIST_DENIED, allowedMentions: mentions });
    return true;
  }
  try {
    const content = await runBlacklistAction({ guild: message.guild, actor: message.member, settings, ...parsed });
    await message.reply({ content: content.slice(0, 2000), allowedMentions: mentions });
  } catch (error) {
    await message.reply({ content: `❌ ${error instanceof Error ? error.message : "Action impossible."}\nUtilisation : \`=blacklist add @membre|id [raison]\` · \`remove\` · \`list\` · \`check\`.`, allowedMentions: mentions });
  }
  return true;
}
