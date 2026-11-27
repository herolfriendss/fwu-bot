// FDPDLAVOC — blind test vocal (/blindtest, ;blindtest par le pont préfixe).
//   /blindtest lancer [manches] [playlist] : le bot rejoint ton vocal et joue un extrait de 30 s par manche.
//   Les membres écrivent leurs réponses dans le salon : titre = 2 points, artiste = 1 point
//   (le premier qui trouve). La manche s'arrête quand le titre est trouvé ou au bout de 30 s.
//   /blindtest stop (l'organisateur ou le staff) · /blindtest classement (points cumulés du serveur).
// Lecture par le même moteur que la musique (yt-dlp + FFmpeg, sources HTTPS vérifiées).
// Une partie à la fois par serveur, jamais pendant que la musique joue.
import { ChannelType, PermissionFlagsBits as P } from "discord.js";
import { db } from "../database.js";
import { respondInPlaceSafe } from "../interaction-reply.js";

export const BLINDTEST_COMMANDS = new Set(["blindtest"]);
export const BT = Object.freeze({ roundMs: 30_000, pauseMs: 6_000, minRounds: 3, maxRounds: 15, defaultRounds: 8, titlePoints: 2, artistPoints: 1, skipIntroSeconds: 25 });

// Liste par défaut : de simples recherches « Artiste - Titre » (aucun contenu embarqué).
export const DEFAULT_SONGS = Object.freeze([
  "Stromae - Alors on danse", "Stromae - Papaoutai", "Angèle - Balance ton quoi", "Aya Nakamura - Djadja",
  "Indila - Dernière danse", "Christophe Maé - Il est où le bonheur", "Daft Punk - One More Time", "Daft Punk - Get Lucky",
  "Céline Dion - Pour que tu m'aimes encore", "Johnny Hallyday - Allumer le feu", "Edith Piaf - La vie en rose",
  "Zaz - Je veux", "Maître Gims - Bella", "Soprano - Cendrillon", "Kendji Girac - Andalouse", "Louane - Avenir",
  "Orelsan - La terre est ronde", "Jul - Tchikita", "PNL - Au DD", "Nekfeu - On verra", "Vianney - Pas là",
  "Michel Sardou - Les lacs du Connemara", "Joe Dassin - Les Champs-Élysées", "Mylène Farmer - Désenchantée",
  "Queen - Bohemian Rhapsody", "Michael Jackson - Billie Jean", "Adele - Rolling in the Deep", "Ed Sheeran - Shape of You",
  "The Weeknd - Blinding Lights", "Dua Lipa - Levitating", "Bruno Mars - Uptown Funk", "Rihanna - Umbrella",
  "Eminem - Lose Yourself", "Coldplay - Viva la Vida", "ABBA - Dancing Queen", "Pharrell Williams - Happy",
  "Shakira - Waka Waka", "Luis Fonsi - Despacito", "Imagine Dragons - Believer", "Billie Eilish - Bad Guy",
]);

db.exec(`
  CREATE TABLE IF NOT EXISTS blindtest_scores (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0, games INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
`);

// ---------------------------------------------------------------- Réponses
/** Minuscules, sans accents, sans parenthèses ni « feat. », ponctuation retirée. */
export function normalizeAnswer(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\b(feat|ft|featuring)\b.*$/, " ")
    .replace(/&/g, " et ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/** Réponse acceptée : identique, ou proche (fautes de frappe) pour les réponses d'au moins 4 lettres. */
export function answerMatches(guess, expected) {
  const g = normalizeAnswer(guess);
  const e = normalizeAnswer(expected);
  if (!g || !e) return false;
  if (g === e) return true;
  if (e.length < 4) return false;
  // « c'est alors on danse ! » : la réponse attendue contenue dans un message court.
  if (g.length <= e.length + 12 && ` ${g} `.includes(` ${e} `)) return true;
  const tolerance = e.length <= 6 ? 1 : e.length <= 12 ? 2 : 3;
  return Math.abs(g.length - e.length) <= tolerance && levenshtein(g, e) <= tolerance;
}

/** "Artiste - Titre (Clip officiel)" → { artist, title }. Sans tiret : titre seul. */
export function splitSong(label) {
  const text = String(label ?? "").replace(/\s+/g, " ").trim();
  const match = /^(.+?)\s+[-–—]\s+(.+)$/.exec(text);
  const strip = (part) => part.replace(/\((?:[^)]*?(?:officiel|official|clip|video|vidéo|audio|lyrics?|paroles)[^)]*)\)|\[[^\]]*\]/gi, "").replace(/\s+/g, " ").trim();
  if (!match) return { artist: null, title: strip(text) || text };
  return { artist: strip(match[1]).replace(/\s*-\s*topic$/i, "") || null, title: strip(match[2]) || match[2] };
}

