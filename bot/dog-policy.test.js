import test from "node:test";
import assert from "node:assert/strict";
import {
  LEASH_ROLE_NAME,
  LEGACY_LEASH_ROLE_NAMES,
  MAX_ACTIVE_LEASHES_PER_SYSPLUS,
  countActiveLeashesForOwner,
  canCreateLeash,
  leashQuotaStatus,
  findLeashRole,
  isLeashRoleName,
  isOwnerLeashRoleName,
  leashRoleName,
  resolveMaxActiveLeashes,
  MIN_CONFIGURABLE_LEASHES_PER_SYSPLUS,
  MAX_CONFIGURABLE_LEASHES_PER_SYSPLUS,
} from "./dog-policy.js";

const records = {
  a: { guildId: "g1", ownerId: "sys1", memberId: "m1" },
  b: { guildId: "g1", ownerId: "sys1", memberId: "m2" },
  c: { guildId: "g1", ownerId: "sys1", memberId: "m3" },
  d: { guildId: "g1", ownerId: "sys2", memberId: "m4" },
  e: { guildId: "g2", ownerId: "sys1", memberId: "m5" },
  f: { guildId: "g1", ownerId: "sys1", memberId: "m6", releasing: true },
};

test("DOG limit is three active leashes per SYS+ and per guild", () => {
  assert.equal(MAX_ACTIVE_LEASHES_PER_SYSPLUS, 3);
  assert.equal(countActiveLeashesForOwner(records, "g1", "sys1"), 3);
  assert.equal(canCreateLeash(records, "g1", "sys1"), false);
  assert.equal(canCreateLeash(records, "g1", "sys1", MAX_ACTIVE_LEASHES_PER_SYSPLUS, true), true);
  assert.equal(canCreateLeash(records, "g1", "sys2"), true);
  assert.equal(canCreateLeash(records, "g2", "sys1"), true);
});

test("releasing leashes do not consume a slot", () => {
  const copy = { ...records, a: { ...records.a, releasing: true } };
  assert.equal(countActiveLeashesForOwner(copy, "g1", "sys1"), 2);
  assert.equal(canCreateLeash(copy, "g1", "sys1"), true);
});

test("WHITELIST is labeled and audited only when it actually exceeds the internal quota", () => {
  assert.deepEqual(leashQuotaStatus(records, "g1", "sys1", 3, true), {
    activeCount: 3,
    exceptionUsed: true,
    label: "4 (exception WHITELIST)",
  });
  assert.deepEqual(leashQuotaStatus(records, "g1", "sys2", 3, true), {
    activeCount: 1,
    exceptionUsed: false,
    label: "2/3",
  });
  assert.equal(leashQuotaStatus(records, "g1", "sys1", 3, false).exceptionUsed, false);
});

test("DOG uses the exact required role name and recognizes the stored legacy name", () => {
  assert.equal(LEASH_ROLE_NAME, "En laisse");
  assert.deepEqual(LEGACY_LEASH_ROLE_NAMES, ["🐶 En laisse · Her?"]);
});

test("rôle de laisse par maître : « En laisse (Pseudo) », 100 caractères maximum", () => {
  assert.equal(leashRoleName("Ryan"), "En laisse (Ryan)");
  assert.equal(leashRoleName("  Le   Boss \n"), "En laisse (Le Boss)");
  assert.equal(leashRoleName(""), "En laisse (son maître)");
  const long = leashRoleName("x".repeat(200));
  assert.equal(long.length, 100);
  assert.match(long, /^En laisse \(x+…\)$/);
  assert.equal(isLeashRoleName("En laisse (Ryan)"), true);
  assert.equal(isLeashRoleName("En laisse"), true, "ancien rôle commun encore reconnu (migration)");
  assert.equal(isLeashRoleName(LEGACY_LEASH_ROLE_NAMES[0]), true);
  assert.equal(isLeashRoleName("Membre"), false);
  assert.equal(isOwnerLeashRoleName("En laisse"), false);
  assert.equal(isOwnerLeashRoleName("En laisse (Ryan)"), true);
});

