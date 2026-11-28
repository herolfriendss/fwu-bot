// FDPDLAVOC — music extras: audio effects, saved playlists, DJ role and vote-skip.
import { PermissionFlagsBits as P } from "discord.js";
import { db } from "../database.js";
import { parsePndOwnerId } from "../pnd-owner-policy.js";
import { perkActive } from "../features/perks.js";

export const AUDIO_FILTERS = Object.freeze({
  aucun: null,
  bassboost: "bass=g=12,dynaudnorm=f=200",
  nightcore: "aresample=48000,asetrate=48000*1.25,aresample=48000",
  "8d": "apulsator=hz=0.08",
  rapide: "atempo=1.25",
  lent: "atempo=0.8",
});
export const FILTER_LABELS = Object.freeze({ aucun: "Aucun", bassboost: "Bass boost", nightcore: "Nightcore", "8d": "8D", rapide: "Rapide", lent: "Lent" });

db.exec(`
  CREATE TABLE IF NOT EXISTS music_settings (guild_id TEXT PRIMARY KEY, dj_role_id TEXT);
  CREATE TABLE IF NOT EXISTS music_playlists (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, tracks_json TEXT NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, name)
  );
`);

export function djRoleId(guildId) {
  return db.prepare("SELECT dj_role_id FROM music_settings WHERE guild_id=?").get(guildId)?.dj_role_id ?? null;
}
export function setDjRole(guildId, roleId) {
  db.prepare("INSERT INTO music_settings(guild_id,dj_role_id) VALUES(?,?) ON CONFLICT(guild_id) DO UPDATE SET dj_role_id=excluded.dj_role_id").run(guildId, roleId);
}

/** No DJ role configured -> everyone is DJ (historical behaviour). */
export function isDj(member, guildId = member?.guild?.id) {
  if (!member) return false;
  if (member.id === parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID) || member.id === member.guild?.ownerId) return true;
  if (member.permissions?.has?.(P.ManageChannels) || member.permissions?.has?.(P.Administrator)) return true;
  const role = djRoleId(guildId);
  if (!role || member.roles?.cache?.has?.(role)) return true;
  // A DJ right bought with PND counts exactly like the role.
  return perkActive(guildId, member.id, "dj");
}

/** Commands that change the session for everyone: reserved to DJs when a DJ role exists. */
export const DJ_COMMANDS = new Set(["=stop", "=leave", "=clearqueue", "=remove", "=volume", "=vol", "=loop", "=shuffle"]);

/** Vote-skip: more than half of the humans in the channel. Returns { skip, votes, needed }. */
export function createVoteSkip() {
  const votes = new Map();
  return {
    vote(guildId, trackKey, userId, listenerIds) {
      const key = `${guildId}:${trackKey}`;
      const set = votes.get(key) ?? new Set();
      set.add(userId);
      for (const id of set) if (!listenerIds.includes(id)) set.delete(id);
      votes.set(key, set);
      const needed = Math.floor(listenerIds.length / 2) + 1;
      if (set.size >= needed) votes.delete(key);
      return { skip: set.size >= needed, votes: set.size, needed };
    },
    reset(guildId) { for (const key of votes.keys()) if (key.startsWith(`${guildId}:`)) votes.delete(key); },
  };
}

const cleanName = (name) => String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
const storable = (track) => {
  const sourcePageUrl = typeof track.webpageUrl === "string" && track.webpageUrl ? track.webpageUrl : null;
  return {
    title: String(track.title ?? "Titre").slice(0, 200),
    // Extractor CDN URLs are signed and expire; persist the supported page URL and resolve a fresh stream on playback.
    url: sourcePageUrl ?? track.url,
    duration: Number(track.duration) || 0,
    ...(sourcePageUrl ? { resolveOnPlay: true } : {}),
    ...(!sourcePageUrl && track.allowedMediaHost ? { allowedMediaHost: track.allowedMediaHost } : {}),
  };
};

export function savePlaylist(guildId, userId, name, tracks) {
  const clean = cleanName(name);
  if (clean.length < 1) throw new Error("Donne un nom à la playlist.");
  const list = tracks.filter((t) => t?.url).map(storable).slice(0, 100);
  if (!list.length) throw new Error("Rien à enregistrer : lance d'abord de la musique.");
  if (db.prepare("SELECT COUNT(*) AS n FROM music_playlists WHERE guild_id=? AND user_id=? AND name<>?").get(guildId, userId, clean).n >= 20) throw new Error("Maximum 20 playlists par personne.");
  db.prepare("INSERT INTO music_playlists(guild_id,user_id,name,tracks_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(guild_id,user_id,name) DO UPDATE SET tracks_json=excluded.tracks_json, updated_at=excluded.updated_at")
    .run(guildId, userId, clean, JSON.stringify(list), Date.now());
  return { name: clean, count: list.length };
}
export function loadPlaylist(guildId, userId, name) {
  const row = db.prepare("SELECT tracks_json FROM music_playlists WHERE guild_id=? AND user_id=? AND name=?").get(guildId, userId, cleanName(name));
  if (!row) throw new Error("Playlist introuvable : `/playlist liste`.");
  return JSON.parse(row.tracks_json);
}
export function listPlaylists(guildId, userId) {
  return db.prepare("SELECT name, tracks_json FROM music_playlists WHERE guild_id=? AND user_id=? ORDER BY name").all(guildId, userId)
    .map((r) => ({ name: r.name, count: JSON.parse(r.tracks_json).length }));
}
export function deletePlaylist(guildId, userId, name) {
  return Number(db.prepare("DELETE FROM music_playlists WHERE guild_id=? AND user_id=? AND name=?").run(guildId, userId, cleanName(name)).changes) > 0;
}
