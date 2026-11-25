// FWU — achievements unlocked from activity already tracked (levels, messages, voice, suggestions, birthday).
import { db } from "../database.js";
import { publishEventSafe } from "../event-bus.js";

db.exec(`CREATE TABLE IF NOT EXISTS community_achievements (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, key TEXT NOT NULL, unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, key)
);`);

/** Ordered catalogue. `test(stats)` must stay pure. */
export const ACHIEVEMENTS = [
  { key: "premier_message", emoji: "💬", name: "Premiers mots", hint: "Envoyer un premier message", test: (s) => s.messages >= 1 },
  { key: "bavard", emoji: "🗣️", name: "Bavard", hint: "500 messages", test: (s) => s.messages >= 500 },
  { key: "pilier", emoji: "🏛️", name: "Pilier du serveur", hint: "5 000 messages", test: (s) => s.messages >= 5000 },
  { key: "micro", emoji: "🎙️", name: "Micro ouvert", hint: "1 h en vocal", test: (s) => s.voiceMinutes >= 60 },
  { key: "noctambule", emoji: "🌙", name: "Habitué du vocal", hint: "24 h en vocal", test: (s) => s.voiceMinutes >= 1440 },
  { key: "marathon", emoji: "🏃", name: "Marathonien du vocal", hint: "100 h en vocal", test: (s) => s.voiceMinutes >= 6000 },
  { key: "niveau_5", emoji: "⭐", name: "Étoile montante", hint: "Atteindre le niveau 5", test: (s) => s.level >= 5 },
  { key: "niveau_20", emoji: "🌟", name: "Confirmé", hint: "Atteindre le niveau 20", test: (s) => s.level >= 20 },
  { key: "niveau_50", emoji: "👑", name: "Légende", hint: "Atteindre le niveau 50", test: (s) => s.level >= 50 },
  { key: "idee", emoji: "💡", name: "Force de proposition", hint: "Proposer une suggestion", test: (s) => s.suggestions >= 1 },
  { key: "idee_acceptee", emoji: "✅", name: "Idée retenue", hint: "Avoir une suggestion acceptée", test: (s) => s.acceptedSuggestions >= 1 },
  { key: "anniversaire", emoji: "🎂", name: "On ne t'oubliera pas", hint: "Enregistrer son anniversaire", test: (s) => s.birthday },
];
const BY_KEY = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));

export function memberStats(guildId, userId) {
  const lvl = db.prepare("SELECT level, messages, voice_minutes FROM community_levels WHERE guild_id=? AND user_id=?").get(guildId, userId) ?? { level: 0, messages: 0, voice_minutes: 0 };
  const sugg = db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END) AS ok FROM community_suggestions WHERE guild_id=? AND author_id=?").get(guildId, userId);
  const birthday = Boolean(db.prepare("SELECT 1 FROM community_birthdays WHERE guild_id=? AND user_id=?").get(guildId, userId));
  return { level: lvl.level, messages: lvl.messages, voiceMinutes: lvl.voice_minutes, suggestions: sugg?.n ?? 0, acceptedSuggestions: sugg?.ok ?? 0, birthday };
}

export function unlockedKeys(guildId, userId) {
  return new Set(db.prepare("SELECT key FROM community_achievements WHERE guild_id=? AND user_id=?").all(guildId, userId).map((r) => r.key));
}

/** Records newly earned achievements; returns them (empty when nothing new). */
export function checkAchievements(guildId, userId, now = Date.now()) {
  const stats = memberStats(guildId, userId);
  const have = unlockedKeys(guildId, userId);
  const fresh = ACHIEVEMENTS.filter((a) => !have.has(a.key) && a.test(stats));
  const insert = db.prepare("INSERT OR IGNORE INTO community_achievements(guild_id,user_id,key,unlocked_at) VALUES(?,?,?,?)");
  for (const a of fresh) {
    insert.run(guildId, userId, a.key, now);
    publishEventSafe({ guildId, kind: "member.achievement", subjectId: userId, source: "fwu", payload: { key: a.key, name: a.name } });
  }
  return fresh;
}

/** Announces fresh achievements in the level channel when one is configured (never pings anyone else). */
export async function announceAchievements(guild, userId, fresh, channelId) {
  if (!fresh.length || !channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const list = fresh.map((a) => `${a.emoji} **${a.name}**`).join(", ");
  await channel.send({ content: `🏅 <@${userId}> débloque ${fresh.length > 1 ? "les succès" : "le succès"} ${list} !`, allowedMentions: { users: [userId] } }).catch(() => {});
}

export function achievementsText(guildId, userId, username) {
  const rows = new Map(db.prepare("SELECT key, unlocked_at FROM community_achievements WHERE guild_id=? AND user_id=?").all(guildId, userId).map((r) => [r.key, r.unlocked_at]));
  const lines = ACHIEVEMENTS.map((a) => (rows.has(a.key)
    ? `${a.emoji} **${a.name}** · <t:${Math.floor(rows.get(a.key) / 1000)}:d>`
    : `🔒 ${a.name} — *${a.hint}*`));
  const total = db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM community_achievements WHERE guild_id=?").get(guildId).n;
  return { title: `🏅 Succès de ${username} · ${rows.size}/${ACHIEVEMENTS.length}`, description: lines.join("\n"), footer: `${total} membre(s) ont déjà au moins un succès` };
}

export const achievementByKey = (key) => BY_KEY.get(key) ?? null;
