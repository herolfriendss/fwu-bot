import {
  getAutomationApprovalChannel, listAutomationRules, previewAutomationEvent,
} from "./automation-rules.js";

function eventIdentity(member) {
  const createdAt = Number(member?.user?.createdTimestamp ?? member?.createdTimestamp ?? 0);
  const accountAgeDays = createdAt > 0 ? Math.max(0, Math.floor((Date.now() - createdAt) / 86_400_000)) : null;
  return {
    memberId: member?.id ?? null,
    memberRoleIds: member?.roles?.cache ? [...member.roles.cache.keys()] : [],
    accountAgeDays,
  };
}

export async function previewGuildAutomationRules(guild, type, eventId, details, client, record = () => {}) {
  if (!guild?.id || !eventId || !client) return 0;
  const approvalChannelId = getAutomationApprovalChannel(guild.id);
  if (!approvalChannelId) return 0;
  const rules = listAutomationRules(guild.id, 50).filter((rule) => rule.enabled && rule.triggerType === type);
  if (!rules.length) return 0;
  const channel = await guild.channels.fetch(approvalChannelId).catch(() => null);
  if (!channel?.isTextBased()) {
    record("automation_approval_channel_unavailable");
    return 0;
  }
  const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  const permissions = channel.permissionsFor?.(botMember);
  if (!permissions?.has?.("ViewChannel") || !permissions?.has?.("SendMessages")) {
    record("automation_approval_channel_forbidden");
    return 0;
  }
  let posted = 0;
  for (const rule of rules) {
    try {
      const preview = previewAutomationEvent(guild.id, rule.ruleId, {
        id: String(eventId), guildId: guild.id, type, ...details,
      }, null);
      if (preview.duplicate || preview.status !== "previewed") continue;
      const actions = preview.preview.actions.map((action) => action.type === "send_message"
        ? `Envoyer un message dans <#${action.channelId}>`
        : `${action.type === "add_role" ? "Ajouter" : "Retirer"} le rôle <@&${action.roleId}>`).join("\n");
      const memberLabel = details.memberId ? `<@${details.memberId}>` : "événement serveur";
      await channel.send({
        content: `🧩 **Aperçu d'automatisation — ${rule.name}**\nDéclencheur : \`${type}\`\nCible : ${memberLabel}\nActions proposées :\n${actions}\n\nAucune action ne sera exécutée sans validation staff : \`=autorule confirm ${preview.runId}\``,
        allowedMentions: { parse: [] },
      });
      posted++;
    } catch {
      record("automation_preview_error");
    }
  }
  return posted;
}

export function buildAutomationEventFromMember(member) {
  return eventIdentity(member);
}

/** Generate one stable approval preview per scheduled interval and rule. */
export async function previewScheduledAutomationRules(client, allowedGuildIds, now = Date.now(), record = () => {}) {
  const allowed = new Set(Array.isArray(allowedGuildIds) ? allowedGuildIds : []);
  let posted = 0;
  for (const guild of client.guilds.cache.values()) {
    if (!allowed.has(guild.id)) continue;
    const rules = listAutomationRules(guild.id, 50).filter((rule) => rule.enabled && rule.triggerType === "scheduled");
    for (const rule of rules) {
      const interval = Number(rule.conditions.intervalMinutes);
      if (!Number.isSafeInteger(interval) || interval < 60) continue;
      const bucket = Math.floor(now / (interval * 60_000));
      posted += await previewGuildAutomationRules(guild, "scheduled", `schedule:${rule.ruleId}:${bucket}`, {}, client, record);
    }
  }
  return posted;
}
