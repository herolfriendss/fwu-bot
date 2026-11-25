// FWU — quotas de modération partagés entre les 5 bots.
//
// Une commande de modération consomme un usage AVANT d'agir sur Discord :
//   const decision = await consumeQuota({...});
//   if (!decision.allowed) → refuser avec formatQuotaRefusal(decision)
//   … action Discord … ; en cas d'échec : await refundQuota(decision.usageId)
//
// Atomicité : chaque (serveur, membre, commande) est sérialisé par un verrou
// consultatif transactionnel PostgreSQL. Deux commandes simultanées, même
// envoyées par deux bots différents, ne peuvent donc pas dépasser la limite.
// L'heure de référence est celle de la base (now()), commune à tous les bots.
import { isConnectionError, SharedDbUnavailableError, sharedDbAvailable, sharedQuery, sharedTransaction } from "./db.js";
import { logQuotaViolation } from "./audit.js";
import { MODERATION_TIERS, TIER_LABELS, canUseModeration } from "./tiers.js";
import { getStaffFreeze } from "./freeze.js";

/** Commandes soumises aux quotas, quel que soit le bot. */
export const QUOTA_COMMANDS = Object.freeze(["tempmute", "unmute", "warn", "kick", "ban", "unban", "blacklist", "mv"]);

export function isQuotaCommand(command) {
  return QUOTA_COMMANDS.includes(String(command));
}

export function formatDurationFr(totalSeconds) {
  const seconds = Math.max(0, Math.ceil(Number(totalSeconds) || 0));
  if (seconds < 60) return `${seconds} s`;
  const totalMinutes = Math.ceil(seconds / 60);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days} j`);
  if (hours) parts.push(`${hours} h`);
  if (minutes) parts.push(`${minutes} min`);
  return parts.join(" ");
}

/** Message de refus clair pour l'utilisateur. */
export function formatQuotaRefusal(decision, command) {
  const name = `\`${command}\``;
  switch (decision.reason) {
    case "quota":
      return `⏳ Quota atteint pour ${name} : **${decision.maxUses} / ${formatDurationFr(decision.windowSeconds)}** (${TIER_LABELS[decision.tier] ?? "ton rôle"}). Réessaie dans **${formatDurationFr(decision.retryAfterSeconds)}**.`;
    case "no_access":
      return "⛔ Ton rôle n'a pas accès aux commandes de modération (palier 50 % minimum).";
    case "command_forbidden":
      return `⛔ Ton rôle (${TIER_LABELS[decision.tier] ?? "inconnu"}) n'a pas accès à ${name}.`;
    case "not_configured":
      return `⛔ Aucun quota n'est configuré pour ${name} et ton rôle : commande refusée par sécurité.`;
    case "bot_not_whitelisted":
      return "⛔ Ce bot n'est pas dans la whitelist des quotas.";
    case "frozen":
      return `🧊 Le staff est **gelé** par l'owner jusqu'à <t:${Math.floor(Number(decision.until) / 1000)}:t> (<t:${Math.floor(Number(decision.until) / 1000)}:R>) : commandes de modération suspendues sur les 5 bots.`;
    case "unavailable":
      return "🛑 La base centrale des quotas est injoignable : commande refusée par sécurité. Réessaie dans un instant.";
    default:
      return "⛔ Commande refusée.";
  }
}

async function isExempt(guildId, userId) {
  const { rows } = await sharedQuery("SELECT 1 FROM quota_exemptions WHERE guild_id = $1 AND user_id = $2", [guildId, userId]);
  return rows.length > 0;
}

export async function isWhitelistedBot(guildId, botId) {
  const { rows } = await sharedQuery("SELECT 1 FROM bot_whitelist WHERE guild_id = $1 AND bot_id = $2", [guildId, botId]);
  return rows.length > 0;
}

async function quotaRow(client, guildId, command, tier) {
  const { rows } = await client.query(
    `SELECT guild_id, max_uses, window_seconds FROM quotas
     WHERE guild_id IN ($1, '*') AND command = $2 AND tier = $3
     ORDER BY (guild_id = '*') ASC LIMIT 1`,
    [guildId, command, tier],
  );
  return rows[0] ?? null;
}

/**
 * Check and consume one use. Never throws for a refusal; throws
 * SharedDbUnavailableError only through `decision.reason === "unavailable"`
 * (returned, not thrown) so every caller fails closed the same way.
 *
 * @param {{ guildId: string, userId: string, command: string, tier: number|null, bot: string, isBot?: boolean }} input
 */
