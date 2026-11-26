// FWU GUARD — slash commands: /antinuke, /automod, /casier, /quarantaine.
import { filterRolesForBlr } from "../blr.js";
import { EmbedBuilder, PermissionFlagsBits as P } from "discord.js";
import { formatHistoryEntry, loadMemberHistory } from "../member-history.js";
import { roleGrantRefusal } from "../role-grant-guard.js";
import { db, transaction } from "../database.js";
import { parsePndOwnerId } from "../pnd-owner-policy.js";
import { isSysPlus } from "../systems/sysplus/permissions.js";
import { getAntiNukeConfig, saveAntiNukeConfig } from "./anti-nuke.js";
import { autoconfigValue } from "../autoconfig.js";
import { AUTOMOD_ACTIONS, AUTOMOD_RULES, getAutomodConfig, normalizeText, saveAutomodConfig } from "./automod.js";

export const GUARD_COMMANDS = new Set(["antinuke", "automod", "casier", "quarantaine"]);

db.exec(`CREATE TABLE IF NOT EXISTS guard_quarantine (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, saved_roles_json TEXT NOT NULL,
  reason TEXT, moderator_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id)
);`);

// Affaires retirées du casier : archivées, jamais effacées (idée SYS+ n°3).
db.exec(`CREATE TABLE IF NOT EXISTS moderation_cases_removed (
  id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, moderator_id TEXT NOT NULL,
  action TEXT NOT NULL, reason TEXT NOT NULL, details_json TEXT, created_at INTEGER NOT NULL,
  removed_by TEXT NOT NULL, removal_reason TEXT NOT NULL, removed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS moderation_cases_removed_member_idx ON moderation_cases_removed(guild_id, user_id, id DESC);`);

/**
 * Retire une affaire du casier : seulement un SYS+ ou l'owner, jamais sa propre affaire
 * (sauf l'owner). L'affaire est déplacée dans les archives avec qui, quand et pourquoi.
 * Renvoie l'affaire archivée, ou un message d'erreur (string).
 */
