import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "pnd-cascade-")), "economy.sqlite");
const { db } = await import("./database.js");
const { publishEvent, recentEvents } = await import("./event-bus.js");
const { sanctionUntil, applySanction, activeSanctions } = await import("./trust.js");
const { planFor, applyPlan, runCascade, grantPnd, levelBonus, SANCTION_RULES } = await import("./cascade.js");

const GUILD = "100000000000000001";
const USER = "200000000000000001";
const balance = (guildId, userId) =>
  Number(db.prepare("SELECT balance FROM wallets WHERE guild_id=? AND user_id=?").get(guildId, userId)?.balance ?? 0);
const event = (kind, over = {}) => ({ id: Math.floor(Math.random() * 1e9), guildId: GUILD, kind, subjectId: USER, payload: {}, source: "guard", ...over });

test("a warning plans a casino freeze, a ban freezes everything", () => {
  const warn = planFor(event("member.warned"));
  assert.deepEqual(warn.find((a) => a.type === "sanction").scopes, ["casino"]);
  const ban = planFor(event("member.banned")).find((a) => a.type === "sanction");
  assert.ok(ban.scopes.length > 3);
  assert.ok(ban.ms > SANCTION_RULES["member.warned"].ms);
});

test("an event nobody reacts to plans nothing", () => {
  assert.deepEqual(planFor(event("music.played")), []);
  assert.deepEqual(planFor(event("member.warned", { subjectId: null })), []);
});

test("a mute uses the real duration when the event carries one", () => {
  const plan = planFor(event("member.muted", { payload: { durationMs: 60_000 } }));
  assert.equal(plan.find((a) => a.type === "sanction").ms, 60_000);
});

test("the level bonus grows then flattens", () => {
  assert.ok(levelBonus(1) > 0);
  assert.ok(levelBonus(20) > levelBonus(5));
  assert.equal(levelBonus(100_000), 25_000);
});

test("a warning really freezes the casino for the member", () => {
  const guild = "100000000000000002";
  applyPlan(event("member.warned", { guildId: guild }));
  assert.ok(sanctionUntil(guild, USER, "casino"));
  assert.equal(sanctionUntil(guild, USER, "dj"), null);
});

test("an unban lifts every freeze", () => {
  const guild = "100000000000000003";
  applyPlan(event("member.banned", { guildId: guild }));
  assert.ok(activeSanctions(guild, USER).length > 3);
  applyPlan(event("member.unbanned", { guildId: guild }));
  assert.equal(activeSanctions(guild, USER).length, 0);
});

test("a level-up pays once, even if the event is replayed", () => {
  const guild = "100000000000000004";
  const levelUp = event("member.levelup", { guildId: guild, payload: { level: 10 } });
  const first = applyPlan(levelUp);
  assert.match(first[0], /PND/);
  const paid = balance(guild, USER);
  assert.equal(paid, levelBonus(10));
  applyPlan(levelUp);
  assert.equal(balance(guild, USER), paid, "un rejeu ne crée pas d'argent");
});

test("two different events both pay", () => {
  const guild = "100000000000000005";
  applyPlan(event("member.levelup", { guildId: guild, payload: { level: 5 } }));
  applyPlan(event("member.birthday", { guildId: guild }));
  assert.equal(balance(guild, USER), levelBonus(5) + 5000);
});

test("a grant with no amount does nothing", () => {
  assert.equal(grantPnd({ eventId: 1, rule: "x", guildId: GUILD, userId: USER, amount: 0, reason: "x" }), 0);
  assert.equal(grantPnd({ eventId: 2, rule: "x", guildId: GUILD, userId: USER, amount: -5, reason: "x" }), 0);
});

test("a cascade pass drains the bus and reports its effects", async () => {
  const guild = "100000000000000006";
  publishEvent({ guildId: guild, kind: "member.warned", subjectId: USER, source: "guard" });
  publishEvent({ guildId: guild, kind: "member.levelup", subjectId: USER, payload: { level: 3 }, source: "fwu" });
  const lines = [];
  const run = await runCascade({ onEffect: (_e, line) => lines.push(line) });
  assert.ok(run.effects >= 2);
  assert.ok(lines.some((line) => /gel casino/.test(line)));
  assert.ok(lines.some((line) => /PND/.test(line)));

  const again = await runCascade();
  assert.equal(again.effects, 0, "rien n'est rejoué");
});

test("an expired sanction is announced on the bus and lifted", async () => {
  const guild = "100000000000000007";
  applySanction({ guildId: guild, userId: USER, scope: "dj", durationMs: 1000, now: Date.now() - 10_000 });
  await runCascade();
  assert.equal(sanctionUntil(guild, USER, "dj"), null);
  assert.ok(recentEvents(guild, { kinds: ["sanction.expired"] }).length >= 1);
});

test("activity from a clan member feeds the clan, once", async () => {
  const { createClan, clanById, membershipOf } = await import("./features/clans.js");
  const guild = "100000000000000020";
  db.prepare("INSERT INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,?,0)").run(guild, USER, 200_000);
  const clan = createClan({ guildId: guild, userId: USER, name: "Cascadeurs", tag: "CS" });

  const levelUp = event("member.levelup", { guildId: guild, payload: { level: 4 } });
  applyPlan(levelUp);
  assert.equal(clanById(clan.id).season_points, 40);
  applyPlan(levelUp);
  assert.equal(clanById(clan.id).season_points, 40, "un rejeu ne gonfle pas le classement");
  assert.ok(membershipOf(guild, USER));
});

test("a season past its end date is closed by the cascade", async () => {
  const { startSeason, currentSeason } = await import("./features/clans.js");
  const guild = "100000000000000021";
  startSeason({ guildId: guild, lengthMs: 1000, now: Date.now() - 10_000 });
  const lines = [];
  await runCascade({ onEffect: (_e, line) => lines.push(line) });
  assert.equal(currentSeason(guild), null);
  assert.ok(lines.some((line) => /saison 1 clôturée/.test(line)));
});