export async function consumeQuota({ guildId, userId, command, tier, bot, isBot = false }) {
  if (!isQuotaCommand(command)) throw new Error(`Commande sans quota : ${command}`);
  // Owner (0 %) : exempté de tout, même base injoignable.
  if (tier === 0 && !isBot) return { allowed: true, exempt: "owner" };
  try {
    if (!sharedDbAvailable()) throw new SharedDbUnavailableError();
    if (isBot) {
      return (await isWhitelistedBot(guildId, userId))
        ? { allowed: true, exempt: "bot_whitelist" }
        : { allowed: false, reason: "bot_not_whitelisted" };
    }
    if (await isExempt(guildId, userId)) return { allowed: true, exempt: "user_exemption" };
    if (!canUseModeration(tier)) return { allowed: false, reason: "no_access", tier };
    // Gel d'urgence : tout le staff (hors owner et exemptés) à 0, sur les 5 bots.
    const freeze = await getStaffFreeze(guildId);
    if (freeze) return { allowed: false, reason: "frozen", tier, until: freeze.until };

    const decision = await sharedTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`quota:${guildId}:${userId}:${command}`]);
      const row = await quotaRow(client, guildId, command, tier);
      if (!row) return { allowed: false, reason: "not_configured", tier };
      const windowSeconds = Number(row.window_seconds);
      const maxUses = row.max_uses == null ? null : Number(row.max_uses);
      if (maxUses === 0) return { allowed: false, reason: "command_forbidden", tier, maxUses, windowSeconds };
      if (maxUses != null) {
        const { rows } = await client.query(
          `SELECT used_at, EXTRACT(EPOCH FROM (used_at + make_interval(secs => $4) - now())) AS remaining
           FROM quota_usage
           WHERE guild_id = $1 AND user_id = $2 AND command = $3 AND refunded = false
             AND used_at > now() - make_interval(secs => $4)
           ORDER BY used_at DESC`,
          [guildId, userId, command, windowSeconds],
        );
        if (rows.length >= maxUses) {
          // The slot frees up when the oldest use still counting leaves the window.
          const freeing = rows[maxUses - 1];
          const retryAfterSeconds = Math.max(1, Math.ceil(Number(freeing.remaining)));
          return { allowed: false, reason: "quota", tier, maxUses, windowSeconds, used: rows.length, retryAfterSeconds };
        }
      }
      const inserted = await client.query(
        "INSERT INTO quota_usage(guild_id, user_id, command, bot) VALUES ($1, $2, $3, $4) RETURNING id",
        [guildId, userId, command, bot],
      );
      return { allowed: true, usageId: String(inserted.rows[0].id), tier, maxUses, windowSeconds };
    });
    if (!decision.allowed && decision.reason === "quota") {
      await logQuotaViolation({
        guildId, userId, bot, command, tier,
        maxUses: decision.maxUses, windowSeconds: decision.windowSeconds, retryAfterSeconds: decision.retryAfterSeconds,
      });
    }
    return decision;
  } catch (error) {
    if (isConnectionError(error)) return { allowed: false, reason: "unavailable" };
    throw error;
  }
}

/**
 * Lecture seule pour /quota moi : ce qu'il reste à un membre, commande par commande.
 * Ne consomme rien. Renvoie { exempt } ou { tier, rows: [{ command, maxUses, windowSeconds, used, retryAfterSeconds }] }.
 */
export async function quotaStatusForUser({ guildId, userId, tier }) {
  if (tier === 0) return { exempt: "owner" };
  if (!sharedDbAvailable()) throw new SharedDbUnavailableError();
  if (await isExempt(guildId, userId)) return { exempt: "user_exemption" };
  if (!canUseModeration(tier)) return { tier, rows: [] };
  const rows = [];
  for (const command of QUOTA_COMMANDS) {
    const row = await quotaRow({ query: sharedQuery }, guildId, command, tier);
    if (!row) { rows.push({ command, maxUses: 0, windowSeconds: null, used: 0, retryAfterSeconds: null }); continue; }
    const windowSeconds = Number(row.window_seconds);
    const maxUses = row.max_uses == null ? null : Number(row.max_uses);
    const { rows: uses } = await sharedQuery(
      `SELECT EXTRACT(EPOCH FROM (used_at + make_interval(secs => $4) - now())) AS remaining
       FROM quota_usage
       WHERE guild_id = $1 AND user_id = $2 AND command = $3 AND refunded = false
         AND used_at > now() - make_interval(secs => $4)
       ORDER BY used_at DESC`,
      [guildId, userId, command, windowSeconds],
    );
    const used = uses.length;
    // Comme consumeQuota : la place se libère quand le plus ancien usage encore compté sort de la fenêtre.
    const retryAfterSeconds = maxUses != null && maxUses > 0 && used >= maxUses ? Math.max(1, Math.ceil(Number(uses[maxUses - 1].remaining))) : null;
    rows.push({ command, maxUses, windowSeconds, used, retryAfterSeconds });
  }
  return { tier, rows };
}

