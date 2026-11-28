import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "pnd-bus-")), "economy.sqlite");
const { db } = await import("./database.js");
const {
  publishEvent, publishEventSafe, consumeEvents, pendingEvents, recentEvents,
  cursorOf, initCursor, advanceCursor, pruneEvents, EVENT_KINDS,
} = await import("./event-bus.js");

const GUILD = "100000000000000001";
const USER = "200000000000000001";
const clear = () => { db.exec("DELETE FROM fwu_events; DELETE FROM fwu_event_cursor;"); };
const emit = (kind, over = {}) => publishEvent({ guildId: GUILD, kind, source: "guard", subjectId: USER, ...over });

test("an event is stored and read back whole", () => {
  clear();
  const id = emit("member.banned", { actorId: "300000000000000001", payload: { reason: "raid" } });
  assert.ok(id > 0);
  const [event] = recentEvents(GUILD);
  assert.equal(event.kind, "member.banned");
  assert.equal(event.subjectId, USER);
  assert.equal(event.payload.reason, "raid");
  assert.equal(event.source, "guard");
});

test("an unknown kind is refused, and the safe form swallows it", () => {
  clear();
  assert.throws(() => emit("member.exploded"), /Événement inconnu/);
  assert.equal(publishEventSafe({ guildId: GUILD, kind: "nope", source: "guard" }), 0);
});

test("an unusable guild id is ignored instead of throwing", () => {
  clear();
  assert.equal(publishEvent({ guildId: "x", kind: "member.joined", source: "fwu" }), 0);
});

test("an oversized payload is refused", () => {
  clear();
  assert.throws(() => emit("member.joined", { payload: { blob: "a".repeat(4100) } }), /trop grande/);
});

test("a consumer reads each event once", async () => {
  clear();
  emit("member.warned");
  emit("member.muted");
  const seen = [];
  const first = await consumeEvents("guard:test", (e) => { seen.push(e.kind); });
  assert.equal(first.handled, 2);
  assert.deepEqual(seen, ["member.warned", "member.muted"]);

  const second = await consumeEvents("guard:test", (e) => { seen.push(e.kind); });
  assert.equal(second.handled, 0, "rien à relire");
  emit("member.banned");
  await consumeEvents("guard:test", (e) => { seen.push(e.kind); });
  assert.deepEqual(seen, ["member.warned", "member.muted", "member.banned"]);
});

test("two consumers keep separate positions", async () => {
  clear();
  emit("member.levelup");
  await consumeEvents("fisc:reward", () => {});
  assert.equal(pendingEvents("fisc:reward").length, 0);
  assert.equal(pendingEvents("suckme:log").length, 1);
});

test("a filtered kind still moves the cursor forward", async () => {
  clear();
  emit("music.played");
  emit("member.banned");
  const run = await consumeEvents("fisc:bans", () => {}, { kinds: ["member.banned"] });
  assert.equal(run.read, 1);
  assert.equal(run.scanned, cursorOf("fisc:bans"));
  assert.equal(pendingEvents("fisc:bans").length, 0, "le kind ignoré ne doit pas rester en attente");
});

test("a handler that throws does not block the ones after it", async () => {
  clear();
  emit("member.warned");
  emit("member.muted");
  const seen = [];
  const run = await consumeEvents("guard:flaky", (e) => {
    if (e.kind === "member.warned") throw new Error("boum");
    seen.push(e.kind);
  });
  assert.equal(run.handled, 1);
  assert.deepEqual(seen, ["member.muted"]);
  assert.equal(pendingEvents("guard:flaky").length, 0);
});

test("a new consumer starts at the present, not at the archive", () => {
  clear();
  emit("member.joined");
  emit("member.left");
  const start = initCursor("fwu:fresh");
  assert.ok(start > 0);
  assert.equal(pendingEvents("fwu:fresh").length, 0);
  emit("member.banned");
  assert.equal(pendingEvents("fwu:fresh").length, 1);
});

test("the cursor only ever moves forward", () => {
  clear();
  emit("member.joined");
  advanceCursor("fwu:c", 5);
  advanceCursor("fwu:c", 2);
  assert.equal(cursorOf("fwu:c"), 5);
});

test("recent events can be filtered by kind and stay scoped to their guild", () => {
  clear();
  emit("member.banned");
  emit("music.played");
  publishEvent({ guildId: "100000000000000002", kind: "member.banned", source: "guard" });
  assert.equal(recentEvents(GUILD).length, 2);
  assert.equal(recentEvents(GUILD, { kinds: ["member.banned"] }).length, 1);
});

test("pruning drops old rows and pulls stale cursors up", () => {
  clear();
  const old = publishEvent({ guildId: GUILD, kind: "member.joined", source: "fwu", now: Date.now() - 30 * 24 * 60 * 60_000 });
  const fresh = emit("member.banned");
  advanceCursor("fwu:slow", 0);
  assert.equal(pruneEvents(), 1);
  assert.equal(recentEvents(GUILD).length, 1);
  assert.ok(cursorOf("fwu:slow") >= old, "le curseur ne doit pas rejouer des lignes supprimées");
  assert.ok(cursorOf("fwu:slow") < fresh, "l'événement encore présent reste à traiter");
});

test("the catalogue has no duplicate and uses dotted names", () => {
  assert.equal(new Set(EVENT_KINDS).size, EVENT_KINDS.length);
  assert.ok(EVENT_KINDS.every((kind) => /^[a-z]+\.[a-z]+$/.test(kind)));
});

test("FWU CORE 2.1: universal id, version and idempotency key (no duplicate event)", async () => {
  const { publishEvent, recentEvents } = await import("./event-bus.js");
  const guildId = "777777777777777777";
  const first = publishEvent({ guildId, kind: "member.warned", subjectId: "1", source: "fwu", idempotencyKey: "case:12" });
  const again = publishEvent({ guildId, kind: "member.warned", subjectId: "1", source: "guard", idempotencyKey: "case:12" });
  assert.equal(again, first);
  const other = publishEvent({ guildId: "888888888888888888", kind: "member.warned", source: "fwu", idempotencyKey: "case:12" });
  assert.notEqual(other, first);
  const [event] = recentEvents(guildId, { limit: 1 });
  assert.match(event.uid, /^[0-9a-f-]{36}$/);
  assert.equal(event.version, 1);
  assert.notEqual(publishEvent({ guildId, kind: "member.warned", source: "fwu" }), publishEvent({ guildId, kind: "member.warned", source: "fwu" }));
});
