import { createHash } from "node:crypto";
import { db, transaction } from "./database.js";
import { authorize } from "./platform/policy/authorize.js";
import { isConfiguredPndOwner } from "./pnd-owner-policy.js";
import { recordSysPlusAudit } from "./systems/sysplus/audit.js";

/**
 * PND Marketplace — secure architecture (V5 PND_V5_FEATURES "Marketplace / Extensions").
 *
 * Specification
 *  1. Disabled by default. Enabling needs MARKETPLACE_ENABLED=true AND the
 *     `marketplace` + `extensions` entitlements on the guild.
 *  2. Catalogue: entries are created and withdrawn only by the single PND owner.
 *  3. Versions: a manifest is validated (schema, size, permissions, forbidden
 *     keys) and stays `pending` until the PND owner validates it. Only validated,
 *     listed versions can be installed.
 *  4. Permissions are DECLARED intents from a closed catalogue. Anything else,
 *     including administrative, moderation, role, economy or secret access, is
 *     refused at validation time and can never be granted.
 *  5. Installation is a SYS+ action with explicit consent: the first call returns
 *     the permission list, the second call with confirmed=true installs. Updates
 *     that change permissions require a new consent.
 *  6. Rollback returns to the previously installed validated version. Uninstall
 *     keeps the row as history. Every action is written to the guild audit.
 *  7. NO RUNTIME. This module stores and checks declarative manifests only. No
 *     code from an extension is loaded or executed. An execution layer would need
 *     its own reviewed specification and sandbox before any extension could run.
 */

export const MARKET_PERMISSIONS = Object.freeze({
  "channels.read.names": "Lire les noms des salons publics",
  "announcements.post": "Publier des annonces via Creator Studio",
  "members.read.counts": "Lire le nombre de membres (agrégé)",
});
// Anything here is never grantable, whatever the manifest declares.
export const FORBIDDEN_PERMISSION_HINTS = Object.freeze([
  "admin", "role", "ban", "kick", "mute", "guild", "webhook", "secret", "token", "economy", "owner", "entitlement", "channel.delete",
]);
const FORBIDDEN_MANIFEST_KEYS = Object.freeze(["code", "script", "entry", "eval", "exec", "url", "hooks", "handler", "wasm", "binary"]);
const MAX_MANIFEST_BYTES = 16_000;
const SEMVER = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{2,39}$/;

export function marketplaceEnabled(env = process.env) {
  return env.MARKETPLACE_ENABLED === "true";
}

