// FWU — community features: levels & XP, suggestions, birthdays, reminders, server stats.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits as P } from "discord.js";
import { db } from "../database.js";
import { parsePndOwnerId } from "../pnd-owner-policy.js";
import { isSysPlus } from "../systems/sysplus/permissions.js";
import { achievementsText, announceAchievements, checkAchievements } from "./achievements.js";
import { publishEventSafe } from "../event-bus.js";

export const COMMUNITY_COMMANDS = new Set(["niveau", "suggestion", "anniversaire", "rappel", "stats"]);

db.exec(`
  CREATE TABLE IF NOT EXISTS community_levels (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 0,
    messages INTEGER NOT NULL DEFAULT 0, voice_minutes INTEGER NOT NULL DEFAULT 0, last_message_xp_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS community_levels_rank_idx ON community_levels(guild_id, xp DESC);
  CREATE TABLE IF NOT EXISTS community_level_config (
    guild_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, channel_id TEXT, rewards_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS community_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, author_id TEXT NOT NULL, channel_id TEXT, message_id TEXT,
    content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', decided_by TEXT, reason TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS community_suggestion_votes (
    suggestion_id INTEGER NOT NULL, user_id TEXT NOT NULL, vote INTEGER NOT NULL, PRIMARY KEY (suggestion_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS community_settings (guild_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY (guild_id, key));
  CREATE TABLE IF NOT EXISTS community_birthdays (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, day INTEGER NOT NULL, month INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS community_birthday_runs (guild_id TEXT NOT NULL, run_date TEXT NOT NULL, PRIMARY KEY (guild_id, run_date));
  CREATE TABLE IF NOT EXISTS community_birthday_roles (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL, given_date TEXT NOT NULL, PRIMARY KEY (guild_id, user_id));
  CREATE TABLE IF NOT EXISTS community_reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, user_id TEXT NOT NULL,
    text TEXT NOT NULL, due_at INTEGER NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS community_reminders_due_idx ON community_reminders(due_at);
`);

const ownerId = () => parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);
const isStaff = (member, settings) => member?.id === ownerId() || member?.id === member?.guild?.ownerId
  || isSysPlus(member, settings?.sysPlus?.roleId ?? null) || Boolean(member?.permissions?.has?.(P.ManageGuild) || member?.permissions?.has?.(P.Administrator));
const getSetting = (guildId, key) => db.prepare("SELECT value FROM community_settings WHERE guild_id=? AND key=?").get(guildId, key)?.value ?? null;
const setSetting = (guildId, key, value) => db.prepare("INSERT INTO community_settings(guild_id,key,value) VALUES(?,?,?) ON CONFLICT(guild_id,key) DO UPDATE SET value=excluded.value").run(guildId, key, value);

/** Automatic configuration: only fills what the staff has not set. */
export const communityAutoconfig = {
  setting: (guildId, key, value) => { if (!getSetting(guildId, key)) setSetting(guildId, key, value); },
  levelChannel: (guildId, channelId) => { const config = getLevelConfig(guildId); if (!config.channelId) saveLevelConfig(guildId, { ...config, channelId }); },
};

// ---------------------------------------------------------------- Levels
/** XP needed to go from level n to n+1 (classic curve). */
export const xpForNextLevel = (level) => 5 * level * level + 50 * level + 100;
export function levelFromXp(xp) {
  let level = 0;
  let remaining = Math.max(0, Math.trunc(xp));
  while (remaining >= xpForNextLevel(level)) { remaining -= xpForNextLevel(level); level += 1; }
  return { level, into: remaining, needed: xpForNextLevel(level) };
}

export function getLevelConfig(guildId) {
  const row = db.prepare("SELECT enabled, channel_id, rewards_json FROM community_level_config WHERE guild_id=?").get(guildId);
  let rewards = {};
  try { rewards = JSON.parse(row?.rewards_json ?? "{}"); } catch { rewards = {}; }
  return { enabled: row ? Boolean(row.enabled) : true, channelId: row?.channel_id ?? null, rewards };
}
function saveLevelConfig(guildId, config) {
  db.prepare(`INSERT INTO community_level_config(guild_id,enabled,channel_id,rewards_json) VALUES(?,?,?,?)
    ON CONFLICT(guild_id) DO UPDATE SET enabled=excluded.enabled, channel_id=excluded.channel_id, rewards_json=excluded.rewards_json`)
    .run(guildId, config.enabled ? 1 : 0, config.channelId, JSON.stringify(config.rewards));
}

