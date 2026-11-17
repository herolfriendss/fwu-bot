import test from "node:test";
import assert from "node:assert/strict";
import { handleGuildCreate, handleGuildGuardJoin, isGuildAllowed, resetGuildGuardState, restrictGuildSettings } from "./guild-guard.js";

const PND_ID = "12345678901234567";
const OTHER_ID = "23456789012345678";

test("guild allowlist rejects missing, empty and malformed configurations", () => {
  assert.equal(isGuildAllowed(PND_ID, null), false);
  assert.equal(isGuildAllowed(PND_ID, []), false);
  assert.equal(isGuildAllowed(PND_ID, ["not-a-snowflake"]), false);
  assert.equal(isGuildAllowed("not-a-snowflake", [PND_ID]), false);
});

test("guild allowlist accepts only the explicitly configured PND server", () => {
  assert.equal(isGuildAllowed(PND_ID, [PND_ID]), true);
  assert.equal(isGuildAllowed(OTHER_ID, [PND_ID]), false);
  assert.equal(isGuildAllowed(PND_ID, [OTHER_ID]), false);
});

test("a foreign guild is left and reported exactly once", async () => {
  let leaves = 0;
  const events = [];
  const guild = {
    id: OTHER_ID,
    leave: async () => { leaves += 1; },
  };

  assert.equal(await handleGuildCreate(guild, [PND_ID], (code) => events.push(code)), true);
  assert.equal(leaves, 1);
  assert.deepEqual(events, ["guild_blocked"]);
});

test("the authorized PND guild is not left", async () => {
  let leaves = 0;
  const guild = {
    id: PND_ID,
    leave: async () => { leaves += 1; },
  };

  assert.equal(await handleGuildCreate(guild, [PND_ID]), false);
  assert.equal(leaves, 0);
});

test("a guild is still denied when leaving it fails", async () => {
  const events = [];
  const guild = {
    id: OTHER_ID,
    leave: async () => { throw new Error("simulated Discord API failure"); },
  };

  assert.equal(await handleGuildCreate(guild, [PND_ID], (code) => events.push(code)), true);
  assert.deepEqual(events, ["guild_blocked"]);
});

test("settings sync exposes only the authorized PND server", () => {
  const pnd = { prefixCommands: [{ name: "help" }] };
  const foreign = { prefixCommands: [{ name: "admin" }] };
  assert.deepEqual(
    restrictGuildSettings({ [PND_ID]: pnd, [OTHER_ID]: foreign }, [PND_ID]),
    { [PND_ID]: pnd },
  );
});

test("settings sync fails closed for missing or invalid allowlists", () => {
  const settings = { [PND_ID]: { enabled: true } };
  assert.deepEqual(restrictGuildSettings(settings, []), {});
  assert.deepEqual(restrictGuildSettings(settings, null), {});
  assert.deepEqual(restrictGuildSettings(null, [PND_ID]), {});
});

test("bot accounts count toward raid bursts without being quarantined themselves", async () => {
  const guildId = "34567890123456789";
  const guild = { id: guildId, name: "PND", channels: { fetch: async () => null } };
  const guard = {
    enabled: true,
    raidJoinThreshold: 1,
    raidWindowSeconds: 60,
    youngAccountAction: "log",
    minAccountAgeDays: 0,
    lockdown: false,
  };
  const now = Date.now();
  const events = [];
  const botMember = {
    id: "45678901234567890",
    guild,
    user: { id: "45678901234567890", tag: "raid-bot", bot: true, createdAt: new Date(now - 90 * 86_400_000) },
  };
  const humanMember = {
    id: "56789012345678901",
    guild,
    user: { id: "56789012345678901", tag: "member", bot: false, createdAt: new Date(now - 90 * 86_400_000) },
  };

  resetGuildGuardState(guildId);
  try {
    assert.equal(await handleGuildGuardJoin(botMember, guard, (code) => events.push(code)), false);
    assert.equal(events.includes("guild_guard_raid"), false);
    assert.equal(await handleGuildGuardJoin(humanMember, guard, (code) => events.push(code)), false);
    assert.equal(events.includes("guild_guard_raid"), true);
    assert.equal(events.includes("guild_guard_log"), true);
  } finally {
    resetGuildGuardState(guildId);
  }
});
