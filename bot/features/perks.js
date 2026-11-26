// What PND are actually for: advantages bought in one place and honoured by
// every bot. XP boost (FWU), nickname colour and DJ control (SUCK ME,
// FDPDLAVOC), theft protection (LE FISC).
//
// A perk is a row with an expiry. Each bot asks `perkActive` before applying
// it, so nothing has to be pushed anywhere when one is bought or runs out.
import { db, transaction } from "../database.js";
import { roleGrantRefusal } from "../role-grant-guard.js";
import { publishEventSafe } from "../event-bus.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS fwu_perks (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL,
    expires_at INTEGER NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}',
    bought_at INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id, kind)
  );
  CREATE INDEX IF NOT EXISTS fwu_perks_expiry ON fwu_perks(expires_at);
`);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MAX_STACK_MS = 30 * DAY;

/** The shop. `kind` is what the other bots check for. */
export const PERKS = Object.freeze([
  { kind: "xp_boost", emoji: "⚡", label: "Boost d'XP", description: "+50 % d'XP gagné", price: 15_000, durationMs: DAY, bot: "Bot principal" },
  { kind: "anti_vol", emoji: "🛡️", label: "Protection anti-vol", description: "Personne ne peut te voler de PND", price: 10_000, durationMs: 2 * DAY, bot: "LE FISC" },
  { kind: "couleur", emoji: "🎨", label: "Couleur de pseudo", description: "Ta couleur rien qu'à toi", price: 25_000, durationMs: 7 * DAY, bot: "SUCK ME" },
  { kind: "dj", emoji: "🎧", label: "Droit DJ", description: "Contrôle de la musique sans rôle DJ", price: 20_000, durationMs: DAY, bot: "FDPDLAVOC" },
  { kind: "vip_casino", emoji: "🎰", label: "Plafond de mise doublé", description: "Mise maximale multipliée par deux", price: 30_000, durationMs: DAY, bot: "LE FISC" },
]);
const BY_KIND = new Map(PERKS.map((perk) => [perk.kind, perk]));
export const perkByKind = (kind) => BY_KIND.get(kind) ?? null;

export const XP_BOOST_FACTOR = 1.5;

/** True while the perk is paid for. The hot path for every other bot. */
export function perkActive(guildId, userId, kind, now = Date.now()) {
  return Boolean(db.prepare("SELECT 1 FROM fwu_perks WHERE guild_id=? AND user_id=? AND kind=? AND expires_at>?")
    .get(guildId, userId, kind, now));
}

export const activePerks = (guildId, userId, now = Date.now()) =>
  db.prepare("SELECT kind, expires_at, payload_json FROM fwu_perks WHERE guild_id=? AND user_id=? AND expires_at>? ORDER BY expires_at")
    .all(guildId, userId, now)
    .map((row) => ({ ...perkByKind(row.kind), kind: row.kind, expiresAt: Number(row.expires_at), payload: JSON.parse(row.payload_json) }));

/**
 * Buys a perk. Buying one already held extends it rather than wasting the
 * money, up to a month so nobody locks a colour in for a year.
 */
export function buyPerk({ guildId, userId, kind, payload = {}, now = Date.now() }) {
  const perk = perkByKind(kind);
  if (!perk) throw new Error("Cet avantage n'existe pas.");
  return transaction(() => {
    db.prepare("INSERT OR IGNORE INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,0,0)").run(guildId, userId);
    const paid = db.prepare("UPDATE wallets SET balance=balance-? WHERE guild_id=? AND user_id=? AND balance>=?")
      .run(perk.price, guildId, userId, perk.price);
    if (!Number(paid.changes)) throw new Error(`Il te faut ${perk.price.toLocaleString("fr-FR")} PND pour cet avantage.`);
    db.prepare("INSERT INTO economy_ledger(guild_id,user_id,delta,reason,created_at) VALUES(?,?,?,?,?)")
      .run(guildId, userId, -perk.price, `avantage_${kind}`, now);

    const current = Number(db.prepare("SELECT expires_at FROM fwu_perks WHERE guild_id=? AND user_id=? AND kind=?")
      .get(guildId, userId, kind)?.expires_at ?? 0);
    const from = Math.max(current, now);
    const expiresAt = Math.min(from + perk.durationMs, now + MAX_STACK_MS);
    db.prepare(`INSERT INTO fwu_perks(guild_id,user_id,kind,expires_at,payload_json,bought_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(guild_id,user_id,kind) DO UPDATE SET expires_at=excluded.expires_at,
      payload_json=excluded.payload_json, bought_at=excluded.bought_at`)
      .run(guildId, userId, kind, expiresAt, JSON.stringify(payload), now);
    return { perk, expiresAt, extended: current > now, spent: perk.price };
  });
}

/** Perks that just ran out, for the cascade to clean up after (roles, mostly). */
export function expirePerks(now = Date.now()) {
  const done = db.prepare("SELECT guild_id,user_id,kind,payload_json FROM fwu_perks WHERE expires_at<=?").all(now)
    .map((row) => ({ guildId: row.guild_id, userId: row.user_id, kind: row.kind, payload: JSON.parse(row.payload_json) }));
  if (done.length) db.prepare("DELETE FROM fwu_perks WHERE expires_at<=?").run(now);
  return done;
}

export const revokePerk = (guildId, userId, kind) =>
  Number(db.prepare("DELETE FROM fwu_perks WHERE guild_id=? AND user_id=? AND kind=?").run(guildId, userId, kind).changes);

/** Pure: how much XP a member actually earns, boost included. */
export const boostedXp = (amount, boosted) => (boosted ? Math.round(amount * XP_BOOST_FACTOR) : amount);

/** Pure: a six-digit hex colour, or null when it is not one. */
export function parseColour(value) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value ?? "").trim());
  return match ? Number.parseInt(match[1], 16) : null;
}

export const COLOUR_ROLE_PREFIX = "🎨";

/** Creates or updates the member's personal colour role, below the bot. */
export async function applyColourRole(member, colour, reason = "Avantage : couleur de pseudo") {
  const guild = member.guild;
  const me = guild.members.me;
  if (!me?.permissions?.has?.("ManageRoles")) throw new Error("Le bot n'a pas la permission de gérer les rôles.");
  const name = `${COLOUR_ROLE_PREFIX} ${member.user.username}`.slice(0, 90);
  // Le nom seul ne suffit pas (un pseudo peut imiter un autre rôle) : on ne réutilise qu'un rôle
  // sans aucune permission, non protégé, sous le bot et porté au plus par ce membre.
  const candidates = guild.roles.cache.filter((role) => role.name === name);
  let existing = null;
  for (const role of candidates.values()) {
    if (!(await isOwnColourRole(guild, role, member.id))) continue;
    existing = role;
    break;
  }
  if (existing) {
    await existing.setColors({ primaryColor: colour }, reason).catch(() => existing.edit({ colors: { primaryColor: colour } }, reason));
    if (!member.roles.cache.has(existing.id)) await member.roles.add(existing, reason);
    return existing;
  }
  const role = await guild.roles.create({
    name, colors: { primaryColor: colour }, permissions: [], reason,
    position: Math.max(1, me.roles.highest.position - 1),
  });
  await member.roles.add(role, reason);
  return role;
}

/** Rôle couleur réutilisable / supprimable : aucune permission, non protégé, sous le bot, porté seulement par ce membre. */
export async function isOwnColourRole(guild, role, memberId) {
  if (!role || role.managed || role.id === guild.id) return false;
  let bits = 0n;
  try { bits = BigInt(role.permissions?.bitfield ?? role.permissions ?? 0); } catch { return false; }
  if (bits !== 0n) return false;
  const me = guild.members?.me;
  if (me && role.position >= me.roles.highest.position) return false;
  const holders = [...(role.members?.keys?.() ?? [])];
  if (holders.some((id) => id !== memberId)) return false;
  return !(await roleGrantRefusal(guild, role, { automatic: true }));
}

/** Removes the colour role when the perk runs out. */
export async function removeColourRole(guild, userId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  const name = member ? `${COLOUR_ROLE_PREFIX} ${member.user.username}`.slice(0, 90) : null;
  let role = null;
  for (const candidate of (name ? guild.roles.cache.filter((r) => r.name === name) : new Map()).values()) {
    if (await isOwnColourRole(guild, candidate, userId)) { role = candidate; break; }
  }
  if (!role) return false;
  return role.delete("Avantage expiré : couleur de pseudo").then(() => true).catch(() => false);
}
