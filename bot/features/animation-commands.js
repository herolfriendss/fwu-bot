// /anim comptage, /anim vedette et /anim qdj (SUCK ME, une seule commande racine) : les commandes et les événements du
// salon de comptage, du mur des célébrités et de la question du jour.
// Les réglages sont réservés au staff (OWNER, propriétaire du serveur,
// Administrateur ou « Gérer le serveur ») ; l'état et les classements sont
// ouverts à tous.
import { ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits as P } from "discord.js";
import { parsePndOwnerId } from "../pnd-owner-policy.js";
import {
  applyCount, breakMessage, countDeleted, countingConfig, countingLeaderboard, disableCounting, setCountingChannel,
} from "./counting.js";
import { handleStarReaction, normalizeStarEmoji, saveStarboardConfig, starboardConfig, starboardStats } from "./starboard.js";
import { addQuestion, parisClock, pendingQuestions, postQotd, qotdConfig, saveQotdConfig } from "./qotd.js";

export const ANIMATION_COMMANDS = new Set(["anim"]);
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const TEXT_CHANNELS = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

export const isAnimationStaff = (member) =>
  Boolean(member) && (
    member.id === parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID)
    || member.id === member.guild?.ownerId
    || Boolean(member.permissions?.has?.(P.Administrator) || member.permissions?.has?.(P.ManageGuild))
  );

/** Le bot peut-il écrire (et réagir) dans ce salon ? Vérifié avant d'enregistrer un réglage. */
function botCanPost(channel, { react = false, thread = false } = {}) {
  const me = channel?.guild?.members?.me;
  const perms = me ? channel.permissionsFor(me) : null;
  if (!perms) return "je ne vois pas ce salon";
  const needed = [[P.ViewChannel, "Voir le salon"], [P.SendMessages, "Envoyer des messages"], [P.EmbedLinks, "Intégrer des liens"]];
  if (react) needed.push([P.AddReactions, "Ajouter des réactions"], [P.ReadMessageHistory, "Voir l'historique"]);
  if (thread) needed.push([P.CreatePublicThreads, "Créer des fils publics"]);
  const missing = needed.filter(([flag]) => !perms.has(flag)).map(([, label]) => label);
  return missing.length ? `il me manque : ${missing.join(", ")}` : null;
}

// ─── Comptage ────────────────────────────────────────────────────────────────

async function counting(interaction, subcommand) {
  const guildId = interaction.guildId;
  if (subcommand === "etat") {
    const state = countingConfig(guildId);
    if (!state.enabled || !state.channelId) return interaction.reply(ephemeral("🔢 Le salon de comptage n'est pas activé. Le staff peut le lancer avec `/anim comptage salon`."));
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x22c55e).setTitle("🔢 Salon de comptage").addFields(
        { name: "Salon", value: `<#${state.channelId}>`, inline: true },
        { name: "Prochain nombre", value: `**${state.current + 1}**`, inline: true },
        { name: "Record", value: state.record ? `**${state.record}**${state.recordAt ? ` (<t:${Math.floor(state.recordAt / 1000)}:d>)` : ""}` : "aucun", inline: true },
        { name: "Séries cassées", value: String(state.fails), inline: true },
      )],
      allowedMentions: { parse: [] },
    });
  }
  if (subcommand === "classement") {
    const rows = countingLeaderboard(guildId, 10);
    const medal = (i) => ["🥇", "🥈", "🥉"][i] ?? `**${i + 1}.**`;
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x22c55e).setTitle("🔢 Meilleurs compteurs").setDescription(
        rows.length ? rows.map((r, i) => `${medal(i)} <@${r.userId}> · ${r.correct} nombres · ${r.mistakes} erreur${r.mistakes > 1 ? "s" : ""}`).join("\n") : "Personne n'a encore compté.",
      )],
      allowedMentions: { parse: [] },
    });
  }
  if (!isAnimationStaff(interaction.member)) return interaction.reply(ephemeral("⛔ Réservé au staff (Gérer le serveur)."));
  if (subcommand === "salon") {
    const channel = interaction.options.getChannel("salon", true);
    if (!TEXT_CHANNELS.has(channel.type)) return interaction.reply(ephemeral("❌ Choisis un salon textuel."));
    const problem = botCanPost(channel, { react: true });
    if (problem) return interaction.reply(ephemeral(`❌ Dans <#${channel.id}>, ${problem}.`));
    const state = setCountingChannel(guildId, channel.id);
    return interaction.reply(ephemeral(`✅ Salon de comptage : <#${channel.id}>. Prochain nombre : **${state.current + 1}**. Record actuel : **${state.record}**.\nRègle : chacun son tour, un mauvais nombre remet à zéro.`));
  }
  if (subcommand === "desactiver") {
    return interaction.reply(ephemeral(disableCounting(guildId) ? "✅ Salon de comptage désactivé (le record est gardé)." : "Le comptage n'était pas activé."));
  }
  return false;
}