/** Adds XP; returns { before, after } levels. Pure SQLite, no Discord call. */
export function addXp(guildId, userId, amount, { message = false, voiceMinutes = 0, now = Date.now() } = {}) {
  const row = db.prepare("SELECT xp, level FROM community_levels WHERE guild_id=? AND user_id=?").get(guildId, userId) ?? { xp: 0, level: 0 };
  const xp = row.xp + amount;
  const after = levelFromXp(xp).level;
  db.prepare(`INSERT INTO community_levels(guild_id,user_id,xp,level,messages,voice_minutes,last_message_xp_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET xp=excluded.xp, level=excluded.level, messages=community_levels.messages+?,
    voice_minutes=community_levels.voice_minutes+?, last_message_xp_at=CASE WHEN ? THEN excluded.last_message_xp_at ELSE community_levels.last_message_xp_at END`)
    .run(guildId, userId, xp, after, message ? 1 : 0, voiceMinutes, message ? now : 0, message ? 1 : 0, voiceMinutes, message ? 1 : 0);
  // LE FISC pays the level bonus and GUARD refreshes the trust score from this.
  if (after > row.level) {
    publishEventSafe({ guildId, kind: "member.levelup", subjectId: userId, source: "fwu", payload: { level: after, from: row.level } });
  }
  return { before: row.level, after, xp };
}

async function applyLevelUp(guild, member, before, after, fallbackChannel = null) {
  if (after <= before) return;
  const config = getLevelConfig(guild.id);
  const earned = Object.entries(config.rewards).filter(([lvl]) => Number(lvl) <= after).map(([, roleId]) => roleId)
    .filter((roleId) => guild.roles.cache.has(roleId) && !member.roles.cache.has(roleId));
  if (earned.length) await member.roles.add(earned, `Niveau ${after} atteint`).catch(() => {});
  const channel = config.channelId ? await guild.channels.fetch(config.channelId).catch(() => null) : fallbackChannel;
  if (!channel?.isTextBased?.()) return;
  await channel.send({ content: `🎉 <@${member.id}> passe **niveau ${after}** !${earned.length ? ` Nouveau rôle : ${earned.map((id) => `<@&${id}>`).join(", ")}.` : ""}`, allowedMentions: { users: [member.id] } }).catch(() => {});
}

/** messageCreate: 15–25 XP, at most once per minute per member. */
export async function handleLevelMessage(message, { random = Math.random, now = Date.now() } = {}) {
  if (!message.guild || message.author?.bot || !message.member) return null;
  if (!getLevelConfig(message.guild.id).enabled) return null;
  const last = db.prepare("SELECT last_message_xp_at FROM community_levels WHERE guild_id=? AND user_id=?").get(message.guild.id, message.author.id)?.last_message_xp_at ?? 0;
  if (now - last < 60_000) return null;
  const result = addXp(message.guild.id, message.author.id, 15 + Math.floor(random() * 11), { message: true, now });
  await applyLevelUp(message.guild, message.member, result.before, result.after, message.channel);
  await announceAchievements(message.guild, message.author.id, checkAchievements(message.guild.id, message.author.id, now), getLevelConfig(message.guild.id).channelId);
  return result;
}

/** Every minute: 10 XP per member in voice with at least one other human, not deafened, not AFK. */
export async function tickVoiceXp(guilds) {
  let given = 0;
  for (const guild of guilds) {
    if (!getLevelConfig(guild.id).enabled) continue;
    for (const channel of guild.channels.cache.values()) {
      if (!channel?.isVoiceBased?.() || channel.id === guild.afkChannelId) continue;
      const humans = [...channel.members.values()].filter((m) => !m.user.bot);
      if (humans.length < 2) continue;
      for (const member of humans) {
        if (member.voice?.selfDeaf || member.voice?.serverDeaf) continue;
        const result = addXp(guild.id, member.id, 10, { voiceMinutes: 1 });
        given += 1;
        await applyLevelUp(guild, member, result.before, result.after, null);
        await announceAchievements(guild, member.id, checkAchievements(guild.id, member.id), getLevelConfig(guild.id).channelId);
      }
    }
  }
  return given;
}