test("le rôle d'un maître est retrouvé par son nom ; refusé s'il est au-dessus du bot", () => {
  const role = { name: "En laisse (Ryan)", managed: false, position: 2 };
  const cache = { find: (predicate) => [role, { name: "En laisse (Autre)", managed: false, position: 2 }].find(predicate) };
  assert.equal(findLeashRole(cache, 5, "Ryan"), role);
  assert.equal(findLeashRole(cache, 5, "Inconnu"), null);
  assert.throws(() => findLeashRole(cache, 2, "Ryan"), /sous le rôle le plus élevé/);
});

test("configured leash limit accepts only integers from 1 to 10 and falls back to 3 otherwise", () => {
  assert.equal(MIN_CONFIGURABLE_LEASHES_PER_SYSPLUS, 1);
  assert.equal(MAX_CONFIGURABLE_LEASHES_PER_SYSPLUS, 10);
  for (const value of [1, 5, 10]) assert.equal(resolveMaxActiveLeashes(value), value);
  for (const value of [undefined, null, 0, 11, -1, 2.5, NaN, Infinity, "5", "", true, {}]) {
    assert.equal(resolveMaxActiveLeashes(value), 3, `valeur ${String(value)}`);
  }
});

test("configured limit applies per SYS+ and per guild without touching other guilds", () => {
  const scoped = {
    a: { guildId: "g1", ownerId: "sys1", memberId: "m1" },
    b: { guildId: "g1", ownerId: "sys1", memberId: "m2" },
    c: { guildId: "g1", ownerId: "sys1", memberId: "m3" },
    d: { guildId: "g1", ownerId: "sys1", memberId: "m4" },
    e: { guildId: "g2", ownerId: "sys1", memberId: "m5" },
  };
  // g1 / sys1 holds 4 leashes: room under a limit of 5, none under a limit of 4.
  assert.equal(canCreateLeash(scoped, "g1", "sys1", 5), true);
  assert.equal(canCreateLeash(scoped, "g1", "sys1", 4), false);
  // Another guild's leashes never consume g1's quota.
  assert.equal(canCreateLeash(scoped, "g2", "sys1", 2), true);
  // Another SYS+ in the same guild has an independent quota.
  assert.equal(canCreateLeash(scoped, "g1", "sys2", 1), true);
});

test("lowering the limit keeps existing leashes and only blocks new ones", () => {
  const records = {
    a: { guildId: "g1", ownerId: "sys1", memberId: "m1" },
    b: { guildId: "g1", ownerId: "sys1", memberId: "m2" },
    c: { guildId: "g1", ownerId: "sys1", memberId: "m3" },
  };
  assert.equal(canCreateLeash(records, "g1", "sys1", 2), false);
  assert.equal(countActiveLeashesForOwner(records, "g1", "sys1"), 3);
});

test("WHITELIST keeps its exception and audit label with a configured limit", () => {
  const records = {
    a: { guildId: "g1", ownerId: "sys1", memberId: "m1" },
    b: { guildId: "g1", ownerId: "sys1", memberId: "m2" },
    c: { guildId: "g1", ownerId: "sys1", memberId: "m3" },
    d: { guildId: "g1", ownerId: "sys1", memberId: "m4" },
    e: { guildId: "g1", ownerId: "sys1", memberId: "m5" },
  };
  assert.equal(canCreateLeash(records, "g1", "sys1", 5), false);
  assert.equal(canCreateLeash(records, "g1", "sys1", 5, true), true);
  assert.deepEqual(leashQuotaStatus(records, "g1", "sys1", 5, true), {
    activeCount: 5,
    exceptionUsed: true,
    label: "6 (exception WHITELIST)",
  });
  assert.equal(leashQuotaStatus(records, "g1", "sys1", 5, false).exceptionUsed, false);
});
