import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const databasePath = `/tmp/pnd-governance-${process.pid}.sqlite`;
process.env.HER_DB_PATH = databasePath;
process.env.PND_OWNER_DISCORD_ID = "700000000000000001";
const { buildPermissionMatrix, formatPermissionMatrix } =
  await import("./permission-matrix.js");
const {
  createSysPlusIncident,
  resolveSysPlusIncident,
  buildSysPlusIncidentReport,
} = await import("./systems/sysplus/incidents.js");
const { recordSysPlusAudit } = await import("./systems/sysplus/audit.js");
const { runSysPlusDiagnostic } = await import("./systems/sysplus/commands.js");
const { recordTransfer, detectTransferSignals } =
  await import("./economy-antifraud.js");
const { db } = await import("./database.js");

const guildId = "700000000000000009";
after(() => {
  db.close();
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${databasePath}${suffix}`, { force: true });
});

const cell = (matrix, labelPart, tier) =>
  matrix.rows.find((row) => row.label.includes(labelPart)).cells[tier];

test("matrix is computed from the real policies", () => {
  const matrix = buildPermissionMatrix({
    guildId,
    guildOwnerId: "700000000000000002",
    sysPlusRoleId: "s",
    adminPlusRoleId: "a",
    whitelistRoleId: "w",
    scopes: { roles: true, voice: false, lockname: true, tickets: false },
  });
  assert.equal(cell(matrix, "rankall", "owner"), true);
  assert.equal(cell(matrix, "rankall", "guildOwner"), false);
  assert.equal(cell(matrix, "Centre SYS+", "sysplus"), true);
  assert.equal(
    cell(matrix, "Centre SYS+", "administrator"),
    false,
    "Administrator never implies SYS+",
  );
  assert.equal(
    cell(matrix, "MENOTTE", "adminplus"),
    false,
    "voice scope disabled",
  );
  assert.equal(
    cell(matrix, "MENOTTE", "sysplus"),
    false,
    "SYS+ alone has no voice scope (decision §6.2)",
  );
  assert.equal(cell(matrix, "Rôles", "adminplus"), true);
  assert.equal(cell(matrix, "Gérer WHITELIST", "guildOwner"), true);
  assert.equal(cell(matrix, "Exemption", "whitelist"), true);
  assert.equal(cell(matrix, "Exemption", "owner"), false);
  assert.match(formatPermissionMatrix(matrix), /Matrice de permissions/);
});

test("matrix flags missing configuration", () => {
  assert.match(
    formatPermissionMatrix(
      buildPermissionMatrix({ guildId, guildOwnerId: "700000000000000002" }),
    ),
    /Non configuré : sysPlus, adminPlus, whitelist/,
  );
});

test("incident report contains the card and the audit timeline of its window only", () => {
  const authorizeActor = () => true;
  recordSysPlusAudit(
    guildId,
    "700000000000000003",
    "before.incident",
    null,
    {},
  );
  const incident = createSysPlusIncident(
    guildId,
    "700000000000000003",
    { title: "Raid détecté", summary: "Vague de comptes", severity: "high" },
    { authorizeActor, now: Date.now() - 1000 },
  );
  recordSysPlusAudit(
    guildId,
    "700000000000000003",
    "guildguard.lockdown",
    null,
    {},
  );
  resolveSysPlusIncident(
    guildId,
    incident.incidentId,
    "700000000000000003",
    "Verrouillage levé",
    { authorizeActor },
  );
  const report = buildSysPlusIncidentReport(guildId, incident.incidentId, {
    now: Date.now() + 5000,
  });
  assert.match(report, /# Rapport d'incident — Raid détecté/);
  assert.match(report, /Gravité : Élevée · Statut : Résolu/);
  assert.match(report, /guildguard\.lockdown/);
  assert.match(report, /Verrouillage levé/);
});

test("economy diagnostic reports open fraud signals to SYS+", async () => {
  const now = Date.now();
  for (let i = 0; i < 5; i += 1)
    recordTransfer({
      guildId,
      senderId: `70000000000000020${i}`,
      recipientId: "700000000000000300",
      amount: 50,
      senderJoinedAt: now - 86_400_000,
      now,
    });
  detectTransferSignals({
    guildId,
    senderId: "700000000000000204",
    recipientId: "700000000000000300",
    now,
  });
  const member = {
    id: "m",
    roles: { cache: new Map([["s", {}]]) },
    permissions: { has: () => false },
    guild: { id: guildId, ownerId: "o" },
  };
  const guild = {
    id: guildId,
    ownerId: "o",
    client: {},
    roles: { cache: new Map(), fetch: async () => null },
    members: { fetch: async () => null },
  };
  const text = await runSysPlusDiagnostic(guild, member, "s", "economie");
  assert.match(text, /Entonnoir/);
  assert.match(text, /Aucune correction ni sanction automatique/);
  const matrixText = await runSysPlusDiagnostic(guild, member, "s", "matrice");
  assert.match(matrixText, /1=OWNER ·/);
});