function progressBar(into, needed, size = 14) {
  const filled = Math.round((into / needed) * size);
  return `${"█".repeat(filled)}${"░".repeat(size - filled)}`;
}

async function niveau(interaction, settings) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  if (sub === "voir") {
    const user = interaction.options.getUser("membre") ?? interaction.user;
    const row = db.prepare("SELECT xp, messages, voice_minutes FROM community_levels WHERE guild_id=? AND user_id=?").get(guild.id, user.id) ?? { xp: 0, messages: 0, voice_minutes: 0 };
    const rank = db.prepare("SELECT COUNT(*) + 1 AS r FROM community_levels WHERE guild_id=? AND xp > ?").get(guild.id, row.xp).r;
    const l = levelFromXp(row.xp);
    return { public: true, embeds: [new EmbedBuilder().setColor(0xe21d2f).setTitle(`⭐ Niveau de ${user.username}`)
      .setDescription(`**Niveau ${l.level}** · rang **#${rank}**\n${progressBar(l.into, l.needed)} ${l.into}/${l.needed} XP\n\nXP total : **${row.xp}** · Messages : **${row.messages}** · Vocal : **${row.voice_minutes} min**`)] };
  }
  if (sub === "succes") {
    const user = interaction.options.getUser("membre") ?? interaction.user;
    checkAchievements(guild.id, user.id);
    const t = achievementsText(guild.id, user.id, user.username);
    return { public: true, embeds: [new EmbedBuilder().setColor(0xf59e0b).setTitle(t.title).setDescription(t.description).setFooter({ text: t.footer })] };
  }
  if (sub === "classement") {
    const rows = db.prepare("SELECT user_id, xp FROM community_levels WHERE guild_id=? ORDER BY xp DESC LIMIT 10").all(guild.id);
    const medal = (i) => ["🥇", "🥈", "🥉"][i] ?? `**${i + 1}.**`;
    return { public: true, embeds: [new EmbedBuilder().setColor(0xe21d2f).setTitle("🏆 Classement des niveaux")
      .setDescription(rows.map((r, i) => `${medal(i)} <@${r.user_id}> — niveau **${levelFromXp(r.xp).level}** (${r.xp} XP)`).join("\n") || "Personne n'a encore d'XP.")] };
  }
  if (!isStaff(interaction.member, settings)) return "⛔ Réglage réservé au staff (Gérer le serveur), aux SYS+ et à l'OWNER.";
  const config = getLevelConfig(guild.id);
  if (sub === "activer" || sub === "desactiver") { saveLevelConfig(guild.id, { ...config, enabled: sub === "activer" }); return sub === "activer" ? "✅ Niveaux activés." : "🛑 Niveaux désactivés (l'XP est conservée)."; }
  if (sub === "salon") {
    const channel = interaction.options.getChannel("salon");
    saveLevelConfig(guild.id, { ...config, channelId: channel?.id ?? null });
    return channel ? `✅ Les passages de niveau seront annoncés dans <#${channel.id}>.` : "✅ Les passages de niveau seront annoncés là où le membre écrit.";
  }
  if (sub === "recompense-ajouter") {
    const level = interaction.options.getInteger("niveau", true);
    const role = interaction.options.getRole("role", true);
    const me = guild.members.me ?? await guild.members.fetchMe();
    if (role.managed || role.id === guild.id || role.position >= me.roles.highest.position) return "❌ Ce rôle ne peut pas être donné par le bot (place mon rôle au-dessus).";
    if (role.permissions?.has?.(P.Administrator) || role.permissions?.has?.(P.ManageGuild) || role.permissions?.has?.(P.BanMembers)) return "❌ Pour la sécurité, un rôle avec des permissions de modération ne peut pas être une récompense.";
    saveLevelConfig(guild.id, { ...config, rewards: { ...config.rewards, [level]: role.id } });
    return `✅ Niveau **${level}** → <@&${role.id}>.`;
  }
  if (sub === "recompense-retirer") {
    const level = interaction.options.getInteger("niveau", true);
    const rewards = { ...config.rewards }; delete rewards[level];
    saveLevelConfig(guild.id, { ...config, rewards });
    return `✅ Récompense du niveau ${level} retirée.`;
  }
  if (sub === "recompenses") {
    const list = Object.entries(config.rewards).sort((a, b) => Number(a[0]) - Number(b[0])).map(([lvl, roleId]) => `• Niveau **${lvl}** → <@&${roleId}>`);
    return `🎁 **Récompenses de niveau**\n${list.join("\n") || "Aucune."}\nNiveaux : ${config.enabled ? "activés" : "désactivés"} · Annonces : ${config.channelId ? `<#${config.channelId}>` : "salon du message"}`;
  }
  return "Action inconnue.";
}

