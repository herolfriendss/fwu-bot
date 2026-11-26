// FWU V2 — /blr et =blr (SUCK ME), application réactive du BLR.
import { AuditLogEvent, PermissionFlagsBits as P } from "discord.js";
import { parsePndOwnerId } from "./pnd-owner-policy.js";
import { memberTier } from "./shared/tiers.js";
import {
  excessBlrRoles, getBlr, getBlrConfig, listActiveBlr, listExpiredBlr, markBlrLifted, parseBlrDuration,
  recordBlr, runBlrInternal, setBlrConfig,
} from "./blr.js";
import { logEvent } from "./log-events.js";
import { privilegedPermissionNames, roleGrantRefusal } from "./role-grant-guard.js";

export const BLR_TIERS = Object.freeze(new Set([0, 1]));

/** OWNER, ou palier 0 % / 1 % (explicite par /quota palier). Base des paliers illisible → refus. */
export async function canManageBlr(member, { env = process.env, tierOf = memberTier } = {}) {
  if (!member?.id) return false;
  const owner = parsePndOwnerId(env.PND_OWNER_DISCORD_ID);
  if (owner && member.id === owner) return true;
  try {
    return BLR_TIERS.has(await tierOf(member, env));
  } catch {
    return false;
  }
}

/** Cible interdite : OWNER, propriétaire du serveur, bot. */
export function blrTargetRefusal(target, guild, env = process.env) {
  const owner = parsePndOwnerId(env.PND_OWNER_DISCORD_ID);
  if (!target) return "⚠️ Membre introuvable sur ce serveur.";
  if (owner && target.id === owner) return "⛔ L'OWNER ne peut pas être BLR.";
  if (target.id === guild.ownerId) return "⛔ Le propriétaire du serveur ne peut pas être BLR.";
  if (target.user?.bot) return "⛔ Un bot ne peut pas être BLR.";
  return null;
}

// Anti-boucle : au plus 5 corrections par membre et par minute.
const corrections = new Map();
function correctionAllowed(key, now = Date.now()) {
  const recent = (corrections.get(key) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= 5) { corrections.set(key, recent); return false; }
  recent.push(now);
  corrections.set(key, recent);
  return true;
}

/**
 * Remet l'état BLR correct : retire tout rôle en trop, s'assure que le rôle membre et le
 * rôle BLR sont là. Retourne { removed, added, failed } (ids).
 */
export async function enforceBlrMember(member, { reason = "BLR : état rétabli" } = {}) {
  const guild = member?.guild;
  if (!guild || !getBlr(guild.id, member.id)) return { removed: [], added: [], failed: [] };
  const config = { guildId: guild.id, ...getBlrConfig(guild.id) };
  const roles = [...(member.roles?.cache?.values?.() ?? [])];
  const excess = excessBlrRoles(roles, config);
  const missing = [config.memberRoleId, config.blrRoleId].filter((id) => id && !member.roles?.cache?.has?.(id) && guild.roles?.cache?.has?.(id));
  const out = { removed: [], added: [], failed: [] };
  await runBlrInternal(async () => {
    for (const roleId of excess) {
      try { await member.roles.remove(roleId, reason); out.removed.push(roleId); } catch { out.failed.push(roleId); }
    }
    if (missing.length) {
      try { await member.roles.add(missing, reason); out.added.push(...missing); } catch { out.failed.push(...missing); }
    }
  });
  return out;
}

/** Qui a donné le rôle ? (journal d'audit, 15 dernières secondes) — pour l'alerte, jamais une sanction. */
async function findRoleGiver(guild, targetId, now = Date.now()) {
  try {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 5 });
    const entry = logs.entries.find((e) => e.target?.id === targetId && now - e.createdTimestamp < 15_000);
    return entry?.executor?.id ?? null;
  } catch {
    return null;
  }
}