/** messageCreate : un nombre posté dans le salon de comptage. true si le message a été pris en charge. */
export async function handleCountingMessage(message) {
  if (!message?.guildId || message.author?.bot) return false;
  const verdict = applyCount({
    guildId: message.guildId, channelId: message.channelId, userId: message.author.id, messageId: message.id, content: message.content,
  });
  if (!verdict) return false;
  if (verdict.ok) {
    await message.react(verdict.milestone ? "🎉" : verdict.record ? "🏆" : "✅").catch(() => {});
    return true;
  }
  await message.react("❌").catch(() => {});
  await message.reply({ content: breakMessage(message.author.id, verdict), allowedMentions: { users: [message.author.id], repliedUser: false } }).catch(() => {});
  return true;
}

/** messageDelete : le dernier nombre valide a disparu, on rappelle où on en est. */
export async function handleCountingDelete(message) {
  if (!message?.guildId) return false;
  const gone = countDeleted(message.guildId, message.channelId, message.id);
  if (!gone) return false;
  await message.channel?.send?.({
    content: `🔢 Le dernier nombre (**${gone.current}**${gone.userId ? `, de <@${gone.userId}>` : ""}) a été supprimé. Le prochain est **${gone.current + 1}**.`,
    allowedMentions: { parse: [] },
  }).catch(() => {});
  return true;
}

// ─── Vedette ─────────────────────────────────────────────────────────────────

async function starboard(interaction, subcommand) {
  const guildId = interaction.guildId;
  if (subcommand === "etat") {
    const config = starboardConfig(guildId);
    const stats = starboardStats(guildId);
    const emoji = /^\d+$/.test(config.emoji) ? `<:e:${config.emoji}>` : config.emoji;
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0xf5b301).setTitle("🌟 Mur des célébrités").addFields(
        { name: "Salon", value: config.enabled && config.channelId ? `<#${config.channelId}>` : "*désactivé*", inline: true },
        { name: "Règle", value: `${config.threshold} × ${emoji}`, inline: true },
        { name: "Messages en vedette", value: String(stats.posts), inline: true },
        { name: "Record d'étoiles", value: String(stats.best), inline: true },
        { name: "Les plus mis en vedette", value: stats.top.length ? stats.top.map((r) => `<@${r.userId}> · ${r.posts}`).join("\n") : "personne pour l'instant" },
      )],
      allowedMentions: { parse: [] },
    });
  }
  if (!isAnimationStaff(interaction.member)) return interaction.reply(ephemeral("⛔ Réservé au staff (Gérer le serveur)."));
  if (subcommand === "config") {
    const channel = interaction.options.getChannel("salon", true);
    if (!TEXT_CHANNELS.has(channel.type)) return interaction.reply(ephemeral("❌ Choisis un salon textuel."));
    const problem = botCanPost(channel);
    if (problem) return interaction.reply(ephemeral(`❌ Dans <#${channel.id}>, ${problem}.`));
    const rawEmoji = interaction.options.getString("emoji");
    const threshold = interaction.options.getInteger("seuil");
    const allowSelf = interaction.options.getBoolean("auto_etoile");
    const next = saveStarboardConfig(guildId, {
      channelId: channel.id, enabled: true,
      ...(rawEmoji ? { emoji: normalizeStarEmoji(rawEmoji) } : {}),
      ...(threshold === null ? {} : { threshold }),
      ...(allowSelf === null ? {} : { allowSelf }),
    });
    const emoji = /^\d+$/.test(next.emoji) ? `<:e:${next.emoji}>` : next.emoji;
    return interaction.reply(ephemeral(`✅ Mur des célébrités : <#${channel.id}>. Un message est recopié dès **${next.threshold} × ${emoji}**${next.allowSelf ? "" : " (l'auteur ne compte pas)"}.\nSeuls les messages des salons publics sont recopiés.`));
  }
  if (subcommand === "desactiver") {
    const config = starboardConfig(guildId);
    if (!config.enabled) return interaction.reply(ephemeral("Le mur des célébrités n'était pas activé."));
    saveStarboardConfig(guildId, { enabled: false });
    return interaction.reply(ephemeral("✅ Mur des célébrités désactivé. Les messages déjà publiés restent."));
  }
  return false;
}