// ---------------------------------------------------------------- Suggestions
function suggestionEmbed(row, up, down) {
  const status = { open: "🟡 En attente", accepted: "🟢 Acceptée", refused: "🔴 Refusée" }[row.status] ?? row.status;
  return new EmbedBuilder().setColor(row.status === "accepted" ? 0x22c55e : row.status === "refused" ? 0xef4444 : 0xe21d2f)
    .setTitle(`💡 Suggestion #${row.id}`).setDescription(row.content.slice(0, 3500))
    .addFields({ name: "Auteur", value: `<@${row.author_id}>`, inline: true }, { name: "Votes", value: `👍 ${up} · 👎 ${down}`, inline: true }, { name: "Statut", value: status, inline: true },
      ...(row.reason ? [{ name: "Réponse du staff", value: row.reason.slice(0, 1000) }] : []));
}
function voteCounts(id) {
  const rows = db.prepare("SELECT vote, COUNT(*) AS n FROM community_suggestion_votes WHERE suggestion_id=? GROUP BY vote").all(id);
  return { up: rows.find((r) => r.vote === 1)?.n ?? 0, down: rows.find((r) => r.vote === -1)?.n ?? 0 };
}
const voteButtons = (id, disabled = false) => [new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`sugg:up:${id}`).setEmoji("👍").setStyle(ButtonStyle.Success).setDisabled(disabled),
  new ButtonBuilder().setCustomId(`sugg:down:${id}`).setEmoji("👎").setStyle(ButtonStyle.Danger).setDisabled(disabled),
)];

async function suggestion(interaction, settings) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  if (sub === "salon") {
    if (!isStaff(interaction.member, settings)) return "⛔ Réservé au staff.";
    const channel = interaction.options.getChannel("salon", true);
    setSetting(guild.id, "suggestion_channel", channel.id);
    return `✅ Les suggestions seront publiées dans <#${channel.id}>.`;
  }
  if (sub === "proposer") {
    const channelId = getSetting(guild.id, "suggestion_channel");
    const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
    if (!channel?.isTextBased?.()) return "❌ Aucun salon de suggestions : le staff doit faire `/suggestion salon` d'abord.";
    const content = interaction.options.getString("texte", true).trim();
    const info = db.prepare("INSERT INTO community_suggestions(guild_id,author_id,channel_id,content,created_at) VALUES(?,?,?,?,?)").run(guild.id, interaction.user.id, channel.id, content, Date.now());
    const row = db.prepare("SELECT * FROM community_suggestions WHERE id=?").get(info.lastInsertRowid);
    const message = await channel.send({ embeds: [suggestionEmbed(row, 0, 0)], components: voteButtons(row.id), allowedMentions: { parse: [] } });
    db.prepare("UPDATE community_suggestions SET message_id=? WHERE id=?").run(message.id, row.id);
    return `✅ Suggestion **#${row.id}** publiée dans <#${channel.id}>.`;
  }
  if (sub === "repondre") {
    if (!isStaff(interaction.member, settings)) return "⛔ Réservé au staff.";
    const id = interaction.options.getInteger("id", true);
    const row = db.prepare("SELECT * FROM community_suggestions WHERE id=? AND guild_id=?").get(id, guild.id);
    if (!row) return "❌ Suggestion introuvable.";
    const status = interaction.options.getString("decision", true);
    const reason = interaction.options.getString("raison") ?? null;
    db.prepare("UPDATE community_suggestions SET status=?, decided_by=?, reason=? WHERE id=?").run(status, interaction.user.id, reason, id);
    const updated = db.prepare("SELECT * FROM community_suggestions WHERE id=?").get(id);
    const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
    const message = channel ? await channel.messages.fetch(row.message_id).catch(() => null) : null;
    const { up, down } = voteCounts(id);
    if (message) await message.edit({ embeds: [suggestionEmbed(updated, up, down)], components: voteButtons(id, true) }).catch(() => {});
    return `✅ Suggestion #${id} ${status === "accepted" ? "acceptée" : "refusée"}.`;
  }
  return "Action inconnue.";
}

