import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits,
} from "discord.js";
import { db, transaction } from "./database.js";
import { sendToLogsHub } from "./logs-hub.js";
import { systemLogEmbed } from "./logs.js";
import { parsePndIntelligenceRequest, validatePndIntelligenceAction } from "./pnd-intelligence-policy.js";
import { createPndIntelligenceAction, expirePendingPndIntelligenceActions } from "./pnd-intelligence-store.js";
import { canUsePndIntelligence } from "./pnd-intelligence-access.js";
import { createPndIntelligenceRateLimiter } from "./pnd-intelligence-rate-limit.js";
import { describePndAiFailure } from "./ai-error-messages.js";
export { createPndIntelligenceAction, expirePendingPndIntelligenceActions, recoverInterruptedPndIntelligenceActions } from "./pnd-intelligence-store.js";
export { parsePndIntelligenceRequest, validatePndIntelligenceAction } from "./pnd-intelligence-policy.js";

const P = PermissionFlagsBits;
const noMentions = { parse: [] };



function actionPreview(action) {
  if (action.type === "create_category") return `Créer la catégorie **${action.name}**`;
  if (action.type === "create_text_channel") return `Créer le salon texte **#${action.name}**${action.categoryName ? ` dans **${action.categoryName}**` : ""}`;
  if (action.type === "create_voice_channel") return `Créer le salon vocal **${action.name}**${action.categoryName ? ` dans **${action.categoryName}**` : ""}`;
  if (action.type === "create_role") return `Créer le rôle **${action.name}** sans permission Discord et sans l'attribuer à aucun membre`;
  if (action.type === "rename_channel") return `Renommer <#${action.channelId}> en **#${action.name}**`;
  if (action.type === "set_channel_topic") return `Modifier le sujet de <#${action.channelId}> :\n> ${action.topic || "(effacer le sujet)"}`;
  if (action.type === "set_channel_slowmode") return action.seconds ? `Activer un mode lent de **${action.seconds} seconde(s)** sur <#${action.channelId}>` : `Désactiver le mode lent sur <#${action.channelId}>`;
  if (action.type === "send_announcement") return `Publier l'annonce suivante dans <#${action.channelId}> :\n> ${action.content.replace(/\n/g, "\n> ")}`;
  return "Action non reconnue.";
}

