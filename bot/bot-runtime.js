// FWU multi-bot runtime: which application this process is, which domains it
// may handle right now, and how dedicated bots hand their logs to FWU.
//
// Every bot runs the same code from the same checkout and shares the same
// SQLite file (WAL + busy_timeout). Two rules prevent double processing:
//  1. A dedicated bot (GUARD, FDPDLAVOC, SUCK ME, LE FISC) holds a renewable
//     lease on its domain in SQLite. Only the lease holder handles that domain.
//  2. FWU (the historical application) handles every domain that has no live
//     lease. With no dedicated bot running it behaves exactly as before, and it
//     takes a domain back automatically if its dedicated bot stops.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { db, transaction } from "./database.js";
import { listGatewayFailures } from "./gateway-watchdog.js";

const sharedProfiles = new URL("../src/lib/bot-profiles.ts", import.meta.url);
const localProfiles = new URL("./bot-profiles.ts", import.meta.url);
const profilesModule = await import((existsSync(sharedProfiles) ? sharedProfiles : localProfiles).href);
export const {
  BOT_PROFILES,
  BOT_PROFILE_IDS,
  DEFAULT_PREFIXES,
  PREFIX_COMMAND_OWNERS,
  SHARED_SLASH_COMMANDS,
  isBotProfileId,
  parseDelegatedProfiles,
  prefixCommandOwner,
  slashCommandNamesDelegatedAway,
  slashCommandNamesForProfile,
  slashCommandNamesOwnedElsewhere,
  slashCommandOwner,
  parsePrefixedMessage,
  validatePrefixes,
} = profilesModule;

/** Commands replaced by another one: removed from every application. */
export const RETIRED_SLASH_COMMANDS = Object.freeze(["mute", "vocal-panel"]);

const LOCAL_BOTS_CONFIG = fileURLToPath(new URL("./config/bots.json", import.meta.url));

/** Where the prefix file is read: PND_BOTS_CONFIG, then the folder shared by the 5 bots, then bot/config. */
export function botsConfigPath(env = process.env) {
  if (String(env.PND_BOTS_CONFIG ?? "").trim()) return String(env.PND_BOTS_CONFIG).trim();
  const shared = String(env.PND_DATA_DIR ?? "").trim();
  if (shared && existsSync(join(shared, "bots.json"))) return join(shared, "bots.json");
  return LOCAL_BOTS_CONFIG;
}

/**
 * Prefix of every bot. The 5 bots must read the SAME file: put it in the shared
 * data folder (PND_DATA_DIR/bots.json). Missing file: defaults (bots.example.json).
 * Invalid file: the bot refuses to start.
 */
export function loadBotPrefixes(env = process.env) {
  const path = botsConfigPath(env);
  if (!existsSync(path)) return validatePrefixes(DEFAULT_PREFIXES);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${path} n'est pas un JSON valide.`);
  }
  return validatePrefixes(parsed?.prefixes ?? {});
}

export const LEASE_TTL_MS = 60_000;
export const LEASE_RENEW_MS = 20_000;
const RELAY_MAX_ROWS = 5_000;
// 24 h : un FWU arrêté une nuit ne fait plus perdre les logs des 4 autres bots.
const RELAY_MAX_AGE_MS = 24 * 60 * 60_000;
export const RELAY_MAX_ATTEMPTS = 3;
const RELAY_RETRY_BASE_MS = 30_000;

db.exec(`
  CREATE TABLE IF NOT EXISTS bot_domain_leases (
    domain TEXT PRIMARY KEY,
    holder TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    renewed_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bot_log_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    source_profile TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS bot_log_outbox_created_idx ON bot_log_outbox(created_at);
  CREATE TABLE IF NOT EXISTS bot_log_relay_losses (
    reason TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    last_at INTEGER
  );
`);
for (const column of ["attempts INTEGER NOT NULL DEFAULT 0", "next_try_at INTEGER NOT NULL DEFAULT 0"]) {
  try { db.exec(`ALTER TABLE bot_log_outbox ADD COLUMN ${column}`); } catch { /* déjà là */ }
}

export const RELAY_LOSS_LABELS = Object.freeze({
  trop_vieux: "plus de 24 h sans être publiés",
  file_pleine: "file pleine (plus de 5 000)",
  envoi_refuse: `non publiés après ${RELAY_MAX_ATTEMPTS} essais`,
  serveur_absent: "serveur d'origine inconnu de FWU",
});

