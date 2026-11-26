// Her? V5 — gestion sécurisée des webhooks Discord.
// Les tokens sont chiffrés en AES-256-GCM. WEBHOOK_ENCRYPTION_KEY doit être
// une clé hexadécimale de 32 octets (64 caractères), indépendante des tokens Discord.
import { EmbedBuilder, PermissionFlagsBits, WebhookClient } from "discord.js";
import { db } from "./database.js";
import { isSysPlus } from "./systems/sysplus/permissions.js";
import { sendCentralLog, systemLogEmbed } from "./logs.js";
import { encryptWebhookToken, decryptWebhookToken, parseWebhookEncryptionKey } from "./webhooks-crypto.js";
import { HER_THEME_FOOTER, herBotAvatar, themePanelEmbed } from "./theme.js";

const KEY = process.env.WEBHOOK_ENCRYPTION_KEY ?? "";
function encryptionKey() { return parseWebhookEncryptionKey(KEY); }

const findWebhook = db.prepare("SELECT * FROM managed_webhooks WHERE id=? AND guild_id=?");
const insertWebhook = db.prepare("INSERT INTO managed_webhooks(id,guild_id,channel_id,name,encrypted_token,created_by,created_at) VALUES(?,?,?,?,?,?,?)");
const listWebhooks = db.prepare("SELECT id,channel_id,name,created_by,created_at,last_message_id,animation_enabled FROM managed_webhooks WHERE guild_id=? ORDER BY created_at DESC LIMIT 25");
const setOneAnimation = db.prepare("UPDATE managed_webhooks SET animation_enabled=? WHERE id=? AND guild_id=?");
const setAllAnimation = db.prepare("UPDATE managed_webhooks SET animation_enabled=? WHERE guild_id=?");
const removeWebhook = db.prepare("DELETE FROM managed_webhooks WHERE id=? AND guild_id=?");

function canManage(guild, member, settings) {
  return isSysPlus(member, settings?.sysPlus?.roleId);
}
function webhookClient(row) {
  return new WebhookClient({ id: row.id, token: decryptWebhookToken(row.encrypted_token) });
}