export async function handleSuggestionVote(interaction) {
  if (!interaction.isButton?.() || !/^sugg:(up|down):\d+$/.test(interaction.customId ?? "")) return false;
  const [, direction, rawId] = interaction.customId.split(":");
  const id = Number(rawId);
  const row = db.prepare("SELECT * FROM community_suggestions WHERE id=? AND guild_id=?").get(id, interaction.guildId);
  if (!row || row.status !== "open") {
    await interaction.reply({ content: "Cette suggestion est fermée.", ephemeral: true });
    return true;
  }
  const vote = direction === "up" ? 1 : -1;
  const current = db.prepare("SELECT vote FROM community_suggestion_votes WHERE suggestion_id=? AND user_id=?").get(id, interaction.user.id)?.vote;
  if (current === vote) db.prepare("DELETE FROM community_suggestion_votes WHERE suggestion_id=? AND user_id=?").run(id, interaction.user.id);
  else db.prepare("INSERT INTO community_suggestion_votes(suggestion_id,user_id,vote) VALUES(?,?,?) ON CONFLICT(suggestion_id,user_id) DO UPDATE SET vote=excluded.vote").run(id, interaction.user.id, vote);
  const { up, down } = voteCounts(id);
  await interaction.update({ embeds: [suggestionEmbed(row, up, down)], components: voteButtons(id) });
  return true;
}

// ---------------------------------------------------------------- Birthdays
export function parisDate(now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  return { day: Number(parts.day), month: Number(parts.month), year: Number(parts.year), hour: Number(parts.hour), key: `${parts.year}-${parts.month}-${parts.day}` };
}
const validDate = (day, month) => month >= 1 && month <= 12 && day >= 1 && day <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];

async function anniversaire(interaction, settings) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  if (sub === "definir") {
    const day = interaction.options.getInteger("jour", true);
    const month = interaction.options.getInteger("mois", true);
    if (!validDate(day, month)) return "❌ Date invalide.";
    db.prepare("INSERT INTO community_birthdays(guild_id,user_id,day,month) VALUES(?,?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET day=excluded.day, month=excluded.month").run(guild.id, interaction.user.id, day, month);
    return `🎂 Anniversaire enregistré : **${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}**.`;
  }
  if (sub === "retirer") { db.prepare("DELETE FROM community_birthdays WHERE guild_id=? AND user_id=?").run(guild.id, interaction.user.id); return "✅ Anniversaire retiré."; }
  if (sub === "liste") {
    const today = parisDate();
    const rows = db.prepare("SELECT user_id, day, month FROM community_birthdays WHERE guild_id=?").all(guild.id)
      .map((r) => ({ ...r, rank: ((r.month - today.month + 12) % 12) * 31 + (r.day - today.day + 31) % 31 })).sort((a, b) => a.rank - b.rank).slice(0, 15);
    return { public: true, content: `🎂 **Prochains anniversaires**\n${rows.map((r) => `• <@${r.user_id}> — ${String(r.day).padStart(2, "0")}/${String(r.month).padStart(2, "0")}`).join("\n") || "Aucun anniversaire enregistré."}` };
  }
  if (sub === "config") {
    if (!isStaff(interaction.member, settings)) return "⛔ Réservé au staff.";
    const channel = interaction.options.getChannel("salon");
    const role = interaction.options.getRole("role");
    if (channel) setSetting(guild.id, "birthday_channel", channel.id);
    if (role) {
      const me = guild.members.me ?? await guild.members.fetchMe();
      if (role.managed || role.position >= me.roles.highest.position || role.permissions?.has?.(P.Administrator)) return "❌ Ce rôle ne peut pas servir de rôle d'anniversaire.";
      setSetting(guild.id, "birthday_role", role.id);
    }
    return `✅ Anniversaires : salon ${getSetting(guild.id, "birthday_channel") ? `<#${getSetting(guild.id, "birthday_channel")}>` : "non choisi"} · rôle du jour ${getSetting(guild.id, "birthday_role") ? `<@&${getSetting(guild.id, "birthday_role")}>` : "aucun"}. Annonce chaque jour à 9 h.`;
  }
  return "Action inconnue.";
}

