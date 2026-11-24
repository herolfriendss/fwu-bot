// FWU — paliers de rôles (0 % = owner … 100 % = tous les membres).
// Plus le palier est petit, plus le rôle est haut placé.
//
// Résolution, du plus fort au plus faible :
//  1. l'owner configuré (PND_OWNER_DISCORD_ID) est toujours au palier 0 ;
//  2. association explicite rôle → palier en base (commande /quota palier) ;
//  3. à défaut, un rôle nommé « 10% », « 10 % » ou « 10% Modérateur » est reconnu tout seul.
// Le membre prend le palier le plus fort (le plus petit) parmi ses rôles.
import { parsePndOwnerId } from "../pnd-owner-policy.js";
import { sharedQuery, sharedTransaction } from "./db.js";

export const TIERS = Object.freeze([0, 1, 5, 10, 50, 70, 80, 100]);
export const MODERATION_TIERS = Object.freeze([1, 5, 10, 50]);
export const TIER_LABELS = Object.freeze({
  0: "0 % · Owner",
  1: "1 % · All Access",
  5: "5 % · Administrateur",
  10: "10 % · Modérateur",
  50: "50 % · Modérateur test",
  70: "70 %",
  80: "80 %",
  100: "100 %",
});

export function isTier(value) {
  return TIERS.includes(Number(value));
}

/**
 * Palier lu dans le nom d'un rôle, ou null. Le palier 0 (pouvoirs de l'owner)
 * n'est JAMAIS déduit d'un nom : seulement de PND_OWNER_DISCORD_ID ou d'une
 * association explicite faite par l'owner (/quota palier).
 */
export function tierFromRoleName(name) {
  const match = /(?:^|[\s|·\-[(])(1|5|10|50|70|80|100)\s?%(?=$|[\s|·\-\])])/u.exec(String(name ?? "").trim());
  return match ? Number(match[1]) : null;
}

export function ownerId(env = process.env) {
  return parsePndOwnerId(env.PND_OWNER_DISCORD_ID);
}

/**
 * Pure resolution. `roles` = [{ id, name }], `explicit` = Map(roleId → tier).
 * Returns the member's tier, or null (no tier: no moderation access).
 */
export function resolveTier({ userId, roles = [], explicit = new Map(), owner = null }) {
  if (owner && userId === owner) return 0;
  let best = null;
  for (const role of roles) {
    const tier = explicit.has(role.id) ? explicit.get(role.id) : tierFromRoleName(role.name);
    if (tier == null) continue;
    if (best == null || tier < best) best = tier;
  }
  return best;
}

export function canUseModeration(tier) {
  return tier === 0 || MODERATION_TIERS.includes(tier);
}

const cache = new Map(); // guildId → { at, map }
const CACHE_MS = 30_000;

export function forgetTierCache(guildId = null) {
  if (guildId) cache.delete(guildId); else cache.clear();
}

/** Explicit role → tier mapping for a guild (cached 30 s; stale cache kept if the DB is down). */
export async function loadRoleTiers(guildId) {
  const cached = cache.get(guildId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.map;
  try {
    const { rows } = await sharedQuery("SELECT role_id, tier FROM role_tiers WHERE guild_id = $1", [guildId]);
    const map = new Map(rows.map((row) => [row.role_id, Number(row.tier)]));
    cache.set(guildId, { at: Date.now(), map });
    return map;
  } catch {
    return cached?.map ?? new Map();
  }
}

function memberRoles(member) {
  const collection = member?.roles?.cache;
  if (!collection) return [];
  return [...collection.values()].map((role) => ({ id: role.id, name: role.name }));
}

/** Tier of a discord.js GuildMember. */
export async function memberTier(member, env = process.env) {
  if (!member?.guild) return null;
  const explicit = await loadRoleTiers(member.guild.id);
  return resolveTier({ userId: member.id, roles: memberRoles(member), explicit, owner: ownerId(env) });
}

export async function listRoleTiers(guildId) {
  const { rows } = await sharedQuery("SELECT role_id, tier, updated_by, updated_at FROM role_tiers WHERE guild_id = $1 ORDER BY tier, role_id", [guildId]);
  return rows.map((row) => ({ roleId: row.role_id, tier: Number(row.tier), updatedBy: row.updated_by, updatedAt: row.updated_at }));
}

/** Set (tier) or remove (tier = null) an explicit mapping. Logged in config_changes. */
export async function setRoleTier({ guildId, roleId, tier, actorId, bot }) {
  if (tier != null && !isTier(tier)) throw new Error("Palier invalide (0, 1, 5, 10, 50, 70, 80 ou 100).");
  const result = await sharedTransaction(async (client) => {
    const before = (await client.query("SELECT tier FROM role_tiers WHERE guild_id = $1 AND role_id = $2 FOR UPDATE", [guildId, roleId])).rows[0] ?? null;
    if (tier == null) await client.query("DELETE FROM role_tiers WHERE guild_id = $1 AND role_id = $2", [guildId, roleId]);
    else await client.query(`INSERT INTO role_tiers(guild_id, role_id, tier, updated_by) VALUES ($1, $2, $3, $4)
      ON CONFLICT (guild_id, role_id) DO UPDATE SET tier = excluded.tier, updated_by = excluded.updated_by, updated_at = now()`, [guildId, roleId, tier, actorId]);
    const after = tier == null ? null : { tier };
    await client.query(`INSERT INTO config_changes(guild_id, actor_id, bot, entity, entity_key, before, after) VALUES ($1, $2, $3, 'role_tier', $4, $5, $6)`,
      [guildId, actorId, bot, roleId, before ? JSON.stringify({ tier: Number(before.tier) }) : null, after ? JSON.stringify(after) : null]);
    return { before: before ? Number(before.tier) : null, after: tier };
  });
  forgetTierCache(guildId);
  return result;
}
