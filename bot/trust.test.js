import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "pnd-trust-")), "economy.sqlite");
const { db } = await import("./database.js");
await import("./features/community.js");
const {
  computeTrust, tierForScore, trustFor, trustSignals, invalidateTrust,
  applySanction, liftSanction, sanctionUntil, activeSanctions, expireSanctions, permissionFor,
} = await import("./trust.js");

const GUILD = "100000000000000001";
const USER = "200000000000000001";
const DAY = 86_400_000;
const veteran = { accountAgeMs: 900 * DAY, memberForMs: 400 * DAY, level: 40, messages: 5000, voiceMinutes: 4000 };

test("a brand-new account starts well below a settled member", () => {
  const fresh = computeTrust({ accountAgeMs: 2 * DAY, memberForMs: 0, hasAvatar: false });
  const settled = computeTrust(veteran);
  assert.ok(fresh.score < 40, `un compte neuf doit être bridé (${fresh.score})`);
  assert.ok(settled.score > fresh.score + 30);
  assert.equal(settled.tier.key, "veteran");
});

test("the score stays inside 0 and 100", () => {
  assert.equal(computeTrust({ accountAgeMs: 0, activeWarnings: 20, quarantined: true, hasAvatar: false }).score, 0);
  assert.equal(computeTrust({ ...veteran, accountAgeMs: 4000 * DAY }).score, 100);
});

test("sanctions pull the score down and are explained", () => {
  const clean = computeTrust(veteran);
  const warned = computeTrust({ ...veteran, activeWarnings: 2 });
  const banned = computeTrust({ ...veteran, recentCases: ["ban"] });
  assert.ok(warned.score < clean.score);
  assert.ok(banned.score < warned.score);
  assert.ok(banned.reasons.some((r) => /Sanctions/.test(r.label)));
});

test("quarantine is the heaviest single penalty", () => {
  const inside = computeTrust({ ...veteran, quarantined: true });
  assert.ok(inside.reasons.some((r) => r.points === -30));
  assert.ok(inside.score < computeTrust(veteran).score);
});

test("bots are trusted without being scored", () => {
  const result = computeTrust({ bot: true, accountAgeMs: 0 });
  assert.equal(result.score, 100);
  assert.equal(result.reasons.length, 1);
});

test("tiers are ordered and cover the whole range", () => {
  assert.equal(tierForScore(0).key, "risque");
  assert.equal(tierForScore(19).key, "risque");
  assert.equal(tierForScore(20).key, "surveille");
  assert.equal(tierForScore(50).key, "normal");
  assert.equal(tierForScore(70).key, "confirme");
  assert.equal(tierForScore(100).key, "veteran");
});

test("signals are read from what the bots already recorded", () => {
  db.prepare("INSERT INTO community_levels(guild_id,user_id,xp,level,messages,voice_minutes,last_message_xp_at) VALUES(?,?,?,?,?,?,0)")
    .run(GUILD, USER, 9000, 12, 1400, 900);
  db.prepare("INSERT INTO moderation_warnings(guild_id,user_id,moderator_id,reason,created_at,expires_at) VALUES(?,?,?,?,?,NULL)")
    .run(GUILD, USER, "300000000000000001", "spam", Date.now());
  db.prepare("INSERT INTO moderation_cases(guild_id,user_id,moderator_id,action,reason,created_at) VALUES(?,?,?,?,?,?)")
    .run(GUILD, USER, "300000000000000001", "mute", "spam", Date.now());

  const signals = trustSignals(GUILD, USER, null);
  assert.equal(signals.level, 12);
  assert.equal(signals.messages, 1400);
  assert.equal(signals.activeWarnings, 1);
  assert.deepEqual(signals.recentCases, ["mute"]);
});

test("an expired warning no longer counts", () => {
  const guild = "100000000000000009";
  db.prepare("INSERT INTO moderation_warnings(guild_id,user_id,moderator_id,reason,created_at,expires_at) VALUES(?,?,?,?,?,?)")
    .run(guild, USER, "300000000000000001", "ancien", Date.now() - 10 * DAY, Date.now() - DAY);
  assert.equal(trustSignals(guild, USER, null).activeWarnings, 0);
});