/** Compte des logs relayés perdus, par raison (jamais leur contenu). */
export function countLostRelayedLogs(reason, n = 1, now = Date.now()) {
  if (!n) return;
  db.prepare(`INSERT INTO bot_log_relay_losses(reason, count, last_at) VALUES (?, ?, ?)
    ON CONFLICT(reason) DO UPDATE SET count = count + excluded.count, last_at = excluded.last_at`).run(String(reason), Number(n), now);
}

export function relayedLogLosses() {
  return db.prepare("SELECT reason, count, last_at AS lastAt FROM bot_log_relay_losses ORDER BY count DESC").all()
    .map((row) => ({ reason: row.reason, count: Number(row.count), lastAt: row.lastAt == null ? null : Number(row.lastAt) }));
}

/** Ligne du diagnostic : logs relayés perdus depuis toujours. */
export function formatRelayLossLine() {
  const losses = relayedLogLosses();
  const total = losses.reduce((sum, row) => sum + row.count, 0);
  if (!total) return "🟢 Logs relayés perdus : 0.";
  const last = Math.max(...losses.map((row) => row.lastAt ?? 0));
  return `🟧 Logs relayés perdus : ${total} (${losses.map((row) => `${row.count} ${RELAY_LOSS_LABELS[row.reason] ?? row.reason}`).join(", ")})${last ? `, dernier <t:${Math.floor(last / 1000)}:R>` : ""}.`;
}

/**
 * Resolve the process profile from the environment. Without PND_BOT_PROFILE the
 * process is FWU, the historical application, unchanged.
 */
export function resolveBotRuntime(env = process.env) {
  const raw = String(env.PND_BOT_PROFILE ?? "").trim().toLowerCase();
  const profile = raw || "fwu";
  if (!isBotProfileId(profile)) {
    throw new Error(`PND_BOT_PROFILE doit être l'un de : ${BOT_PROFILE_IDS.join(", ")}.`);
  }
  const config = BOT_PROFILES[profile];
  if (profile === "fwu") {
    return {
      profile,
      config,
      token: env.DISCORD_TOKEN ?? null,
      guildAllowlist: env.V4_ALLOWED_GUILD_IDS ?? "",
      delegated: parseDelegatedProfiles(env.PND_FWU_DELEGATED),
    };
  }
  const token = String(env[config.tokenEnv] ?? "").trim();
  if (!token) throw new Error(`${config.tokenEnv} est obligatoire pour démarrer ${config.label}.`);
  if (token === String(env.DISCORD_TOKEN ?? "").trim()) {
    throw new Error(`${config.tokenEnv} doit être le token d'une autre application que FWU.`);
  }
  return {
    profile,
    config,
    token,
    guildAllowlist: env[config.guildAllowlistEnv] || env.V4_ALLOWED_GUILD_IDS || "",
    delegated: [],
  };
}

export function claimDomainLease(domain, holder, now = Date.now(), ttlMs = LEASE_TTL_MS) {
  db.prepare(`
    INSERT INTO bot_domain_leases(domain, holder, expires_at, renewed_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(domain) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at, renewed_at = excluded.renewed_at
    WHERE bot_domain_leases.holder = excluded.holder OR bot_domain_leases.expires_at <= ?
  `).run(domain, holder, now + ttlMs, now, now);
  return db.prepare("SELECT holder FROM bot_domain_leases WHERE domain = ?").get(domain)?.holder === holder;
}

export function releaseDomainLease(domain, holder) {
  db.prepare("DELETE FROM bot_domain_leases WHERE domain = ? AND holder = ?").run(domain, holder);
}

export function liveDomainLease(domain, now = Date.now()) {
  const row = db.prepare("SELECT holder, expires_at FROM bot_domain_leases WHERE domain = ?").get(domain);
  return row && row.expires_at > now ? { holder: row.holder, expiresAt: row.expires_at } : null;
}

export function listDomainLeases(now = Date.now()) {
  return db.prepare("SELECT domain, holder, expires_at, renewed_at FROM bot_domain_leases ORDER BY domain").all()
    .map((row) => ({ domain: row.domain, holder: row.holder, live: row.expires_at > now, expiresAt: row.expires_at, renewedAt: row.renewed_at }));
}

