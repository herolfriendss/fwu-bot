import test from "node:test";
import assert from "node:assert/strict";
import { ActivityType } from "discord.js";
import {
  buildPndPresenceProfiles,
  PND_PRESENCE_INTERVAL_MS,
} from "./rich-presence.js";

test("PND identity profiles contain only supported bot activity fields", () => {
  const profiles = buildPndPresenceProfiles({ name: "PND", memberCount: 42 });
  assert.equal(profiles.length, 4);
  assert.equal(profiles[0].name, "PND Assist • PND");
  assert.equal(profiles[0].type, ActivityType.Watching);
  assert.equal(profiles[1].name, "42 membres sur PND");
  assert.equal(profiles[1].type, ActivityType.Playing);
  assert.equal(profiles[2].type, ActivityType.Listening);
  assert.equal(profiles[3].type, ActivityType.Competing);

  for (const profile of profiles) {
    assert.deepEqual(Object.keys(profile).sort(), ["name", "state", "type"]);
    assert.ok(profile.name.length <= 100);
    assert.ok(profile.state.length <= 100);
  }
});

test("presence uses a safe fallback without inventing a member count", () => {
  const [first, second] = buildPndPresenceProfiles(null);
  assert.equal(first.name, "PND Assist • communauté PND");
  assert.equal(second.name, "Communauté privée PND");
});

test("presence rotation interval stays well below Discord's activity update limit", () => {
  assert.equal(PND_PRESENCE_INTERVAL_MS, 75_000);
  assert.ok(PND_PRESENCE_INTERVAL_MS >= 20_000);
});
