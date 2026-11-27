import { test } from "node:test";
import assert from "node:assert/strict";
import { castVote, tally, SYSP_VOTE } from "./vote.js";

const G = "723456789012345678"; const T0 = 1_700_000_000_000;

test("une voix par votant, modifiable, comptage pour/contre", () => {
  castVote({ guildId: G, candidateId: "c1", voterId: "a", pour: true }, T0);
  castVote({ guildId: G, candidateId: "c1", voterId: "b", pour: true }, T0);
  const t = castVote({ guildId: G, candidateId: "c1", voterId: "b", pour: false }, T0 + 1);
  assert.deepEqual(t, { pour: 1, contre: 1, total: 2 });
});

test("pas de vote pour soi, un bot ou un SYS+ ; les votes expirent", () => {
  assert.throws(() => castVote({ guildId: G, candidateId: "a", voterId: "a" }), /toi-même/);
  assert.throws(() => castVote({ guildId: G, candidateId: "x", voterId: "a", candidateIsBot: true }), /bot/);
  assert.throws(() => castVote({ guildId: G, candidateId: "x", voterId: "a", candidateIsSysPlus: true }), /déjà SYS\+/);
  assert.equal(tally(G, "c1", T0 + SYSP_VOTE.ttlMs + 10).total, 0);
});