/** Run every few minutes: at 9:00 Paris, wish birthdays once per day; remove yesterday's role. */
export async function runBirthdays(guilds, now = Date.now()) {
  const today = parisDate(now);
  let wished = 0;
  for (const guild of guilds) {
    for (const given of db.prepare("SELECT user_id, role_id FROM community_birthday_roles WHERE guild_id=? AND given_date<>?").all(guild.id, today.key)) {
      const member = await guild.members.fetch({ user: given.user_id }).catch(() => null);
      if (member?.roles?.cache?.has(given.role_id)) await member.roles.remove(given.role_id, "Fin de l'anniversaire").catch(() => {});
      db.prepare("DELETE FROM community_birthday_roles WHERE guild_id=? AND user_id=?").run(guild.id, given.user_id);
    }
    if (today.hour < 9) continue;
    if (db.prepare("SELECT 1 FROM community_birthday_runs WHERE guild_id=? AND run_date=?").get(guild.id, today.key)) continue;
    db.prepare("INSERT INTO community_birthday_runs(guild_id,run_date) VALUES(?,?)").run(guild.id, today.key);
    const people = db.prepare("SELECT user_id FROM community_birthdays WHERE guild_id=? AND day=? AND month=?").all(guild.id, today.day, today.month);
    if (!people.length) continue;
    const roleId = getSetting(guild.id, "birthday_role");
    const present = [];
    for (const { user_id: userId } of people) {
      const member = await guild.members.fetch({ user: userId }).catch(() => null);
      if (!member) continue;
      present.push(userId);
      if (roleId) {
        await member.roles.add(roleId, "Anniversaire").catch(() => {});
        db.prepare("INSERT OR REPLACE INTO community_birthday_roles(guild_id,user_id,role_id,given_date) VALUES(?,?,?,?)").run(guild.id, userId, roleId, today.key);
      }
    }
    const channelId = getSetting(guild.id, "birthday_channel");
    const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
    if (present.length && channel?.isTextBased?.()) {
      await channel.send({ content: `🎂 Joyeux anniversaire ${present.map((id) => `<@${id}>`).join(", ")} ! 🎉`, allowedMentions: { users: present } }).catch(() => {});
      wished += present.length;
    }
  }
  return wished;
}

// ---------------------------------------------------------------- Reminders
/** "1j2h30m", "45m", "2h", "90s" → milliseconds (1 minute to 365 days), or null. */
export function parseDuration(text) {
  const clean = String(text ?? "").toLowerCase().replace(/\s+/g, "");
  if (!/^(\d+(j|d|h|m|min|s))+$/.test(clean)) return null;
  let ms = 0;
  for (const [, n, unit] of clean.matchAll(/(\d+)(j|d|h|min|m|s)/g)) {
    ms += Number(n) * ({ j: 86_400_000, d: 86_400_000, h: 3_600_000, min: 60_000, m: 60_000, s: 1000 }[unit]);
  }
  return ms >= 60_000 && ms <= 365 * 86_400_000 ? ms : null;
}

async function rappel(interaction) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  if (sub === "creer") {
    const ms = parseDuration(interaction.options.getString("dans", true));
    if (!ms) return "❌ Durée invalide. Exemples : `10m`, `2h`, `1j12h` (1 minute à 365 jours).";
    if (db.prepare("SELECT COUNT(*) AS n FROM community_reminders WHERE guild_id=? AND user_id=?").get(guild.id, interaction.user.id).n >= 25) return "❌ Maximum 25 rappels en cours.";
    const due = Date.now() + ms;
    const info = db.prepare("INSERT INTO community_reminders(guild_id,channel_id,user_id,text,due_at,created_at) VALUES(?,?,?,?,?,?)")
      .run(guild.id, interaction.channelId, interaction.user.id, interaction.options.getString("message", true).slice(0, 500), due, Date.now());
    return `⏰ Rappel **#${info.lastInsertRowid}** programmé <t:${Math.floor(due / 1000)}:R>.`;
  }
  if (sub === "liste") {
    const rows = db.prepare("SELECT id, text, due_at FROM community_reminders WHERE guild_id=? AND user_id=? ORDER BY due_at").all(guild.id, interaction.user.id);
    return `⏰ **Tes rappels**\n${rows.map((r) => `• #${r.id} <t:${Math.floor(r.due_at / 1000)}:R> — ${r.text.slice(0, 80)}`).join("\n") || "Aucun rappel."}`;
  }
  if (sub === "supprimer") {
    const result = db.prepare("DELETE FROM community_reminders WHERE id=? AND guild_id=? AND user_id=?").run(interaction.options.getInteger("id", true), guild.id, interaction.user.id);
    return Number(result.changes) ? "🗑️ Rappel supprimé." : "❌ Rappel introuvable.";
  }
  return "Action inconnue.";
}

