import { PermissionFlagsBits } from "discord.js";
import { exceedsMentionLimit, shouldApplySpamLimit } from "./spam-policy.js";

export async function enforceMentionFlood(message, settings, whitelistRoleId, record = () => {}) {
  if (!message?.member || !shouldApplySpamLimit(message.member, whitelistRoleId)) return false;
  const mentions = {
    users: message.mentions.users.size,
    roles: message.mentions.roles.size,
    everyone: message.mentions.everyone,
  };
  if (!exceedsMentionLimit(mentions, settings?.maxMentions ?? 5)) return false;

  const botMember = message.guild?.members?.me;
  const permissions = botMember && message.channel.permissionsFor(botMember);
  if (!permissions?.has(PermissionFlagsBits.ManageMessages)
    || !permissions.has(PermissionFlagsBits.ModerateMembers)) {
    record("spam_timeout_error");
    return true;
  }

  await message.delete().catch(() => null);
  try {
    await message.member.timeout(Number(settings.timeoutMinutes) * 60_000, "Protection anti-mentions");
    await message.channel.send({
      content: `🔇 <@${message.author.id}> mis en sourdine ${settings.timeoutMinutes} min pour excès de mentions.`,
      allowedMentions: { parse: [] },
    });
  } catch {
    record("spam_timeout_error");
  }
  return true;
}