/** Pur : texte de /quota moi. */
export function formatQuotaStatus(status, tierLabel = "") {
  if (status.exempt === "owner") return "♾️ Tu es l'owner : aucune limite.";
  if (status.exempt) return "♾️ Tu as une exemption de quota sur ce serveur : aucune limite.";
  if (!status.rows.length) return "⛔ Tu n'as pas de palier de modération : aucune commande à quota.";
  const lines = status.rows.map(({ command, maxUses, windowSeconds, used, retryAfterSeconds }) => {
    if (maxUses === 0) return `• \`${command}\` : ⛔ non autorisée à ton palier`;
    if (maxUses == null) return `• \`${command}\` : illimitée`;
    const left = Math.max(0, maxUses - used);
    const per = `/ ${formatDurationFr(windowSeconds)}`;
    return left > 0
      ? `• \`${command}\` : ✅ **${left}** restant${left > 1 ? "s" : ""} (${used}/${maxUses} ${per})`
      : `• \`${command}\` : ⏳ **0** restant (${used}/${maxUses} ${per}), prochain dans **${formatDurationFr(retryAfterSeconds)}**`;
  });
  return `🎚️ **Tes quotas** ${tierLabel ? `(palier ${tierLabel})` : ""}, partagés entre les 5 bots\n${lines.join("\n")}`;
}

/** Give back a use when the Discord action failed after consumption. */
export async function refundQuota(usageId) {
  if (!usageId) return false;
  try {
    const result = await sharedQuery("UPDATE quota_usage SET refunded = true WHERE id = $1 AND refunded = false", [usageId]);
    return result.rowCount === 1;
  } catch {
    return false; // At worst the moderator loses one use: never more than the limit.
  }
}

// ── Configuration (owner uniquement : vérifié par l'appelant ET ici) ─────────

function assertOwner(actorId, owner) {
  if (!owner || actorId !== owner) throw new Error("Seul l'owner peut modifier les quotas, la whitelist et les exemptions.");
}

