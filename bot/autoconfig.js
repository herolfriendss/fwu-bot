// FWU — one-time automatic configuration per guild and per bot domain.
// Reuses existing channels/roles found by name, creates only what is missing, never runs twice for the same item.
import { ChannelType, PermissionFlagsBits as P } from "discord.js";
import { db } from "./database.js";

db.exec(`CREATE TABLE IF NOT EXISTS fwu_autoconfig (guild_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT, done_at INTEGER NOT NULL, PRIMARY KEY (guild_id, key));`);

const done = (guildId, key) => db.prepare("SELECT value FROM fwu_autoconfig WHERE guild_id=? AND key=?").get(guildId, key);
const mark = (guildId, key, value) => db.prepare("INSERT OR REPLACE INTO fwu_autoconfig(guild_id,key,value,done_at) VALUES(?,?,?,?)").run(guildId, key, value ?? null, Date.now());
export const autoconfigValue = (guildId, key) => done(guildId, key)?.value ?? null;

const fold = (text) => String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Pure: first text channel whose name matches one of the patterns. */
export function findChannelByName(channels, patterns) {
  const list = [...channels].filter((c) => c?.type === ChannelType.GuildText || c?.type === ChannelType.GuildAnnouncement);
  for (const pattern of patterns) {
    const hit = list.find((c) => pattern.test(fold(c.name)));
    if (hit) return hit;
  }
  return null;
}
export const findRoleByName = (roles, pattern) => [...roles].find((r) => !r.managed && pattern.test(fold(r.name))) ?? null;

const STAFF_FLAGS = [P.KickMembers, P.BanMembers, P.ModerateMembers, P.ManageMessages, P.MuteMembers, P.MoveMembers];
/** Pure: staff ladder candidates (lowest first) — moderation roles below the bot, never Administrator. */
export function staffLadderCandidates(roles, guildId, botPosition) {
  return [...roles]
    .filter((r) => r.id !== guildId && !r.managed && r.position < botPosition && !r.permissions.has(P.Administrator) && STAFF_FLAGS.some((f) => r.permissions.has(f)))
    .sort((a, b) => a.position - b.position)
    .slice(-6)
    .map((r) => r.id);
}

async function category(guild, me) {
  const existing = [...guild.channels.cache.values()].find((c) => c.type === ChannelType.GuildCategory && (/fwu/.test(fold(c.name)) || /^\W*bots$/.test(fold(c.name).trim())));
  if (existing) return existing;
  return guild.channels.create({ name: "✨ Bots", type: ChannelType.GuildCategory, reason: "Configuration automatique" }).catch(() => null);
}

/** Text channel where members read but only bots write. */
async function ensureChannel(guild, me, key, patterns, name, topic, log) {
  const known = done(guild.id, key);
  if (known) return known.value;
  let channel = findChannelByName(guild.channels.cache.values(), patterns);
  if (!channel) {
    const parent = await category(guild, me);
    channel = await guild.channels.create({
      name, type: ChannelType.GuildText, topic, parent: parent?.id ?? null, reason: "Configuration automatique",
      permissionOverwrites: [
        { id: guild.id, deny: [P.SendMessages, P.CreatePublicThreads, P.CreatePrivateThreads] },
        { id: me.id, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks] },
      ],
    }).catch(() => null);
    if (channel) log(`salon créé #${channel.name}`); else return null;
  } else log(`salon trouvé #${channel.name}`);
  mark(guild.id, key, channel.id);
  return channel.id;
}

async function ensureRole(guild, me, key, pattern, data, log) {
  const known = done(guild.id, key);
  if (known) return known.value;
  let role = findRoleByName(guild.roles.cache.values(), pattern);
  if (role && role.position >= me.roles.highest.position) role = null;
  if (!role) {
    role = await guild.roles.create({ ...data, permissions: [], reason: "Configuration automatique" }).catch(() => null);
    if (role) log(`rôle créé ${role.name}`); else return null;
  } else log(`rôle trouvé ${role.name}`);
  mark(guild.id, key, role.id);
  return role.id;
}

