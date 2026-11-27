import test from "node:test";
import assert from "node:assert/strict";
import { createPermissionWatch, isPhishingExecution, matchBanEvader, missingPermissions } from "./extra-watch.js";

test("ban evader: recent account with a banned name or avatar", () => {
  const now = 100 * 86_400_000;
  const member = (u) => ({ displayName: u.globalName ?? u.username, user: { bot: false, createdTimestamp: now - 86_400_000, ...u } });
  const bans = [{ id: "b1", username: "Raider_Pro", avatar: "abc" }];
  assert.equal(matchBanEvader(member({ id: "n", username: "raiderpro" }), bans, { now }).reason, "même pseudo");
  assert.equal(matchBanEvader(member({ id: "n", username: "zzz", avatar: "abc" }), bans, { now }).reason, "même avatar");
  assert.equal(matchBanEvader(member({ id: "n", username: "quelquun" }), bans, { now }), null);
  assert.equal(matchBanEvader({ ...member({ id: "n", username: "raiderpro" }), user: { username: "raiderpro", createdTimestamp: 0 } }, bans, { now }), null, "vieux compte");
});

test("phishing rule detection and permission watch", () => {
  assert.equal(isPhishingExecution({ userId: "u" }, "Protection · phishing et faux Nitro"), true);
  assert.equal(isPhishingExecution({ userId: "u" }, "Protection · spam"), false);
  const perms = (names) => ({ has: (bit) => names.some((n) => n === bit) });
  const { PermissionFlagsBits: P } = { PermissionFlagsBits: { Administrator: 8n } };
  void P;
  const all = missingPermissions({ has: () => false }, "fisc");
  assert.deepEqual(all, ["SendMessages", "EmbedLinks"]);
  assert.deepEqual(missingPermissions({ has: () => true }, "guard"), []);
  const watch = createPermissionWatch();
  assert.equal(watch.check("g", []), null, "premier relevé complet : rien");
  assert.deepEqual(watch.check("g", ["BanMembers"]), { lost: ["BanMembers"], regained: [] });
  assert.equal(watch.check("g", ["BanMembers"]), null);
  assert.deepEqual(watch.check("g", []), { lost: [], regained: ["BanMembers"] });
  void perms;
});
