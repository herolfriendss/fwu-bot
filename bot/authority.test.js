// AUTHORITY security audit (docs/specs/CAHIER_DES_CHARGES_FWU_V2.md § 5.J): every case must
// end in a secure refusal unless the configured OWNER approved a valid, signed, current request.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  authorityExceptionFor, createRequest, decideRequest, EXCEPTIONABLE, expireDue, getRequest, hasException,
  listRequests, requestHistory, takeExpiryReminders,
} from "./authority.js";
import { decide } from "./core-permissions.js";
import { verifyAuditChain } from "./core-audit.js";

const G = "111111111111111111"; const G2 = "222222222222222222";
const OWNER = "100000000000000001"; const SYS = "300000000000000003"; const ADMIN = "300000000000000004"; const MEMBER = "300000000000000005";
const env = { PND_OWNER_DISCORD_ID: OWNER, PND_AUTHORITY_SECRET: "secret-de-test" };
const H = 3_600_000;
const mem = () => new DatabaseSync(":memory:");
const ask = (db, extra = {}, now = 0) => createRequest({ guildId: G, requesterId: MEMBER, beneficiaryId: MEMBER, permission: "voice.room.extra", justification: "Événement vocal de samedi", durationMs: 2 * H, ...extra }, { db, env, now });

test("catalogue: only exceptionable application actions, never roles, Discord permissions, Tier 0 or owner actions", () => {
  assert.ok(EXCEPTIONABLE.includes("voice.room.extra"));
  for (const forbidden of ["authority.decide", "core.queue.retry", "discord.role.grant", "tier0.override", "staff.intervention.validate"]) assert.ok(!EXCEPTIONABLE.includes(forbidden));
  const db = mem();
  assert.match(ask(db, { permission: "tier0.override" }).error, /ne peut pas faire l'objet/);
  assert.match(ask(db, { permission: "discord.role.grant" }).error, /ne peut pas faire l'objet/);
});

test("OWNER approval: signed, active, checked; OWNER refusal: nothing granted", () => {
  const db = mem();
  const r = ask(db);
  const ok = decideRequest({ guildId: G, number: r.number, actorId: OWNER, action: "approve", nonce: r.nonce }, { db, env, now: 10 });
  assert.equal(ok.status, "active");
  assert.equal(hasException({ guildId: G, userId: MEMBER, permission: "voice.room.extra" }, { db, env, now: 20 }), true);
  const r2 = ask(db, { permission: "economy.quota.extra" });
  assert.equal(decideRequest({ guildId: G, number: r2.number, actorId: OWNER, action: "refuse", nonce: r2.nonce }, { db, env, now: 10 }).status, "refused");
  assert.equal(hasException({ guildId: G, userId: MEMBER, permission: "economy.quota.extra" }, { db, env, now: 20 }), false);
  assert.equal(verifyAuditChain(G, { db, secret: "" }).ok, true);
  assert.deepEqual(requestHistory(G, r.number, { db }).map((e) => e.kind), ["request", "approve"]);
});

test("SYS+, ADMIN+, the Discord server owner or a bot cannot approve", () => {
  const db = mem();
  const r = ask(db);
  for (const actor of [SYS, ADMIN, "guild-owner", "bot-id"]) {
    assert.match(decideRequest({ guildId: G, number: r.number, actorId: actor, action: "approve", nonce: r.nonce }, { db, env }).error, /Seul l'OWNER/);
  }
  assert.match(decideRequest({ guildId: G, number: r.number, actorId: OWNER, action: "approve", nonce: r.nonce }, { db, env: { PND_AUTHORITY_SECRET: "x" } }).error, /Seul l'OWNER/);
  assert.equal(hasException({ guildId: G, userId: MEMBER, permission: "voice.room.extra" }, { db, env }), false);
});

test("self-grant: nobody approves their own request, the OWNER is never a beneficiary", () => {
  const db = mem();
  assert.match(ask(db, { beneficiaryId: OWNER }).error, /OWNER ne peut pas recevoir/);
  const own = createRequest({ guildId: G, requesterId: OWNER, beneficiaryId: MEMBER, permission: "voice.room.extra", justification: "Je me l'accorde pour lui", durationMs: H }, { db, env });
  assert.match(decideRequest({ guildId: G, number: own.number, actorId: OWNER, action: "approve", nonce: own.nonce }, { db, env }).error, /propre demande/);
  assert.equal(hasException({ guildId: G, userId: OWNER, permission: "voice.room.extra" }, { db, env }), false);
});

test("double validation and reuse of an old interaction are refused", () => {
  const db = mem();
  const r = ask(db);
  assert.ok(decideRequest({ guildId: G, number: r.number, actorId: OWNER, action: "approve", nonce: r.nonce }, { db, env }).ok);
  assert.match(decideRequest({ guildId: G, number: r.number, actorId: OWNER, action: "approve", nonce: r.nonce }, { db, env }).error, /déjà traitée/);
  const r2 = ask(db, { permission: "economy.quota.extra" });
  assert.match(decideRequest({ guildId: G, number: r2.number, actorId: OWNER, action: "approve", nonce: "ancien-bouton" }, { db, env }).error, /expirée ou déjà utilisée/);
  assert.match(decideRequest({ guildId: G, number: r2.number, actorId: OWNER, action: "approve" }, { db, env }).error, /expirée ou déjà utilisée/);
});

test("expiry works without any timer (restart) and reminders fire once", () => {
  const db = mem();
  const r = ask(db);
  decideRequest({ guildId: G, number: r.number, actorId: OWNER, action: "approve", nonce: r.nonce }, { db, env, now: 0 });
  // A new process with an empty memory: only the stored expiry counts.
  assert.equal(hasException({ guildId: G, userId: MEMBER, permission: "voice.room.extra" }, { db, env, now: 2 * H - 1 }), true);
  assert.equal(hasException({ guildId: G, userId: MEMBER, permission: "voice.room.extra" }, { db, env, now: 2 * H }), false);
  assert.equal(listRequests(G, { db, now: 2 * H })[0].effective, "expired");
  assert.equal(takeExpiryReminders({ db, now: H }).length, 1);
  assert.equal(takeExpiryReminders({ db, now: H + 1 }).length, 0);
  assert.equal(expireDue({ db, now: 3 * H }).length, 1);
  assert.equal(getRequest(G, r.number, { db }).status, "expired");
});

test("revocation, suspension and extension are immediate and OWNER only", () => {
  const db = mem();
  const r = ask(db);
  decideRequest({ guildId: G, number: r.number, actorId: OWNER, action: "approve", nonce: r.nonce }, { db, env, now: 0 });
  assert.match(decideRequest({ guildId: G, number: r.number, actorId: SYS, action: "extend", durationMs: H }, { db, env }).error, /Seul l'OWNER/);
  assert.equal(decideRequest({ guildId: G, number: r.number, actorId: OWNER, action: "suspend" }, { db, env, now: 1 }).status, "suspended");
  assert.equal(hasException({ guildId: G, userId: MEMBER, permission: "voice.room.extra" }, { db, env, now: 2 }), false);
  assert.equal(decideRequest({ guildId: G, number: r.number, actorId: OWNER, action: "resume" }, { db, env, now: 3 }).status, "active");
  assert.equal(decideRequest({ guildId: G, number: r.number, actorId: OWNER, action: "extend", durationMs: 5 * H }, { db, env, now: 4 }).expiresAt, 7 * H);
  assert.equal(hasException({ guildId: G, userId: MEMBER, permission: "voice.room.extra" }, { db, env, now: 6 * H }), true);
  assert.equal(decideRequest({ guildId: G, number: r.number, actorId: OWNER, action: "revoke" }, { db, env, now: 5 }).status, "revoked");
  assert.equal(hasException({ guildId: G, userId: MEMBER, permission: "voice.room.extra" }, { db, env, now: 6 }), false);
});

test("direct modification of the registry is worthless", () => {
  const db = mem();
  const r = ask(db);
  decideRequest({ guildId: G, number: r.number, actorId: OWNER, action: "approve", nonce: r.nonce }, { db, env, now: 0 });
  db.exec(`UPDATE authority_requests SET expires_at = ${100 * H}`);
  assert.equal(hasException({ guildId: G, userId: MEMBER, permission: "voice.room.extra" }, { db, env, now: 3 * H }), false);
  db.exec(`INSERT INTO authority_requests(uid, guild_id, number, requester_id, beneficiary_id, permission, service, justification, duration_ms, status, nonce, created_at, starts_at, expires_at, signature)
    VALUES ('forged', '${G}', 99, 'x', '${SYS}', 'economy.quota.extra', 'x', 'forgé à la main', 1, 'active', 'n', 0, 0, ${100 * H}, 'deadbeef')`);
  assert.equal(hasException({ guildId: G, userId: SYS, permission: "economy.quota.extra" }, { db, env, now: H }), false);
  assert.equal(verifyAuditChain(G, { db, secret: "" }).ok, true); // the journal itself was not touched
});

test("server isolation, unavailability and missing secret all refuse", () => {
  const db = mem();
  const r = ask(db);
  decideRequest({ guildId: G, number: r.number, actorId: OWNER, action: "approve", nonce: r.nonce }, { db, env, now: 0 });
  assert.equal(hasException({ guildId: G2, userId: MEMBER, permission: "voice.room.extra" }, { db, env, now: 1 }), false);
  const broken = { prepare() { throw new Error("base indisponible"); }, exec() { throw new Error("base indisponible"); } };
  assert.equal(hasException({ guildId: G, userId: MEMBER, permission: "voice.room.extra" }, { db: broken, env, now: 1 }), false);
  assert.equal(hasException({ guildId: G, userId: MEMBER, permission: "voice.room.extra" }, { db, env: { PND_OWNER_DISCORD_ID: OWNER }, now: 1 }), false);
  const r2 = ask(db, { permission: "economy.quota.extra" });
  assert.match(decideRequest({ guildId: G, number: r2.number, actorId: OWNER, action: "approve", nonce: r2.nonce }, { db, env: { PND_OWNER_DISCORD_ID: OWNER } }).error, /Secret serveur absent/);
});

test("request hygiene: justification, duration, anti-spam, duplicates", () => {
  const db = mem();
  assert.match(ask(db, { justification: "court" }).error, /justification/);
  assert.match(ask(db, { durationMs: 1000 }).error, /Durée/);
  assert.match(ask(db, { durationMs: 60 * 86_400_000 }).error, /Durée/);
  ask(db);
  assert.match(ask(db).error, /existe déjà/);
  ask(db, { permission: "economy.quota.extra" });
  ask(db, { permission: "module.beta.access", beneficiaryId: SYS });
  assert.match(ask(db, { permission: "staff.mission.create", beneficiaryId: ADMIN }).error, /déjà 3 demandes/);
});

test("core-permissions uses AUTHORITY only when the normal control refuses", () => {
  const db = mem();
  const r = createRequest({ guildId: G, requesterId: MEMBER, beneficiaryId: MEMBER, permission: "staff.mission.create", justification: "Organisation du tournoi", durationMs: H }, { db, env, now: 0 });
  const ctx = { env, settings: { sysPlus: { roleId: "sys" } }, staffIds: [MEMBER], exception: authorityExceptionFor(G, { db, env, now: 1 }) };
  assert.equal(decide("staff.mission.create", { id: MEMBER }, ctx).allowed, false);
  decideRequest({ guildId: G, number: r.number, actorId: OWNER, action: "approve", nonce: r.nonce }, { db, env, now: 0 });
  assert.equal(decide("staff.mission.create", { id: MEMBER }, ctx).via, "exception");
  assert.equal(decide("staff.mission.create", { id: MEMBER }, { ...ctx, exception: authorityExceptionFor(G2, { db, env, now: 1 }) }).allowed, false);
});

test("decision re-reads the request after acquiring the write lock", () => {
  const base = mem();
  const r = ask(base);
  let injected = false;
  const db = {
    prepare: (...args) => base.prepare(...args),
    exec: (sql) => {
      if (sql === "BEGIN IMMEDIATE" && !injected) {
        injected = true;
        // Simulate another process committing a decision after this interaction's
        // initial read but before it acquires the SQLite write lock.
        base.prepare("UPDATE authority_requests SET status = 'refused', nonce = 'rotated-by-other-process' WHERE guild_id = ? AND number = ?")
          .run(G, r.number);
      }
      return base.exec(sql);
    },
  };
  const result = decideRequest({ guildId: G, number: r.number, actorId: OWNER, action: "approve", nonce: r.nonce }, { db, env, now: 10 });
  assert.match(result.error, /déjà traitée/);
  assert.equal(getRequest(G, r.number, { db: base }).status, "refused");
  assert.equal(hasException({ guildId: G, userId: MEMBER, permission: "voice.room.extra" }, { db: base, env, now: 20 }), false);
  assert.deepEqual(requestHistory(G, r.number, { db: base }).map((event) => event.kind), ["request"]);
});

test("request eligibility is rechecked after acquiring the write lock", () => {
  const base = mem();
  let injected = false;
  const db = {
    prepare: (...args) => base.prepare(...args),
    exec: (sql) => {
      if (sql === "BEGIN IMMEDIATE" && !injected) {
        injected = true;
        // Simulate another request committing after the first caller's preflight.
        const competing = ask(base);
        assert.ok(competing.number);
      }
      return base.exec(sql);
    },
  };
  const result = createRequest({
    guildId: G, requesterId: MEMBER, beneficiaryId: MEMBER,
    permission: "voice.room.extra", justification: "Demande simultanée de test",
    durationMs: 2 * H,
  }, { db, env, now: 1 });
  assert.match(result.error, /existe déjà/);
  assert.equal(base.prepare("SELECT COUNT(*) AS n FROM authority_requests WHERE guild_id = ? AND beneficiary_id = ? AND permission = ?").get(G, MEMBER, "voice.room.extra").n, 1);
});