/** FWU: levels channel, suggestions channel, birthdays channel + role of the day. */
async function configureFwu(guild, me, log, store) {
  const levels = await ensureChannel(guild, me, "fwu:levels", [/niveau|level|rang|xp/], "⭐・niveaux", "Passages de niveau et succès débloqués", log);
  if (levels) store.levelChannel(guild.id, levels);
  const sugg = await ensureChannel(guild, me, "fwu:suggestions", [/suggestion|idee/], "💡・suggestions", "Propose avec /suggestion proposer, vote avec les boutons", log);
  if (sugg) store.setting(guild.id, "suggestion_channel", sugg);
  const bday = await ensureChannel(guild, me, "fwu:birthdays", [/anniv|birthday/], "🎂・anniversaires", "Enregistre ta date avec /anniversaire definir", log);
  if (bday) store.setting(guild.id, "birthday_channel", bday);
  const role = await ensureRole(guild, me, "fwu:birthday_role", /anniv|birthday/, { name: "🎂 Anniversaire", colors: { primaryColor: 0xf472b6 }, hoist: true }, log);
  if (role) store.setting(guild.id, "birthday_role", role);
}

/** SUCK ME: staff ladder from the moderation roles already on the server. */
async function configureSuckme(guild, me, log, store) {
  if (done(guild.id, "suckme:ladder")) return;
  if (store.ladder(guild.id).length) { mark(guild.id, "suckme:ladder", "existing"); return; }
  const ids = staffLadderCandidates(guild.roles.cache.values(), guild.id, me.roles.highest.position);
  if (ids.length < 2) return; // retried at next start, once staff roles exist
  store.saveLadder(guild.id, ids);
  mark(guild.id, "suckme:ladder", ids.join(","));
  log(`échelle du staff : ${ids.map((id) => guild.roles.cache.get(id)?.name).join(" → ")}`);
}

/** GUARD: quarantine role that hides every channel. */
async function configureGuard(guild, me, log) {
  if (done(guild.id, "guard:quarantine_ready")) return;
  const roleId = await ensureRole(guild, me, "guard:quarantine_role", /quarantaine|quarantine/, { name: "🔒 Quarantaine", colors: { primaryColor: 0x64748b } }, log);
  if (!roleId) return;
  let applied = 0;
  for (const channel of guild.channels.cache.values()) {
    if (!channel.permissionOverwrites || channel.isThread?.()) continue;
    if (channel.parentId && channel.permissionsLocked) continue; // inherits from its category
    if (channel.permissionOverwrites.cache.get(roleId)?.deny?.has?.(P.ViewChannel)) continue;
    const ok = await channel.permissionOverwrites.edit(roleId, { ViewChannel: false, SendMessages: false, Connect: false }, { reason: "Rôle de quarantaine" }).then(() => true).catch(() => false);
    if (ok) applied += 1;
  }
  mark(guild.id, "guard:quarantine_ready", String(applied));
  log(`quarantaine appliquée sur ${applied} salon(s)`);
}

const RUNNERS = { fwu: configureFwu, suckme: configureSuckme, guard: configureGuard };

/** Runs the automatic configuration for every served domain; returns the log lines per guild. */
export async function runAutoconfig(guilds, serves, store, onLog = () => {}) {
  const report = {};
  for (const guild of guilds) {
    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!me?.permissions?.has?.(P.ManageChannels) || !me.permissions.has(P.ManageRoles)) continue;
    const lines = [];
    const log = (line) => { lines.push(line); onLog(guild, line); };
    for (const [domain, run] of Object.entries(RUNNERS)) {
      if (!serves(domain)) continue;
      await run(guild, me, log, store).catch((error) => log(`${domain} : ${error?.message ?? "erreur"}`));
    }
    if (lines.length) report[guild.id] = lines;
  }
  return report;
}
