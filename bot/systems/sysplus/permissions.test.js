import test from "node:test";
import assert from "node:assert/strict";
import { isSysPlus, canConfigureSysPlus } from "./permissions.js";

function member({ id = "12345", ownerId = "99999", admin = false, roles = [] } = {}) {
  return {
    id,
    guild: { ownerId },
    permissions: { has: (flag) => admin },
    roles: { cache: new Map(roles.map((r) => [r, true])) },
  };
}
test("owner is SYS+ and can configure", () => {
  const m = member({ id: "99999" });
  assert.equal(isSysPlus(m, null), true);
  assert.equal(canConfigureSysPlus(m), true);
});
test("administrator is SYS+ and can configure", () => {
  const m = member({ admin: true });
  assert.equal(isSysPlus(m, null), true);
  assert.equal(canConfigureSysPlus(m), true);
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