test("the score is cached and the cache can be dropped", () => {
  const first = trustFor(GUILD, USER);
  assert.equal(first.cached, false);
  assert.equal(trustFor(GUILD, USER).cached, true);
  invalidateTrust(GUILD, USER);
  assert.equal(trustFor(GUILD, USER).cached, false);
});

test("a sanction freezes one capability and lifts on its own", () => {
  const guild = "100000000000000002";
  const until = applySanction({ guildId: guild, userId: USER, scope: "casino", durationMs: 60_000, reason: "warn" });
  assert.ok(until > Date.now());
  assert.ok(sanctionUntil(guild, USER, "casino"));
  assert.equal(sanctionUntil(guild, USER, "dj"), null, "les autres domaines restent ouverts");
  assert.equal(activeSanctions(guild, USER).length, 1);
  assert.equal(sanctionUntil(guild, USER, "casino", Date.now() + 120_000), null, "expirée plus tard");
});

test("the longest sanction wins and lifting is explicit", () => {
  const guild = "100000000000000003";
  applySanction({ guildId: guild, userId: USER, scope: "casino", durationMs: 600_000 });
  const shorter = applySanction({ guildId: guild, userId: USER, scope: "casino", durationMs: 1000 });
  assert.ok(sanctionUntil(guild, USER, "casino") > shorter - 1, "une sanction courte ne raccourcit pas une longue");
  assert.equal(liftSanction(guild, USER, "casino"), 1);
  assert.equal(sanctionUntil(guild, USER, "casino"), null);
});

test("expiry reports what was lifted, once", () => {
  const guild = "100000000000000004";
  applySanction({ guildId: guild, userId: USER, scope: "dj", durationMs: 1000, now: Date.now() - 10_000 });
  const lifted = expireSanctions();
  assert.ok(lifted.some((row) => row.guildId === guild && row.scope === "dj"));
  assert.equal(expireSanctions().filter((row) => row.guildId === guild).length, 0);
});

test("an unknown scope is refused", () => {
  assert.throws(() => applySanction({ guildId: GUILD, userId: USER, scope: "nimportequoi", durationMs: 1000 }), /inconnu/);
});

test("permission answers with a ceiling, and says why when it refuses", () => {
  const guild = "100000000000000005";
  const trusted = "200000000000000055";
  db.prepare("INSERT INTO community_levels(guild_id,user_id,xp,level,messages,voice_minutes,last_message_xp_at) VALUES(?,?,?,?,?,?,0)")
    .run(guild, trusted, 90000, 40, 5000, 4000);
  const ok = permissionFor(guild, trusted, "casino", { baseBet: 100_000 });
  assert.equal(ok.allowed, true);
  assert.ok(ok.maxBet >= 100_000);

  applySanction({ guildId: guild, userId: trusted, scope: "casino", durationMs: 60_000, reason: "avertissement" });
  const frozen = permissionFor(guild, trusted, "casino");
  assert.equal(frozen.allowed, false);
  assert.match(frozen.reason, /suspendu/);
});

test("a trust score never automatically restricts a member", () => {
  const guild = "100000000000000006";
  const risky = "200000000000000066";
  db.prepare("INSERT INTO fwu_trust(guild_id,user_id,score,tier,reasons_json,computed_at) VALUES(?,?,?,?,'[]',?)")
    .run(guild, risky, 5, "risque", Date.now());
  const verdict = permissionFor(guild, risky, "casino");
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.maxBet, 100_000);
  assert.equal(verdict.reason, null);
});

test("only an explicit scoped sanction can freeze a capability", () => {
  const guild = "100000000000000007";
  const member = "200000000000000077";
  db.prepare("INSERT INTO fwu_trust(guild_id,user_id,score,tier,reasons_json,computed_at) VALUES(?,?,?,?,'[]',?)")
    .run(guild, member, 0, "risque", Date.now());
  const before = permissionFor(guild, member, "casino");
  assert.equal(before.allowed, true);
  applySanction({ guildId: guild, userId: member, scope: "casino", durationMs: 60_000, reason: "Décision staff documentée" });
  const after = permissionFor(guild, member, "casino");
  assert.equal(after.allowed, false);
  assert.match(after.reason, /sanction explicite/);
  assert.throws(() => permissionFor(guild, member, "unknown"), /Domaine de permission inconnu/);
});
