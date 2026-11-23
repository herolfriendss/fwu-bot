import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADMIN_PLUS_SCOPES, canUseAdminPlusScope } from "./admin-plus-scope-policy.js";

function member({ owner = false, admin = false, roles = [] } = {}) {
  return {
    id: owner ? "owner" : "member",
    guild: { id: "guild-test", ownerId: "owner" },
    permissions: { has: (flag) => admin && flag === 1n << 3n },
    roles: { cache: new Map(roles.map((role) => [role, true])) },
  };
}

test("ADMIN+ module grants are independent, configurable, and default compatibly", () => {
  const actor = member({ roles: ["admin"] });
  assert.equal(canUseAdminPlusScope(actor, "sys", "admin", "roles", true), true);
  assert.equal(canUseAdminPlusScope(actor, "sys", "admin", "roles", false), false);
  assert.equal(canUseAdminPlusScope(actor, "sys", "admin", "tickets", false), false);
  assert.equal(ADMIN_PLUS_SCOPES.roles.defaultEnabled, true);
  assert.equal(ADMIN_PLUS_SCOPES.tickets.defaultEnabled, false);
});

test("SYS+ does not grant administrative scopes; ADMIN+ remains independently scoped", () => {
  assert.equal(
    canUseAdminPlusScope(member({ roles: ["sys"] }), "sys", "admin", "tickets", true),
    false,
  );
  assert.equal(
    canUseAdminPlusScope(member({ roles: ["admin"] }), "sys", "admin", "tickets", true),
    true,
  );
  assert.equal(
    canUseAdminPlusScope(member({ roles: ["admin"] }), "sys", "admin", "tickets", false),
    false,
  );
});

test("only configured PND Owner bypasses ADMIN+ scopes, even when a scope is disabled", () => {
  const previous = process.env.PND_OWNER_DISCORD_ID;
  process.env.PND_OWNER_DISCORD_ID = "12345";
  try {
    const owner = {
      id: "12345",
      guild: { id: "guild-test", ownerId: "someone-else" },
      roles: { cache: new Map() },
    };
    assert.equal(canUseAdminPlusScope(owner, null, null, "tickets", false), true);
  } finally {
    if (previous === undefined) delete process.env.PND_OWNER_DISCORD_ID;
    else process.env.PND_OWNER_DISCORD_ID = previous;
  }
});

test("unknown scopes and members without the configured ADMIN+ role fail closed", () => {
  assert.equal(canUseAdminPlusScope(member(), "sys", "admin", "roles", true), false);
  assert.equal(
    canUseAdminPlusScope(member({ roles: ["admin"] }), "sys", "admin", "unknown", true),
    false,
  );
});

test("scope overrides persist by guild without changing another guild's defaults", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pnd-admin-scopes-"));
  process.env.HER_DB_PATH = join(dir, "test.sqlite");
  const store = await import("./admin-plus-scopes.js");
  const { db } = await import("../../database.js");
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.HER_DB_PATH;
  });

  assert.equal(store.getAdminPlusScope("guild-one", "roles"), true);
  assert.equal(store.getAdminPlusScope("guild-two", "roles"), true);
  store.setAdminPlusScope("guild-one", "roles", false, "owner-one");
  store.setAdminPlusScope("guild-one", "tickets", true, "owner-one");
  assert.equal(store.getAdminPlusScope("guild-one", "roles"), false);
  assert.equal(store.getAdminPlusScope("guild-one", "tickets"), true);
  assert.equal(store.getAdminPlusScope("guild-two", "roles"), true);
  assert.equal(store.getAdminPlusScope("guild-two", "tickets"), false);
  assert.throws(
    () => store.setAdminPlusScope("guild-one", "unknown", true, "owner-one"),
    /invalide/,
  );
});
