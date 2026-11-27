// SUCK ME — badges d'ancienneté (/anciennete) : rôles à 1 mois, 6 mois et 1 an sur le serveur,
// et un message le jour anniversaire d'arrivée (1 an et plus). Un seul badge à la fois : le plus haut mérité
// remplace les précédents. Tout rôle donné passe par le garde des rôles. Contrôle toutes les heures.
import { PermissionFlagsBits as P } from "discord.js";
import { db } from "../database.js";
import { roleGrantRefusal } from "../role-grant-guard.js";
import { respondInPlaceSafe } from "../interaction-reply.js";

export const SENIORITY_COMMANDS = new Set(["anciennete"]);
export const SENIORITY_TIERS = Object.freeze([
  { kind: "y1", days: 365, label: "1 an", column: "role_y1", option: "role-1-an" },
  { kind: "m6", days: 182, label: "6 mois", column: "role_m6", option: "role-6-mois" },
  { kind: "m1", days: 30, label: "1 mois", column: "role_m1", option: "role-1-mois" },
]);
const DAY = 86_400_000;

db.exec(`
  CREATE TABLE IF NOT EXISTS seniority_config (guild_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, role_m1 TEXT, role_m6 TEXT, role_y1 TEXT, channel_id TEXT);
  CREATE TABLE IF NOT EXISTS seniority_done (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id, kind));
`);

/** Badge mérité (le plus haut) pour une date d'arrivée, ou null. */
export function earnedTier(joinedAt, now = Date.now()) {
  if (!joinedAt) return null;
  const days = (now - joinedAt) / DAY;
  return SENIORITY_TIERS.find((tier) => days >= tier.days) ?? null;
}

const parisDay = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day) };
};

/** Années d'ancienneté si c'est aujourd'hui l'anniversaire d'arrivée (heure de Paris), sinon 0. */
export function anniversaryYears(joinedAt, now = Date.now()) {
  if (!joinedAt) return 0;
  const a = parisDay(joinedAt); const b = parisDay(now);
  return a.month === b.month && a.day === b.day && b.year > a.year ? b.year - a.year : 0;
}

export function seniorityConfig(guildId) {
  const row = db.prepare("SELECT * FROM seniority_config WHERE guild_id=?").get(guildId);
  return { enabled: Boolean(row?.enabled), m1: row?.role_m1 ?? null, m6: row?.role_m6 ?? null, y1: row?.role_y1 ?? null, channelId: row?.channel_id ?? null };
}

export function configureSeniority(guildId, patch) {
  const cur = seniorityConfig(guildId);
  const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined && v !== null)) };
  db.prepare(`INSERT INTO seniority_config(guild_id,enabled,role_m1,role_m6,role_y1,channel_id) VALUES(?,?,?,?,?,?)
    ON CONFLICT(guild_id) DO UPDATE SET enabled=excluded.enabled, role_m1=excluded.role_m1, role_m6=excluded.role_m6, role_y1=excluded.role_y1, channel_id=excluded.channel_id`)
    .run(guildId, next.enabled ? 1 : 0, next.m1, next.m6, next.y1, next.channelId);
  return seniorityConfig(guildId);
}

/** Met un membre au bon badge. Rend le badge donné (kind) ou null. */
async function syncMember(guild, member, config, now) {
  const tier = earnedTier(member.joinedTimestamp ?? member.joinedAt?.getTime?.(), now);
  if (!tier || !config[tier.kind]) return null;
  const roleIds = SENIORITY_TIERS.map((t) => config[t.kind]).filter(Boolean);
  if (member.roles.cache.has(config[tier.kind]) && !roleIds.some((id) => id !== config[tier.kind] && member.roles.cache.has(id))) return null;
  const role = guild.roles.cache.get(config[tier.kind]) ?? await guild.roles.fetch(config[tier.kind]).catch(() => null);
  if (!role || await roleGrantRefusal(guild, role, { automatic: true, targetId: member.id })) return null;
  for (const id of roleIds) if (id !== role.id && member.roles.cache.has(id)) await member.roles.remove(id, "Badge d'ancienneté remplacé").catch(() => {});
  if (!member.roles.cache.has(role.id)) await member.roles.add(role.id, `Badge d'ancienneté : ${tier.label}`).catch(() => null);
  db.prepare("INSERT OR REPLACE INTO seniority_done(guild_id,user_id,kind,at) VALUES(?,?,?,?)").run(guild.id, member.id, tier.kind, now);
  return tier.kind;
}

