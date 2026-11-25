import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "pnd-overview-")), "economy.sqlite");
const { db } = await import("../database.js");
await import("./community.js");
await import("./confessions.js");
const { memberOverview, overviewEmbed, botPresence, panelView } = await import("./overview.js");

const GUILD = "100000000000000001";
const USER = "200000000000000001";
const OTHER = "200000000000000002";

test("a member with no history still gets a readable profile", () => {
  const overview = memberOverview(GUILD, "200000000000000099");
  assert.equal(overview.level, null);
  assert.equal(overview.economy, null);
  const json = JSON.stringify(overviewEmbed(overview, { username: "Inconnu" }).toJSON());
  assert.match(json, /Aucune activité/);
  assert.match(json, /Confiance/, "le score de confiance est toujours affiché");
});

test("the profile gathers level, money and casino in one read", () => {
  db.prepare("INSERT INTO community_levels(guild_id,user_id,xp,level,messages,voice_minutes,last_message_xp_at) VALUES(?,?,?,?,?,?,0)")
    .run(GUILD, USER, 4200, 9, 730, 185);
  db.prepare("INSERT INTO community_levels(guild_id,user_id,xp,level,messages,voice_minutes,last_message_xp_at) VALUES(?,?,?,?,?,?,0)")
    .run(GUILD, OTHER, 9000, 14, 1200, 60);
  db.prepare("INSERT INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,?,?)").run(GUILD, USER, 15_000, 4000);
  db.prepare(`INSERT INTO casino_rounds(idempotency_key,guild_id,user_id,game,bet,payout,outcome_json,created_at)
    VALUES(?,?,?,?,?,?,'{}',?)`).run("r1", GUILD, USER, "mines", 1000, 2500, Date.now());

  const overview = memberOverview(GUILD, USER);
  assert.equal(overview.level.level, 9);
  assert.equal(overview.level.rank, 2, "classé derrière le membre qui a plus d'XP");
  assert.equal(overview.level.total, 2);
  assert.equal(overview.economy.balance, 15_000);
  assert.equal(overview.economy.bank, 4000);
  assert.equal(overview.economy.casinoNet, 1500);
});

test("the embed shows money, rank and voice time", () => {
  const json = JSON.stringify(overviewEmbed(memberOverview(GUILD, USER), { username: "Ryan" }).toJSON());
  assert.match(json, /15 ?.?000 PND/);
  assert.match(json, /3 h 5 min/, "185 minutes de vocal doivent se lire en heures");
  assert.match(json, /Casino/);
});

test("warnings and sanctions surface on the profile", () => {
  const guild = "100000000000000002";
  db.prepare("INSERT INTO moderation_warnings(guild_id,user_id,moderator_id,reason,created_at,expires_at) VALUES(?,?,?,?,?,NULL)")
    .run(guild, USER, "300000000000000001", "spam", Date.now());
  db.prepare("INSERT INTO fwu_sanctions(guild_id,user_id,scope,until,reason,created_at) VALUES(?,?,?,?,?,?)")
    .run(guild, USER, "casino", Date.now() + 3_600_000, "avertissement", Date.now());

  const overview = memberOverview(guild, USER);
  assert.equal(overview.record.warnings, 1);
  assert.equal(overview.sanctions.length, 1);
  const json = JSON.stringify(overviewEmbed(overview, { username: "Ryan" }).toJSON());
  assert.match(json, /avertissement/);
  assert.match(json, /Accès suspendus/);
});

test("a clean member is shown as having a clean record", () => {
  const json = JSON.stringify(overviewEmbed(memberOverview("100000000000000003", USER), { username: "Net" }).toJSON());
  assert.match(json, /Vierge/);
});

test("published confessions are counted, drafts are not", () => {
  const guild = "100000000000000004";
  const insert = db.prepare(`INSERT INTO community_confessions(guild_id,number,author_id,body,status,created_at) VALUES(?,?,?,?,?,?)`);
  insert.run(guild, 1, USER, "a", "published", Date.now());
  insert.run(guild, 2, USER, "b", "pending", Date.now());
  assert.equal(memberOverview(guild, USER).extras.confessions, 1);
});

test("presence lists the six bots and marks a stale lease offline", () => {
  const now = Date.now();
  db.exec(`CREATE TABLE IF NOT EXISTS bot_domain_leases (
    domain TEXT PRIMARY KEY, holder TEXT NOT NULL, expires_at INTEGER NOT NULL, renewed_at INTEGER NOT NULL)`);
  db.prepare("INSERT OR REPLACE INTO bot_domain_leases(domain,holder,expires_at,renewed_at) VALUES(?,?,?,?)")
    .run("fwu", "host-1", now + 60_000, now);
  db.prepare("INSERT OR REPLACE INTO bot_domain_leases(domain,holder,expires_at,renewed_at) VALUES(?,?,?,?)")
    .run("guard", "host-2", now - 10 * 60_000, now - 11 * 60_000);

  const presence = botPresence(now);
  assert.equal(presence.length, 6);
  assert.equal(presence.find((b) => b.id === "fwu").online, true);
  assert.equal(presence.find((b) => b.id === "guard").online, false, "un bail périmé veut dire hors ligne");
  assert.equal(presence.find((b) => b.id === "fisc").online, false, "aucun bail veut dire hors ligne");
});

test("the panel names every bot and warns about the ones that are down", () => {
  const view = panelView();
  const json = JSON.stringify(view.embeds[0].toJSON());
  for (const label of ["FWU", "GUARD", "FDPDLAVOC", "SUCK ME", "LE FISC"]) assert.ok(json.includes(label), label);
  assert.match(json, /Hors ligne/);
  assert.equal(view.components.length, 1);
});
