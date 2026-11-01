import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  PermissionFlagsBits, ChannelType
} from "discord.js";
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, NoSubscriberBehavior, VoiceConnectionStatus,
  entersState
} from "@discordjs/voice";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import play from "play-dl";
import { assertSameVoice } from "./music-policy.js";

const queues = new Map();
const commandActivity = new Map();
const radioConfigFile = new URL("../data/radio-config.json", import.meta.url);
let radioConfigs;
let radioWrite = Promise.resolve();
const MAX_TRACKS_PER_REQUEST = 25;
const MAX_TRACKS_PER_GUILD = 100;
const MAX_RADIO_TRACKS = 100;

function enforceMusicCooldown(guildId, userId) {
  const now = Date.now();
  const key = `${guildId}:${userId}`;
  const previous = commandActivity.get(key) ?? 0;
  if (now - previous < 1_500) throw new Error("Attends un instant avant de relancer une commande musicale.");
  commandActivity.set(key, now);
  if (commandActivity.size > 2_000) {
    for (const [entry, at] of commandActivity) if (now - at > 60_000) commandActivity.delete(entry);
  }
}

function stateFor(guildId) {
  if (!queues.has(guildId)) {
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    const state = {
      guildId, player, connection: null, queue: [], current: null,
      textChannel: null, volume: 0.5, loop: "off", panelMessage: null,
      advancing: false,
    };
    player.on(AudioPlayerStatus.Idle, () => { void advance(state); });
    player.on("error", (error) => {
      console.error("[music] Erreur de lecture:", error.message);
      void state.textChannel?.send("⚠️ Une erreur est survenue pendant la lecture. Je passe au titre suivant.").catch(() => {});
      void advance(state);
    });
    queues.set(guildId, state);
  }
  return queues.get(guildId);
}

async function loadRadioConfigs() {
  if (radioConfigs) return radioConfigs;
  try { radioConfigs = JSON.parse(await readFile(radioConfigFile, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; radioConfigs = {}; }
  return radioConfigs;
}

async function saveRadioConfigs() {
  const contents = JSON.stringify(radioConfigs, null, 2);
  const write = radioWrite.catch(() => {}).then(async () => {
    await mkdir(new URL("../data/", import.meta.url), { recursive: true, mode: 0o700 });
    const tmp = new URL("../data/radio-config.tmp", import.meta.url);
    await writeFile(tmp, contents, { mode: 0o600 });
    await rename(tmp, radioConfigFile);
  });
  radioWrite = write;
  await write;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "Durée inconnue";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function isYouTubeUrl(value) {
  return /^https?:\/\/(?:www\.|music\.)?(youtube\.com|youtu\.be)\//i.test(value);
}

async function resolveYouTube(query) {
  const results = await play.search(query, { limit: 1, source: { youtube: "video" } });
  const video = results?.[0];
  if (!video?.url) throw new Error(`Aucun résultat YouTube trouvé pour « ${query} ».`);
  return {
    title: video.title ?? query,
    url: video.url,
    duration: video.durationInSec ?? 0,
    thumbnail: video.thumbnails?.[0]?.url ?? null,
  };
}

async function resolveInput(input, playlistLimit = MAX_TRACKS_PER_REQUEST) {
  if (isYouTubeUrl(input)) {
    if (/youtube\.com\/playlist/.test(input)) {
      const playlist = await play.playlist_info(input, { incomplete: true });
      const videos = await playlist.all_videos();
      return videos.slice(0, playlistLimit).map((video) => ({
        title: video.title, url: video.url, duration: video.durationInSec ?? 0,
        thumbnail: video.thumbnails?.[0]?.url ?? null, source: "YouTube",
      }));
    }
    const info = await play.video_info(input);
    const video = info.video_details;
    return [{
      title: video.title, url: video.url, duration: video.durationInSec ?? 0,
      thumbnail: video.thumbnails?.[0]?.url ?? null, source: "YouTube",
    }];
  }

  const result = await resolveYouTube(input);
  return [{ ...result, source: "YouTube" }];
}

function buildPanel(state) {
  const track = state.current;
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🎵 Music System")
    .setDescription(track
      ? `**[${track.title}](${track.url})**\n${track.artist ? `Artiste : ${track.artist}\n` : ""}Durée : ${formatDuration(track.duration)}\nDemandé par : ${track.requesterId === "radio" ? "Radio Her?" : `<@${track.requesterId}>`}`
      : "Aucune musique en cours.")
    .addFields(
      { name: "File d'attente", value: `${state.queue.length} titre(s)`, inline: true },
      { name: "Volume", value: `${Math.round(state.volume * 100)} %`, inline: true },
      { name: "Répétition", value: state.loop === "track" ? "Titre" : state.loop === "queue" ? "File" : "Désactivée", inline: true },
    );
  if (track?.thumbnail) embed.setThumbnail(track.thumbnail);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("music:pause").setEmoji("⏯️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("music:skip").setEmoji("⏭️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:stop").setEmoji("⏹️").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("music:loop").setEmoji("🔁").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:shuffle").setEmoji("🔀").setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

async function updatePanel(state) {
  if (!state.panelMessage) return;
  await state.panelMessage.edit(buildPanel(state)).catch(() => { state.panelMessage = null; });
}

async function connectChannel(guild, channel, textChannel) {
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    throw new Error("La musique demande un salon vocal classique, pas un salon Stage.");
  }
  const me = await guild.members.fetchMe();
  const perms = channel.permissionsFor(me);
  if (!perms?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
    throw new Error("Il me faut les permissions **Se connecter** et **Parler** dans ce vocal.");
  }
  const state = stateFor(guild.id);
  if (state.connection && state.connection.joinConfig.channelId !== channel.id) {
    const old = state.connection;
    old.destroy();
    state.connection = null;
  }
  if (!state.connection) {
    state.connection = joinVoiceChannel({
      channelId: channel.id, guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator, selfDeaf: true,
    });
    const connection = state.connection;
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        if (state.connection === connection) state.connection = null;
        connection.destroy();
        if (state.radio) {
          const config = state.radio;
          setTimeout(() => {
            if (state.radio !== config) return;
            void startRadio(guild, config).catch((error) => {
              console.error("[radio] Reconnexion impossible:", error.message);
              scheduleRadioReconnect(guild, state, config);
            });
          }, 10_000).unref?.();
        } else {
          state.player.stop(true);
        }
      }
    });
    state.connection.subscribe(state.player);
    await entersState(state.connection, VoiceConnectionStatus.Ready, 20_000);
  }
  state.textChannel = textChannel;
  return state;
}

