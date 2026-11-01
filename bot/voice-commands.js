import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits, UserSelectMenuBuilder } from "discord.js";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { canUseVoiceCommand, privateVoicePlan, restoreVoicePlan, voiceCommand } from "./voice-permissions.js";

const panels = new Map();
const busyChannels = new Set();
const stateFile = new URL("./data/voice-locks.json", import.meta.url);
let snapshots;
let pendingWrite = Promise.resolve();

async function loadState() {
  if (snapshots) return snapshots;
  try { snapshots = JSON.parse(await readFile(stateFile, "utf8")); }
  catch (e) { if (e.code !== "ENOENT") throw e; snapshots = {}; }
  return snapshots;
}
async function persist() {
  const contents = JSON.stringify(snapshots);
  const write = pendingWrite.catch(() => {}).then(async () => {
    await mkdir(new URL("./data/", import.meta.url), { recursive: true });
    await writeFile(new URL("./data/voice-locks.tmp", import.meta.url), contents, { mode: 0o600 });
    await rename(new URL("./data/voice-locks.tmp", import.meta.url), stateFile);
  });
  pendingWrite = write;
  await write;
}
const serialOverwrites = (channel) => [...channel.permissionOverwrites.cache.values()].map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() }));
async function apply(channel, plan) {
  for (const target of plan) await channel.permissionOverwrites.edit(target.id, { Connect: target.Connect }, { type: target.type, reason: "Configuration vocale depuis le bot" });
}
async function lock(channel, member, bot) {
  const state = await loadState();
  if (!state[channel.id]) {
    state[channel.id] = { guildId: channel.guild.id, overwrites: serialOverwrites(channel) };
    await persist();
  }
  await apply(channel, privateVoicePlan(serialOverwrites(channel), channel.guild.id, member.id, bot.id));
}
async function unlock(channel) {
  const state = await loadState();
  const snapshot = state[channel.id];
  if (!snapshot || snapshot.guildId !== channel.guild.id) throw new Error("Ce salon n’a pas été verrouillé par ce bot.");
  await apply(channel, restoreVoicePlan(serialOverwrites(channel), snapshot.overwrites));
  delete state[channel.id];
  await persist();
}
async function authorizedChannel(guild, memberId, expectedChannelId, command, access) {
  const member = await guild.members.fetch({ user: memberId, force: true });
  const channelId = member.voice.channelId;
  if (!channelId || (expectedChannelId && channelId !== expectedChannelId)) throw new Error("Rejoins le salon vocal concerné avant cette action.");
  const channel = await guild.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error("Cette commande demande un salon vocal classique.");
  if (!canUseVoiceCommand(command, channel.permissionsFor(member)?.bitfield ?? 0n, [...member.roles.cache.keys()], access, guild.ownerId === memberId)) throw new Error(`Tu n’as pas accès à ${command}. Vérifie les rôles autorisés dans le panneau Admin.`);
  const bot = await guild.members.fetchMe();
  const botPermissions = channel.permissionsFor(bot);
  if (command === "=access" || command === "=unaccess") {
    if (!botPermissions?.has(PermissionFlagsBits.ManageRoles)) throw new Error("Le bot doit avoir « Gérer les rôles » pour modifier les permissions d’accès au vocal.");
  } else {
    if (!botPermissions?.has(PermissionFlagsBits.ManageChannels)) throw new Error("Le bot doit avoir « Gérer les salons » dans ce vocal.");
    if (!botPermissions.has(PermissionFlagsBits.ManageRoles)) throw new Error("Le bot doit aussi avoir « Gérer les rôles » dans ce vocal.");
  }
  return { channel, member, bot };
}
async function exclusive(channelId, action) {
  if (busyChannels.has(channelId)) throw new Error("Une modification est déjà en cours dans ce vocal.");
  busyChannels.add(channelId);
  try { return await action(); } finally { busyChannels.delete(channelId); }
}

function panelPayload(channel, panelId) {
  return {
    embeds: [new EmbedBuilder().setTitle(`Vocal · ${channel.name}`).setDescription("Accès au salon vocal").addFields({ name: "Privé", value: "Les autres membres ne peuvent plus rejoindre. Les administrateurs et le propriétaire du serveur restent exemptés." })],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`voice:${panelId}:lock`).setLabel("Privé").setEmoji("🔒").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`voice:${panelId}:unlock`).setLabel("Rétablir l’accès").setEmoji("🔓").setStyle(ButtonStyle.Secondary)),
      new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`voice:${panelId}:allow`).setPlaceholder("Autoriser une personne").setMinValues(1).setMaxValues(1)),
      new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`voice:${panelId}:block`).setPlaceholder("Bloquer une personne").setMinValues(1).setMaxValues(1)),
    ], allowedMentions: { parse: [] },
  };
}

