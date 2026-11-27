// FWU — exécution commune des sanctions (FWU en slash, GUARD en préfixe).
//
// Ordre, identique pour tous les bots :
//   1. hiérarchie (rôles Discord + paliers) : aucun quota consommé si refus ;
//   2. quota partagé (atomique, base centrale ; injoignable = refus) ;
//   3. action Discord ; en cas d'échec, l'usage est rendu ;
//   4. dossier local (appels), historique central, MP au membre, logs.
import { EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { sendCentralLog } from "./logs.js";
import { parsePndOwnerId } from "./pnd-owner-policy.js";
import { evaluateTargetHierarchy } from "./target-hierarchy-policy.js";
import { getStaffSupervisorId } from "./staff-hierarchy.js";
import { openModerationGate } from "./shared/moderation-gate.js";
import { recordSanction } from "./shared/audit.js";
import { memberTier, TIER_LABELS } from "./shared/tiers.js";
import { formatDurationFr } from "./shared/quotas.js";

const ACTION_LABELS = Object.freeze({
  tempmute: "Exclusion temporaire", unmute: "Fin d'exclusion", warn: "Avertissement",
  kick: "Expulsion", ban: "Bannissement", unban: "Débannissement", blacklist: "Blacklist",
});
// Local SQLite case (appeals) uses the historical action names.
const CASE_ACTION = Object.freeze({ tempmute: "mute", unmute: "unmute", warn: "warn", kick: "kick", ban: "ban" });
const NOTIFY = new Set(["tempmute", "warn", "kick", "ban"]);

export class ModerationRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = "ModerationRefusal";
  }
}

/** Translate a Discord API error into a clear sentence. */
export function describeDiscordError(error) {
  const code = error?.code ?? error?.rawError?.code;
  if (code === 50013) return "Permission Discord manquante pour le bot (ou rôle du bot trop bas).";
  if (code === 10007) return "Ce membre n'est plus sur le serveur.";
  if (code === 10013) return "Utilisateur Discord introuvable.";
  if (code === 10026) return "Ce compte n'est pas banni.";
  if (error?.status === 429 || code === 429) return "Discord limite les requêtes : réessaie dans quelques secondes.";
  return "Discord a refusé l'action.";
}

/**
 * Hierarchy for an action on a member (or on an ID only, for ban/unban).
 * Throws ModerationRefusal. `actorTier` comes from shared/tiers.js.
 */
export async function assertCanTarget({ guild, actor, actorTier, targetId, targetMember, command }) {
  const pndOwnerId = parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);
  if (targetId === actor.id) throw new ModerationRefusal("Tu ne peux pas t'appliquer cette action.");
  if (targetId === guild.ownerId || (pndOwnerId && targetId === pndOwnerId)) throw new ModerationRefusal("Cette personne est protégée (propriétaire) : action refusée.");
  if (targetId === guild.client?.user?.id) throw new ModerationRefusal("Je ne peux pas me sanctionner moi-même.");
  if (!targetMember) return;
  const bot = guild.members.me ?? await guild.members.fetchMe();
  const fullAccess = actorTier === 0 || actor.id === guild.ownerId;
  const decision = evaluateTargetHierarchy({ actor, target: targetMember, bot, guildOwnerId: guild.ownerId, pndOwnerId, enforceActorRank: !fullAccess });
  if (!decision.allowed) throw new ModerationRefusal(decision.reason);
  if (!fullAccess) {
    const targetTier = await memberTier(targetMember);
    if (targetTier != null && actorTier != null && targetTier <= actorTier) {
      throw new ModerationRefusal(`Ce membre a un palier égal ou supérieur au tien (${TIER_LABELS[targetTier]}).`);
    }
  }
  if ((command === "tempmute" || command === "unmute") && !targetMember.moderatable) {
    throw new ModerationRefusal("Je ne peux pas exclure temporairement ce membre (administrateur ou rôle au-dessus du mien).");
  }
  if (command === "kick" && !targetMember.kickable) throw new ModerationRefusal("Je ne peux pas expulser ce membre (permission ou hiérarchie).");
  if (command === "ban" && !targetMember.bannable) throw new ModerationRefusal("Je ne peux pas bannir ce membre (permission ou hiérarchie).");
}

function sanctionEmbed({ guild, command, actor, targetId, targetTag, reason, durationSeconds, label, caseId, supervisorId, bot }) {
  return new EmbedBuilder()
    .setColor(command === "warn" ? 0xf59e0b : command === "unmute" || command === "unban" ? 0x22c55e : 0xef4444)
    .setTitle(`🛡️ Modération — ${ACTION_LABELS[command] ?? command}`)
    .addFields(
      { name: "Membre", value: `${targetTag ?? `<@${targetId}>`} (${targetId})`, inline: true },
      { name: "Modérateur", value: `<@${actor.id}> (${actor.id})`, inline: true },
      { name: "Responsable hiérarchique", value: supervisorId ? `<@${supervisorId}>` : "Responsable non configuré", inline: true },
      ...(label ? [{ name: "Sanction", value: label, inline: true }] : []),
      ...(durationSeconds ? [{ name: "Durée", value: formatDurationFr(durationSeconds), inline: true }] : []),
      ...(caseId ? [{ name: "Dossier", value: `#${caseId}`, inline: true }] : []),
      { name: "Raison", value: reason || "Non précisée", inline: false },
      { name: "Bot", value: bot, inline: true },
      { name: "Serveur", value: `${guild.name} (${guild.id})`, inline: false },
    )
    .setTimestamp(new Date());
}