async function connectMember(member, textChannel) {
  const channel = member.voice.channel;
  if (!channel || ![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) {
    throw new Error("Rejoins un salon vocal avant de lancer la musique.");
  }
  return connectChannel(member.guild, channel, textChannel);
}

async function playTrack(state, track) {
  const stream = await play.stream(track.url, { quality: 2 });
  const resource = createAudioResource(stream.stream, {
    inputType: stream.type,
    inlineVolume: true,
    metadata: track,
  });
  resource.volume?.setVolume(state.volume);
  state.current = track;
  state.player.play(resource);
  await updatePanel(state);
}

async function advance(state) {
  if (state.advancing) return;
  state.advancing = true;
  try {
    if (!state.radio && state.loop === "track" && state.current) {
      await playTrack(state, state.current);
      return;
    }
    if (!state.radio && state.current && state.loop === "queue") state.queue.push(state.current);
    state.current = null;
    if (state.radio && state.queue.length === 0) {
      try {
        const tracks = await resolveInput(state.radio.playlistUrl, MAX_RADIO_TRACKS);
        if (!tracks.length) throw new Error("La playlist radio est vide.");
        state.queue.push(...tracks.map((track) => ({ ...track, requesterId: "radio" })));
      } catch (error) {
        console.error("[radio] Impossible de recharger la playlist:", error.message);
        await state.textChannel?.send("⚠️ Radio en pause : impossible de relire la playlist YouTube. Nouvelle tentative dans 30 secondes.").catch(() => {});
        setTimeout(() => { if (state.radio) void advance(state); }, 30_000).unref?.();
        return;
      }
    }
    const next = state.queue.shift();
    if (!next) {
      await updatePanel(state);
      return;
    }
    try {
      await playTrack(state, next);
      await state.textChannel?.send(`▶️ Lecture : **${next.title}**`).catch(() => {});
    } catch (error) {
      console.error("[music] Impossible de lire le titre:", error.message);
      await state.textChannel?.send(`⚠️ Impossible de lire **${next.title}**. Je passe au suivant.`).catch(() => {});
      state.current = null;
      queueMicrotask(() => void advance(state));
    }
  } finally {
    state.advancing = false;
  }
}

async function startRadio(guild, config, preloadedPlaylist = null) {
  const channel = await guild.channels.fetch(config.voiceChannelId);
  if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error("Le salon radio configuré n’existe pas ou n’est pas un vocal classique.");
  const textChannel = config.textChannelId ? await guild.channels.fetch(config.textChannelId).catch(() => null) : null;
  const playlist = preloadedPlaylist ?? await resolveInput(config.playlistUrl, MAX_RADIO_TRACKS);
  if (!playlist.length) throw new Error("La playlist YouTube ne contient aucun titre lisible.");
  const state = await connectChannel(guild, channel, textChannel?.isTextBased() ? textChannel : null);
  state.radio = config;
  state.loop = "off";
  state.queue = playlist.map((track) => ({ ...track, requesterId: "radio" }));
  state.current = null;
  await advance(state);
  return state;
}

function scheduleRadioReconnect(guild, state, config) {
  const timer = setTimeout(() => {
    if (state.radio !== config) return;
    void startRadio(guild, config).catch((error) => {
      console.error("[radio] Nouvelle tentative de reconnexion impossible:", error.message);
      scheduleRadioReconnect(guild, state, config);
    });
  }, 30_000);
  timer.unref?.();
}

export async function startConfiguredRadios(client) {
  const configs = await loadRadioConfigs();
  let started = 0;
  for (const [guildId, config] of Object.entries(configs)) {
    if (!config?.voiceChannelId || !config?.playlistUrl) continue;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    try {
      await startRadio(guild, config);
      started++;
    } catch (error) {
      console.error(`[radio] Démarrage impossible pour le serveur ${guildId}:`, error.message);
    }
  }
  return started;
}

export async function handleRadioMessage(message) {
  if (!message.guild || !message.member) return false;
  const parts = message.content.trim().split(/\s+/);
  if (parts[0]?.toLowerCase() !== "=radio") return false;
  const action = (parts[1] ?? "status").toLowerCase();
  try {
    const configs = await loadRadioConfigs();
    const config = configs[message.guild.id];
    const state = queues.get(message.guild.id);
    if (action === "status") {
      if (!config) await message.reply({ content: "📻 Radio non configurée. Un administrateur peut faire `=radio set #salon URL_PLAYLIST_YOUTUBE`.", allowedMentions: { parse: [] } });
      else await message.reply({ content: `📻 Radio ${state?.radio ? "active" : "arrêtée"} · <#${config.voiceChannelId}> · playlist configurée.`, allowedMentions: { parse: [] } });
      return true;
    }
    if (!adminRadio(message.member)) throw new Error("La configuration de la radio est réservée aux administrateurs ou à la permission Gérer le serveur.");
    if (action === "set") {
      const channelId = message.mentions.channels.first()?.id ?? parts[2]?.match(/^<#(\d{5,25})>$/)?.[1] ?? parts[2];
      const playlistUrl = parts.slice(3).join(" ");
      if (!/^\d{5,25}$/.test(channelId ?? "") || !/^https?:\/\/(?:www\.|music\.)?youtube\.com\/playlist\?list=[\w-]+/i.test(playlistUrl)) {
        throw new Error("Utilisation : `=radio set #salon https://www.youtube.com/playlist?list=...`.");
      }
      const channel = await message.guild.channels.fetch(channelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error("Choisis un salon vocal classique de ce serveur.");
      // Validate the playlist before persisting configuration.
      const playlist = await resolveInput(playlistUrl, MAX_RADIO_TRACKS);
      if (!playlist.length) throw new Error("La playlist est vide ou inaccessible.");
      configs[message.guild.id] = { voiceChannelId: channel.id, playlistUrl, textChannelId: message.channel.id, updatedAt: Date.now() };
      radioConfigs = configs;
      await saveRadioConfigs();
      await startRadio(message.guild, configs[message.guild.id], playlist);
      await message.reply({ content: `✅ Radio PartyNextDoor lancée dans **${channel.name}**. Elle reprendra automatiquement après les titres et les redémarrages du bot.`, allowedMentions: { parse: [] } });
    } else if (action === "start") {
      if (!config) throw new Error("Configure d’abord la radio : `=radio set #salon URL_PLAYLIST_YOUTUBE`.");
      await startRadio(message.guild, config);
      await message.reply({ content: "✅ Radio démarrée.", allowedMentions: { parse: [] } });
    } else if (action === "stop") {
      if (state) {
        state.radio = null;
        state.queue = [];
        state.current = null;
        state.player.stop(true);
        state.connection?.destroy();
        state.connection = null;
      }
      await message.reply({ content: "⏹️ Radio arrêtée. Sa configuration est conservée pour le prochain démarrage.", allowedMentions: { parse: [] } });
    } else if (action === "clear") {
      delete configs[message.guild.id];
      radioConfigs = configs;
      await saveRadioConfigs();
      if (state?.radio) {
        state.radio = null;
        state.queue = [];
        state.current = null;
        state.player.stop(true);
        state.connection?.destroy();
        state.connection = null;
      }
      await message.reply({ content: "✅ Configuration radio supprimée et lecture arrêtée.", allowedMentions: { parse: [] } });
    } else {
      throw new Error("Commandes : `=radio status`, `=radio set #salon URL`, `=radio start`, `=radio stop`, `=radio clear`.");
    }
  } catch (error) {
    await message.reply({ content: `❌ ${error.message}`, allowedMentions: { parse: [] } }).catch(() => {});
  }
  return true;
}

function adminRadio(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild);
}

function ensureSameVoice(message, state) {
  const userChannel = message.member?.voice.channelId;
  const botChannel = state.connection?.joinConfig.channelId;
  assertSameVoice(userChannel, botChannel);
}

function parseVolume(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error("Le volume doit être compris entre 0 et 100.");
  return n / 100;
}

export async function handleMusicMessage(message) {
  if (!message.guild || !message.member) return false;
  const parts = message.content.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase();
  const known = new Set([
    "=play", "=p", "=pause", "=resume", "=skip", "=stop", "=queue",
    "=nowplaying", "=np", "=volume", "=vol", "=loop", "=shuffle",
    "=clearqueue", "=remove", "=join", "=leave", "=musicpanel",
  ]);
  if (!known.has(command)) return false;

  try {
    enforceMusicCooldown(message.guild.id, message.author.id);
    const input = message.content.trim().slice(parts[0].length).trim();
    let state = stateFor(message.guild.id);
    if (state.radio) throw new Error("La radio 24/7 est active sur ce serveur. Un administrateur doit utiliser `=radio stop` avant les commandes musicales.");

    if (command === "=play" || command === "=p") {
      if (!input) throw new Error("Utilisation : `=play nom de musique ou lien YouTube`.");
      if (input.length > 250) throw new Error("La recherche ne peut pas dépasser 250 caractères.");
      await message.channel.sendTyping();
      state = await connectMember(message.member, message.channel);
      const tracks = await resolveInput(input);
      const added = tracks.map((track) => ({ ...track, requesterId: message.author.id }));
      const total = state.queue.length + (state.current ? 1 : 0) + added.length;
      if (total > MAX_TRACKS_PER_GUILD) throw new Error(`La file est limitée à ${MAX_TRACKS_PER_GUILD} titres. Il reste ${Math.max(0, MAX_TRACKS_PER_GUILD - state.queue.length - (state.current ? 1 : 0))} place(s).`);
      state.queue.push(...added);
      if (state.player.state.status !== AudioPlayerStatus.Playing && state.player.state.status !== AudioPlayerStatus.Paused && !state.current) {
        await advance(state);
      }
      const panel = await message.channel.send(buildPanel(state));
      state.panelMessage = panel;
      await message.reply(`✅ **${added.length}** titre(s) ajouté(s) à la file d'attente.`);
      return true;
    }

    if (command === "=join") {
      state = await connectMember(message.member, message.channel);
      await message.reply("🔊 Je suis connecté à ton salon vocal.");
      return true;
    }
    if (command === "=leave" || command === "=stop") {
      if (state.connection) {
        ensureSameVoice(message, state);
        state.queue = [];
        state.current = null;
        state.loop = "off";
        state.player.stop(true);
        state.connection.destroy();
        state.connection = null;
      }
      await message.reply("⏹️ Lecture arrêtée et file vidée. J'ai quitté le vocal.");
      return true;
    }

    ensureSameVoice(message, state);
    if (command === "=pause") {
      if (!state.player.pause()) throw new Error("Aucune musique n'est en cours.");
      await message.reply("⏸️ Musique en pause.");
    } else if (command === "=resume") {
      if (!state.player.unpause()) throw new Error("Aucune musique en pause.");
      await message.reply("▶️ Lecture reprise.");
    } else if (command === "=skip") {
      if (!state.current) throw new Error("Aucune musique en cours.");
      state.player.stop(true);
      await message.reply("⏭️ Musique passée.");
    } else if (command === "=queue") {
      const lines = state.queue.slice(0, 15).map((t, i) => `**${i + 1}.** ${t.title} — ${formatDuration(t.duration)}`);
      await message.reply({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📜 File d'attente")
          .setDescription(lines.length ? lines.join("\n") : "La file d'attente est vide.")
          .setFooter({ text: `${state.queue.length} titre(s) en attente` })],
      });
    } else if (command === "=nowplaying" || command === "=np") {
      if (!state.current) throw new Error("Aucune musique en cours.");
      await message.reply({ embeds: [buildPanel(state).embeds[0]] });
    } else if (command === "=volume" || command === "=vol") {
      if (!input) throw new Error("Utilisation : `=volume 50` (0 à 100).");
      state.volume = parseVolume(input);
      state.player.state.resource?.volume?.setVolume(state.volume);
      await updatePanel(state);
      await message.reply(`🔊 Volume réglé à **${Math.round(state.volume * 100)} %**.`);
    } else if (command === "=loop") {
      const modes = ["off", "track", "queue"];
      const requested = input.toLowerCase();
      if (requested) {
        if (!modes.includes(requested)) throw new Error("Utilisation : `=loop off`, `=loop track` ou `=loop queue`.");
        state.loop = requested;
      } else {
        state.loop = modes[(modes.indexOf(state.loop) + 1) % modes.length];
      }
      await updatePanel(state);
      await message.reply(`🔁 Répétition : **${state.loop}**.`);
    } else if (command === "=shuffle") {
      for (let i = state.queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
      }
      await updatePanel(state);
      await message.reply("🔀 File mélangée.");
    } else if (command === "=clearqueue") {
      state.queue = [];
      await updatePanel(state);
      await message.reply("🧹 File d'attente vidée.");
    } else if (command === "=remove") {
      const index = Number(input) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= state.queue.length) throw new Error("Indique le numéro d'un titre dans `=queue`.");
      const [removed] = state.queue.splice(index, 1);
      await updatePanel(state);
      await message.reply(`🗑️ **${removed.title}** retiré de la file.`);
    } else if (command === "=musicpanel") {
      const panel = await message.channel.send(buildPanel(state));
      state.panelMessage = panel;
    }
    return true;
  } catch (error) {
    await message.reply({ content: `❌ ${error.message}`, allowedMentions: { parse: [] } }).catch(() => {});
    return true;
  }
}