export async function handleVoiceMessage(msg, access) {
  const command = voiceCommand(msg.content);
  if (!command) return false;
  try {
    const { channel, member, bot } = await authorizedChannel(msg.guild, msg.author.id, undefined, command, access);
    if (command === "=access" || command === "=unaccess") {
      const parts = msg.content.trim().split(/\s+/);
      const targetId = msg.mentions.members.first()?.id ?? parts[1]?.match(/^<@!?([0-9]{5,25})>$/)?.[1];
      if (!targetId) throw new Error(`Utilisation : \`${command} @membre\` — rejoins d’abord le salon vocal concerné.`);
      const target = await msg.guild.members.fetch(targetId).catch(() => null);
      if (!target) throw new Error("Je ne trouve pas ce membre sur le serveur.");
      if (target.id === bot.id) throw new Error("Le bot a déjà accès à ses salons vocaux.");
      if (command === "=access") {
        await channel.permissionOverwrites.edit(target.id, { Connect: true }, { type: 1, reason: `Accès vocal accordé par ${msg.author.tag} avec =access` });
        await msg.reply({ content: `✅ <@${target.id}> peut maintenant rejoindre **${channel.name}**.`, allowedMentions: { users: [target.id] } });
      } else {
        await channel.permissionOverwrites.edit(target.id, { Connect: null }, { type: 1, reason: `Accès vocal retiré par ${msg.author.tag} avec =unaccess` });
        await msg.reply({ content: `✅ L’accès individuel de <@${target.id}> à **${channel.name}** a été retiré.`, allowedMentions: { users: [target.id] } });
      }
    } else if (command === "=pv") {
      await exclusive(channel.id, () => lock(channel, member, bot));
      await msg.reply({ content: `🔒 ${channel.name} est privé. Les autres membres ne peuvent plus rejoindre ; les administrateurs et le propriétaire Discord restent exemptés. Les personnes déjà présentes restent dans le vocal.`, allowedMentions: { parse: [] } });
    } else {
      const now = Date.now();
      for (const [id, panel] of panels) if (panel.expires <= now) panels.delete(id);
      const panelId = msg.id;
      panels.set(panelId, { ownerId: member.id, guildId: msg.guild.id, channelId: channel.id, expires: now + 15 * 60_000 });
      await msg.reply(panelPayload(channel, panelId));
    }
  } catch (e) {
    console.error("Commande vocale :", e.message);
    await msg.reply({ content: e.message.includes("Missing Permissions") ? "Discord refuse cette modification : vérifie les permissions du bot." : e.message, allowedMentions: { parse: [] } }).catch(() => {});
  }
  return true;
}

export async function handleVoiceInteraction(i, access) {
  if ((!i.isButton() && !i.isUserSelectMenu()) || !i.customId.startsWith("voice:")) return;
  await i.deferReply({ flags: 64 });
  try {
    const [, panelId, action] = i.customId.split(":");
    const panel = panels.get(panelId);
    if (!panel || panel.expires <= Date.now()) throw new Error("Ce panneau a expiré. Renvoie =panel.");
    if (!i.guild || panel.guildId !== i.guild.id || panel.ownerId !== i.user.id) throw new Error("Seule la personne qui a ouvert ce panneau peut le modifier.");
    const { channel, member, bot } = await authorizedChannel(i.guild, i.user.id, panel.channelId, "=panel", access);
    if ((action === "lock" || action === "unlock") && !canUseVoiceCommand("=pv", channel.permissionsFor(member)?.bitfield ?? 0n, [...member.roles.cache.keys()], access, i.guild.ownerId === member.id)) throw new Error("Le verrouillage demande aussi un rôle autorisé à =pv.");
    await exclusive(channel.id, async () => {
      if (action === "lock" && i.isButton()) await lock(channel, member, bot);
      else if (action === "unlock" && i.isButton()) await unlock(channel);
      else if ((action === "allow" || action === "block") && i.isUserSelectMenu()) {
        const targetId = i.values[0];
        if (!targetId) throw new Error("Choisis une personne.");
        const target = await i.guild.members.fetch(targetId);
        if (target.id === bot.id || target.id === member.id) throw new Error("Tu ne peux pas modifier ton propre accès ni celui du bot ici.");
        if (action === "block" && (target.id === i.guild.ownerId || target.permissions.has(PermissionFlagsBits.Administrator))) throw new Error("Discord ne permet pas de bloquer un administrateur ou le propriétaire du serveur.");
        if (action === "block" && target.voice.channelId === channel.id && !channel.permissionsFor(bot)?.has(PermissionFlagsBits.MoveMembers)) throw new Error("Le bot doit avoir « Déplacer les membres » pour exclure cette personne du vocal.");
        await channel.permissionOverwrites.edit(target.id, { Connect: action === "allow" }, { type: 1, reason: "Accès vocal depuis =panel" });
        if (action === "block" && target.voice.channelId === channel.id) await target.voice.disconnect("Bloqué depuis =panel");
      } else throw new Error("Action inconnue.");
    });
    await i.editReply({ content: action === "allow" ? "Accès autorisé." : action === "block" ? "Personne bloquée." : action === "lock" ? "Vocal privé : seuls les accès autorisés et les administrateurs peuvent rejoindre." : "Accès du vocal rétabli.", allowedMentions: { parse: [] } });
  } catch (e) {
    console.error("Panneau vocal :", e.message);
    await i.editReply({ content: e.message, allowedMentions: { parse: [] } }).catch(() => {});
  }
}