/** guildMemberUpdate : un BLR qui reçoit un rôle de trop le perd aussitôt ; alerte au staff. */
export async function handleBlrMemberUpdate(oldMember, newMember, { settings = null, record = () => {}, now = Date.now() } = {}) {
  const guild = newMember?.guild;
  if (!guild || !getBlr(guild.id, newMember.id, now)) return false;
  const config = { guildId: guild.id, ...getBlrConfig(guild.id) };
  const excess = excessBlrRoles([...(newMember.roles?.cache?.values?.() ?? [])], config);
  if (!excess.length) return false;
  const key = `${guild.id}:${newMember.id}`;
  if (!correctionAllowed(key, now)) {
    record("blr_loop_guard");
    return false;
  }
  const result = await enforceBlrMember(newMember, { reason: "BLR : rôle donné à un membre BLR retiré" });
  const giver = await findRoleGiver(guild, newMember.id, now);
  if (giver !== guild.client?.user?.id) {
    void logEvent(guild, settings, {
      category: "permissions", action: "blr_grant_attempt", severity: "critical", actorId: giver, targetId: newMember.id,
      details: `Rôle(s) retiré(s) : ${result.removed.map((id) => `<@&${id}>`).join(", ") || "—"}${result.failed.length ? `\nÉchec : ${result.failed.map((id) => `<@&${id}>`).join(", ")}` : ""}${giver ? "" : "\nAuteur introuvable dans le journal d'audit."}`,
    }).catch(() => {});
  }
  record("blr_reverted");
  return true;
}

/** Retour d'un membre BLR parti : l'état BLR revient depuis la base. */
export async function handleBlrMemberAdd(member, { record = () => {} } = {}) {
  if (!member?.guild || !getBlr(member.guild.id, member.id)) return false;
  await enforceBlrMember(member, { reason: "BLR : retour d'un membre BLR" });
  record("blr_reverted");
  return true;
}

/** Démarrage : vérifie tous les BLR (des rôles ont pu être donnés pendant une panne) et lève les expirés. */
export async function sweepBlr(client, { guildIds = null, record = () => {} } = {}) {
  for (const expired of listExpiredBlr()) {
    const guild = client.guilds.cache.get(expired.guildId);
    if (!guild || (guildIds && !guildIds.includes(guild.id))) continue;
    const member = await guild.members.fetch(expired.userId).catch(() => null);
    await liftBlr({ guild, actorId: null, target: member, targetId: expired.userId, restore: false, reason: "Durée écoulée" }).catch(() => record("blr_error"));
  }
  for (const state of listActiveBlr()) {
    const guild = client.guilds.cache.get(state.guildId);
    if (!guild || (guildIds && !guildIds.includes(guild.id))) continue;
    const member = await guild.members.fetch(state.userId).catch(() => null);
    if (member) await enforceBlrMember(member).catch(() => record("blr_error"));
  }
}

/** Pose un BLR. Retourne { ok, message, caseNumber }. */
export async function setBlr({ guild, actor, target, reason = null, durationText = null, settings = null, env = process.env, now = Date.now(), automatic = false }) {
  const config = getBlrConfig(guild.id);
  if (!config.blrRoleId || !config.memberRoleId) return { ok: false, message: "⚠️ BLR non configuré : `/blr configurer role membre` (OWNER)." };
  // automatic : protection du bot (salon piège), sans membre derrière l'action.
  if (!automatic && !(await canManageBlr(actor, { env }))) return { ok: false, message: "⛔ Seuls l'OWNER et les paliers 0 % et 1 % peuvent poser un BLR." };
  const refusal = blrTargetRefusal(target, guild, env);
  if (refusal) return { ok: false, message: refusal };
  let durationMs;
  try { durationMs = parseBlrDuration(durationText); } catch (error) { return { ok: false, message: `⚠️ ${error.message}` }; }
  const saved = [...target.roles.cache.values()].filter((role) => role.id !== guild.id && !role.managed && role.id !== config.blrRoleId && role.id !== config.memberRoleId).map((role) => role.id);
  const { caseNumber } = await logEvent(guild, settings, {
    category: "moderation", action: "blr_set", severity: "warning", actorId: automatic ? null : actor.id, targetId: target.id, reason,
    details: `Durée : ${durationMs ? `${Math.round(durationMs / 60_000)} min` : "définitive"}\nRôles retirés : ${saved.length}`,
  });
  recordBlr({ guildId: guild.id, userId: target.id, reason, actorId: actor.id, expiresAt: durationMs ? now + durationMs : null, savedRoles: saved, caseNumber }, now);
  const result = await enforceBlrMember(target, { reason: `BLR posé par ${actor.id}` });
  const failed = result.failed.length ? ` (${result.failed.length} rôle(s) au-dessus du bot non retiré(s))` : "";
  return { ok: true, message: `✅ <@${target.id}> est BLR${failed}.`, caseNumber };
}