export async function handleWebhookInteraction(interaction, settings = {}, record = () => {}) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "webhook") return false;
  const guild = interaction.guild;
  if (!guild) { await interaction.reply({ content: "Cette commande doit être utilisée sur un serveur.", ephemeral: true }); return true; }
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member || !canManage(guild, member, settings)) {
    await interaction.reply({ content: "⛔ Accès réservé au rôle SYS+, au propriétaire ou aux administrateurs.", ephemeral: true });
    return true;
  }
  const action = interaction.options.getSubcommand();
  try {
    if (action === "animation") {
      const enabled = interaction.options.getString("etat", true) === "on" ? 1 : 0;
      const id = interaction.options.getString("id");
      if (id) {
        const row = findWebhook.get(id, guild.id);
        if (!row) throw new Error("Webhook introuvable dans ce serveur.");
        setOneAnimation.run(enabled, id, guild.id);
      } else {
        setAllAnimation.run(enabled, guild.id);
      }
      const stateLabel = enabled ? "activée" : "désactivée";
      const scopeLabel = id ? `pour **${findWebhook.get(id, guild.id).name}**` : "pour tous les webhooks de ce serveur";
      record(enabled ? "webhook_animation_enabled" : "webhook_animation_disabled");
      await sendCentralLog(guild, settings, systemLogEmbed({ title: "🎞️ Animation des webhooks modifiée", description: `Acteur : <@${interaction.user.id}>\nÉtat : **${stateLabel}**\nPortée : ${scopeLabel}` })).catch(() => {});
      await interaction.reply({ content: `✅ Animation ${stateLabel} ${scopeLabel}.`, ephemeral: true });
      return true;
    }

    if (action === "create") {
      const channel = interaction.options.getChannel("salon", true);
      const name = interaction.options.getString("nom", true).trim();
      if (!channel.isTextBased() || !channel.guild || channel.guild.id !== guild.id || typeof channel.createWebhook !== "function") throw new Error("Choisis un salon textuel de ce serveur.");
      const bot = guild.members.me ?? await guild.members.fetchMe();
      if (!channel.permissionsFor(bot)?.has(PermissionFlagsBits.ManageWebhooks)) throw new Error("Le bot doit avoir Gérer les webhooks dans ce salon.");
      const created = await channel.createWebhook({ name, reason: `Webhook créé par ${interaction.user.tag}` });
      try {
        insertWebhook.run(created.id, guild.id, channel.id, name, encryptWebhookToken(created.token), interaction.user.id, Date.now());
      } catch (error) {
        await created.delete("Échec de sauvegarde sécurisée du webhook").catch(() => {});
        throw error;
      }
      record("webhook_created");
      await sendCentralLog(guild, settings, systemLogEmbed({ title: "🔗 Webhook créé", description: `Acteur : <@${interaction.user.id}>\nSalon : <#${channel.id}>\nNom : **${name}**` })).catch(() => {});
      await interaction.reply({ content: `✅ Webhook **${name}** créé dans <#${channel.id}>. Son secret est chiffré dans la base locale et ne sera jamais affiché.`, ephemeral: true });
      return true;
    }
    if (action === "list") {
      const rows = listWebhooks.all(guild.id);
      const description = rows.map((row) => `• **${row.name}** — <#${row.channel_id}> — animation ${row.animation_enabled ? "🟣 activée" : "⚫ désactivée"} — ID \`${row.id}\``).join("\n") || "Aucun webhook géré.";
      const embed = themePanelEmbed(new EmbedBuilder().setTitle("🔗 Webhooks").setDescription(description), { footer: HER_THEME_FOOTER, thumbnailUrl: herBotAvatar(guild) });
      await interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: { parse: [] } });
      return true;
    }
    const id = interaction.options.getString("id", true);
    const row = findWebhook.get(id, guild.id);
    if (!row) throw new Error("Webhook introuvable dans ce serveur.");
    if (action === "delete") {
      const hook = webhookClient(row);
      hook.destroy();
      const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
      const remote = await channel?.fetchWebhooks().catch(() => null);
      const target = remote?.get(id);
      if (target) await target.delete("Suppression via le bot");
      removeWebhook.run(id, guild.id);
      record("webhook_deleted");
      await sendCentralLog(guild, settings, systemLogEmbed({ title: "🗑️ Webhook supprimé", description: `Acteur : <@${interaction.user.id}>\nWebhook : \`${id}\`\nSalon : <#${row.channel_id}>` })).catch(() => {});
      await interaction.reply({ content: "🗑️ Webhook supprimé du bot et de Discord s'il existe encore.", ephemeral: true });
      return true;
    }
    const hook = webhookClient(row);
    try {
      const content = interaction.options.getString("message", true).trim();
      if (!content || content.length > 2000) throw new Error("Le message doit contenir entre 1 et 2000 caractères.");
      const branded = themePanelEmbed(
        new EmbedBuilder().setTitle(`🌙 ${row.name}`).setDescription(content).setTimestamp(),
        { animated: row.animation_enabled === 1, footer: HER_THEME_FOOTER, thumbnailUrl: herBotAvatar(guild) },
      );
      if (action === "publish") {
        const sent = await hook.send({ embeds: [branded], allowedMentions: { parse: [] } });
        db.prepare("UPDATE managed_webhooks SET last_message_id=? WHERE id=? AND guild_id=?").run(sent.id, id, guild.id);
        record("webhook_message_published");
        await sendCentralLog(guild, settings, systemLogEmbed({ title: "📢 Publication Webhook", description: `Acteur : <@${interaction.user.id}>\nWebhook : **${row.name}**\nSalon : <#${row.channel_id}>\nMessage : \`${sent.id}\`\nAnimation : ${row.animation_enabled ? "activée" : "désactivée"}` })).catch(() => {});
        await interaction.reply({ content: `✅ Message publié dans <#${row.channel_id}>${row.animation_enabled ? " avec la bannière animée" : " sans animation"}.`, ephemeral: true });
      } else if (action === "edit") {
        if (!row.last_message_id) throw new Error("Ce webhook n'a encore aucun message à modifier.");
        await hook.editMessage(row.last_message_id, { embeds: [branded], allowedMentions: { parse: [] } });
        record("webhook_message_edited");
        await sendCentralLog(guild, settings, systemLogEmbed({ title: "✏️ Message Webhook modifié", description: `Acteur : <@${interaction.user.id}>\nWebhook : **${row.name}**\nSalon : <#${row.channel_id}>\nMessage : \`${row.last_message_id}\`` })).catch(() => {});
        await interaction.reply({ content: `✅ Dernier message modifié dans <#${row.channel_id}>.`, ephemeral: true });
      }
    } finally { hook.destroy(); }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action webhook impossible.";
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: `❌ ${message}` }).catch(() => {});
    else await interaction.reply({ content: `❌ ${message}`, ephemeral: true }).catch(() => {});
    return true;
  }
}
