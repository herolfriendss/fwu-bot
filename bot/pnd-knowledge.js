import {
  ActionRowBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} from "discord.js";
import { db } from "./database.js";
import {
  getKnowledgeTopic,
  KNOWLEDGE_TOPICS,
  normalizeKnowledgePage,
  parseKnowledgePrefixCommand,
} from "./pnd-knowledge-policy.js";

const P = PermissionFlagsBits;
const TOPIC_SELECT_ID = "pndknowledge:topic";

db.exec(`
  CREATE TABLE IF NOT EXISTS pnd_knowledge_pages (
    guild_id TEXT NOT NULL,
    topic_key TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, topic_key)
  );
`);

const readPage = db.prepare("SELECT title, content, updated_by, updated_at FROM pnd_knowledge_pages WHERE guild_id=? AND topic_key=?");
const savePage = db.prepare(`INSERT INTO pnd_knowledge_pages(guild_id,topic_key,title,content,updated_by,updated_at)
  VALUES(?,?,?,?,?,?) ON CONFLICT(guild_id,topic_key) DO UPDATE SET
  title=excluded.title, content=excluded.content, updated_by=excluded.updated_by, updated_at=excluded.updated_at`);

function pageFor(guildId, key) {
  const topic = getKnowledgeTopic(key);
  if (!topic) return null;
  const saved = readPage.get(guildId, topic.key);
  return saved ? { key: topic.key, label: topic.label, title: saved.title, content: saved.content } : topic;
}

function pageEmbed(guild, page) {
  return new EmbedBuilder()
    .setColor(0x6d28d9)
    .setTitle(`📚 ${page.title}`)
    .setDescription(page.content)
    .setFooter({ text: `${guild.name} • Base de connaissances PND` });
}

function topicMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(TOPIC_SELECT_ID)
      .setPlaceholder("Choisir une rubrique")
      .addOptions(KNOWLEDGE_TOPICS.map((topic) => ({ label: topic.label, value: topic.key }))),
  );
}

function canManageKnowledge(member, guild) {
  return member?.id === guild.ownerId || Boolean(member?.permissions?.has?.(P.ManageGuild));
}

async function freshManager(guild, userId) {
  const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
  return member && canManageKnowledge(member, guild) ? member : null;
}

async function publishPanel(channel, guild) {
  const page = pageFor(guild.id, "guide");
  await channel.send({ embeds: [pageEmbed(guild, page)], components: [topicMenu()], allowedMentions: { parse: [] } });
}

async function handleEdit({ guild, actorId, topicKey, title, content }) {
  const actor = await freshManager(guild, actorId);
  if (!actor) throw new Error("La modification des rubriques est réservée au propriétaire du serveur ou aux membres avec Gérer le serveur.");
  const topic = getKnowledgeTopic(topicKey);
  if (!topic) throw new Error("Rubrique inconnue. Choisis permissions, recruitment, tickets, rules, guide ou sysplus.");
  const page = normalizeKnowledgePage({ title, content });
  savePage.run(guild.id, topic.key, page.title, page.content, actorId, Date.now());
  return page;
}

export async function handleKnowledgeMessage(message) {
  if (!message?.guild || !message?.member) return false;
  const command = parseKnowledgePrefixCommand(message.content);
  if (!command) return false;
  try {
    if (command.action === "panel") {
      const actor = await freshManager(message.guild, message.author.id);
      if (!actor) throw new Error("La publication du panneau est réservée au propriétaire du serveur ou aux membres avec Gérer le serveur.");
      await publishPanel(message.channel, message.guild);
      await message.reply({ content: "✅ Panneau PND Knowledge publié.", allowedMentions: { parse: [] } });
      return true;
    }
    if (command.action === "show") {
      const page = pageFor(message.guild.id, command.topic);
      if (!page) throw new Error("Rubrique inconnue. Rubriques : permissions, recruitment, tickets, rules, guide, sysplus.");
      await message.reply({ embeds: [pageEmbed(message.guild, page)], allowedMentions: { parse: [] } });
      return true;
    }
    if (command.action === "edit") {
      const page = await handleEdit({ guild: message.guild, actorId: message.author.id, ...command });
      await message.reply({ content: `✅ Rubrique **${page.title}** mise à jour.`, allowedMentions: { parse: [] } });
      return true;
    }
    await message.reply({
      content: "**PND Knowledge**\n`=knowledge panel` — publier le panneau\n`=knowledge show <rubrique>` — afficher une rubrique\n`=knowledge edit <rubrique> | <titre> | <contenu>` — modifier une rubrique (staff gestion serveur)",
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    await message.reply({ content: `❌ ${error instanceof Error ? error.message : "Action impossible."}`, allowedMentions: { parse: [] } });
  }
  return true;
}

export async function handleKnowledgeInteraction(interaction) {
  if (interaction.isStringSelectMenu?.() && interaction.customId === TOPIC_SELECT_ID) {
    if (!interaction.guild) {
      await interaction.reply({ content: "Cette rubrique doit être ouverte depuis un serveur.", ephemeral: true });
      return true;
    }
    const page = pageFor(interaction.guild.id, interaction.values[0]);
    if (!page) {
      await interaction.reply({ content: "Rubrique introuvable.", ephemeral: true });
      return true;
    }
    await interaction.update({ embeds: [pageEmbed(interaction.guild, page)], components: [topicMenu()], allowedMentions: { parse: [] } });
    return true;
  }
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== "knowledge") return false;
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Cette commande doit être utilisée sur un serveur.", ephemeral: true });
    return true;
  }
  const action = interaction.options.getSubcommand();
  try {
    if (action === "panel") {
      const actor = await freshManager(guild, interaction.user.id);
      if (!actor) throw new Error("La publication du panneau est réservée au propriétaire du serveur ou aux membres avec Gérer le serveur.");
      await interaction.deferReply({ ephemeral: true });
      if (!interaction.channel?.isTextBased?.()) throw new Error("Choisis un salon textuel.");
      await publishPanel(interaction.channel, guild);
      await interaction.editReply({ content: "✅ Panneau PND Knowledge publié." });
      return true;
    }
    if (action === "show") {
      const page = pageFor(guild.id, interaction.options.getString("rubrique", true));
      if (!page) throw new Error("Rubrique introuvable.");
      await interaction.reply({ embeds: [pageEmbed(guild, page)], ephemeral: true, allowedMentions: { parse: [] } });
      return true;
    }
    if (action === "edit") {
      const page = await handleEdit({
        guild,
        actorId: interaction.user.id,
        topicKey: interaction.options.getString("rubrique", true),
        title: interaction.options.getString("titre", true),
        content: interaction.options.getString("contenu", true),
      });
      await interaction.reply({ content: `✅ Rubrique **${page.title}** mise à jour.`, ephemeral: true, allowedMentions: { parse: [] } });
      return true;
    }
  } catch (error) {
    const content = `❌ ${error instanceof Error ? error.message : "Action impossible."}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {});
    else await interaction.reply({ content, ephemeral: true }).catch(() => {});
    return true;
  }
  return false;
}

export function getKnowledgePage(guildId, topicKey) {
  return pageFor(guildId, topicKey);
}
