import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import { exceedsMentionLimit, shouldApplySpamLimit } from "./spam-policy.js";

function member({ guildId = "guild-a", roles = [], permissions = [] } = {}) {
  return {
    id: "actor-a",
    guild: { id: guildId },
    roles: { cache: new Set(roles) },
    permissions: { has: (permission) => permissions.includes(permission) },
  };
}

test("anti-spam exempts only Discord ManageMessages or this guild's configured WHITELIST role", () => {
  assert.equal(shouldApplySpamLimit(member(), "whitelist-a"), true);
  assert.equal(shouldApplySpamLimit(member({ roles: ["whitelist-a"] }), "whitelist-a"), false);
  assert.equal(shouldApplySpamLimit(member({ roles: ["whitelist-b"] }), "whitelist-a"), true);
  assert.equal(shouldApplySpamLimit(member({ permissions: [PermissionFlagsBits.ManageMessages] }), null), false);
  assert.equal(shouldApplySpamLimit(null, "whitelist-a"), false);
});

test("mention protection counts user, role, and everyone mentions against a strict threshold", () => {
  assert.equal(exceedsMentionLimit({ users: 4, roles: 1 }, 5), false);
  assert.equal(exceedsMentionLimit({ users: 4, roles: 1, everyone: true }, 5), true);
  assert.equal(exceedsMentionLimit({ users: 6 }, 5), true);
  assert.equal(exceedsMentionLimit({ users: -5, roles: 1 }, 5), false);
});