/**
 * Passage horaire. `announce(guild, channelId, text, userId)` publie les anniversaires.
 * Rend { badges, birthdays }.
 */
export async function runSeniority(client, { isAllowedGuild = () => true, now = Date.now(), announce = async () => {} } = {}) {
  let badges = 0; let birthdays = 0;
  for (const { guild_id: guildId } of db.prepare("SELECT guild_id FROM seniority_config WHERE enabled=1").all()) {
    const guild = isAllowedGuild(guildId) ? client.guilds.cache.get(guildId) : null;
    if (!guild) continue;
    const config = seniorityConfig(guildId);
    const members = await guild.members.fetch().catch(() => guild.members.cache);
    for (const member of members.values()) {
      if (member.user?.bot) continue;
      if (await syncMember(guild, member, config, now).catch(() => null)) badges += 1;
      const years = anniversaryYears(member.joinedTimestamp ?? member.joinedAt?.getTime?.(), now);
      if (years && config.channelId) {
        const kind = `anniv:${parisDay(now).year}`;
        if (db.prepare("SELECT 1 FROM seniority_done WHERE guild_id=? AND user_id=? AND kind=?").get(guildId, member.id, kind)) continue;
        db.prepare("INSERT INTO seniority_done(guild_id,user_id,kind,at) VALUES(?,?,?,?)").run(guildId, member.id, kind, now);
        await announce(guild, config.channelId, `🎂 <@${member.id}> fête aujourd'hui **${years} an${years > 1 ? "s" : ""}** sur le serveur, merci d'être là !`, member.id).catch(() => {});
        birthdays += 1;
      }
    }
  }
  return { badges, birthdays };
}

const isAdmin = (member) => Boolean(member?.permissions?.has?.(P.ManageGuild) || member?.permissions?.has?.(P.Administrator) || member?.id === member?.guild?.ownerId);

function stateText(config) {
  const role = (id) => (id ? `<@&${id}>` : "aucun");
  return [`🏅 **Badges d'ancienneté** : ${config.enabled ? "activés" : "désactivés"}`, `1 mois : ${role(config.m1)} · 6 mois : ${role(config.m6)} · 1 an : ${role(config.y1)}`, `Anniversaires : ${config.channelId ? `<#${config.channelId}>` : "pas de salon"}`].join("\n");
}

export async function handleSeniorityInteraction(interaction) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== "anciennete" || !interaction.guild) return false;
  const gid = interaction.guild.id;
  const o = interaction.options;
  try {
    if (!isAdmin(interaction.member)) throw new Error("Réservé aux admins (Gérer le serveur).");
    const sub = o.getSubcommand(false) ?? "etat";
    let config;
    if (sub === "configurer") config = configureSeniority(gid, { m1: o.getRole("role-1-mois", false)?.id, m6: o.getRole("role-6-mois", false)?.id, y1: o.getRole("role-1-an", false)?.id, channelId: o.getChannel("salon", false)?.id });
    else if (sub === "activer") config = configureSeniority(gid, { enabled: true });
    else if (sub === "desactiver") config = configureSeniority(gid, { enabled: false });
    else config = seniorityConfig(gid);
    await interaction.reply({ content: stateText(config), ephemeral: true, allowedMentions: { parse: [] } });
  } catch (error) {
    await respondInPlaceSafe(interaction, { content: `❌ ${error.message}`, ephemeral: true });
  }
  return true;
}