export function removeModerationCase({ guildId, caseId, actorId, reason, ownerId = null }) {
  const motif = String(reason ?? "").trim();
  if (motif.length < 3) return "❌ Indique un motif (3 caractères minimum).";
  const row = db.prepare("SELECT * FROM moderation_cases WHERE id=? AND guild_id=?").get(caseId, guildId);
  if (!row) return "❌ Affaire introuvable sur ce serveur.";
  if (row.moderator_id === actorId && actorId !== ownerId) return "⛔ Tu ne peux pas retirer une affaire que tu as toi-même ouverte : demande à un autre SYS+ ou à l'owner.";
  const now = Date.now();
  transaction(() => {
    db.prepare(`INSERT INTO moderation_cases_removed(id,guild_id,user_id,moderator_id,action,reason,details_json,created_at,removed_by,removal_reason,removed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(row.id, row.guild_id, row.user_id, row.moderator_id, row.action, row.reason, row.details_json, row.created_at, actorId, motif.slice(0, 300), now);
    db.prepare("DELETE FROM moderation_cases WHERE id=? AND guild_id=?").run(caseId, guildId);
  });
  return { ...row, removedBy: actorId, removalReason: motif.slice(0, 300), removedAt: now };
}

export function listRemovedCases(guildId, userId, limit = 10) {
  return db.prepare("SELECT * FROM moderation_cases_removed WHERE guild_id=? AND user_id=? ORDER BY removed_at DESC LIMIT ?").all(guildId, userId, limit);
}

const quarantineRoleOf = (guildId, settings) => settings?.guildGuard?.quarantineRoleId ?? autoconfigValue(guildId, "guard:quarantine_role");
const isOwner = (member) => member?.id === parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID) || member?.id === member?.guild?.ownerId;
const isStaff = (member, settings, flag = P.ManageGuild) => isOwner(member) || isSysPlus(member, settings?.sysPlus?.roleId ?? null) || Boolean(member?.permissions?.has?.(P.Administrator) || member?.permissions?.has?.(flag));

function antinukeText(config) {
  return [
    `🛡️ **Anti-nuke** : ${config.enabled ? "activé" : "désactivé"}`,
    `Seuil : **${config.threshold}** actions destructrices en **${config.windowSeconds} s** par la même personne`,
    "Surveillé : suppression de salons et de rôles, bannissements, expulsions, création de webhooks.",
    `Personnes de confiance : ${config.trusted.length ? config.trusted.map((id) => `<@${id}>`).join(", ") : "aucune"} (toi, le propriétaire du serveur et les bots du serveur sont toujours exemptés)`,
  ].join("\n");
}

function automodText(config) {
  const rules = Object.entries(AUTOMOD_RULES).map(([key, label]) => {
    const rule = config.rules[key];
    return `${rule.enabled ? "🟢" : "⚪"} **${label}** — ${AUTOMOD_ACTIONS[rule.action]}${rule.action === "exclure" ? ` (${rule.minutes} min)` : ""}`;
  });
  return [
    "🧹 **Automod**",
    ...rules,
    `Mots interdits : ${config.words.length ? config.words.map((w) => `\`${w}\``).join(", ").slice(0, 900) : "aucun"}`,
    `Salons exemptés : ${config.exemptChannelIds.map((id) => `<#${id}>`).join(", ") || "aucun"} · Rôles exemptés : ${config.exemptRoleIds.map((id) => `<@&${id}>`).join(", ") || "aucun"}`,
    "Le staff (Gérer les messages), les SYS+, toi et le propriétaire du serveur ne sont jamais concernés.",
  ].join("\n");
}

async function handleAntiNuke(interaction) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  if (sub !== "etat" && !isOwner(interaction.member)) return "⛔ Seuls l'OWNER et le propriétaire du serveur peuvent régler l'anti-nuke.";
  if (sub === "etat" && !isStaff(interaction.member, null)) return "⛔ Réservé au staff.";
  const config = getAntiNukeConfig(guild.id);
  const actor = interaction.user.id;
  if (sub === "activer") return antinukeText(saveAntiNukeConfig(guild.id, { enabled: true }, actor));
  if (sub === "desactiver") return antinukeText(saveAntiNukeConfig(guild.id, { enabled: false }, actor));
  if (sub === "seuil") return antinukeText(saveAntiNukeConfig(guild.id, { threshold: interaction.options.getInteger("actions", true), windowSeconds: interaction.options.getInteger("secondes") ?? config.windowSeconds }, actor));
  if (sub === "confiance-ajouter") return antinukeText(saveAntiNukeConfig(guild.id, { trusted: [...config.trusted, interaction.options.getUser("membre", true).id] }, actor));
  if (sub === "confiance-retirer") { const id = interaction.options.getUser("membre", true).id; return antinukeText(saveAntiNukeConfig(guild.id, { trusted: config.trusted.filter((t) => t !== id) }, actor)); }
  return antinukeText(config);
}

async function handleAutomod(interaction, settings) {
  if (!isStaff(interaction.member, settings)) return "⛔ Réservé au staff (Gérer le serveur), aux SYS+ et à l'OWNER.";
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  const config = getAutomodConfig(guild.id);
  const o = interaction.options;
  const save = (next) => automodText(saveAutomodConfig(guild.id, next, interaction.user.id));
  if (sub === "regle") {
    const rule = o.getString("regle", true);
    const current = config.rules[rule];
    return save({ ...config, rules: { ...config.rules, [rule]: { enabled: o.getString("etat", true) === "on", action: o.getString("action") ?? current.action, minutes: o.getInteger("minutes") ?? current.minutes } } });
  }
  if (sub === "mot-ajouter") {
    const word = normalizeText(o.getString("mot", true));
    if (word.length < 2) return "❌ Mot trop court.";
    return save({ ...config, words: [...config.words, word], rules: { ...config.rules, mots: { ...config.rules.mots, enabled: true } } });
  }
  if (sub === "mot-retirer") { const word = normalizeText(o.getString("mot", true)); return save({ ...config, words: config.words.filter((w) => w !== word) }); }
  if (sub === "exempter" || sub === "retirer-exemption") {
    const channel = o.getChannel("salon");
    const role = o.getRole("role");
    if (!channel && !role) return "❌ Choisis un salon ou un rôle.";
    const toggle = (list, id) => (id ? (sub === "exempter" ? [...list, id] : list.filter((x) => x !== id)) : list);
    return save({ ...config, exemptChannelIds: toggle(config.exemptChannelIds, channel?.id), exemptRoleIds: toggle(config.exemptRoleIds, role?.id) });
  }
  return automodText(config);
}

const CASE_LABELS = { warn: "Avertissement", mute: "Exclusion", unmute: "Fin d'exclusion", kick: "Expulsion", ban: "Bannissement", unban: "Débannissement", quarantine: "Quarantaine", unquarantine: "Fin de quarantaine" };

async function handleCasier(interaction, settings, { report = async () => {} } = {}) {
  if (!isStaff(interaction.member, settings, P.ModerateMembers)) return "⛔ Réservé au staff.";
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  if (sub === "supprimer") {
    const owner = parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);
    // « Gérer le serveur » ne suffit plus : un modo ne doit pas pouvoir effacer ses propres abus.
    if (interaction.user.id !== owner && !isSysPlus(interaction.member, settings?.sysPlus?.roleId ?? null)) return "⛔ Retirer une affaire est réservé aux SYS+ et à l'owner.";
    const id = interaction.options.getInteger("affaire", true);
    const removed = removeModerationCase({ guildId: guild.id, caseId: id, actorId: interaction.user.id, reason: interaction.options.getString("motif") ?? "", ownerId: owner });
    if (typeof removed === "string") return removed;
    await report(guild, {
      title: "🗂️ Affaire retirée du casier",
      description: `Affaire **#${removed.id}** · ${CASE_LABELS[removed.action] ?? removed.action} · membre <@${removed.user_id}>\nOuverte par <@${removed.moderator_id}> le <t:${Math.floor(removed.created_at / 1000)}:d>\nRetirée par <@${removed.removedBy}>\nMotif : ${removed.removalReason}\nL'affaire reste dans les archives (\`/casier voir\`).`,
      color: 0xf59e0b,
    }).catch(() => {});
    return `🗂️ Affaire **#${id}** retirée du casier et archivée (motif enregistré, log envoyé).`;
  }
  const user = interaction.options.getUser("membre", true);
  const warnings = db.prepare("SELECT COUNT(*) AS n FROM moderation_warnings WHERE guild_id=? AND user_id=? AND (expires_at IS NULL OR expires_at > ?)").get(guild.id, user.id, Date.now()).n;
  // Historique unifié : casier de ce bot + sanctions des 5 bots (base centrale), sans doublon.
  const history = await loadMemberHistory({ guildId: guild.id, userId: user.id, limit: 50 });
  const active = history.entries.filter((e) => !e.removed);
  const removedEntries = history.entries.filter((e) => e.removed);
  const total = active.length;
  const lines = active.slice(0, 15).map(formatHistoryEntry);
  if (removedEntries.length) lines.push("", "**Affaires retirées** (archives)", ...removedEntries.slice(0, 5).map(formatHistoryEntry));
  if (!history.centralAvailable) lines.push("", "⚠️ Base centrale injoignable : seules les affaires de ce bot sont affichées.");
  return { embeds: [new EmbedBuilder().setColor(0xe21d2f).setTitle(`📁 Casier de ${user.username}`)
    .setDescription(`Sanctions : **${total}** · Avertissements actifs : **${warnings}**\n\n${lines.join("\n") || "Casier vierge."}`.slice(0, 4000))
    .setFooter({ text: "Tous bots confondus · /casier supprimer (SYS+) pour retirer une affaire, avec un motif" })] };
}