/** Validates a declarative manifest. Returns the normalized manifest and its hash. */
export function validateManifest(raw) {
  let text;
  if (typeof raw === "string") text = raw;
  else text = JSON.stringify(raw ?? null);
  if (Buffer.byteLength(text, "utf8") > MAX_MANIFEST_BYTES) throw new Error("Manifeste trop volumineux (16 Ko maximum).");
  let manifest;
  try { manifest = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { throw new Error("Manifeste JSON invalide."); }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Le manifeste doit être un objet.");
  for (const key of Object.keys(manifest)) {
    if (FORBIDDEN_MANIFEST_KEYS.includes(key.toLowerCase())) throw new Error(`Clé interdite dans le manifeste : ${key}. Les extensions ne contiennent aucun code exécutable.`);
  }
  if (typeof manifest.id !== "string" || !SLUG.test(manifest.id)) throw new Error("Identifiant d'extension invalide (slug de 3 à 40 caractères).");
  if (typeof manifest.version !== "string" || !SEMVER.test(manifest.version)) throw new Error("Version invalide (format x.y.z).");
  const name = String(manifest.name ?? "").trim().slice(0, 80);
  if (name.length < 2) throw new Error("Nom d'extension requis (2 caractères minimum).");
  const summary = String(manifest.summary ?? "").trim().slice(0, 200);
  const requested = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  if (requested.length > 10) throw new Error("Trop de permissions demandées (10 maximum).");
  for (const permission of requested) {
    if (typeof permission !== "string") throw new Error("Permission invalide.");
    const lower = permission.toLowerCase();
    if (FORBIDDEN_PERMISSION_HINTS.some((hint) => lower.includes(hint))) throw new Error(`Permission jamais accordable : ${permission}.`);
    if (!Object.hasOwn(MARKET_PERMISSIONS, permission)) throw new Error(`Permission inconnue : ${permission}.`);
  }
  const permissions = [...new Set(requested)].sort();
  const normalized = { id: manifest.id, version: manifest.version, name, summary, permissions };
  return { manifest: normalized, sha256: createHash("sha256").update(JSON.stringify(normalized)).digest("hex") };
}

function requireOwner(actorId, configuredOwners, guildId) {
  if (!isConfiguredPndOwner(actorId, configuredOwners, guildId)) throw new Error("Réservé au propriétaire PND configuré.");
}

export function publishCatalogEntry({ guildId, actorId, configuredOwners, id, name, summary, publisher, now = Date.now() }) {
  requireOwner(actorId, configuredOwners, guildId);
  if (!SLUG.test(String(id ?? ""))) throw new Error("Identifiant invalide (slug de 3 à 40 caractères).");
  const existing = db.prepare("SELECT extension_id FROM market_extensions WHERE extension_id=?").get(id);
  if (existing) throw new Error("Cette extension existe déjà au catalogue.");
  db.prepare("INSERT INTO market_extensions(extension_id,name,summary,publisher,status,created_at) VALUES(?,?,?,?,?,?)")
    .run(id, String(name).slice(0, 80), String(summary ?? "").slice(0, 200), String(publisher ?? "PND").slice(0, 80), "listed", now);
  recordSysPlusAudit(guildId, actorId, "market.catalog.add", id, { name });
  return { id, status: "listed" };
}

export function withdrawCatalogEntry({ guildId, actorId, configuredOwners, id, now = Date.now() }) {
  requireOwner(actorId, configuredOwners, guildId);
  const row = db.prepare("SELECT * FROM market_extensions WHERE extension_id=?").get(id);
  if (!row) throw new Error("Extension introuvable.");
  db.prepare("UPDATE market_extensions SET status='withdrawn' WHERE extension_id=?").run(id);
  recordSysPlusAudit(guildId, actorId, "market.catalog.withdraw", id, null);
  return { id, status: "withdrawn", at: now };
}

/** Adds a manifest as pending. Validation happens here, never at install time only. */
export function submitVersion({ guildId, actorId, configuredOwners, extensionId, manifest, now = Date.now() }) {
  requireOwner(actorId, configuredOwners, guildId);
  const ext = db.prepare("SELECT * FROM market_extensions WHERE extension_id=?").get(extensionId);
  if (!ext) throw new Error("Extension introuvable.");
  const { manifest: normalized, sha256 } = validateManifest(manifest);
  if (normalized.id !== extensionId) throw new Error("L'identifiant du manifeste ne correspond pas à l'extension.");
  try {
    db.prepare("INSERT INTO market_versions(extension_id,version,manifest_json,manifest_sha256,status,created_at) VALUES(?,?,?,?,?,?)")
      .run(extensionId, normalized.version, JSON.stringify(normalized), sha256, "pending", now);
  } catch {
    throw new Error("Cette version existe déjà pour cette extension.");
  }
  recordSysPlusAudit(guildId, actorId, "market.version.submit", `${extensionId}@${normalized.version}`, { sha256: sha256.slice(0, 12) });
  return { extensionId, version: normalized.version, status: "pending", sha256 };
}

export function reviewVersion({ guildId, actorId, configuredOwners, extensionId, version, decision }) {
  requireOwner(actorId, configuredOwners, guildId);
  if (!["validate", "reject"].includes(decision)) throw new Error("Décision inconnue.");
  const row = db.prepare("SELECT * FROM market_versions WHERE extension_id=? AND version=?").get(extensionId, version);
  if (!row) throw new Error("Version introuvable.");
  if (row.status !== "pending") throw new Error("Cette version n'est plus en attente de revue.");
  const status = decision === "validate" ? "validated" : "rejected";
  db.prepare("UPDATE market_versions SET status=?, reviewed_by=? WHERE extension_id=? AND version=?").run(status, actorId, extensionId, version);
  recordSysPlusAudit(guildId, actorId, `market.version.${status}`, `${extensionId}@${version}`, null);
  return { extensionId, version, status };
}

export function listCatalog() {
  return db.prepare("SELECT extension_id,name,summary,publisher,status FROM market_extensions WHERE status='listed' ORDER BY name LIMIT 50").all();
}

function gateInstall({ guildId, actorId, tiers, entitlements }) {
  if (!marketplaceEnabled()) return { allowed: false, code: "MARKET_DISABLED" };
  // marketplace gives access; extensions is required to install or change anything.
  const decision = authorize({
    guildId,
    actor: { id: actorId },
    actionPolicy: { key: "market.install", minTiers: ["SYS_PLUS"], entitlement: "marketplace" },
    resolved: { guildId, guildStatus: "active", moduleEnabled: true, tiers, entitlements },
  });
  if (!decision.allow || decision.code !== "AUTHORIZED") return { allowed: false, code: decision.code };
  if (!entitlements.includes("extensions")) return { allowed: false, code: "ENTITLEMENT_MISSING" };
  return { allowed: true, code: "OK" };
}

/**
 * Install or update. First call without confirmed returns the permissions to
 * consent to; the call with confirmed=true (and the same version) installs.
 */
export function installExtension({ guildId, actorId, tiers, entitlements, extensionId, version, confirmed = false, now = Date.now() }) {
  const gate = gateInstall({ guildId, actorId, tiers, entitlements });
  if (!gate.allowed) return { ok: false, code: gate.code };
  const ext = db.prepare("SELECT * FROM market_extensions WHERE extension_id=?").get(extensionId);
  if (!ext || ext.status !== "listed") return { ok: false, code: "NOT_LISTED" };
  const row = db.prepare("SELECT * FROM market_versions WHERE extension_id=? AND version=?").get(extensionId, version);
  if (!row || row.status !== "validated") return { ok: false, code: "VERSION_NOT_VALIDATED" };
  const manifest = JSON.parse(row.manifest_json);
  const sha256 = row.manifest_sha256;
  // Re-hash the stored manifest: a tampered row cannot be installed.
  if (createHash("sha256").update(JSON.stringify(manifest)).digest("hex") !== sha256) return { ok: false, code: "INTEGRITY_FAILED" };

  const current = db.prepare("SELECT * FROM market_installs WHERE guild_id=? AND extension_id=?").get(guildId, extensionId);
  if (current?.status === "active" && current.version === version) return { ok: false, code: "ALREADY_INSTALLED" };
  const previousPermissions = current?.status === "active" ? JSON.parse(current.granted_permissions_json) : [];
  const permissionsChanged = JSON.stringify(previousPermissions) !== JSON.stringify(manifest.permissions);
  const previousVersion = current?.status === "active" ? current.version : null; // a reinstall starts a fresh history
  const consent = manifest.permissions.map((key) => ({ key, label: MARKET_PERMISSIONS[key] }));
  if (!confirmed) return { ok: false, code: "CONSENT_REQUIRED", consent, permissionsChanged, version, name: manifest.name };

  transaction(() => {
    if (current) {
      db.prepare(`UPDATE market_installs SET previous_version=?, version=?, status='active', granted_permissions_json=?, installed_by=?, updated_at=?
        WHERE guild_id=? AND extension_id=?`).run(previousVersion, version,
        JSON.stringify(manifest.permissions), actorId, now, guildId, extensionId);
    } else {
      db.prepare(`INSERT INTO market_installs(guild_id,extension_id,version,previous_version,status,granted_permissions_json,installed_by,installed_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(guildId, extensionId, version, null, "active", JSON.stringify(manifest.permissions), actorId, now, now);
    }
  });
  recordSysPlusAudit(guildId, actorId, current ? "market.install.update" : "market.install", `${extensionId}@${version}`, { permissions: manifest.permissions, sha256: sha256.slice(0, 12) });
  return { ok: true, code: "INSTALLED", version, permissions: manifest.permissions };
}

export function uninstallExtension({ guildId, actorId, tiers, entitlements, extensionId, now = Date.now() }) {
  const gate = gateInstall({ guildId, actorId, tiers, entitlements });
  if (!gate.allowed) return { ok: false, code: gate.code };
  const row = db.prepare("SELECT * FROM market_installs WHERE guild_id=? AND extension_id=?").get(guildId, extensionId);
  if (!row || row.status !== "active") return { ok: false, code: "NOT_INSTALLED" };
  db.prepare("UPDATE market_installs SET status='uninstalled', updated_at=? WHERE guild_id=? AND extension_id=?").run(now, guildId, extensionId);
  recordSysPlusAudit(guildId, actorId, "market.uninstall", `${extensionId}@${row.version}`, null);
  return { ok: true, code: "UNINSTALLED" };
}

/** Returns to the previously installed version, which must still be validated. One step only. */
export function rollbackExtension({ guildId, actorId, tiers, entitlements, extensionId, now = Date.now() }) {
  const gate = gateInstall({ guildId, actorId, tiers, entitlements });
  if (!gate.allowed) return { ok: false, code: gate.code };
  const row = db.prepare("SELECT * FROM market_installs WHERE guild_id=? AND extension_id=?").get(guildId, extensionId);
  if (!row || row.status !== "active") return { ok: false, code: "NOT_INSTALLED" };
  if (!row.previous_version) return { ok: false, code: "NOTHING_TO_ROLL_BACK" };
  const target = db.prepare("SELECT * FROM market_versions WHERE extension_id=? AND version=?").get(extensionId, row.previous_version);
  if (!target || target.status !== "validated") return { ok: false, code: "VERSION_NOT_VALIDATED" };
  const permissions = JSON.parse(target.manifest_json).permissions;
  const current = JSON.parse(row.granted_permissions_json);
  // A rollback may only narrow permissions. Widening would grant access without consent.
  if (permissions.some((key) => !current.includes(key))) return { ok: false, code: "CONSENT_REQUIRED" };
  db.prepare(`UPDATE market_installs SET version=?, previous_version=?, granted_permissions_json=?, updated_at=?
    WHERE guild_id=? AND extension_id=?`).run(row.previous_version, row.version, JSON.stringify(permissions), now, guildId, extensionId);
  recordSysPlusAudit(guildId, actorId, "market.rollback", `${extensionId}@${row.version}->${row.previous_version}`, { permissions });
  return { ok: true, code: "ROLLED_BACK", version: row.previous_version };
}

export function listInstalled(guildId) {
  return db.prepare("SELECT extension_id,version,previous_version,status,granted_permissions_json FROM market_installs WHERE guild_id=? AND status='active' ORDER BY extension_id")
    .all(guildId).map((row) => ({ extensionId: row.extension_id, version: row.version, previousVersion: row.previous_version, permissions: JSON.parse(row.granted_permissions_json) }));
}

