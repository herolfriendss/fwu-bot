import assert from "node:assert/strict";
import test from "node:test";
import { ACTIONS, decide } from "./core-permissions.js";

const OWNER = "100000000000000001";
const env = { PND_OWNER_DISCORD_ID: OWNER };
const settings = { sysPlus: { roleId: "sysrole" } };
const ctx = (extra = {}) => ({ env, settings, staffIds: ["staff1"], ...extra });

test("levels: member, staff, SYS+, OWNER by configured ID only", () => {
  assert.equal(decide("staff.center.view", { id: "staff1" }, ctx()).allowed, true);
  assert.equal(decide("staff.center.view", { id: "random" }, ctx()).allowed, false);
  assert.equal(decide("staff.intervention.validate", { id: "s", roleIds: ["sysrole"] }, ctx()).allowed, true);
  assert.equal(decide("staff.intervention.validate", { id: "staff1" }, ctx()).allowed, false);
  assert.equal(decide("authority.decide", { id: OWNER }, ctx()).allowed, true);
  // Neither SYS+, nor the Discord server owner, nor an Administrator replaces the configured OWNER.
  assert.equal(decide("authority.decide", { id: "s", roleIds: ["sysrole"] }, ctx()).allowed, false);
  assert.equal(decide("authority.decide", { id: "guild-owner", hasDiscordPermission: () => true }, ctx({ guildOwnerId: "guild-owner" })).allowed, false);
  assert.equal(decide("authority.decide", { id: OWNER }, ctx({ env: {} })).allowed, false); // no configured owner
});

test("refusal by default: unknown action, unknown actor, errors", () => {
  assert.match(decide("nope", { id: "a" }, ctx()).reason, /inconnue/);
  assert.match(decide("help.ask", null, ctx()).reason, /Auteur inconnu/);
  assert.match(decide("staff.center.view", { id: "staff1" }, ctx({ isFrozen: () => { throw new Error("db"); } })).reason, /refusé par sécurité/);
});

test("frozen staff lose staff powers, the OWNER is never frozen", () => {
  assert.match(decide("staff.center.view", { id: "staff1" }, ctx({ isFrozen: () => true })).reason, /gelé/);
  assert.equal(decide("help.ask", { id: "staff1" }, ctx({ isFrozen: () => true })).allowed, true);
  assert.equal(decide("authority.decide", { id: OWNER }, ctx({ isFrozen: () => true })).allowed, true);
});

test("AUTHORITY exceptions: only for exception actions, never owner actions, never for the OWNER, never instead of Discord", () => {
  const yes = () => true;
  assert.deepEqual(decide("staff.mission.create", { id: "staff1" }, ctx({ exception: yes })).via, "exception");
  assert.equal(decide("staff.intervention.validate", { id: "staff1" }, ctx({ exception: yes })).allowed, false);
  assert.equal(decide("core.queue.retry", { id: "staff1" }, ctx({ exception: yes })).allowed, false);
  assert.equal(decide("staff.mission.create", { id: "staff1" }, ctx({ exception: () => "true" })).allowed, false); // strict true only
  const noDiscord = { id: "staff1", hasDiscordPermission: () => false };
  assert.match(decide("staff.mission.create", noDiscord, ctx({ exception: yes, discordPermission: 8n })).reason, /Permission Discord manquante/);
  for (const [name, action] of Object.entries(ACTIONS)) if (action.level === "owner") assert.ok(!action.exception, `${name} must not be exceptionable`);
});
