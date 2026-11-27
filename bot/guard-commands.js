// GUARD — commandes d'administration en préfixe (par défaut « + »).
//   +ban @membre|ID [raison]   +tempban @membre|ID durée [raison]   +unban ID [raison]   +kick @membre|ID [raison]
//   +purge|+nettoyer nombre    +lock   +unlock      +slowmode secondes
// ban / unban / kick : paliers + quotas partagés (moderation-actions.js).
// Les handlers lisent la forme canonique « =commande » (réécrite par index.js).
import { PermissionFlagsBits } from "discord.js";
import { ModerationRefusal, describeDiscordError, runModerationAction } from "./moderation-actions.js";
import { appealButton, discardModerationCase, recordModerationCase } from "./moderation.js";
import { clearTempban, parseTempbanDuration, scheduleTempban } from "./guard/tempban.js";
import { formatDurationFr } from "./shared/quotas.js";
import { logCommandUsage } from "./shared/audit.js";
import { memberTier } from "./shared/tiers.js";

const P = PermissionFlagsBits;
const COMMAND = /^=(ban|tempban|unban|kick|purge|nettoyer|lock|unlock|slowmode)(?=$|\s)([\s\S]*)$/i;
const TARGET = /^\s*(?:<@!?(\d{17,20})>|(\d{17,20}))(?=$|\s)([\s\S]*)$/;

/** "=ban <@1…> spam" → { command, targetId, rest }. null when it is not a GUARD command. */
export function parseGuardCommand(content) {
  const match = COMMAND.exec(String(content ?? "").trim());
  if (!match) return null;
  const command = match[1].toLowerCase();
  const args = match[2] ?? "";
  if (["ban", "tempban", "unban", "kick"].includes(command)) {
    const target = TARGET.exec(args);
    return { command, targetId: target ? (target[1] ?? target[2]) : null, rest: String(target ? target[3] : args).trim(), rawArgs: args.trim() };
  }
  return { command: command === "nettoyer" ? "purge" : command, targetId: null, rest: args.trim(), rawArgs: args.trim() };
}

const USAGE = {
  ban: "`=ban @membre|ID [raison]`",
  tempban: "`=tempban @membre|ID durée [raison]` (durée : `30m`, `12h`, `7j`…)",
  unban: "`=unban ID [raison]`",
  kick: "`=kick @membre|ID [raison]`",
  purge: "`=purge nombre` (1 à 100)",
  slowmode: "`=slowmode secondes` (0 = désactivé, max 21600)",
};

async function canUseChannelTool(member, bit) {
  if (member.permissions?.has?.(bit) || member.permissions?.has?.(P.Administrator)) return true;
  const tier = await memberTier(member);
  return tier === 0 || (tier != null && tier <= 10);
}

