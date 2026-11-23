import test from "node:test";
import assert from "node:assert/strict";
import { isSysPlus, canConfigureSysPlus } from "./permissions.js";

function member({ id = "12345", ownerId = "99999", admin = false, roles = [] } = {}) {
  return {
    id,
    guild: { id: "guild-test", ownerId },
    permissions: { has: (flag) => admin },
    roles: { cache: new Map(roles.map((r) => [r, true])) },
  };
}
test("configured PND owner is SYS+ and can configure", () => {
  const previousOwner = process.env.PND_OWNER_DISCORD_ID;
  process.env.PND_OWNER_DISCORD_ID = "99999";
  try {
    const m = member({ id: "99999" });
    assert.equal(isSysPlus(m, null), true);
    assert.equal(canConfigureSysPlus(m), true);
  } finally {
    if (previousOwner === undefined) delete process.env.PND_OWNER_DISCORD_ID;
    else process.env.PND_OWNER_DISCORD_ID = previousOwner;
  }
});
test("Discord administrator does not automatically receive SYS+ or SYS+ configuration rights", () => {
  const m = member({ admin: true });
  assert.equal(isSysPlus(m, null), false);
  assert.equal(canConfigureSysPlus(m), false);
});
test("configured role grants SYS+ but not configuration rights", () => {
  const m = member({ roles: ["55555"] });
  assert.equal(isSysPlus(m, "55555"), true);
  assert.equal(canConfigureSysPlus(m), false);
});
test("missing or wrong role fails closed", () => {
  const m = member();
  assert.equal(isSysPlus(m, null), false);
  assert.equal(isSysPlus(m, "55555"), false);
});

test("incomplete member identities fail closed for owner checks", () => {
  const m = { guild: {}, roles: { cache: new Map() }, permissions: { has: () => false } };
  assert.equal(isSysPlus(m, null), false);
  assert.equal(canConfigureSysPlus(m), false);
});

test("ADMIN+ grants limited staff access but is not SYS+", async () => {
  const { isAdminPlus } = await import("./permissions.js");
  const m = member({ roles: ["adminplus"] });
  assert.equal(isAdminPlus(m, "sysplus", "adminplus"), true);
  assert.equal(isSysPlus(m, "sysplus"), false);
});

test("SYS+ remains a separate entitlement and does not imply ADMIN+", async () => {
  const { isAdminPlus } = await import("./permissions.js");
  const m = member({ roles: ["sysplus"] });
  assert.equal(isAdminPlus(m, "sysplus", "adminplus"), false);
  assert.equal(isSysPlus(m, "sysplus"), true);
});


test("only the configured PND owner receives implicit SYS+; legacy cofounder IDs are ignored", async () => {
  const previousOwner = process.env.PND_OWNER_DISCORD_ID;
  const previousCofounders = process.env.PND_COFOUNDER_DISCORD_IDS;
  process.env.PND_OWNER_DISCORD_ID = "12345";
  process.env.PND_COFOUNDER_DISCORD_IDS = "54321,67890";
  try {
    const { isAdminPlus } = await import("./permissions.js");
    const pndOwner = member({ id: "12345" });
    assert.equal(isSysPlus(pndOwner, null), true);
    assert.equal(isAdminPlus(pndOwner, null, null), true);
    assert.equal(canConfigureSysPlus(pndOwner), true);
    const cofounder = member({ id: "54321" });
    assert.equal(isSysPlus(cofounder, null), false);
    assert.equal(isAdminPlus(cofounder, null, null), false);
    assert.equal(canConfigureSysPlus(cofounder), false);
  } finally {
    if (previousOwner === undefined) delete process.env.PND_OWNER_DISCORD_ID;
    else process.env.PND_OWNER_DISCORD_ID = previousOwner;
    if (previousCofounders === undefined) delete process.env.PND_COFOUNDER_DISCORD_IDS;
    else process.env.PND_COFOUNDER_DISCORD_IDS = previousCofounders;
  }
});