// ---------------------------------------------------------------- Parties
const sessions = new Map(); // guildId → session

export function isBlindTestRunning(guildId) {
  return sessions.has(String(guildId));
}

export function createSession({ guildId, channelId, voiceChannelId, hostId, songs }) {
  if (sessions.has(guildId)) throw new Error("Un blind test est déjà en cours sur ce serveur.");
  const session = { guildId, channelId, voiceChannelId, hostId, songs: [...songs], round: 0, current: null, scores: new Map(), stopped: false, wake: null };
  sessions.set(guildId, session);
  return session;
}

export function endSession(guildId) {
  const session = sessions.get(guildId);
  sessions.delete(guildId);
  return session ?? null;
}

export function startRound(session, song) {
  session.round += 1;
  session.current = { ...song, titleBy: null, artistBy: null };
  return session.current;
}

/**
 * Vérifie un message pendant une manche. Rend { points, found: ["title"|"artist"], roundOver } ou null.
 * Le titre clôt la manche ; l'artiste peut être trouvé avant ou dans le même message.
 */
export function checkGuess(session, userId, content) {
  const round = session?.current;
  if (!round || round.titleBy) return null;
  const found = [];
  if (round.artist && !round.artistBy && answerMatches(content, round.artist)) found.push("artist");
  if (answerMatches(content, round.title) || (round.artist && answerMatches(content, `${round.artist} ${round.title}`))) found.push("title");
  // « Stromae alors on danse » : les deux d'un coup.
  if (!found.includes("artist") && round.artist && !round.artistBy && found.includes("title") && normalizeAnswer(content).includes(normalizeAnswer(round.artist))) found.unshift("artist");
  if (!found.length) return null;
  let points = 0;
  if (found.includes("artist")) { round.artistBy = userId; points += BT.artistPoints; }
  if (found.includes("title")) { round.titleBy = userId; points += BT.titlePoints; }
  session.scores.set(userId, (session.scores.get(userId) ?? 0) + points);
  return { points, found, roundOver: Boolean(round.titleBy) };
}

export function ranking(scores) {
  return [...scores.entries()].filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1]);
}

/** Enregistre la partie : points cumulés, parties jouées, victoire au premier (ex aequo : tous). */
export function recordGame(guildId, scores) {
  const ranked = ranking(scores);
  const best = ranked[0]?.[1] ?? 0;
  const upsert = db.prepare(`INSERT INTO blindtest_scores(guild_id,user_id,points,games,wins) VALUES(?,?,?,1,?)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET points=points+excluded.points, games=games+1, wins=wins+excluded.wins`);
  for (const [userId, points] of ranked) upsert.run(guildId, userId, points, points === best ? 1 : 0);
  return ranked;
}

export function leaderboard(guildId, limit = 10) {
  return db.prepare("SELECT user_id, points, games, wins FROM blindtest_scores WHERE guild_id=? ORDER BY points DESC, wins DESC, games ASC, user_id LIMIT ?").all(guildId, limit);
}

export function pickSongs(pool, count, random = Math.random) {
  const copy = [...new Set(pool.map((s) => String(s).trim()).filter(Boolean))];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

// ---------------------------------------------------------------- Discord
const sleep = (ms, session) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  if (session) session.wake = () => { clearTimeout(timer); resolve(); };
});