/** messageReactionAdd / messageReactionRemove. */
export async function handleStarboardReaction(reaction, user) {
  if (user?.bot) return null;
  return handleStarReaction(reaction);
}

// ─── Question du jour ────────────────────────────────────────────────────────

async function qotd(interaction, subcommand) {
  const guildId = interaction.guildId;
  if (subcommand === "etat") {
    const config = qotdConfig(guildId);
    const clock = parisClock();
    const doneToday = config.lastDay === clock.day;
    return interaction.reply(ephemeral([
      "❓ **Question du jour**",
      `Salon : ${config.enabled && config.channelId ? `<#${config.channelId}>` : "*désactivée*"}`,
      `Heure : **${config.hour} h** (heure de Paris)${config.enabled ? (doneToday ? " · déjà publiée aujourd'hui" : "") : ""}`,
      `Rôle mentionné : ${config.roleId ? `<@&${config.roleId}>` : "aucun"}`,
      `Fil de réponses : **${config.thread ? "oui" : "non"}**`,
      `Questions publiées : **${config.posted}** · questions du staff en attente : **${pendingQuestions(guildId)}**`,
    ].join("\n")));
  }
  if (!isAnimationStaff(interaction.member)) return interaction.reply(ephemeral("⛔ Réservé au staff (Gérer le serveur)."));
  if (subcommand === "config") {
    const channel = interaction.options.getChannel("salon", true);
    if (!TEXT_CHANNELS.has(channel.type)) return interaction.reply(ephemeral("❌ Choisis un salon textuel."));
    const hour = interaction.options.getInteger("heure");
    const role = interaction.options.getRole("role");
    const thread = interaction.options.getBoolean("fil");
    const wantsThread = thread ?? qotdConfig(guildId).thread;
    const problem = botCanPost(channel, { thread: wantsThread });
    if (problem) return interaction.reply(ephemeral(`❌ Dans <#${channel.id}>, ${problem}.`));
    if (role && (role.id === interaction.guildId || role.managed)) return interaction.reply(ephemeral("❌ Choisis un rôle normal (pas @everyone ni un rôle de bot)."));
    const next = saveQotdConfig(guildId, {
      channelId: channel.id, enabled: true,
      ...(hour === null ? {} : { hour }),
      ...(role ? { roleId: role.id } : {}),
      ...(thread === null ? {} : { thread }),
    });
    return interaction.reply(ephemeral(`✅ Question du jour dans <#${channel.id}> chaque jour à **${next.hour} h** (Paris)${next.roleId ? `, en mentionnant <@&${next.roleId}>` : ""}${next.thread ? ", avec un fil de réponses" : ""}.\nAstuce : \`/qdj ajouter\` pour proposer vos propres questions, elles passent en premier.`));
  }
  if (subcommand === "sans_role") {
    saveQotdConfig(guildId, { roleId: null });
    return interaction.reply(ephemeral("✅ La question du jour ne mentionne plus de rôle."));
  }
  if (subcommand === "desactiver") {
    const config = qotdConfig(guildId);
    if (!config.enabled) return interaction.reply(ephemeral("La question du jour n'était pas activée."));
    saveQotdConfig(guildId, { enabled: false });
    return interaction.reply(ephemeral("✅ Question du jour désactivée."));
  }
  if (subcommand === "ajouter") {
    const added = addQuestion(guildId, interaction.options.getString("question", true), interaction.user.id);
    return interaction.reply(ephemeral(`✅ Question ajoutée. Elle passera avant les questions intégrées (${added.pending} en attente).`));
  }
  if (subcommand === "maintenant") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await postQotd(interaction.guild, { force: true });
    return interaction.editReply(result.ok ? `✅ Question #${result.number} publiée. Elle compte comme la question du jour.` : `❌ ${result.reason}`);
  }
  return false;
}

export async function handleAnimationInteraction(interaction) {
  if (!interaction.isChatInputCommand?.() || !ANIMATION_COMMANDS.has(interaction.commandName) || !interaction.guildId) return false;
  try {
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();
    const handler = { comptage: counting, vedette: starboard, qdj: qotd }[group];
    const handled = handler ? await handler(interaction, subcommand) : false;
    if (handled === false && !interaction.replied && !interaction.deferred) await interaction.reply(ephemeral("Sous-commande inconnue."));
    return true;
  } catch (error) {
    const content = `❌ ${error instanceof Error ? error.message : "Action impossible."}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {});
    else await interaction.reply(ephemeral(content)).catch(() => {});
    return true;
  }
}
