// FDPDLAVOC — lecture vocale pour les membres qui ne peuvent pas parler (/lecture, ;lecture par le pont).
//   /lecture activer : le bot rejoint ton vocal et lit à voix haute les messages écrits dans le
//   salon texte de ce vocal (« Pseudo : message »), par les membres présents dans le vocal.
//   /lecture desactiver : il s'en va (seul celui qui l'a lancée ou le staff). Départ automatique
//   quand le vocal est vide ou après 30 minutes sans message.
// Synthèse vocale locale (aucune donnée envoyée à un service extérieur) :
//   espeak-ng par défaut (sudo apt-get install -y espeak-ng), ou Piper si PND_PIPER_MODEL est réglé.
import { spawn } from "node:child_process";
import { ChannelType, PermissionFlagsBits as P } from "discord.js";
import { respondInPlaceSafe } from "../interaction-reply.js";

export const TTS_COMMANDS = new Set(["lecture"]);
export const TTS = Object.freeze({ maxChars: 200, maxQueue: 5, idleMs: 30 * 60_000, synthTimeoutMs: 15_000 });

/**
 * Texte lisible à voix haute : mentions remplacées par les noms, liens et émojis personnalisés
 * résumés, mise en forme retirée, longueur bornée. Rend "" quand il n'y a rien à lire.
 */
