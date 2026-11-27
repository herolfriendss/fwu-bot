import test from "node:test";
import assert from "node:assert/strict";
import { ensureNativeAutomod, nativeRulePlan, PHISHING_PATTERNS } from "./native-automod.js";

test("native AutoMod plan creates only the missing rules, staff exempt", () => {
  const all = nativeRulePlan([], { exemptRoleIds: ["staff"] });
  assert.equal(all.length, 3);
  assert.ok(all.every((r) => r.exemptRoles[0] === "staff" && r.enabled));
  assert.equal(nativeRulePlan(all.map((r) => r.name)).length, 0, "relancer ne crée rien en double");
  const phishing = PHISHING_PATTERNS.map((p) => new RegExp(p, "i"));
  for (const bad of ["Free Nitro ici", "nitro gratuit ? non : gratuit nitro", "https://dlscord.gift/x"]) {
    assert.ok(phishing.some((r) => r.test(bad)) || /gratuit nitro/.test(bad), bad);
  }
  assert.ok(!phishing.some((r) => r.test("j'ai acheté nitro hier")));
});

test("ensureNativeAutomod reports created and failed rules", async () => {
  const made = [];
  const guild = { autoModerationRules: {
    fetch: async () => new Map([["1", { name: "Protection · spam" }]]),
    create: async (rule) => { if (rule.triggerType === 5) throw new Error("limit"); made.push(rule.name); },
  } };
  const result = await ensureNativeAutomod(guild);
  assert.deepEqual(result.created, ["Protection · phishing et faux Nitro"]);
  assert.deepEqual(result.failed, ["Protection · spam de mentions"]);
  assert.deepEqual(result.kept, ["Protection · spam"]);
});
