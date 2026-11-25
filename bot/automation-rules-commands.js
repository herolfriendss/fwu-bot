import {
  confirmAutomationRun, createAutomationRule, disableAutomationRule,
  executeConfirmedAutomation, getAutomationRule, getAutomationRun, listAutomationRules,
  setAutomationApprovalChannel,
} from "./automation-rules.js";
import { assertRoleGrantable } from "./role-grant-guard.js";

const noMentions = { parse: [], repliedUser: false };
const triggers = new Set(["member_join", "member_leave", "message_created", "voice_join", "voice_leave", "scheduled"]);

function canManage(message) {
  return message.guild?.ownerId === message.author.id
    || message.member?.permissions?.has?.("ManageGuild") === true
    || message.member?.permissions?.has?.("Administrator") === true;
}

function resolveRuleId(guildId, token) {
  const rules = listAutomationRules(guildId, 50);
  return rules.find((rule) => rule.ruleId === token || rule.ruleId.startsWith(token))?.ruleId ?? null;
}

function parseSnowflake(value, type) {
  const match = String(value ?? "").match(/^<?(?:#|@&)?(\d{5,25})>?$/);
  if (!match) throw new Error(`Identifiant ${type} invalide.`);
  return match[1];
}

async function executeDiscordAction(guild, action, event) {
  const botMember = guild.members.me ?? await guild.members.fetchMe();
  if (action.type === "send_message") {
    const channel = await guild.channels.fetch(action.channelId).catch(() => null);
    if (!channel || channel.guildId !== guild.id || !channel.isTextBased()) throw new Error("Salon de destination introuvable sur ce serveur.");
    const permissions = channel.permissionsFor(botMember);
    if (!permissions?.has("ViewChannel") || !permissions?.has("SendMessages")) throw new Error("Le bot ne peut pas publier dans ce salon.");
    const sent = await channel.send({ content: action.content, allowedMentions: { parse: [] } });
    return { type: action.type, messageId: sent.id, channelId: channel.id };
  }

  if (!event.memberId) throw new Error("Aucun membre cible n'est associé à cet événement.");
  if (!botMember.permissions.has("ManageRoles")) throw new Error("Le bot n'a pas la permission Gérer les rôles.");
  const target = await guild.members.fetch(event.memberId).catch(() => null);
  const role = await guild.roles.fetch(action.roleId).catch(() => null);
  if (!target || !role || role.id === guild.id || role.managed) throw new Error("Membre ou rôle indisponible.");
  if (target.id === guild.ownerId || botMember.roles.highest.comparePositionTo(role) <= 0) throw new Error("Hiérarchie Discord insuffisante pour ce rôle.");
  if (action.type === "add_role") {
    await assertRoleGrantable(guild, role, { automatic: true });
    await target.roles.add(role, "Automatisation PND confirmée par le staff");
  } else await target.roles.remove(role, "Automatisation PND confirmée par le staff");
  return { type: action.type, memberId: target.id, roleId: role.id };
}

export async function handleAutomationRulesMessage(message) {
  if (!message?.guild || message.author?.bot || !String(message.content ?? "").trim().toLowerCase().startsWith("=autorule")) return false;
  const [command = "help", ...rest] = String(message.content).trim().slice("=autorule".length).trim().split(/\s+/);
  if (!canManage(message)) {
    await message.reply({ content: "⛔ Cette commande est réservée au propriétaire du serveur ou au staff Gérer le serveur.", allowedMentions: noMentions });
    return true;
  }
  try {
    if (command === "help") {
      await message.reply({ content: "**Automatisations PND**\n`=autorule channel #salon`\n`=autorule create <déclencheur> | <nom> | message #salon | <texte>`\n`=autorule create scheduled | <nom> | every 60 | message #salon | <texte>`\n`=autorule create <déclencheur> | <nom> | add-role @rôle`\n`=autorule list` · `=autorule disable <id>` · `=autorule confirm <runId>`\nDéclencheurs : `member_join`, `member_leave`, `message_created`, `voice_join`, `voice_leave`, `scheduled` (60 min minimum). Toute action passe par un aperçu puis une confirmation staff.", allowedMentions: noMentions });
      return true;
    }
    if (command === "channel") {
      const channelId = parseSnowflake(rest[0], "salon");
      const channel = await message.guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased()) throw new Error("Choisis un salon textuel existant sur ce serveur.");
      const permissions = channel.permissionsFor(message.guild.members.me);
      if (!permissions?.has("ViewChannel") || !permissions?.has("SendMessages")) throw new Error("Le bot doit pouvoir voir et écrire dans ce salon.");
      setAutomationApprovalChannel(message.guild.id, message.author.id, channel.id);
      await message.reply({ content: `✅ Salon de validation défini : <#${channel.id}>.`, allowedMentions: noMentions });
      return true;
    }
    if (command === "create") {
      const payload = String(message.content).slice(String(message.content).toLowerCase().indexOf("=autorule create") + "=autorule create".length).trim();
      const fields = payload.split("|").map((item) => item.trim());
      const [trigger, name] = fields;
      if (!triggers.has(trigger)) throw new Error("Déclencheur inconnu ou non pris en charge.");
      if (!name) throw new Error("Format incomplet. Consulte `=autorule help`.");
      let conditions = {};
      let actionSpec;
      let content;
      if (trigger === "scheduled") {
        const [, intervalSpec, scheduledAction, scheduledContent] = fields;
        const interval = intervalSpec?.match(/^every\s+(\d+)$/i);
        if (!interval) throw new Error("Utilise `every 60` pour définir un intervalle d'au moins 60 minutes.");
        conditions.intervalMinutes = Number(interval[1]);
        actionSpec = scheduledAction;
        content = scheduledContent;
      } else {
        actionSpec = fields[2];
        content = fields[3];
      }
      if (!actionSpec) throw new Error("Action manquante. Consulte `=autorule help`.");
      let action;
      if (actionSpec.toLowerCase().startsWith("message ")) {
        const channelId = parseSnowflake(actionSpec.slice(8).trim(), "salon");
        if (!content) throw new Error("Le contenu du message est requis.");
        action = { type: "send_message", channelId, content };
      } else if (actionSpec.toLowerCase().startsWith("add-role ")) {
        action = { type: "add_role", roleId: parseSnowflake(actionSpec.slice(9).trim(), "rôle") };
      } else if (actionSpec.toLowerCase().startsWith("remove-role ")) {
        action = { type: "remove_role", roleId: parseSnowflake(actionSpec.slice(12).trim(), "rôle") };
      } else throw new Error("Action inconnue. Utilise `message #salon`, `add-role @rôle` ou `remove-role @rôle`.");
      const rule = createAutomationRule(message.guild.id, message.author.id, { name, triggerType: trigger, conditions, actions: [action] });
      await message.reply({ content: `✅ Règle **${rule.name}** créée (` + `\`${rule.ruleId.slice(0, 8)}\`). Les déclenchements seront envoyés au salon de validation configuré.`, allowedMentions: noMentions });
      return true;
    }
    if (command === "list") {
      const rules = listAutomationRules(message.guild.id);
      await message.reply({ content: rules.length ? `**Règles d'automatisation**\n${rules.map((rule) => `• \`${rule.ruleId.slice(0, 8)}\` — ${rule.name} — ${rule.triggerType} — ${rule.enabled ? "active" : "inactive"}`).join("\n")}` : "Aucune règle configurée.", allowedMentions: noMentions });
      return true;
    }
    if (command === "disable") {
      const token = rest[0] ?? "";
      const ruleId = resolveRuleId(message.guild.id, token);
      if (!ruleId) throw new Error("Règle introuvable.");
      disableAutomationRule(message.guild.id, ruleId, message.author.id);
      await message.reply({ content: "✅ Règle désactivée.", allowedMentions: noMentions });
      return true;
    }
    if (command === "confirm") {
      const runId = rest[0];
      if (!runId || !/^[0-9a-f-]{36}$/i.test(runId)) throw new Error("Identifiant d'aperçu invalide.");
      const run = getAutomationRun(message.guild.id, runId);
      if (!run || run.status !== "previewed") throw new Error("Aperçu introuvable, déjà traité ou expiré.");
      const roleActions = run.preview.actions.filter((action) => action.type === "add_role" || action.type === "remove_role");
      if (roleActions.length) {
        if (!message.member?.permissions?.has?.("ManageRoles")) throw new Error("Tu dois aussi disposer de la permission Gérer les rôles pour confirmer cette action.");
        for (const action of roleActions) {
          const role = await message.guild.roles.fetch(action.roleId).catch(() => null);
          if (!role || message.member.roles.highest.comparePositionTo(role) <= 0) throw new Error("Ta hiérarchie Discord ne permet pas de modifier ce rôle.");
        }
      }
      confirmAutomationRun(message.guild.id, runId, message.author.id, { authorizeActor: ({ guildId, actorId }) => guildId === message.guild.id && actorId === message.author.id && canManage(message) });
      const result = await executeConfirmedAutomation(message.guild.id, runId, ({ guildId, action, event }) => {
        if (guildId !== message.guild.id) throw new Error("Serveur incohérent.");
        return executeDiscordAction(message.guild, action, event);
      });
      await message.reply({ content: result.executed ? `✅ Automatisation exécutée (${result.results.length} action(s)).` : `⚠️ Action non exécutée : ${result.reason}.`, allowedMentions: noMentions });
      return true;
    }
    throw new Error("Sous-commande inconnue. Utilise `=autorule help`.");
  } catch (error) {
    await message.reply({ content: `❌ ${error instanceof Error ? error.message : "Erreur d'automatisation."}`, allowedMentions: noMentions });
    return true;
  }
}
