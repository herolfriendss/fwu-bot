import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "pnd-perks-")), "economy.sqlite");
const { db } = await import("../database.js");
const P = await import("./perks.js");

const USER = "200000000000000001";
let n = 50;
const freshGuild = () => `10000000000000${++n}`;
const fund = (guild, amount) =>
  db.prepare("INSERT INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,?,0) ON CONFLICT(guild_id,user_id) DO UPDATE SET balance=excluded.balance")
    .run(guild, USER, amount);
const balance = (guild) =>
  Number(db.prepare("SELECT balance FROM wallets WHERE guild_id=? AND user_id=?").get(guild, USER)?.balance ?? 0);

test("the catalogue is coherent: a price, a duration and an owning bot", () => {
  assert.ok(P.PERKS.length >= 4);
  for (const perk of P.PERKS) {
    assert.ok(perk.price > 0 && perk.durationMs > 0, perk.kind);
    assert.ok(perk.bot && perk.label && perk.description, perk.kind);
    assert.equal(P.perkByKind(perk.kind).kind, perk.kind);
  }
  assert.equal(P.perkByKind("inconnu"), null);
});

test("buying takes the money and turns the perk on", () => {
  const guild = freshGuild();
  fund(guild, 50_000);
  const result = P.buyPerk({ guildId: guild, userId: USER, kind: "xp_boost" });
  assert.equal(balance(guild), 50_000 - result.perk.price);
  assert.equal(P.perkActive(guild, USER, "xp_boost"), true);
  assert.equal(P.perkActive(guild, USER, "dj"), false, "seul l'avantage acheté est actif");
  assert.equal(result.extended, false);
});

test("buying without the money changes nothing", () => {
  const guild = freshGuild();
  fund(guild, 100);
  assert.throws(() => P.buyPerk({ guildId: guild, userId: USER, kind: "xp_boost" }), /PND/);
  assert.equal(balance(guild), 100);
  assert.equal(P.perkActive(guild, USER, "xp_boost"), false);
});

test("buying an active perk again extends it instead of wasting the money", () => {
  const guild = freshGuild();
  fund(guild, 200_000);
  const first = P.buyPerk({ guildId: guild, userId: USER, kind: "xp_boost" });
  const second = P.buyPerk({ guildId: guild, userId: USER, kind: "xp_boost" });
  assert.equal(second.extended, true);
  assert.ok(second.expiresAt > first.expiresAt);
});

test("stacking is capped so nothing is locked in for a year", () => {
  const guild = freshGuild();
  fund(guild, 100_000_000);
  let last = 0;
  for (let i = 0; i < 60; i += 1) last = P.buyPerk({ guildId: guild, userId: USER, kind: "xp_boost" }).expiresAt;
  assert.ok(last - Date.now() <= 31 * 86_400_000, "plafonné à un mois");
});

test("an unknown perk is refused before any money moves", () => {
  const guild = freshGuild();
  fund(guild, 50_000);
  assert.throws(() => P.buyPerk({ guildId: guild, userId: USER, kind: "voler_tout" }), /n'existe pas/);
  assert.equal(balance(guild), 50_000);
});

test("a perk reads as inactive once its time has passed", () => {
  const guild = freshGuild();
  fund(guild, 50_000);
  const { expiresAt } = P.buyPerk({ guildId: guild, userId: USER, kind: "anti_vol" });
  assert.equal(P.perkActive(guild, USER, "anti_vol", expiresAt + 1), false);
});

test("expiry reports what ran out, once, with its payload", () => {
  const guild = freshGuild();
  fund(guild, 50_000);
  P.buyPerk({ guildId: guild, userId: USER, kind: "couleur", payload: { colour: 0xe21d2f }, now: Date.now() - 30 * 86_400_000 });
  const gone = P.expirePerks();
  const mine = gone.find((perk) => perk.guildId === guild);
  assert.ok(mine);
  assert.equal(mine.kind, "couleur");
  assert.equal(mine.payload.colour, 0xe21d2f);
  assert.equal(P.expirePerks().filter((perk) => perk.guildId === guild).length, 0);
});

test("active perks are listed with their end time", () => {
  const guild = freshGuild();
  fund(guild, 200_000);
  P.buyPerk({ guildId: guild, userId: USER, kind: "dj" });
  P.buyPerk({ guildId: guild, userId: USER, kind: "anti_vol" });
  const mine = P.activePerks(guild, USER);
  assert.equal(mine.length, 2);
  assert.ok(mine.every((perk) => perk.expiresAt > Date.now() && perk.label));
});

test("a perk can be taken back", () => {
  const guild = freshGuild();
  fund(guild, 50_000);
  P.buyPerk({ guildId: guild, userId: USER, kind: "dj" });
  assert.equal(P.revokePerk(guild, USER, "dj"), 1);
  assert.equal(P.perkActive(guild, USER, "dj"), false);
});

test("the XP boost raises the gain and leaves it alone otherwise", () => {
  assert.equal(P.boostedXp(20, false), 20);
  assert.equal(P.boostedXp(20, true), 30);
  assert.equal(P.boostedXp(0, true), 0);
});

test("colours are parsed with or without the hash, and refused otherwise", () => {
  assert.equal(P.parseColour("#e21d2f"), 0xe21d2f);
  assert.equal(P.parseColour("E21D2F"), 0xe21d2f);
  assert.equal(P.parseColour("rouge"), null);
  assert.equal(P.parseColour("#fff"), null);
  assert.equal(P.parseColour(null), null);
});