export async function handleMusicInteraction(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith("music:")) return false;
  await interaction.deferReply({ ephemeral: true });
  try {
    enforceMusicCooldown(interaction.guildId, interaction.user.id);
    const state = queues.get(interaction.guildId);
    if (!state) throw new Error("Aucune session musicale active.");
    if (state.radio) throw new Error("La radio 24/7 est active; ses contrôles sont réservés aux administrateurs avec `=radio stop`.");
    const member = await interaction.guild.members.fetch(interaction.user.id);
    ensureSameVoice({ member }, state);
    const action = interaction.customId.split(":")[1];
    if (action === "pause") {
      if (state.player.state.status === AudioPlayerStatus.Paused) state.player.unpause();
      else if (!state.player.pause()) throw new Error("Aucune musique en cours.");
    } else if (action === "skip") {
      if (!state.current) throw new Error("Aucune musique en cours.");
      state.player.stop(true);
    } else if (action === "stop") {
      state.queue = [];
      state.current = null;
      state.player.stop(true);
      state.connection?.destroy();
      state.connection = null;
    } else if (action === "loop") {
      state.loop = state.loop === "off" ? "track" : state.loop === "track" ? "queue" : "off";
    } else if (action === "shuffle") {
      for (let i = state.queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
      }
    } else throw new Error("Bouton inconnu.");
    await updatePanel(state);
    await interaction.editReply("✅ Commande exécutée.");
  } catch (error) {
    await interaction.editReply(`❌ ${error.message}`).catch(() => {});
  }
  return true;
}