function buttons(actionId) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pndia:${actionId}:confirm`).setLabel("Confirmer l'action").setEmoji("✅").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`pndia:${actionId}:cancel`).setLabel("Annuler").setEmoji("✖️").setStyle(ButtonStyle.Secondary),
  )];
}

function has(member, permission) {
  return Boolean(member?.permissions?.has?.(permission));
}

async function assertPermissions(guild, requester, action) {
  const bot = guild.members.me ?? await guild.members.fetchMe();
  if (["create_category", "create_text_channel", "create_voice_channel"].includes(action.type)) {
    if (!has(requester, P.ManageChannels)) throw new Error("Tu dois avoir Gérer les salons pour demander cette création.");
    if (!has(bot, P.ManageChannels)) throw new Error("Le bot doit avoir Gérer les salons.");
    return { bot };
  }
  if (action.type === "create_role") {
    if (!has(requester, P.ManageRoles) && !has(requester, P.ManageGuild) && requester.id !== guild.ownerId) throw new Error("Tu dois avoir Gérer les rôles pour créer un rôle.");
    if (!has(bot, P.ManageRoles)) throw new Error("Le bot doit avoir Gérer les rôles.");
    return { bot };
  }
  if (["rename_channel", "set_channel_topic", "set_channel_slowmode"].includes(action.type)) {
    if (!has(requester, P.ManageChannels) && !has(requester, P.ManageGuild) && requester.id !== guild.ownerId) throw new Error("Tu dois avoir Gérer les salons pour modifier un salon.");
    if (!has(bot, P.ManageChannels)) throw new Error("Le bot doit avoir Gérer les salons.");
    const channel = await guild.channels.fetch(action.channelId).catch(() => null);
    if (!channel || channel.guildId !== guild.id) throw new Error("Salon cible introuvable sur ce serveur.");
    if (action.type !== "rename_channel" && !channel.isTextBased?.()) throw new Error("Cette modification nécessite un salon textuel.");
    return { bot, channel };
  }
  if (action.type === "send_announcement") {
    if (!has(requester, P.ManageMessages) && !has(requester, P.ManageGuild) && requester.id !== guild.ownerId) {
      throw new Error("Tu dois avoir Gérer les messages ou Gérer le serveur pour publier une annonce.");
    }
    const channel = await guild.channels.fetch(action.channelId).catch(() => null);
    if (!channel?.isTextBased?.() || !channel.send || channel.guildId !== guild.id) throw new Error("Salon d'annonce introuvable ou non textuel sur ce serveur.");
    const requesterPermissions = channel.permissionsFor(requester);
    if (!requesterPermissions?.has(P.ViewChannel) || !requesterPermissions?.has(P.SendMessages)) throw new Error("Tu dois pouvoir voir et écrire dans le salon ciblé pour demander une publication.");
    const permissions = channel.permissionsFor(bot);
    if (!permissions?.has(P.ViewChannel) || !permissions?.has(P.SendMessages)) throw new Error("Le bot doit pouvoir voir ce salon et y envoyer des messages.");
    return { bot, channel };
  }
  throw new Error("Action non autorisée.");
}

async function executeAction(guild, action, resources) {
  if (action.type === "create_category") {
    return await guild.channels.create({ name: action.name, type: ChannelType.GuildCategory, reason: "PND Intelligence — action approuvée" });
  }
  if (action.type === "create_text_channel" || action.type === "create_voice_channel") {
    let parent;
    if (action.categoryName) {
      parent = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name.toLowerCase() === action.categoryName.toLowerCase());
      if (!parent) throw new Error(`Catégorie « ${action.categoryName} » introuvable.`);
    }
    return await guild.channels.create({ name: action.name, type: action.type === "create_text_channel" ? ChannelType.GuildText : ChannelType.GuildVoice, ...(parent ? { parent: parent.id } : {}), reason: "PND Intelligence — action approuvée" });
  }
  if (action.type === "create_role") return await guild.roles.create({ name: action.name, permissions: [], mentionable: false, hoist: false, reason: "PND Intelligence — rôle sans permission créé après confirmation" });
  if (action.type === "rename_channel") return await resources.channel.setName(action.name, "PND Intelligence — action approuvée");
  if (action.type === "set_channel_topic") return await resources.channel.setTopic(action.topic || null, "PND Intelligence — action approuvée");
  if (action.type === "set_channel_slowmode") return await resources.channel.setRateLimitPerUser(action.seconds, "PND Intelligence — action approuvée");
  if (action.type === "send_announcement") {
    await resources.channel.send({ content: action.content, allowedMentions: noMentions });
    return resources.channel;
  }
  throw new Error("Action non autorisée.");
}

async function logAction(guild, requesterId, actorId, action, result) {
  const title = result.ok ? "🧠 PND Intelligence — action exécutée" : "⚠️ PND Intelligence — action échouée";
  const embed = systemLogEmbed({
    category: "ai",
    title,
    description: `Demandeur : <@${requesterId}>\nValidateur : <@${actorId}>\nAction : ${action.type}\nRésultat : ${result.message}`,
    color: result.ok ? 0x22c55e : 0xef4444,
  });
  await sendToLogsHub(guild.client, guild, embed, title).catch(() => {});
}

const plannerRateLimiter = createPndIntelligenceRateLimiter();

export async function handlePndIntelligenceMessage(message, { apiUrl, secret, instructions = "", settings = {}, ownerIds } = {}) {
  const match = String(message.content ?? "").trim().match(/^=pndia(?:\s+([\s\S]+))?$/i);
  if (!match) return false;
  if (!message.guild || !message.member || message.author.bot) return true;
  const sysPlus = settings?.[message.guild.id]?.sysPlus ?? {};
  if (!canUsePndIntelligence({
    guildId: message.guild.id,
    channelId: message.channel.id,
    enabled: sysPlus.intelligenceEnabled,
    configuredChannelId: sysPlus.intelligenceChannelId,
    member: message.member,
    sysPlusRoleId: sysPlus.roleId,
    ownerIds,
  })) {
    await message.reply({ content: "⛔ PND Intelligence est réservée au salon dédié configuré et aux membres SYS+ ou propriétaires PND autorisés.", allowedMentions: noMentions });
    return true;
  }
  try {
    if (!match[1] || /^(aide|help)$/i.test(match[1].trim())) {
      await message.reply({ content: "**🧠 PND Intelligence**\n`=pndia crée une catégorie Staff`\n`=pndia crée un salon texte annonces dans la catégorie Staff`\n`=pndia crée un rôle Animateur`\n`=pndia crée un salon vocal réunion dans la catégorie Staff`\n`=pndia renomme le salon <#id> en annonces`\n`=pndia change le sujet du salon <#id> en Texte du sujet`\n`=pndia active le mode lent à 10 secondes sur <#id>`\n`=pndia publie une annonce ... dans #annonces`\n`=pndia history`\nChaque action est prévisualisée et nécessite une confirmation.", allowedMentions: noMentions });
      return true;
    }
    if (/^history$/i.test(match[1].trim())) {
      const rows = db.prepare(`SELECT action_id,action_json,status,created_at,expires_at
        FROM pnd_intelligence_actions WHERE guild_id=? AND requester_id=?
        ORDER BY created_at DESC LIMIT 10`).all(message.guild.id, message.author.id);
      const output = rows.map((row) => {
        const action = JSON.parse(row.action_json);
        const labels = {
          create_category: "Création de catégorie", create_text_channel: "Création de salon texte",
          create_voice_channel: "Création de salon vocal", create_role: "Création de rôle",
          rename_channel: "Renommage de salon", set_channel_topic: "Modification de sujet",
          set_channel_slowmode: "Mode lent", send_announcement: "Annonce",
        };
        const statuses = { pending: "en attente", processing: "en cours", executed: "exécutée", cancelled: "annulée", expired: "expirée", failed: "à vérifier" };
        const label = `${labels[action.type] ?? "Action"}${action.name ? ` · ${action.name}` : ""}`;
        return `• **${statuses[row.status] ?? "inconnue"}** · ${label} · <t:${Math.floor(Number(row.created_at) / 1000)}:R> · \`${row.action_id.slice(0, 8)}\``;
      });
      await message.reply({ content: output.length ? `**🧠 Tes 10 dernières actions PND Intelligence**\n${output.join("\n")}` : "Aucune action enregistrée.", allowedMentions: noMentions });
      return true;
    }
    let action;
    try {
      action = parsePndIntelligenceRequest(match[1]);
    } catch {
      const isGuildOwner = message.guild.ownerId === message.author.id;
      if (!isGuildOwner && !has(message.member, P.ManageChannels) && !has(message.member, P.ManageMessages) && !has(message.member, P.ManageGuild)) {
        throw new Error("Tu dois disposer de Gérer les salons ou Gérer les messages pour demander une action à PND Intelligence.");
      }
      if (!apiUrl || !secret) throw new Error("Le planificateur IA n'est pas configuré sur ce bot.");
      const rateKey = `${message.guild.id}:${message.author.id}`;
      if (!plannerRateLimiter.take(rateKey)) throw new Error("Limite atteinte : 3 plans IA par minute.");
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          action: "ai-action-plan",
          prompt: match[1].slice(0, 1200),
          instructions,
          author: message.member.displayName ?? message.author.username,
          guildId: message.guild.id,
          userId: message.author.id,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.action) {
        throw new Error(describePndAiFailure(response.status, data, "action"));
      }
      if (data.action?.type === "none") throw new Error(String(data.action.reason ?? "Cette demande n'est pas prise en charge."));
      action = validatePndIntelligenceAction(data.action);
    }
    await assertPermissions(message.guild, message.member, action);
    const pending = createPndIntelligenceAction({ guildId: message.guild.id, requesterId: message.author.id, sourceChannelId: message.channel.id, action });
    const post = await message.reply({
      content: `🧠 **PND Intelligence — aperçu**\n${actionPreview(action)}\n\nServeur : **${message.guild.name}**\nDemandeur : <@${message.author.id}>\nExpiration : <t:${Math.floor(pending.expiresAt / 1000)}:R>\n\nAucun changement n'a encore été effectué. Confirme ci-dessous pour exécuter.`,
      components: buttons(pending.actionId),
      allowedMentions: noMentions,
    });
    db.prepare("UPDATE pnd_intelligence_actions SET source_message_id=? WHERE action_id=? AND status='pending'").run(post.id, pending.actionId);
  } catch (error) {
    await message.reply({ content: `❌ ${error instanceof Error ? error.message : "Action impossible."}`, allowedMentions: noMentions });
  }
  return true;
}

