import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateTargetHierarchy,
  HIERARCHY_CODES,
} from "./target-hierarchy-policy.js";

const member = (id, position) => ({ id, roles: { highest: { position } } });
const bot = member("bot", 10);

test("a lower-ranked target is allowed", () => {
  assert.deepEqual(
    evaluateTargetHierarchy({
      actor: member("a", 5),
      target: member("t", 3),
      bot,
      guildOwnerId: "go",
    }),
    { allowed: true, code: null, reason: null },
  );
});

test("equal and higher targets are refused for the actor", () => {
  for (const position of [5, 7, 9]) {
    const result = evaluateTargetHierarchy({
      actor: member("a", 5),
      target: member("t", position),
      bot,
      guildOwnerId: "go",
    });
    assert.equal(result.allowed, false, `position ${position}`);
    assert.equal(result.code, HIERARCHY_CODES.TARGET_NOT_LOWER);
  }
});

test("a target at or above the bot is refused even when the actor outranks it", () => {
  for (const position of [10, 11]) {
    const result = evaluateTargetHierarchy({
      actor: member("a", 20),
      target: member("t", position),
      bot,
      guildOwnerId: "go",
    });
    assert.equal(result.code, HIERARCHY_CODES.BOT_BELOW_TARGET);
  }
});

test("the Discord server owner and the configured PND OWNER are never targets", () => {
  assert.equal(
    evaluateTargetHierarchy({
      actor: member("a", 9),
      target: member("go", 1),
      bot,
      guildOwnerId: "go",
    }).code,
    HIERARCHY_CODES.PROTECTED_OWNER,
  );
  assert.equal(
    evaluateTargetHierarchy({
      actor: member("a", 9),
      target: member("po", 1),
      bot,
      guildOwnerId: "go",
      pndOwnerId: "po",
    }).code,
    HIERARCHY_CODES.PROTECTED_OWNER,
  );
});

test("self targeting is refused unless explicitly allowed (read-only commands)", () => {
  assert.equal(
    evaluateTargetHierarchy({
      actor: member("a", 5),
      target: member("a", 5),
      bot,
    }).code,
    HIERARCHY_CODES.SELF,
  );
  assert.equal(
    evaluateTargetHierarchy({
      actor: member("a", 5),
      target: member("a", 5),
      bot,
      allowSelf: true,
      enforceActorRank: false,
    }).allowed,
    true,
  );
});

test("the Discord server owner outranks every role natively", () => {
  assert.equal(
    evaluateTargetHierarchy({
      actor: member("go", 1),
      target: member("t", 9),
      bot,
      guildOwnerId: "go",
    }).allowed,
    true,
  );
  // ...but the bot-side limit still applies to them.
  assert.equal(
    evaluateTargetHierarchy({
      actor: member("go", 1),
      target: member("t", 10),
      bot,
      guildOwnerId: "go",
    }).code,
    HIERARCHY_CODES.BOT_BELOW_TARGET,
  );
});

test("actor rank can be waived for release/read commands but the bot limit stays", () => {
  assert.equal(
    evaluateTargetHierarchy({
      actor: member("a", 5),
      target: member("t", 7),
      bot,
      enforceActorRank: false,
    }).allowed,
    true,
  );
  assert.equal(
    evaluateTargetHierarchy({
      actor: member("a", 5),
      target: member("t", 10),
      bot,
      enforceActorRank: false,
    }).code,
    HIERARCHY_CODES.BOT_BELOW_TARGET,
  );
});

test("missing or unreadable hierarchy data fails closed", () => {
  assert.equal(
    evaluateTargetHierarchy({ actor: member("a", 5), target: null, bot }).code,
    HIERARCHY_CODES.TARGET_MISSING,
  );
  assert.equal(
    evaluateTargetHierarchy({
      actor: member("a", 5),
      target: { id: "t", roles: {} },
      bot,
    }).code,
    HIERARCHY_CODES.UNREADABLE,
  );
  assert.equal(
    evaluateTargetHierarchy({
      actor: { id: "a", roles: {} },
      target: member("t", 1),
      bot,
    }).code,
    HIERARCHY_CODES.UNREADABLE,
  );
});