/** Lève un BLR ; restaure seulement si demandé, et seulement les rôles qui passent la garde. */
export async function liftBlr({ guild, actorId, actor = null, target, targetId = target?.id, restore = false, reason = null, settings = null, env = process.env }) {
  // now = 0 : un BLR expiré mais pas encore levé est trouvé aussi.
  const state = getBlr(guild.id, targetId, 0);
  if (!state) return { ok: false, message: "ℹ️ Ce membre n'est pas BLR." };
  if (actor && !(await canManageBlr(actor, { env }))) return { ok: false, message: "⛔ Seuls l'OWNER et les paliers 0 % et 1 % peuvent lever un BLR." };
  markBlrLifted(guild.id, targetId, actorId);
  const config = getBlrConfig(guild.id);
  const restored = [];
  const refused = [];
  if (target) {
    await runBlrInternal(async () => {
      if (config.blrRoleId && target.roles.cache.has(config.blrRoleId)) await target.roles.remove(config.blrRoleId, "BLR levé").catch(() => {});
      if (!restore) return;
      for (const roleId of state.savedRoles) {
        const role = guild.roles.cache.get(roleId);
        if (!role || role.managed) { refused.push(roleId); continue; }
        const why = await roleGrantRefusal(guild, role, { actorId, settings, targetId: target.id, env });
        // La garde refuse déjà les rôles protégés (sauf OWNER) : on la suit telle quelle.
        if (why) { refused.push(roleId); continue; }
        try { await target.roles.add(role, "BLR levé : restauration"); restored.push(roleId); } catch { refused.push(roleId); }
      }
    });
  }
  await logEvent(guild, settings, {
    category: "moderation", action: "blr_lift", severity: "notice", actorId, targetId, reason,
    details: restore ? `Rôles rendus : ${restored.length} • refusés par la garde : ${refused.length}` : "Sans restauration des rôles",
  }).catch(() => {});
  return { ok: true, message: `✅ <@${targetId}> n'est plus BLR.${restore ? ` ${restored.length} rôle(s) rendu(s), ${refused.length} refusé(s).` : ""}`, restored, refused };
}

async function configure({ guild, actor, blrRole, memberRole, env }) {
  const owner = parsePndOwnerId(env.PND_OWNER_DISCORD_ID);
  if (!owner || actor.id !== owner) return "⛔ La configuration du BLR est réservée à l'OWNER.";
  if (!blrRole || !memberRole) return "⚠️ Indique le rôle BLR et le rôle membre.";
  if (blrRole.id === memberRole.id) return "⚠️ Le rôle BLR et le rôle membre doivent être différents.";
  for (const role of [blrRole, memberRole]) {
    if (role.managed || role.id === guild.id) return "⚠️ Rôle géré par une intégration ou @everyone : impossible.";
    const dangerous = privilegedPermissionNames(role.permissions);
    if (dangerous.length) return `⛔ Le rôle ${role.name} porte des permissions sensibles (${dangerous.join(", ")}).`;
  }
  setBlrConfig(guild.id, { blrRoleId: blrRole.id, memberRoleId: memberRole.id });
  return `✅ BLR configuré : rôle BLR <@&${blrRole.id}>, rôle membre <@&${memberRole.id}>.`;
}

function listText(guild) {
  const rows = listActiveBlr(guild.id);
  if (!rows.length) return "ℹ️ Aucun membre BLR.";
  return `**Membres BLR (${rows.length})**\n${rows.slice(0, 30).map((r) => `• <@${r.userId}> depuis <t:${Math.floor(r.createdAt / 1000)}:R>${r.expiresAt ? `, fin <t:${Math.floor(r.expiresAt / 1000)}:R>` : ""}${r.caseNumber ? ` — dossier #${r.caseNumber}` : ""}`).join("\n")}`;
}

