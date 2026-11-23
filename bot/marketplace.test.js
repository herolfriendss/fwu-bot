import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-market-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
process.env.MARKETPLACE_ENABLED = "true";
const OWNERS = "123456";
const { db } = await import("./database.js");
const m = await import("./marketplace.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  delete process.env.MARKETPLACE_ENABLED;
  rmSync(directory, { recursive: true, force: true });
});

const GUILD = "600000000000000001";
const OTHER = "600000000000000002";
const OWNER = "123456";
const SYS = ["SYS_PLUS"];
const BOTH = ["marketplace", "extensions"];
const ext = (id = "welcome-card") => ({ id, version: "1.0.0", name: "Carte d'accueil", summary: "Message d'accueil", permissions: ["channels.read.names"] });

function publish(id = "welcome-card") {
  m.publishCatalogEntry({ guildId: GUILD, actorId: OWNER, configuredOwners: OWNERS, id, name: "Carte d'accueil", summary: "Message", publisher: "PND" });
}
function validated(manifest) {
  m.submitVersion({ guildId: GUILD, actorId: OWNER, configuredOwners: OWNERS, extensionId: manifest.id, manifest });
  m.reviewVersion({ guildId: GUILD, actorId: OWNER, configuredOwners: OWNERS, extensionId: manifest.id, version: manifest.version, decision: "validate" });
}

test("the marketplace is disabled by default: no install, even with both packs", () => {
  const previous = process.env.MARKETPLACE_ENABLED;
  delete process.env.MARKETPLACE_ENABLED;
  try {
    assert.equal(m.marketplaceEnabled(), false);
    assert.equal(m.installExtension({ guildId: GUILD, actorId: "1", tiers: SYS, entitlements: BOTH, extensionId: "x", version: "1.0.0", confirmed: true }).code, "MARKET_DISABLED");
  } finally {
    process.env.MARKETPLACE_ENABLED = previous;
  }
});

test("manifests with code, URLs, unknown or administrative permissions are refused", () => {
  assert.throws(() => m.validateManifest({ ...ext(), script: "console.log(1)" }), /Clé interdite/);
  assert.throws(() => m.validateManifest({ ...ext(), url: "https://evil.example" }), /Clé interdite/);
  assert.throws(() => m.validateManifest({ ...ext(), permissions: ["roles.manage"] }), /jamais accordable|inconnue/);
  assert.throws(() => m.validateManifest({ ...ext(), permissions: ["admin.all"] }), /jamais accordable/);
  assert.throws(() => m.validateManifest({ ...ext(), permissions: ["economy.adjust"] }), /jamais accordable/);
  assert.throws(() => m.validateManifest({ ...ext(), permissions: ["mystery.scope"] }), /inconnue/);
  assert.throws(() => m.validateManifest({ ...ext(), version: "v1" }), /Version/);
  assert.throws(() => m.validateManifest({ ...ext(), id: "A" }), /slug|Identifiant/);
  assert.throws(() => m.validateManifest("{ not json"), /JSON/);
  assert.throws(() => m.validateManifest({ ...ext(), name: "x".repeat(20_000) }), /volumineux/);
  const ok = m.validateManifest({ ...ext(), permissions: ["members.read.counts", "channels.read.names"] });
  assert.deepEqual(ok.manifest.permissions, ["channels.read.names", "members.read.counts"]);
  assert.match(ok.sha256, /^[a-f0-9]{64}$/);
});

test("only the PND owners maintain the catalogue and review versions", () => {
  assert.throws(() => m.publishCatalogEntry({ guildId: GUILD, actorId: "999999", configuredOwners: OWNERS, id: "intrus-ext", name: "X" }), /propriétaire/);
  publish();
  assert.throws(() => publish(), /existe déjà/);
  assert.throws(() => m.submitVersion({ guildId: GUILD, actorId: "999999", configuredOwners: OWNERS, extensionId: "welcome-card", manifest: ext() }), /propriétaire/);
  assert.throws(() => m.submitVersion({ guildId: GUILD, actorId: OWNER, configuredOwners: OWNERS, extensionId: "welcome-card", manifest: ext("autre-ext") }), /ne correspond pas/);
});

test("a pending version cannot be installed; once validated, install requires SYS+ and consent", () => {
  m.submitVersion({ guildId: GUILD, actorId: OWNER, configuredOwners: OWNERS, extensionId: "welcome-card", manifest: ext() });
  assert.equal(m.installExtension({ guildId: GUILD, actorId: "1", tiers: SYS, entitlements: BOTH, extensionId: "welcome-card", version: "1.0.0", confirmed: true }).code, "VERSION_NOT_VALIDATED");
  m.reviewVersion({ guildId: GUILD, actorId: OWNER, configuredOwners: OWNERS, extensionId: "welcome-card", version: "1.0.0", decision: "validate" });
  assert.equal(m.installExtension({ guildId: GUILD, actorId: "1", tiers: [], entitlements: BOTH, extensionId: "welcome-card", version: "1.0.0", confirmed: true }).code, "TIER_INSUFFICIENT");
  assert.equal(m.installExtension({ guildId: GUILD, actorId: "1", tiers: SYS, entitlements: ["marketplace"], extensionId: "welcome-card", version: "1.0.0", confirmed: true }).code, "ENTITLEMENT_MISSING");
  const consent = m.installExtension({ guildId: GUILD, actorId: "1", tiers: SYS, entitlements: BOTH, extensionId: "welcome-card", version: "1.0.0" });
  assert.equal(consent.code, "CONSENT_REQUIRED");
  assert.deepEqual(consent.consent.map((item) => item.key), ["channels.read.names"]);
  assert.equal(m.installExtension({ guildId: GUILD, actorId: "1", tiers: SYS, entitlements: BOTH, extensionId: "welcome-card", version: "1.0.0", confirmed: true }).code, "INSTALLED");
  assert.equal(m.installExtension({ guildId: GUILD, actorId: "1", tiers: SYS, entitlements: BOTH, extensionId: "welcome-card", version: "1.0.0", confirmed: true }).code, "ALREADY_INSTALLED");
});

