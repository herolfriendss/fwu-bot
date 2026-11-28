import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createRequest, getRequest, hasException } from "./authority.js";
import { applyConsoleDecisions, buildAuthoritySnapshot, runAuthoritySync } from "./authority-sync.js";

const G = "111111111111111111"; const OTHER = "222222222222222222";
const OWNER = "100000000000000001"; const MEMBER = "300000000000000005";
const env = { PND_OWNER_DISCORD_ID: OWNER, PND_AUTHORITY_SECRET: "s" };
const mem = () => new DatabaseSync(":memory:");
const ask = (db) => createRequest({ guildId: G, requesterId: MEMBER, beneficiaryId: MEMBER, permission: "voice.room.extra", justification: "Soirée vocale du samedi", durationMs: 3_600_000 }, { db, env });

test("snapshot: bounded, nonce only while pending, no secret", () => {
  const db = mem();
  ask(db);
  const snap = buildAuthoritySnapshot(G, { db });
  assert.equal(snap.requests[0].status, "pending");
  assert.ok(snap.requests[0].nonce);
  assert.doesNotMatch(JSON.stringify(snap), /signature|"s"/);
});

test("console decisions go through the registry: nonce, server, owner", () => {
  const db = mem();
  const r = ask(db);
  const results = applyConsoleDecisions([
    { id: "11111111-1111-4111-8111-111111111111", guildId: OTHER, number: r.number, action: "approve", nonce: r.nonce },
    { id: "22222222-2222-4222-8222-222222222222", guildId: G, number: r.number, action: "approve", nonce: "vieux" },
    { id: "33333333-3333-4333-8333-333333333333", guildId: G, number: r.number, action: "approve", nonce: r.nonce },
    { id: "44444444-4444-4444-8444-444444444444", guildId: G, number: r.number, action: "approve", nonce: r.nonce },
  ], { guildIds: [G], db, env });
  assert.equal(results.length, 3); // the other server's decision is not touched by this bot
  assert.deepEqual(results.map((x) => x.ok), [false, true, false]);
  assert.match(results[2].result, /déjà traitée/);
  assert.equal(getRequest(G, r.number, { db }).status, "active");
  assert.equal(hasException({ guildId: G, userId: MEMBER, permission: "voice.room.extra" }, { db, env }), true);
  assert.match(applyConsoleDecisions([{ id: "x", guildId: G, number: 1, action: "revoke" }], { guildIds: [G], db, env: {} })[0].result, /OWNER non configuré/);
});

test("sync round: sends snapshots and results, applies returned decisions, survives the site being down", async () => {
  const db = mem();
  const r = ask(db);
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ decisions: [{ id: "55555555-5555-4555-8555-555555555555", guildId: G, number: r.number, action: "refuse", nonce: r.nonce }] }) };
  };
  const round = await runAuthoritySync({ apiUrl: "https://site.example/", secret: "bearer", guildIds: [G], fetchImpl, db, env });
  assert.equal(sent.url, "https://site.example/api/public/authority-sync");
  assert.equal(sent.init.headers.Authorization, "Bearer bearer");
  assert.equal(sent.body.snapshots[0].guildId, G);
  assert.equal(round.results[0].ok, true);
  assert.equal(getRequest(G, r.number, { db }).status, "refused");
  const down = await runAuthoritySync({ apiUrl: "https://site.example", secret: "b", guildIds: [G], pendingResults: round.results, fetchImpl: async () => { throw new Error("réseau"); }, db, env });
  assert.equal(down.error, "unreachable");
  assert.deepEqual(down.results, round.results); // kept for the next round
  assert.equal((await runAuthoritySync({ apiUrl: "", secret: "b", guildIds: [G], db, env })).applied, 0);
});
