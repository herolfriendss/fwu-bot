// SYS+ n°2 : envoi des alertes d'abus du staff (rafale, cible répétée) en MP aux SYS+ et à l'owner.
// Le membre du staff signalé ne reçoit jamais l'alerte, même s'il est SYS+ (compte peut-être piraté).
import { setSanctionObserver } from "../../shared/audit.js";
import { checkStaffAbuse, formatAbuseAlert, formatAbuseThresholds, getAbuseThresholds, setAbuseThresholds } from "../../shared/staff-abuse.js";
import { ownerId } from "../../shared/tiers.js";

/** Destinataires : owner + membres du rôle SYS+, sans le membre signalé ni les bots. */
export async function abuseAlertRecipients(guild, sysPlusRoleId, moderatorId) {
  const ids = new Set();
  const owner = ownerId();
  if (owner) ids.add(owner);
  if (sysPlusRoleId) {
    await guild.members.fetch().catch(() => null);
    const role = guild.roles.cache.get(sysPlusRoleId);
    for (const member of role?.members?.values?.() ?? []) if (!member.user?.bot) ids.add(member.id);
  }
  ids.delete(moderatorId);
  return [...ids];
}

export async function deliverAbuseAlerts({ client, guild, alerts, sysPlusRoleId, audit = () => {} }) {
  let sent = 0;
  for (const alert of alerts) {
    const text = formatAbuseAlert(alert, guild.name);
    audit(guild, "🚨 Alerte d'abus du staff", text);
    for (const id of await abuseAlertRecipients(guild, sysPlusRoleId, alert.moderatorId)) {
      const user = await client.users.fetch(id).catch(() => null);
      if (!user) continue;
      try { await user.send({ content: text, allowedMentions: { parse: [] } }); sent += 1; } catch { /* MP fermés */ }
    }
  }
  return sent;
}

/** Branché sur chaque bot : toute sanction écrite en base est vérifiée. */
export function startStaffAbuseAlerts({ client, bot, getSettings, record = () => {}, audit = () => {} }) {
  setSanctionObserver(async (entry) => {
    try {
      const alerts = await checkStaffAbuse({ ...entry, bot, ownerId: ownerId() });
      if (!alerts.length) return;
      const guild = client.guilds.cache.get(entry.guildId);
      if (!guild) return;
      await deliverAbuseAlerts({ client, guild, alerts, sysPlusRoleId: getSettings(entry.guildId)?.sysPlus?.roleId ?? null, audit });
      record("staff_abuse_alert");
    } catch {
      record("staff_abuse_check_error");
    }
  });
}

/**
 * /sysp urgence alerte-abus : sans option, affiche les seuils (SYS+ ou owner).
 * Avec une option, modifie (owner seulement : un SYS+ ne doit pas pouvoir couper l'alerte qui le vise).
 */
export async function handleAbuseAlertCommand(interaction, { bot, member, roleId, isSysPlus, audit = () => {} }) {
  const owner = ownerId();
  const isOwner = Boolean(owner) && interaction.user.id === owner;
  if (!isOwner && !isSysPlus(member, roleId)) {
    await interaction.reply({ content: "⛔ Réservé aux SYS+ et à l'owner.", ephemeral: true });
    return true;
  }
  const opts = interaction.options;
  const changes = {
    enabled: opts.getBoolean("active") ?? undefined,
    burstCount: opts.getInteger("rafale") ?? undefined,
    burstMinutes: opts.getInteger("rafale_minutes") ?? undefined,
    repeatCount: opts.getInteger("cible") ?? undefined,
    repeatHours: opts.getInteger("cible_heures") ?? undefined,
  };
  const wantsChange = Object.values(changes).some((value) => value !== undefined);
  await interaction.deferReply({ ephemeral: true });
  try {
    if (!wantsChange) {
      await interaction.editReply(`**Alerte d'abus du staff**\n${formatAbuseThresholds(await getAbuseThresholds(interaction.guildId))}`);
      return true;
    }
    if (!isOwner) {
      await interaction.editReply("⛔ Seul l'owner peut modifier ou couper les alertes d'abus.");
      return true;
    }
    const next = await setAbuseThresholds({ guildId: interaction.guildId, changes, actorId: interaction.user.id, bot });
    audit(interaction.guild, "🚨 Alerte d'abus du staff modifiée", formatAbuseThresholds(next));
    await interaction.editReply(`✅ Seuils enregistrés (valables sur les 5 bots).\n${formatAbuseThresholds(next)}`);
  } catch (error) {
    await interaction.editReply(`❌ ${error?.message?.startsWith("Valeur hors limites") ? error.message : "Base centrale injoignable : réessaie dans un instant."}`);
  }
  return true;
}