export function speakableText(content, { userName = (id) => null, roleName = (id) => null, channelName = (id) => null } = {}) {
  let text = String(content ?? "");
  text = text.replace(/```[\s\S]*?```/g, " bloc de code ")
    .replace(/<@!?(\d{17,20})>/g, (_, id) => ` ${userName(id) ?? "quelqu'un"} `)
    .replace(/<@&(\d{17,20})>/g, (_, id) => ` ${roleName(id) ?? "un rôle"} `)
    .replace(/<#(\d{17,20})>/g, (_, id) => ` ${channelName(id) ?? "un salon"} `)
    .replace(/<a?:([\w~]{1,32}):\d{17,20}>/g, (_, name) => ` ${name.replace(/_/g, " ")} `)
    .replace(/<t:\d+(?::[a-zA-Z])?>/g, " une date ")
    .replace(/https?:\/\/\S+/gi, " un lien ")
    .replace(/@(everyone|here)\b/g, " tout le monde ")
    .replace(/[*_~`|>#]+/g, " ")
    .replace(/(.)\1{3,}/g, "$1$1$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!/[\p{L}\p{N}]/u.test(text)) return "";
  return text.length > TTS.maxChars ? `${text.slice(0, TTS.maxChars).replace(/\s+\S*$/, "")}, la suite est coupée` : text;
}

/** Commande de synthèse selon la configuration : le texte passe toujours par l'entrée standard. */
export function ttsEngine(env = process.env) {
  if (env.PND_PIPER_MODEL) {
    return { name: "piper", bin: env.PND_PIPER_PATH || "piper", args: ["--model", env.PND_PIPER_MODEL, "--output_file", "-"] };
  }
  return { name: "espeak-ng", bin: env.PND_ESPEAK_PATH || "espeak-ng", args: ["-v", env.PND_TTS_VOICE || "fr", "-s", "165", "--stdin", "--stdout"] };
}

/** Synthèse → flux WAV (stdout du moteur). Rejette avec un message clair si le moteur manque. */
export function synthesize(text, { engine = ttsEngine(), spawnProcess = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnProcess(engine.bin, engine.args, { stdio: ["pipe", "pipe", "ignore"], windowsHide: true }); }
    catch { reject(new Error(`La synthèse vocale (${engine.name}) est indisponible sur le serveur du bot.`)); return; }
    let settled = false;
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(new Error("La synthèse vocale a dépassé le délai.")); }, TTS.synthTimeoutMs);
    timer.unref?.();
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    child.once("error", (error) => finish(new Error(error?.code === "ENOENT" ? `La synthèse vocale n'est pas installée sur le serveur du bot (${engine.name}).` : "Impossible de lancer la synthèse vocale.")));
    child.stdout.once("readable", () => finish(null, { stream: child.stdout, stop: () => { if (child.exitCode === null) child.kill("SIGTERM"); } }));
    child.stdin.on("error", () => {});
    child.stdin.end(`${text}\n`);
  });
}

// ---------------------------------------------------------------- Sessions
const sessions = new Map(); // guildId → { voiceChannelId, ownerId, queue, playing, connection, player, lastAt }

export function ttsSession(guildId) {
  return sessions.get(String(guildId)) ?? null;
}

export function isTtsRunning(guildId) {
  return sessions.has(String(guildId));
}

/** File bornée : au-delà de 5 messages en attente, les plus anciens sautent (le vocal reste suivable). */
export function enqueue(session, line) {
  session.queue.push(line);
  while (session.queue.length > TTS.maxQueue) session.queue.shift();
  return session.queue.length;
}

async function playNext(session) {
  if (session.playing || !session.queue.length || !session.player) return;
  session.playing = true;
  const line = session.queue.shift();
  try {
    const voice = await import("@discordjs/voice");
    const audio = await synthesize(line);
    const resource = voice.createAudioResource(audio.stream, { inputType: voice.StreamType.Arbitrary });
    resource.playStream.once("close", audio.stop);
    session.player.play(resource);
  } catch (error) {
    session.playing = false;
    session.onError?.(error);
    void playNext(session);
  }
}

function stopSession(guildId) {
  const session = sessions.get(guildId);
  if (!session) return null;
  sessions.delete(guildId);
  clearInterval(session.idleTimer);
  try { session.player?.stop(true); } catch { /* déjà arrêté */ }
  try { session.connection?.destroy(); } catch { /* déjà détruit */ }
  return session;
}

async function startSession(guild, voiceChannel, ownerId, textChannel) {
  const voice = await import("@discordjs/voice");
  const session = { guildId: guild.id, voiceChannelId: voiceChannel.id, ownerId, queue: [], playing: false, lastAt: Date.now() };
  sessions.set(guild.id, session);
  try {
    session.connection = voice.joinVoiceChannel({ channelId: voiceChannel.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true });
    session.player = voice.createAudioPlayer({ behaviors: { noSubscriber: voice.NoSubscriberBehavior.Play } });
    session.connection.subscribe(session.player);
    session.player.on(voice.AudioPlayerStatus.Idle, () => { session.playing = false; void playNext(session); });
    session.player.on("error", () => { session.playing = false; void playNext(session); });
    let warned = false;
    session.onError = (error) => {
      if (warned) return;
      warned = true;
      void textChannel?.send({ content: `⚠️ Lecture vocale : ${error.message}`, allowedMentions: { parse: [] } }).catch(() => {});
    };
    await voice.entersState(session.connection, voice.VoiceConnectionStatus.Ready, 20_000);
    session.idleTimer = setInterval(() => {
      const channel = guild.channels.cache.get(session.voiceChannelId);
      const humans = channel?.members?.filter?.((m) => !m.user?.bot)?.size ?? 0;
      if (!humans || Date.now() - session.lastAt > TTS.idleMs) {
        stopSession(guild.id);
        void textChannel?.send({ content: humans ? "🔇 Lecture vocale arrêtée après 30 minutes sans message." : "🔇 Lecture vocale arrêtée : le vocal est vide.", allowedMentions: { parse: [] } }).catch(() => {});
      }
    }, 60_000);
    session.idleTimer.unref?.();
    return session;
  } catch (error) {
    stopSession(guild.id);
    throw new Error(/Ready|abort/i.test(String(error?.message)) ? "Impossible de rejoindre le vocal." : "Lecture vocale impossible.");
  }
}

const isStaff = (member) => Boolean(member?.permissions?.has?.(P.MoveMembers) || member?.permissions?.has?.(P.ManageChannels) || member?.permissions?.has?.(P.Administrator) || member?.id === member?.guild?.ownerId);

export async function handleTtsInteraction(interaction, { busy = () => false } = {}) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== "lecture" || !interaction.guild) return false;
  const guild = interaction.guild;
  const sub = interaction.options.getSubcommand(false) ?? "activer";
  try {
    if (sub === "desactiver") {
      const session = ttsSession(guild.id);
      if (!session) throw new Error("La lecture vocale n'est pas active.");
      if (session.ownerId !== interaction.user.id && !isStaff(interaction.member)) throw new Error("Seul celui qui l'a lancée ou le staff peut l'arrêter.");
      stopSession(guild.id);
      await interaction.reply({ content: "🔇 Lecture vocale arrêtée.", allowedMentions: { parse: [] } });
      return true;
    }
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) throw new Error("Rejoins un salon vocal classique pour activer la lecture.");
    const current = ttsSession(guild.id);
    if (current) throw new Error(current.voiceChannelId === voiceChannel.id ? "La lecture vocale est déjà active dans ce vocal." : `La lecture vocale est déjà active dans <#${current.voiceChannelId}>.`);
    const me = guild.members.me ?? await guild.members.fetchMe();
    if (me.voice?.channelId || busy(guild.id)) throw new Error("Je suis déjà dans un vocal (musique, radio ou blind test) : arrête-le d'abord.");
    if (!voiceChannel.permissionsFor(me)?.has([P.Connect, P.Speak])) throw new Error("Il me faut les permissions **Se connecter** et **Parler** dans ce vocal.");
    await interaction.deferReply();
    await startSession(guild, voiceChannel, interaction.user.id, voiceChannel);
    await interaction.editReply({ content: `🗣️ **Lecture vocale activée** dans <#${voiceChannel.id}> : j'y lis à voix haute les messages écrits dans le chat de ce vocal par les membres présents (${TTS.maxChars} caractères maximum). \`/lecture desactiver\` pour arrêter.`, allowedMentions: { parse: [] } });
  } catch (error) {
    await respondInPlaceSafe(interaction, { content: `❌ ${error.message}`, ephemeral: true, allowedMentions: { parse: [] } });
  }
  return true;
}

/** Message écrit dans le chat du vocal suivi : mis en file de lecture. Ne bloque jamais les autres traitements. */
export function handleTtsMessage(message) {
  const session = message?.guild ? sessions.get(message.guild.id) : null;
  if (!session || message.author?.bot || message.channelId !== session.voiceChannelId) return false;
  if (message.member?.voice?.channelId !== session.voiceChannelId) return false;
  if (/^[=+;\-$/!]\S/.test(String(message.content ?? "").trim())) return false; // commandes : jamais lues
  const guild = message.guild;
  const text = speakableText(message.content, {
    userName: (id) => guild.members.cache.get(id)?.displayName ?? null,
    roleName: (id) => guild.roles.cache.get(id)?.name ?? null,
    channelName: (id) => guild.channels.cache.get(id)?.name ?? null,
  });
  if (!text) return false;
  session.lastAt = Date.now();
  enqueue(session, `${message.member?.displayName ?? message.author.username} : ${text}`);
  void playNext(session);
  return true;
}