async function sendLogs(guild, settings, embed, supervisorId) {
  const allowedUserIds = supervisorId ? [supervisorId] : [];
  // sendCentralLog publie déjà dans le hub (catégorie typée) : l'ancien envoi direct
  // au hub en plus faisait apparaître chaque sanction deux fois.
  await Promise.allSettled([
    sendCentralLog(guild, settings, embed, [settings?.moderation?.logChannelId], [], allowedUserIds, { category: "moderation" }),
  ]);
}

async function logQuotaRefusal(guild, settings, actor, command, message) {
  const embed = new EmbedBuilder().setColor(0xf59e0b).setTitle("⏳ Quota de modération — refus")
    .setDescription(`Modérateur : <@${actor.id}>\nCommande : \`${command}\`\n${message}`).setTimestamp(new Date());
  await sendCentralLog(guild, settings, embed, [], [], [], { category: "moderation" }).catch(() => {});
}

/**
 * Run one sanction. `execute()` performs the Discord call.
 * Returns { caseId, gate } on success; throws ModerationRefusal (clear message) otherwise.
 */
export async function runModerationAction({
  guild, actor, command, bot, targetId, targetMember = null, targetUser = null, reason = "",
  durationSeconds = null, sanctionTypeId = null, sanctionLabel = null, settings = null,
  execute, notify = NOTIFY.has(command), recordCase = null, appealButton = null, discardCase = null,
}) {
  const actorTier = await memberTier(actor);
  await assertCanTarget({ guild, actor, actorTier, targetId, targetMember, command });

  const gate = await openModerationGate({ member: actor, command, bot, targetId });
  if (!gate.ok) {
    if (gate.decision?.reason === "quota") await logQuotaRefusal(guild, settings, actor, command, gate.message);
    throw new ModerationRefusal(gate.message);
  }
  const cleanReason = String(reason ?? "").trim().slice(0, 500);
  const fullReason = sanctionLabel ? `${sanctionLabel}${cleanReason ? ` — ${cleanReason}` : ""}` : cleanReason;
  const supervisorId = (() => { try { return getStaffSupervisorId(guild.id, actor.id); } catch { return null; } })();
  const user = targetUser ?? targetMember?.user ?? null;
  const record = () => {
    if (!recordCase || !CASE_ACTION[command]) return null;
    try { return recordCase({ guildId: guild.id, userId: targetId, moderatorId: actor.id, action: CASE_ACTION[command], reason: fullReason || "Non précisée", details: { durationSeconds, durationMs: durationSeconds ? durationSeconds * 1000 : undefined, supervisorId, bot } }); } catch { return null; }
  };
  const decisionDm = (caseId) => new EmbedBuilder().setColor(0xef4444).setTitle(`Décision de modération · ${guild.name}`)
    .setDescription([
      `Sanction : **${ACTION_LABELS[command]}${command === "ban" && durationSeconds ? " temporaire" : ""}**${sanctionLabel ? ` (${sanctionLabel})` : ""}`,
      durationSeconds ? `Durée : **${formatDurationFr(durationSeconds)}**` : null,
      caseId ? `Dossier : **#${caseId}**` : null,
      `Motif : ${(fullReason || "Non précisé").slice(0, 700)}`,
      caseId ? "\nTu peux faire appel dans les 7 jours. L'appel ne suspend pas la sanction." : null,
    ].filter(Boolean).join("\n"))
    .setTimestamp(new Date());
  const canDm = notify && user && typeof user.send === "function";
  // Ban : le MP part AVANT le ban (après, Discord ne laisse plus écrire au membre, qui
  // ne recevait donc jamais son bouton d'appel). En cas d'échec du ban, tout est annulé.
  const dmFirst = command === "ban" && canDm;
  let caseId = null;
  let earlyDm = null;
  if (dmFirst) {
    caseId = record();
    earlyDm = await user.send({ embeds: [decisionDm(caseId)], components: caseId && appealButton ? [appealButton(caseId)] : [], allowedMentions: { parse: [] } }).catch(() => null);
  }
  try {
    await execute();
  } catch (error) {
    if (dmFirst) {
      await earlyDm?.delete?.().catch?.(() => {});
      if (caseId && discardCase) { try { discardCase(guild.id, caseId); } catch { /* dossier orphelin, sans effet */ } }
    }
    await gate.fail(error);
    throw new ModerationRefusal(describeDiscordError(error));
  }
  if (!dmFirst) caseId = record();
  await recordSanction({
    guildId: guild.id, targetId, moderatorId: actor.id, action: command, sanctionTypeId, sanctionLabel,
    reason: cleanReason, durationSeconds, bot,
  }).catch(() => null);
  await gate.succeed(sanctionLabel ?? null);

  if (canDm && !dmFirst) {
    await user.send({ embeds: [decisionDm(caseId)], components: caseId && appealButton ? [appealButton(caseId)] : [], allowedMentions: { parse: [] } }).catch(() => {});
  }
  await sendLogs(guild, settings, sanctionEmbed({
    guild, command, actor, targetId, targetTag: user?.tag, reason: cleanReason, durationSeconds,
    label: sanctionLabel, caseId, supervisorId, bot,
  }), supervisorId);
  return { caseId, gate };
}

export function hasDiscordPermission(member, bit) {
  return Boolean(member?.permissions?.has?.(bit) || member?.permissions?.has?.(PermissionFlagsBits.Administrator));
}