export async function handleBlrInteraction(interaction, settings, { env = process.env } = {}) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== "blr" || !interaction.guild) return false;
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  const actor = interaction.member;
  if (sub === "configurer") {
    await interaction.reply({ content: await configure({ guild, actor, blrRole: interaction.options.getRole("role"), memberRole: interaction.options.getRole("membre"), env }), ephemeral: true, allowedMentions: { parse: [] } });
    return true;
  }
  if (sub === "liste") {
    if (!(await canManageBlr(actor, { env })) && !actor?.permissions?.has?.(P.ModerateMembers)) {
      await interaction.reply({ content: "⛔ Liste réservée au staff.", ephemeral: true });
      return true;
    }
    await interaction.reply({ content: listText(guild), visibility: "private", ephemeral: true, allowedMentions: { parse: [] } });
    return true;
  }
  const user = interaction.options.getUser("membre", true);
  const target = await guild.members.fetch({ user: user.id, force: true }).catch(() => null);
  await interaction.deferReply();
  const result = sub === "poser"
    ? await setBlr({ guild, actor, target, reason: interaction.options.getString("raison", false), durationText: interaction.options.getString("duree", false), settings, env })
    : await liftBlr({ guild, actorId: actor.id, actor, target, targetId: user.id, restore: interaction.options.getBoolean("restaurer", false) === true, settings, env });
  await interaction.editReply({ content: result.message, allowedMentions: { parse: [] } });
  return true;
}

/** =blr poser @membre [durée] [raison…] · =blr lever @membre [oui|non] · =blr liste · =blr configurer @&blr @&membre */
export async function handleBlrMessage(message, settings, { env = process.env } = {}) {
  const match = String(message?.content ?? "").trim().match(/^=blr\b\s*(\S*)\s*(.*)$/i);
  if (!match || !message.guild) return false;
  const sub = match[1].toLowerCase() || "liste";
  const rest = match[2];
  const guild = message.guild;
  const actor = message.member;
  const reply = (content) => message.reply({ content, allowedMentions: { parse: [] } }).catch(() => {});
  if (sub === "configurer") {
    const ids = [...rest.matchAll(/<@&(\d+)>/g)].map((m) => m[1]);
    await reply(await configure({ guild, actor, blrRole: guild.roles.cache.get(ids[0]), memberRole: guild.roles.cache.get(ids[1]), env }));
    return true;
  }
  if (sub === "liste") {
    if (!(await canManageBlr(actor, { env })) && !actor?.permissions?.has?.(P.ModerateMembers)) { await reply("⛔ Liste réservée au staff."); return true; }
    const sent = await message.author.send({ content: listText(guild), allowedMentions: { parse: [] } }).then(() => true).catch(() => false);
    await reply(sent ? "📬 Liste envoyée en message privé." : "❌ MP fermés : impossible d'envoyer la liste.");
    return true;
  }
  const targetId = rest.match(/<@!?(\d{17,20})>/)?.[1] ?? rest.match(/\b(\d{17,20})\b/)?.[1];
  if (!targetId || !["poser", "lever"].includes(sub)) { await reply("⚠️ Utilisation : `=blr poser @membre [durée] [raison]` · `=blr lever @membre [oui|non]` · `=blr liste`."); return true; }
  const target = await guild.members.fetch({ user: targetId, force: true }).catch(() => null);
  const words = rest.replace(/<@!?\d+>|\b\d{17,20}\b/, "").trim().split(/\s+/).filter(Boolean);
  let result;
  if (sub === "poser") {
    const duration = words[0] && /^(\d{1,4}\s*(m|min|h|j|d)|définitif|definitif)$/i.test(words[0]) ? words.shift() : null;
    result = await setBlr({ guild, actor, target, reason: words.join(" ") || null, durationText: duration, settings, env });
  } else {
    result = await liftBlr({ guild, actorId: actor.id, actor, target, targetId, restore: /^(oui|o|yes|true)$/i.test(words[0] ?? ""), settings, env });
  }
  await reply(result.message);
  return true;
}