test("updates keep history, rollback narrows permissions only, and widening requires consent", () => {
  validated({ ...ext(), version: "1.1.0", permissions: ["channels.read.names", "announcements.post"] });
  const update = m.installExtension({ guildId: GUILD, actorId: "1", tiers: SYS, entitlements: BOTH, extensionId: "welcome-card", version: "1.1.0", confirmed: true });
  assert.equal(update.code, "INSTALLED");
  assert.equal(m.listInstalled(GUILD)[0].previousVersion, "1.0.0");
  const back = m.rollbackExtension({ guildId: GUILD, actorId: "1", tiers: SYS, entitlements: BOTH, extensionId: "welcome-card" });
  assert.equal(back.code, "ROLLED_BACK");
  assert.equal(back.version, "1.0.0");
  assert.deepEqual(m.listInstalled(GUILD)[0].permissions, ["channels.read.names"]);

  validated({ ...ext(), version: "2.0.0", permissions: ["channels.read.names", "members.read.counts"] });
  m.installExtension({ guildId: GUILD, actorId: "1", tiers: SYS, entitlements: BOTH, extensionId: "welcome-card", version: "2.0.0", confirmed: true });
  // Narrowing rollback (2.0.0 -> 1.0.0, a subset of permissions) is allowed.
  assert.equal(m.rollbackExtension({ guildId: GUILD, actorId: "1", tiers: SYS, entitlements: BOTH, extensionId: "welcome-card" }).code, "ROLLED_BACK");
  assert.deepEqual(m.listInstalled(GUILD)[0].permissions, ["channels.read.names"]);

  // Install a version with NO permissions, then try to roll back to 1.0.0, which would grant a permission again.
  validated({ ...ext(), version: "3.0.0", permissions: [] });
  m.installExtension({ guildId: GUILD, actorId: "1", tiers: SYS, entitlements: BOTH, extensionId: "welcome-card", version: "3.0.0", confirmed: true });
  const widening = m.rollbackExtension({ guildId: GUILD, actorId: "1", tiers: SYS, entitlements: BOTH, extensionId: "welcome-card" });
  assert.equal(widening.code, "CONSENT_REQUIRED", "a rollback must never widen permissions silently");
  assert.deepEqual(m.listInstalled(GUILD)[0].permissions, [], "state unchanged after refusal");
});

test("a tampered stored manifest is refused at install time", () => {
  publish("tamper-ext");
  validated({ id: "tamper-ext", version: "1.0.0", name: "Test altération", permissions: [] });
  db.prepare("UPDATE market_versions SET manifest_json=? WHERE extension_id='tamper-ext' AND version='1.0.0'")
    .run(JSON.stringify({ id: "tamper-ext", version: "1.0.0", name: "Altérée", summary: "", permissions: ["channels.read.names"] }));
  assert.equal(m.installExtension({ guildId: GUILD, actorId: "1", tiers: SYS, entitlements: BOTH, extensionId: "tamper-ext", version: "1.0.0", confirmed: true }).code, "INTEGRITY_FAILED");
});

test("uninstall keeps history, reinstall starts a fresh rollback chain, and withdrawn entries are not installable", () => {
  assert.equal(m.uninstallExtension({ guildId: GUILD, actorId: "1", tiers: SYS, entitlements: BOTH, extensionId: "welcome-card" }).code, "UNINSTALLED");
  assert.equal(m.uninstallExtension({ guildId: GUILD, actorId: "1", tiers: SYS, entitlements: BOTH, extensionId: "welcome-card" }).code, "NOT_INSTALLED");
  assert.deepEqual(m.listInstalled(GUILD), []);
  m.installExtension({ guildId: GUILD, actorId: "1", tiers: SYS, entitlements: BOTH, extensionId: "welcome-card", version: "1.0.0", confirmed: true });
  assert.equal(m.listInstalled(GUILD)[0].previousVersion, null);
  m.withdrawCatalogEntry({ guildId: GUILD, actorId: OWNER, configuredOwners: OWNERS, id: "tamper-ext" });
  assert.equal(m.installExtension({ guildId: GUILD, actorId: "1", tiers: SYS, entitlements: BOTH, extensionId: "tamper-ext", version: "1.0.0", confirmed: true }).code, "NOT_LISTED");
});

test("installs are isolated per guild", () => {
  assert.deepEqual(m.listInstalled(OTHER), []);
  assert.equal(m.installExtension({ guildId: OTHER, actorId: "1", tiers: SYS, entitlements: BOTH, extensionId: "welcome-card", version: "1.0.0", confirmed: true }).code, "INSTALLED");
  m.uninstallExtension({ guildId: OTHER, actorId: "1", tiers: SYS, entitlements: BOTH, extensionId: "welcome-card" });
  assert.deepEqual(m.listInstalled(OTHER), []);
  assert.equal(m.listInstalled(GUILD).length, 1);
});
