import test from "node:test";
import assert from "node:assert/strict";

const { evaluateHealth, buildHealthReport, registerHealthProvider } =
  await import("./health-report.js");
const { runSysPlusDiagnostic } = await import("./systems/sysplus/commands.js");

const okSnapshot = {
  ready: true,
  wsPing: 40,
  lastSync: new Date(1_000_000).toISOString(),
  missingPermissions: [],
  antiMoveEnabled: false,
  logsHubPresent: true,
  database: "ok",
  recentErrorCodes: [],
};

test("a healthy snapshot is ok", () => {
  assert.equal(evaluateHealth(okSnapshot, 1_030_000).status, "ok");
});

test("stale sync and many errors degrade, missing ManageRoles or broken DB is critical", () => {
  assert.equal(
    evaluateHealth({ ...okSnapshot, lastSync: null }, 1_030_000).status,
    "degraded",
  );
  assert.equal(
    evaluateHealth(
      { ...okSnapshot, recentErrorCodes: Array(12).fill("x_error") },
      1_030_000,
    ).status,
    "degraded",
  );
  assert.equal(
    evaluateHealth(
      {
        ...okSnapshot,
        missingPermissions: [{ name: "ManageRoles", label: "Gérer les rôles" }],
      },
      1_030_000,
    ).status,
    "critical",
  );
  assert.equal(
    evaluateHealth({ ...okSnapshot, database: "corrupt" }, 1_030_000).status,
    "critical",
  );
});

test("Anti-Move enabled without its permissions is critical", () => {
  const evaluation = evaluateHealth(
    {
      ...okSnapshot,
      antiMoveEnabled: true,
      missingPermissions: [{ name: "ViewAuditLog", label: "Voir les logs" }],
    },
    1_030_000,
  );
  assert.equal(evaluation.status, "critical");
  assert.ok(evaluation.checks.some((c) => c.name === "Anti-Move"));
});

function fakeGuild(perms = () => true) {
  return {
    id: "500000000000000001",
    members: {
      me: { permissions: { has: perms }, roles: { highest: { position: 5 } } },
      fetch: async () => null,
    },
    roles: { cache: new Map(), fetch: async () => null },
    channels: { cache: new Map() },
  };
}

test("collector reads the provider and real SQLite without leaking data", () => {
  registerHealthProvider(() => ({
    events: [{ code: "sync_error" }, { code: "connected" }],
    lastSync: new Date().toISOString(),
    startedAt: "x",
  }));
  const client = {
    isReady: () => true,
    ws: { ping: 30 },
    uptime: 3_700_000,
    guilds: { cache: new Map() },
  };
  const report = buildHealthReport(client, fakeGuild());
  assert.equal(report.snapshot.database, "ok");
  assert.deepEqual(report.snapshot.recentErrorCodes, ["sync_error"]);
  assert.match(report.text, /Santé/);
  assert.match(report.text, /1 h 1 min/);
});

test("diagnostics are refused to non SYS+ members", async () => {
  const member = {
    id: "m",
    roles: { cache: new Map() },
    permissions: { has: () => false },
    guild: { ownerId: "o" },
  };
  await assert.rejects(
    runSysPlusDiagnostic(fakeGuild(), member, "sysrole", "acl"),
    /réservés/,
  );
});

test("SYS+ gets the read-only ACL and coverage reports", async () => {
  const member = {
    id: "m",
    roles: { cache: new Map([["sysrole", {}]]) },
    permissions: { has: () => false },
    guild: { id: "500000000000000001", ownerId: "o" },
  };
  const guild = fakeGuild();
  guild.roles.cache.set(guild.id, {
    id: guild.id,
    name: "@everyone",
    position: 0,
    permissions: { bitfield: 1n << 3n },
    members: { size: 2 },
  });
  const acl = await runSysPlusDiagnostic(guild, member, "sysrole", "acl");
  assert.match(acl, /Administrateur/);
  assert.match(acl, /Lecture seule/);
  assert.match(
    await runSysPlusDiagnostic(guild, member, "sysrole", "logs-couverture"),
    /Couverture/,
  );
});