/**
 * Domain gate for one process. `serves(domain)` is cheap (cached) and safe to
 * call on every event.
 */
export function createDomainGate({ profile, holder = `${profile}:${process.pid}:${randomUUID().slice(0, 8)}`, now = () => Date.now(), ttlMs = LEASE_TTL_MS, cacheMs = 2_000 } = {}) {
  if (!isBotProfileId(profile)) throw new Error(`Profil inconnu : ${profile}`);
  let held = false;
  const cache = new Map();

  function foreignLease(domain) {
    const at = now();
    const cached = cache.get(domain);
    if (cached && at - cached.at < cacheMs) return cached.value;
    let value = false;
    try {
      const lease = liveDomainLease(domain, at);
      value = Boolean(lease && lease.holder !== holder);
    } catch {
      value = false; // A read error must never silence FWU: it stays the fallback.
    }
    cache.set(domain, { at, value });
    return value;
  }

  return {
    profile,
    holder,
    get held() { return held; },
    /** Claim or renew this process's own domain lease (dedicated bots only). */
    tick() {
      if (profile === "fwu") return true;
      try { held = claimDomainLease(profile, holder, now(), ttlMs); } catch { held = false; }
      return held;
    },
    release() {
      if (profile === "fwu" || !held) return;
      try { releaseDomainLease(profile, holder); } catch { /* expires on its own */ }
      held = false;
    },
    serves(domain) {
      if (profile === "fwu") return domain === "fwu" || !foreignLease(domain);
      return domain === profile && held;
    },
    /** True when this process handles every domain: the historical single-bot mode. */
    servesAll() {
      return profile === "fwu" && BOT_PROFILE_IDS.every((domain) => domain === "fwu" || !foreignLease(domain));
    },
    forgetCache() { cache.clear(); },
  };
}

function toPlain(value) {
  if (value && typeof value.toJSON === "function") return value.toJSON();
  return value;
}

/** Dedicated bots hand their log embeds to FWU, which owns the Logs Hub. */
export function enqueueRelayedLog({ guildId, sourceProfile, embed, fallbackChannelIds = [], components = [], allowedUserIds = [] }, now = Date.now()) {
  if (!guildId || !embed) return false;
  const payload = JSON.stringify({
    embed: toPlain(embed),
    fallbackChannelIds: fallbackChannelIds.filter(Boolean).slice(0, 5),
    components: components.map(toPlain).slice(0, 5),
    allowedUserIds: allowedUserIds.filter(Boolean).slice(0, 10),
  });
  transaction(() => {
    db.prepare("INSERT INTO bot_log_outbox(guild_id, source_profile, payload, created_at) VALUES (?, ?, ?, ?)")
      .run(String(guildId), String(sourceProfile), payload, now);
    const old = db.prepare("DELETE FROM bot_log_outbox WHERE created_at < ?").run(now - RELAY_MAX_AGE_MS);
    countLostRelayedLogs("trop_vieux", Number(old?.changes ?? 0), now);
    const overflow = db.prepare(`DELETE FROM bot_log_outbox WHERE id <= (SELECT id FROM bot_log_outbox ORDER BY id DESC LIMIT 1 OFFSET ${RELAY_MAX_ROWS})`).run();
    countLostRelayedLogs("file_pleine", Number(overflow?.changes ?? 0), now);
  });
  return true;
}

/**
 * Remet en file un log que FWU n'a pas pu publier (limite de débit, panne Discord).
 * Nouvel essai après 30 s puis 60 s ; au 3e échec il est compté comme perdu.
 */