export async function handleGuardPrefixCommand(message, settings = null, { bot = "guard", audit = () => {} } = {}) {
  if (!message?.guild || !message.member || message.author?.bot) return false;
  const parsed = parseGuardCommand(message.content);
  if (!parsed) return false;
  const guild = message.guild;
  const actor = message.member;
  const say = (content) => message.reply({ content, allowedMentions: { parse: [], repliedUser: false } }).catch(() => null);

  try {
    if (["ban", "tempban", "kick", "unban"].includes(parsed.command)) {
      if (!parsed.targetId) {
        await say(parsed.rawArgs ? `❌ Identifiant invalide. Utilisation : ${USAGE[parsed.command]}` : `Utilisation : ${USAGE[parsed.command]}`);
        return true;
      }
      let reason = parsed.rest.slice(0, 300);
      let durationSeconds = null;
      if (parsed.command === "tempban") {
        const [rawDuration, ...words] = parsed.rest.split(/\s+/);
        const duration = parseTempbanDuration(rawDuration);
        if (duration.error) {
          await say(`${rawDuration ? `❌ ${duration.error} ` : ""}Utilisation : ${USAGE.tempban}`);
          return true;
        }
        durationSeconds = duration.seconds;
        reason = words.join(" ").slice(0, 300);
      }
      const targetMember = await guild.members.fetch({ user: parsed.targetId, force: true }).catch(() => null);
      const targetUser = targetMember?.user ?? await message.client.users.fetch(parsed.targetId).catch(() => null);
      if (!targetUser) {
        await say("❌ Utilisateur Discord introuvable pour cet identifiant.");
        return true;
      }
      if (parsed.command === "kick" && !targetMember) {
        await say("❌ Ce membre n'est pas sur le serveur.");
        return true;
      }
      if (parsed.command === "unban") {
        const ban = await guild.bans.fetch(parsed.targetId).catch(() => null);
        if (!ban) {
          await say(`ℹ️ <@${parsed.targetId}> n'est pas banni.`);
          return true;
        }
      }
      const execute = parsed.command === "ban" || parsed.command === "tempban"
        ? () => guild.members.ban(parsed.targetId, { reason: `${reason || "Sans raison"}${durationSeconds ? " (temporaire)" : ""} (par ${actor.id})`.slice(0, 500), deleteMessageSeconds: 0 })
        : parsed.command === "kick"
          ? () => targetMember.kick(`${reason || "Sans raison"} (par ${actor.id})`.slice(0, 500))
          : () => guild.bans.remove(parsed.targetId, `${reason || "Sans raison"} (par ${actor.id})`.slice(0, 500));
      const { caseId } = await runModerationAction({
        guild, actor, command: parsed.command === "tempban" ? "ban" : parsed.command, bot, targetId: parsed.targetId, targetMember, targetUser, reason, settings,
        durationSeconds, recordCase: recordModerationCase, appealButton, discardCase: discardModerationCase, execute,
      });
      if (parsed.command === "unban") clearTempban(guild.id, parsed.targetId);
      if (parsed.command === "tempban") {
        const expiresAt = scheduleTempban({ guildId: guild.id, userId: parsed.targetId, seconds: durationSeconds, caseId, moderatorId: actor.id, reason });
        await say(`⏳ ${caseId ? `Dossier #${caseId} · ` : ""}<@${parsed.targetId}> banni pour ${formatDurationFr(durationSeconds)}, débanni automatiquement <t:${Math.floor(expiresAt / 1000)}:R>.${reason ? ` Raison : ${reason}` : ""}`);
        return true;
      }
      const icon = { ban: "🔨", kick: "👢", unban: "♻️" }[parsed.command];
      const verb = { ban: "banni", kick: "expulsé", unban: "débanni" }[parsed.command];
      await say(`${icon} ${caseId ? `Dossier #${caseId} · ` : ""}<@${parsed.targetId}> ${verb}.${reason ? ` Raison : ${reason}` : ""}`);
      return true;
    }

    if (parsed.command === "purge") {
      if (!(await canUseChannelTool(actor, P.ManageMessages))) throw new ModerationRefusal("Permission « Gérer les messages » ou palier 10 % requis.");
      const amount = Number(parsed.rest.split(/\s+/)[0]);
      if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
        await say(`Utilisation : ${USAGE.purge}`);
        return true;
      }
      if (typeof message.channel?.bulkDelete !== "function") throw new ModerationRefusal("Salon incompatible.");
      await message.delete().catch(() => {});
      const deleted = await message.channel.bulkDelete(amount, true);
      const notice = await message.channel.send({ content: `🧹 ${deleted.size} message(s) supprimé(s) par <@${actor.id}>.`, allowedMentions: { parse: [] } }).catch(() => null);
      if (notice) setTimeout(() => { notice.delete().catch(() => {}); }, 5_000).unref?.();
      await logCommandUsage({ guildId: guild.id, userId: actor.id, bot, command: "purge", outcome: "ok", detail: String(deleted.size) });
      audit("🧹 Purge de messages", `Par : <@${actor.id}>\nSalon : <#${message.channel.id}>\nMessages : **${deleted.size}**`, 0xef4444);
      return true;
    }

    if (parsed.command === "lock" || parsed.command === "unlock") {
      if (!(await canUseChannelTool(actor, P.ManageChannels))) throw new ModerationRefusal("Permission « Gérer les salons » ou palier 10 % requis.");
      if (!message.channel?.permissionOverwrites) throw new ModerationRefusal("Salon incompatible.");
      const locked = parsed.command === "lock";
      await message.channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: locked ? false : null }, { reason: `GUARD ${parsed.command} par ${actor.id}` });
      await logCommandUsage({ guildId: guild.id, userId: actor.id, bot, command: parsed.command, outcome: "ok" });
      audit(locked ? "🔒 Salon verrouillé" : "🔓 Salon déverrouillé", `Par : <@${actor.id}>\nSalon : <#${message.channel.id}>`);
      await say(locked ? "🔒 Salon verrouillé." : "🔓 Salon déverrouillé.");
      return true;
    }

    if (parsed.command === "slowmode") {
      if (!(await canUseChannelTool(actor, P.ManageChannels))) throw new ModerationRefusal("Permission « Gérer les salons » ou palier 10 % requis.");
      const seconds = Number(parsed.rest.split(/\s+/)[0]);
      if (!Number.isInteger(seconds) || seconds < 0 || seconds > 21_600) {
        await say(`Utilisation : ${USAGE.slowmode}`);
        return true;
      }
      if (typeof message.channel?.setRateLimitPerUser !== "function") throw new ModerationRefusal("Salon incompatible.");
      await message.channel.setRateLimitPerUser(seconds, `GUARD slowmode par ${actor.id}`);
      await logCommandUsage({ guildId: guild.id, userId: actor.id, bot, command: "slowmode", outcome: "ok", detail: String(seconds) });
      await say(seconds ? `🐢 Mode lent : ${seconds} s.` : "🐇 Mode lent désactivé.");
      return true;
    }
  } catch (error) {
    await say(`❌ ${error instanceof ModerationRefusal ? error.message : describeDiscordError(error)}`);
    return true;
  }
  return false;
}