const medal = (i) => ["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`;
const rankingText = (ranked) => ranked.length ? ranked.slice(0, 10).map(([id, p], i) => `${medal(i)} <@${id}> · **${p}** pt${p > 1 ? "s" : ""}`).join("\n") : "Personne n'a marqué de point.";

async function playExcerpt(session, voice, query) {
  const { resolveMusicInput } = await import("../music/music-resolver.js");
  const { openAuthorizedAudioStream } = await import("../music/audio-source.js");
  const resolved = await resolveMusicInput(query);
  const filter = resolved.duration > 90 ? `atrim=start=${BT.skipIntroSeconds},asetpts=PTS-STARTPTS` : null;
  const stream = await openAuthorizedAudioStream(resolved.url, [resolved.allowedMediaHost], { audioFilter: filter });
  const resource = voice.createAudioResource(stream.stream, { inputType: voice.StreamType.OggOpus });
  resource.playStream.once("close", stream.stop);
  session.player.play(resource);
  return { resolved, stop: () => { session.player.stop(true); stream.stop(); } };
}

async function runGame(session, guild, channel) {
  const voice = await import("@discordjs/voice");
  try {
    session.connection = voice.joinVoiceChannel({ channelId: session.voiceChannelId, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true });
    session.player = voice.createAudioPlayer({ behaviors: { noSubscriber: voice.NoSubscriberBehavior.Play } });
    session.connection.subscribe(session.player);
    await voice.entersState(session.connection, voice.VoiceConnectionStatus.Ready, 20_000);
    let failures = 0;
    for (const query of session.songs) {
      if (session.stopped) break;
      const label = splitSong(query);
      let excerpt;
      try {
        excerpt = await playExcerpt(session, voice, query);
      } catch {
        failures += 1;
        await channel.send({ content: "⚠️ Extrait illisible, je passe au suivant.", allowedMentions: { parse: [] } }).catch(() => {});
        if (failures >= 3) { await channel.send("⛔ Trop d'extraits illisibles : partie arrêtée (le moteur audio du serveur est peut-être indisponible).").catch(() => {}); break; }
        continue;
      }
      const song = label.artist ? label : { artist: null, title: label.title };
      startRound(session, song);
      await channel.send({ content: `🎧 **Manche ${session.round}/${session.songs.length}** : écoute bien ! ${song.artist ? "Titre = 2 pts, artiste = 1 pt." : "Trouve le titre (2 pts)."} 30 secondes.`, allowedMentions: { parse: [] } }).catch(() => {});
      await sleep(BT.roundMs, session);
      excerpt.stop();
      const round = session.current;
      session.current = null;
      await channel.send({
        content: [
          `🎵 C'était **${song.artist ? `${song.artist} - ` : ""}${song.title}**.`,
          round.titleBy ? `Titre trouvé par <@${round.titleBy}>.` : "Personne n'a trouvé le titre.",
          song.artist ? (round.artistBy ? `Artiste trouvé par <@${round.artistBy}>.` : "Personne n'a trouvé l'artiste.") : null,
        ].filter(Boolean).join(" "),
        allowedMentions: { parse: [] },
      }).catch(() => {});
      if (!session.stopped) await sleep(BT.pauseMs, session);
    }
  } catch (error) {
    await channel.send({ content: `⛔ Blind test interrompu : ${/Ready|abort/i.test(String(error?.message)) ? "impossible de rejoindre le vocal." : "erreur de lecture."}`, allowedMentions: { parse: [] } }).catch(() => {});
  } finally {
    try { session.player?.stop(true); } catch { /* déjà arrêté */ }
    try { session.connection?.destroy(); } catch { /* déjà détruit */ }
    endSession(session.guildId);
    const ranked = recordGame(session.guildId, session.scores);
    await channel.send({ content: `🏁 **Fin du blind test**\n${rankingText(ranked)}`, allowedMentions: { parse: [] } }).catch(() => {});
  }
}

function songsFor(guildId, userId, playlistName) {
  if (!playlistName) return DEFAULT_SONGS;
  const row = db.prepare("SELECT tracks_json FROM music_playlists WHERE guild_id=? AND user_id=? AND name=?").get(guildId, userId, String(playlistName).replace(/\s+/g, " ").trim().slice(0, 40));
  if (!row) throw new Error("Playlist introuvable : crée-la avec `/playlist` (musique) puis réessaie.");
  const titles = JSON.parse(row.tracks_json).map((t) => t.title).filter(Boolean);
  if (titles.length < BT.minRounds) throw new Error(`Il faut au moins ${BT.minRounds} titres dans la playlist.`);
  return titles;
}

const isStaff = (member) => Boolean(member?.permissions?.has?.(P.ManageChannels) || member?.permissions?.has?.(P.ManageGuild) || member?.permissions?.has?.(P.Administrator) || member?.id === member?.guild?.ownerId);

export async function handleBlindtestInteraction(interaction) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== "blindtest" || !interaction.guild) return false;
  const guild = interaction.guild;
  const sub = interaction.options.getSubcommand(false) ?? "lancer";
  try {
    if (sub === "classement") {
      const rows = leaderboard(guild.id);
      await interaction.reply({ content: rows.length ? `🏆 **Classement du blind test**\n${rows.map((r, i) => `${medal(i)} <@${r.user_id}> · **${r.points}** pts · ${r.wins} victoire(s) en ${r.games} partie(s)`).join("\n")}` : "Aucune partie jouée pour l'instant : `/blindtest lancer`.", allowedMentions: { parse: [] } });
      return true;
    }
    if (sub === "stop") {
      const session = sessions.get(guild.id);
      if (!session) throw new Error("Aucun blind test en cours.");
      if (session.hostId !== interaction.user.id && !isStaff(interaction.member)) throw new Error("Seul l'organisateur ou le staff peut arrêter la partie.");
      session.stopped = true;
      session.wake?.();
      await interaction.reply({ content: "⏹️ Blind test arrêté : résultats dans un instant.", allowedMentions: { parse: [] } });
      return true;
    }
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) throw new Error("Rejoins un salon vocal classique pour lancer un blind test.");
    const me = guild.members.me ?? await guild.members.fetchMe();
    if (me.voice?.channelId) throw new Error("Je suis déjà dans un vocal (musique ou radio) : arrête-la d'abord.");
    if (!voiceChannel.permissionsFor(me)?.has([P.Connect, P.Speak])) throw new Error("Il me faut les permissions **Se connecter** et **Parler** dans ce vocal.");
    const rounds = Math.min(BT.maxRounds, Math.max(BT.minRounds, interaction.options.getInteger("manches", false) ?? BT.defaultRounds));
    const songs = pickSongs(songsFor(guild.id, interaction.user.id, interaction.options.getString("playlist", false)), rounds);
    const session = createSession({ guildId: guild.id, channelId: interaction.channelId, voiceChannelId: voiceChannel.id, hostId: interaction.user.id, songs });
    await interaction.reply({ content: `🎶 **Blind test** lancé par <@${interaction.user.id}> dans <#${voiceChannel.id}> : **${songs.length} manches**. Réponds ici : titre = ${BT.titlePoints} pts, artiste = ${BT.artistPoints} pt. Les fautes de frappe légères passent.`, allowedMentions: { parse: [] } });
    void runGame(session, guild, interaction.channel);
  } catch (error) {
    await respondInPlaceSafe(interaction, { content: `❌ ${error.message}`, ephemeral: true, allowedMentions: { parse: [] } });
  }
  return true;
}

/** Réponses écrites dans le salon de la partie. Rend true si le message a marqué. */
export async function handleBlindtestMessage(message) {
  const session = message?.guild ? sessions.get(message.guild.id) : null;
  if (!session || message.author?.bot || message.channelId !== session.channelId || !session.current) return false;
  const result = checkGuess(session, message.author.id, message.content);
  if (!result) return false;
  await message.react(result.roundOver ? "✅" : "🎤").catch(() => {});
  const what = result.found.length === 2 ? "le titre et l'artiste" : result.found[0] === "title" ? "le titre" : "l'artiste";
  await message.reply({ content: `👏 <@${message.author.id}> trouve ${what} : +${result.points} pt${result.points > 1 ? "s" : ""}.`, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
  if (result.roundOver) session.wake?.();
  return true;
}