export function requeueRelayedLog(item, now = Date.now()) {
  const attempts = Number(item?.attempts ?? 0) + 1;
  if (!item?.guildId || attempts >= RELAY_MAX_ATTEMPTS) {
    countLostRelayedLogs("envoi_refuse", 1, now);
    return false;
  }
  const payload = JSON.stringify({
    embed: item.embed,
    fallbackChannelIds: item.fallbackChannelIds ?? [],
    components: item.components ?? [],
    allowedUserIds: item.allowedUserIds ?? [],
  });
  db.prepare("INSERT INTO bot_log_outbox(guild_id, source_profile, payload, created_at, attempts, next_try_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(String(item.guildId), String(item.sourceProfile ?? "fwu"), payload, Number(item.createdAt ?? now), attempts, now + RELAY_RETRY_BASE_MS * 2 ** (attempts - 1));
  return true;
}

/**
 * Take (and delete) the oldest relayed logs that are due. Rows are removed before
 * sending; a failed send goes back with requeueRelayedLog (3 tries at most).
 */
export function takeRelayedLogs(limit = 25, now = Date.now()) {
  return transaction(() => {
    const rows = db.prepare("SELECT id, guild_id, source_profile, payload, created_at, attempts FROM bot_log_outbox WHERE next_try_at <= ? ORDER BY id LIMIT ?").all(now, limit);
    const remove = db.prepare("DELETE FROM bot_log_outbox WHERE id = ?");
    for (const row of rows) remove.run(row.id);
    return rows.flatMap((row) => {
      try {
        return [{ id: row.id, guildId: row.guild_id, sourceProfile: row.source_profile, createdAt: row.created_at, attempts: Number(row.attempts ?? 0), ...JSON.parse(row.payload) }];
      } catch {
        return [];
      }
    });
  });
}

/** Commands this application must register, and the ones it must remove (owned by another bot or retired). */
export function slashRegistrationPlan(runtime, catalog, extras = [], maxRoot = 100) {
  const wanted = new Set(slashCommandNamesForProfile(runtime.profile));
  const register = [];
  const skipped = [];
  for (const command of [...catalog, ...extras]) {
    if (!wanted.has(command.name) || register.includes(command)) continue;
    if (register.length >= maxRoot) skipped.push(command.name);
    else register.push(command);
  }
  const retire = [...new Set([...slashCommandNamesOwnedElsewhere(runtime.profile), ...RETIRED_SLASH_COMMANDS])];
  return { register, retire, skipped };
}

export function pendingRelayedLogs() {
  return Number(db.prepare("SELECT COUNT(*) AS n FROM bot_log_outbox").get()?.n ?? 0);
}

/** Read-only overview for /sysp diagnostic bots. */
export function formatBotsDiagnostic(now = Date.now()) {
  const leases = new Map(listDomainLeases(now).map((lease) => [lease.domain, lease]));
  const lines = ["**Bots FWU — qui traite quoi en ce moment** (lecture seule)"];
  for (const id of BOT_PROFILE_IDS) {
    const profile = BOT_PROFILES[id];
    if (id === "fwu") {
      lines.push(`🟢 **${profile.label}** — ${profile.summary}`);
      continue;
    }
    const lease = leases.get(id);
    const optional = profile.optional ? " (facultatif)" : "";
    lines.push(lease?.live
      ? `🟢 **${profile.label}**${optional} — en ligne, renouvelé <t:${Math.floor(lease.renewedAt / 1000)}:R>`
      : profile.optional
        ? `⚪ **${profile.label}**${optional} — non démarré : aucun domaine Invest + actif pour le moment.`
        : `⚪ **${profile.label}** — non démarré ou arrêté : **FWU reprend les événements de ce domaine**${lease ? ` (dernier signe <t:${Math.floor(lease.renewedAt / 1000)}:R>)` : ""}. Les commandes propres à ce bot restent indisponibles.`);
  }
  // Connection failures recorded by the silent-crash guard (bot/gateway-watchdog.js).
  let failures = [];
  try { failures = listGatewayFailures(db); } catch { /* diagnostic only */ }
  for (const failure of failures) {
    const label = BOT_PROFILES[failure.profile]?.label ?? failure.profile;
    lines.push(failure.stopped
      ? `🔴 **${label}** — arrêté après ${failure.failures} échecs de connexion à Discord (${failure.reason}) <t:${Math.floor(failure.at / 1000)}:R>. Corrige le token ou les intents, puis \`pm2 restart\`.`
      : `🟠 **${label}** — ${failure.failures} échec(s) de connexion à Discord (${failure.reason}) <t:${Math.floor(failure.at / 1000)}:R>, nouvel essai en cours.`);
  }
  const pending = pendingRelayedLogs();
  lines.push(pending > 50 ? `🟧 ${pending} logs en attente de publication par FWU : vérifie que FWU est en ligne.` : `🟢 Logs relayés en attente : ${pending}.`);
  return lines.join("\n");
}