/** Run every 30 s: deliver due reminders (in the channel, or by DM if the channel is gone). */
export async function runReminders(client, now = Date.now()) {
  const due = db.prepare("SELECT * FROM community_reminders WHERE due_at <= ? ORDER BY due_at LIMIT 50").all(now);
  for (const r of due) {
    db.prepare("DELETE FROM community_reminders WHERE id=?").run(r.id);
    const content = `⏰ <@${r.user_id}>, rappel : ${r.text}`;
    const channel = await client.channels.fetch(r.channel_id).catch(() => null);
    const sent = channel?.isTextBased?.() ? await channel.send({ content, allowedMentions: { users: [r.user_id] } }).catch(() => null) : null;
    if (!sent) await (await client.users.fetch(r.user_id).catch(() => null))?.send({ content }).catch(() => {});
  }
  return due.length;
}

// ---------------------------------------------------------------- Stats
async function stats(interaction) {
  const guild = interaction.guild;
  const members = guild.members.cache;
  const bots = members.filter((m) => m.user?.bot).size;
  const inVoice = members.filter((m) => m.voice?.channelId && !m.user?.bot).size;
  const channels = guild.channels.cache;
  const text = channels.filter((c) => c.isTextBased?.() && !c.isThread?.() && !c.isVoiceBased?.()).size;
  const voice = channels.filter((c) => c.isVoiceBased?.()).size;
  const top = db.prepare("SELECT user_id, xp FROM community_levels WHERE guild_id=? ORDER BY xp DESC LIMIT 3").all(guild.id);
  const totalMessages = db.prepare("SELECT COALESCE(SUM(messages),0) AS n FROM community_levels WHERE guild_id=?").get(guild.id).n;
  return { public: true, embeds: [new EmbedBuilder().setColor(0xe21d2f).setTitle(`📊 ${guild.name}`).setThumbnail(guild.iconURL?.() ?? null).addFields(
    { name: "Membres", value: `${guild.memberCount} (dont ${bots} bots)`, inline: true },
    { name: "En vocal", value: String(inVoice), inline: true },
    { name: "Boosts", value: `${guild.premiumSubscriptionCount ?? 0} (niveau ${guild.premiumTier ?? 0})`, inline: true },
    { name: "Salons", value: `${text} textuels · ${voice} vocaux`, inline: true },
    { name: "Rôles", value: String(guild.roles.cache.size), inline: true },
    { name: "Créé", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
    { name: "Messages comptés (XP)", value: String(totalMessages), inline: true },
    { name: "Top niveaux", value: top.map((r, i) => `${["🥇", "🥈", "🥉"][i]} <@${r.user_id}> (niv. ${levelFromXp(r.xp).level})`).join("\n") || "—" },
  )] };
}

export async function handleCommunityInteraction(interaction, settings = {}) {
  if (await handleSuggestionVote(interaction)) return true;
  if (!interaction.isChatInputCommand?.() || !COMMUNITY_COMMANDS.has(interaction.commandName)) return false;
  if (!interaction.guild) {
    await interaction.reply({ content: "Cette commande s'utilise sur un serveur.", ephemeral: true });
    return true;
  }
  const run = { niveau, suggestion, anniversaire, rappel, stats }[interaction.commandName];
  try {
    const result = await run(interaction, settings);
    const payload = typeof result === "string" ? { content: result } : result;
    const isPublic = Boolean(payload.public);
    delete payload.public;
    await interaction.reply({ ...payload, ephemeral: !isPublic, allowedMentions: { parse: [] } });
  } catch (error) {
    const content = `❌ ${error instanceof Error ? error.message : "Action impossible."}`;
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content, ephemeral: true }).catch(() => {});
    else await interaction.reply({ content, ephemeral: true }).catch(() => {});
  }
  return true;
}