async function logChange(client, { guildId, actorId, bot, entity, key, before, after }) {
  await client.query(
    `INSERT INTO config_changes(guild_id, actor_id, bot, entity, entity_key, before, after) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [guildId, actorId, bot, entity, key, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after)],
  );
}

/** Effective quotas for a guild: its own rows, or the defaults ('*'). */
export async function listQuotas(guildId) {
  const { rows } = await sharedQuery(
    `SELECT DISTINCT ON (command, tier) command, tier, max_uses, window_seconds, guild_id
     FROM quotas WHERE guild_id IN ($1, '*')
     ORDER BY command, tier, (guild_id = '*') ASC`,
    [guildId],
  );
  return rows.map((row) => ({
    command: row.command, tier: Number(row.tier),
    maxUses: row.max_uses == null ? null : Number(row.max_uses),
    windowSeconds: Number(row.window_seconds), isDefault: row.guild_id === "*",
  }));
}

export async function setQuota({ guildId, command, tier, maxUses, windowSeconds, actorId, owner, bot }) {
  assertOwner(actorId, owner);
  if (!isQuotaCommand(command)) throw new Error(`Commande inconnue : ${command}. Commandes : ${QUOTA_COMMANDS.join(", ")}.`);
  if (!MODERATION_TIERS.includes(Number(tier))) throw new Error("Palier invalide : 1, 5, 10 ou 50 (le 0 % est toujours illimité).");
  if (maxUses != null && (!Number.isInteger(maxUses) || maxUses < 0 || maxUses > 10_000)) throw new Error("Valeur invalide (0 à 10 000, ou illimité).");
  if (!Number.isInteger(windowSeconds) || windowSeconds < 60 || windowSeconds > 2_592_000) throw new Error("Fenêtre invalide (1 min à 30 jours).");
  return sharedTransaction(async (client) => {
    const before = await quotaRow(client, guildId, command, tier);
    await client.query(
      `INSERT INTO quotas(guild_id, command, tier, max_uses, window_seconds, updated_by) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (guild_id, command, tier) DO UPDATE SET max_uses = excluded.max_uses, window_seconds = excluded.window_seconds,
         updated_by = excluded.updated_by, updated_at = now()`,
      [guildId, command, tier, maxUses, windowSeconds, actorId],
    );
    const beforeValue = before ? { maxUses: before.max_uses == null ? null : Number(before.max_uses), windowSeconds: Number(before.window_seconds), isDefault: before.guild_id === "*" } : null;
    const afterValue = { maxUses, windowSeconds };
    await logChange(client, { guildId, actorId, bot, entity: "quota", key: `${command}:${tier}`, before: beforeValue, after: afterValue });
    return { before: beforeValue, after: afterValue };
  });
}

/** Remove the guild's own value: the default applies again. */
export async function resetQuota({ guildId, command, tier, actorId, owner, bot }) {
  assertOwner(actorId, owner);
  return sharedTransaction(async (client) => {
    const { rows } = await client.query("DELETE FROM quotas WHERE guild_id = $1 AND command = $2 AND tier = $3 RETURNING max_uses, window_seconds", [guildId, command, tier]);
    if (!rows.length) return { changed: false };
    const before = { maxUses: rows[0].max_uses == null ? null : Number(rows[0].max_uses), windowSeconds: Number(rows[0].window_seconds) };
    await logChange(client, { guildId, actorId, bot, entity: "quota", key: `${command}:${tier}`, before, after: { reset: "default" } });
    return { changed: true, before };
  });
}

export async function addExemption({ guildId, userId, reason = "", actorId, owner, bot }) {
  assertOwner(actorId, owner);
  return sharedTransaction(async (client) => {
    const { rowCount } = await client.query(
      "INSERT INTO quota_exemptions(guild_id, user_id, reason, added_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
      [guildId, userId, String(reason).slice(0, 200), actorId],
    );
    if (rowCount) await logChange(client, { guildId, actorId, bot, entity: "quota_exemption", key: userId, before: null, after: { exempt: true, reason } });
    return { changed: rowCount === 1 };
  });
}

export async function removeExemption({ guildId, userId, actorId, owner, bot }) {
  assertOwner(actorId, owner);
  return sharedTransaction(async (client) => {
    const { rows } = await client.query("DELETE FROM quota_exemptions WHERE guild_id = $1 AND user_id = $2 RETURNING reason", [guildId, userId]);
    if (rows.length) await logChange(client, { guildId, actorId, bot, entity: "quota_exemption", key: userId, before: { exempt: true, reason: rows[0].reason }, after: null });
    return { changed: rows.length === 1 };
  });
}

export async function listExemptions(guildId) {
  const { rows } = await sharedQuery("SELECT user_id, reason, added_by, added_at FROM quota_exemptions WHERE guild_id = $1 ORDER BY added_at", [guildId]);
  return rows.map((row) => ({ userId: row.user_id, reason: row.reason, addedBy: row.added_by, addedAt: row.added_at }));
}

export async function addWhitelistedBot({ guildId, botId, actorId, owner, bot }) {
  assertOwner(actorId, owner);
  return sharedTransaction(async (client) => {
    const { rowCount } = await client.query("INSERT INTO bot_whitelist(guild_id, bot_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [guildId, botId, actorId]);
    if (rowCount) await logChange(client, { guildId, actorId, bot, entity: "bot_whitelist", key: botId, before: null, after: { whitelisted: true } });
    return { changed: rowCount === 1 };
  });
}

export async function removeWhitelistedBot({ guildId, botId, actorId, owner, bot }) {
  assertOwner(actorId, owner);
  return sharedTransaction(async (client) => {
    const { rowCount } = await client.query("DELETE FROM bot_whitelist WHERE guild_id = $1 AND bot_id = $2", [guildId, botId]);
    if (rowCount) await logChange(client, { guildId, actorId, bot, entity: "bot_whitelist", key: botId, before: { whitelisted: true }, after: null });
    return { changed: rowCount === 1 };
  });
}

export async function listWhitelistedBots(guildId) {
  const { rows } = await sharedQuery("SELECT bot_id, added_by, added_at FROM bot_whitelist WHERE guild_id = $1 ORDER BY added_at", [guildId]);
  return rows.map((row) => ({ botId: row.bot_id, addedBy: row.added_by, addedAt: row.added_at }));
}

export async function recentConfigChanges(guildId, limit = 10) {
  const { rows } = await sharedQuery(
    "SELECT actor_id, bot, entity, entity_key, before, after, created_at FROM config_changes WHERE guild_id = $1 ORDER BY id DESC LIMIT $2",
    [guildId, Math.min(25, Math.max(1, limit))],
  );
  return rows;
}