async function handleQuarantaine(interaction, settings) {
  if (!isStaff(interaction.member, settings, P.ModerateMembers)) return "⛔ Réservé au staff (Exclure des membres), aux SYS+ et à l'OWNER.";
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  const user = interaction.options.getUser("membre", true);
  const member = await guild.members.fetch({ user: user.id, force: true }).catch(() => null);
  if (!member) return "❌ Ce membre n'est pas sur le serveur.";
  const me = guild.members.me ?? await guild.members.fetchMe();
  if (sub === "ajouter") {
    const roleId = quarantineRoleOf(guild.id, settings);
    const role = roleId ? await guild.roles.fetch(roleId).catch(() => null) : null;
    if (!role) return "❌ Aucun rôle de quarantaine : il sera créé automatiquement au prochain démarrage de GUARD (ou `/guildguard quarantine role:@Quarantaine`).";
    if (role.position >= me.roles.highest.position) return "❌ Le rôle de quarantaine doit être sous mon rôle.";
    const protectedReason = await roleGrantRefusal(guild, role, { automatic: true, settings });
    if (protectedReason) return `❌ Rôle de quarantaine refusé : ${protectedReason}`;
    if (db.prepare("SELECT 1 FROM guard_quarantine WHERE guild_id=? AND user_id=?").get(guild.id, user.id)) return "ℹ️ Ce membre est déjà en quarantaine.";
    const removable = [...member.roles.cache.values()].filter((r) => r.id !== guild.id && !r.managed && r.id !== role.id && r.position < me.roles.highest.position);
    const reason = interaction.options.getString("raison") ?? "Quarantaine manuelle";
    db.prepare("INSERT INTO guard_quarantine(guild_id,user_id,saved_roles_json,reason,moderator_id,created_at) VALUES(?,?,?,?,?,?)").run(guild.id, user.id, JSON.stringify(removable.map((r) => r.id)), reason, interaction.user.id, Date.now());
    try {
      if (removable.length) await member.roles.remove(removable, `Quarantaine par ${interaction.user.id} : ${reason}`);
      await member.roles.add(role, `Quarantaine par ${interaction.user.id} : ${reason}`);
    } catch (error) {
      db.prepare("DELETE FROM guard_quarantine WHERE guild_id=? AND user_id=?").run(guild.id, user.id);
      if (removable.length) await member.roles.add(removable).catch(() => {});
      throw error;
    }
    if (member.voice?.channelId) await member.voice.disconnect("Quarantaine").catch(() => {});
    db.prepare("INSERT INTO moderation_cases(guild_id,user_id,moderator_id,action,reason,details_json,created_at) VALUES(?,?,?,?,?,?,?)").run(guild.id, user.id, interaction.user.id, "quarantine", reason, JSON.stringify({ roles: removable.length }), Date.now());
    return `🔒 <@${user.id}> est en quarantaine (${removable.length} rôle(s) mis de côté). \`/quarantaine retirer\` les lui rendra.`;
  }
  const row = db.prepare("SELECT saved_roles_json FROM guard_quarantine WHERE guild_id=? AND user_id=?").get(guild.id, user.id);
  if (!row) return "ℹ️ Ce membre n'est pas en quarantaine.";
  // Restauration filtrée par le BLR : un membre BLR ne retrouve que le rôle membre.
  const saved = filterRolesForBlr(guild.id, user.id, JSON.parse(row.saved_roles_json).filter((id) => guild.roles.cache.has(id)));
  const roleId = quarantineRoleOf(guild.id, settings);
  if (roleId && member.roles.cache.has(roleId)) await member.roles.remove(roleId, `Fin de quarantaine par ${interaction.user.id}`);
  if (saved.length) await member.roles.add(saved, `Fin de quarantaine par ${interaction.user.id}`);
  db.prepare("DELETE FROM guard_quarantine WHERE guild_id=? AND user_id=?").run(guild.id, user.id);
  db.prepare("INSERT INTO moderation_cases(guild_id,user_id,moderator_id,action,reason,details_json,created_at) VALUES(?,?,?,?,?,?,?)").run(guild.id, user.id, interaction.user.id, "unquarantine", "Fin de quarantaine", JSON.stringify({ restored: saved.length }), Date.now());
  return `🔓 Quarantaine levée pour <@${user.id}> : ${saved.length} rôle(s) rendu(s).`;
}

export async function handleGuardInteraction(interaction, settings = {}, context = {}) {
  if (!interaction.isChatInputCommand?.() || !GUARD_COMMANDS.has(interaction.commandName)) return false;
  if (!interaction.guild) {
    await interaction.reply({ content: "Cette commande s'utilise sur un serveur.", ephemeral: true });
    return true;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    const run = { antinuke: handleAntiNuke, automod: handleAutomod, casier: handleCasier, quarantaine: handleQuarantaine }[interaction.commandName];
    const result = await run(interaction, settings, context);
    await interaction.editReply(typeof result === "string" ? { content: result, allowedMentions: { parse: [] } } : { ...result, allowedMentions: { parse: [] } });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error instanceof Error ? error.message : "Action impossible."}`, allowedMentions: { parse: [] } }).catch(() => {});
  }
  return true;
}