export async function handlePndIntelligenceInteraction(interaction, { settings = {}, ownerIds } = {}) {
  if (!interaction?.isButton?.() || !String(interaction.customId).startsWith("pndia:")) return false;
  const [, actionId, intent] = interaction.customId.split(":");
  const row = db.prepare("SELECT * FROM pnd_intelligence_actions WHERE action_id=?").get(actionId);
  if (!row || !interaction.guild || row.guild_id !== interaction.guild.id || row.source_channel_id !== interaction.channelId || row.source_message_id !== interaction.message?.id) {
    await interaction.reply({ content: "Cet aperçu n'existe plus ou ne correspond pas à ce message.", ephemeral: true });
    return true;
  }
  const sysPlus = settings?.[interaction.guild.id]?.sysPlus ?? {};
  const actor = await interaction.guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
  if (!actor || !canUsePndIntelligence({
    guildId: interaction.guild.id,
    channelId: interaction.channelId,
    enabled: sysPlus.intelligenceEnabled,
    configuredChannelId: sysPlus.intelligenceChannelId,
    member: actor,
    sysPlusRoleId: sysPlus.roleId,
    ownerIds,
  })) {
    await interaction.reply({ content: "⛔ Seuls les membres SYS+ autorisés ou les propriétaires PND peuvent valider cette action dans le salon dédié.", ephemeral: true });
    return true;
  }
  if (intent === "cancel") {
    const changed = db.prepare("UPDATE pnd_intelligence_actions SET status='cancelled',decided_by=?,decided_at=? WHERE action_id=? AND status='pending'")
      .run(interaction.user.id, Date.now(), actionId);
    if (!Number(changed.changes)) {
      await interaction.reply({ content: "Cette action a déjà été traitée.", ephemeral: true });
      return true;
    }
    await interaction.update({ content: "🛑 **Action annulée.** Aucune modification n'a été effectuée.", components: [] });
    return true;
  }
  if (intent !== "confirm") return false;
  if (Number(row.expires_at) <= Date.now()) {
    db.prepare("UPDATE pnd_intelligence_actions SET status='expired',decided_at=? WHERE action_id=? AND status='pending'").run(Date.now(), actionId);
    await interaction.update({ content: "⌛ **Aperçu expiré.** Relance ta demande pour obtenir une nouvelle validation.", components: [] });
    return true;
  }
  const claimed = db.prepare("UPDATE pnd_intelligence_actions SET status='processing',decided_by=?,decided_at=? WHERE action_id=? AND status='pending'")
    .run(interaction.user.id, Date.now(), actionId);
  if (!Number(claimed.changes)) {
    await interaction.reply({ content: "Cette action vient d'être traitée par quelqu'un d'autre.", ephemeral: true });
    return true;
  }
  await interaction.deferUpdate();
  const action = JSON.parse(row.action_json);
  try {
    const requester = await interaction.guild.members.fetch({ user: row.requester_id, force: true }).catch(() => null);
    if (!requester) throw new Error("Le demandeur n'est plus membre du serveur.");
    const requesterSysPlus = settings?.[interaction.guild.id]?.sysPlus ?? {};
    if (!canUsePndIntelligence({
      guildId: interaction.guild.id,
      channelId: row.source_channel_id,
      enabled: requesterSysPlus.intelligenceEnabled,
      configuredChannelId: requesterSysPlus.intelligenceChannelId,
      member: requester,
      sysPlusRoleId: requesterSysPlus.roleId,
      ownerIds,
    })) {
      throw new Error("Le demandeur ne dispose plus de l'accès SYS+ requis pour cette action.");
    }
    const resources = await assertPermissions(interaction.guild, requester, action);
    const result = await executeAction(interaction.guild, action, resources);
    const resultMessage = action.type === "send_announcement" ? `Annonce publiée dans <#${result.id}>.` : action.type === "rename_channel" ? `Salon renommé : <#${result.id}>.` : action.type === "set_channel_topic" ? `Sujet mis à jour sur <#${result.id}>.` : action.type === "set_channel_slowmode" ? `Mode lent mis à jour sur <#${result.id}>.` : action.type === "create_role" ? `Rôle **${result.name}** créé sans permission et non attribué.` : `Créé : ${result.name} (<#${result.id}>).`;
    db.prepare("UPDATE pnd_intelligence_actions SET status='executed',result_json=? WHERE action_id=? AND status='processing'")
      .run(JSON.stringify({ id: result.id, name: result.name ?? null }), actionId);
    await interaction.editReply({ content: `✅ **Action exécutée.** ${resultMessage}`, components: [] });
    await logAction(interaction.guild, row.requester_id, interaction.user.id, action, { ok: true, message: resultMessage });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 300) : "Erreur Discord inconnue.";
    db.prepare("UPDATE pnd_intelligence_actions SET status='failed',result_json=? WHERE action_id=? AND status='processing'")
      .run(JSON.stringify({ error: reason }), actionId);
    await interaction.editReply({ content: `❌ **Action non exécutée.** ${reason}\nAucune autre action n'a été lancée.`, components: [] });
    await logAction(interaction.guild, row.requester_id, interaction.user.id, action, { ok: false, message: reason });
  }
  return true;
}

