import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "pnd-clans-")), "economy.sqlite");
const { db } = await import("../database.js");
await import("./community.js");
const C = await import("./clans.js");

const GUILD = "100000000000000001";
const LEAD = "200000000000000001";
const MATE = "200000000000000002";
const THIRD = "200000000000000003";
const fund = (userId, amount, guildId = GUILD) =>
  db.prepare("INSERT INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,?,0) ON CONFLICT(guild_id,user_id) DO UPDATE SET balance=excluded.balance")
    .run(guildId, userId, amount);
const balance = (userId, guildId = GUILD) =>
  Number(db.prepare("SELECT balance FROM wallets WHERE guild_id=? AND user_id=?").get(guildId, userId)?.balance ?? 0);
let guildCounter = 10;
const freshGuild = () => `10000000000000${++guildCounter}`;

test("a clan name and tag are normalised and checked", () => {
  assert.deepEqual(C.validateClanIdentity("  Les   Loups ", "lp"), { name: "Les Loups", tag: "LP" });
  assert.throws(() => C.validateClanIdentity("ab", "LP"), /3 et 32/);
  assert.throws(() => C.validateClanIdentity("Nom valable", "TROPLONG"), /2 à 5/);
  assert.throws(() => C.validateClanIdentity("Nom valable", "A B"), /2 à 5/);
});

test("founding a clan costs PND and makes the founder chief", () => {
  const guild = freshGuild();
  fund(LEAD, 60_000, guild);
  const clan = C.createClan({ guildId: guild, userId: LEAD, name: "Les Loups", tag: "LP" });
  assert.equal(clan.tag, "LP");
  assert.equal(balance(LEAD, guild), 60_000 - C.CLAN_COST);
  assert.equal(C.membershipOf(guild, LEAD).role, "chef");
  assert.equal(C.clanSize(clan.id), 1);
});

test("founding is refused without the money, and nothing is created", () => {
  const guild = freshGuild();
  fund(LEAD, 100, guild);
  assert.throws(() => C.createClan({ guildId: guild, userId: LEAD, name: "Sans Sou", tag: "SS" }), /PND/);
  assert.equal(C.clanByTag(guild, "SS"), null);
  assert.equal(balance(LEAD, guild), 100);
});

test("a tag and a name cannot be taken twice on one server", () => {
  const guild = freshGuild();
  fund(LEAD, 200_000, guild);
  fund(MATE, 200_000, guild);
  C.createClan({ guildId: guild, userId: LEAD, name: "Uniques", tag: "UN" });
  assert.throws(() => C.createClan({ guildId: guild, userId: MATE, name: "Autres", tag: "UN" }), /déjà pris/);
  assert.throws(() => C.createClan({ guildId: guild, userId: MATE, name: "Uniques", tag: "AU" }), /déjà ce nom/);
});

test("you can only be in one clan at a time", () => {
  const guild = freshGuild();
  fund(LEAD, 200_000, guild);
  C.createClan({ guildId: guild, userId: LEAD, name: "Premier", tag: "P1" });
  assert.throws(() => C.createClan({ guildId: guild, userId: LEAD, name: "Second", tag: "P2" }), /déjà dans un clan/);
});

test("joining needs a valid invitation from someone allowed to send one", () => {
  const guild = freshGuild();
  fund(LEAD, 200_000, guild);
  const clan = C.createClan({ guildId: guild, userId: LEAD, name: "Invitants", tag: "IV" });
  assert.throws(() => C.joinClan({ guildId: guild, userId: MATE, clanId: clan.id }), /pas d'invitation/);

  C.inviteToClan({ guildId: guild, clanId: clan.id, userId: MATE, invitedBy: LEAD });
  assert.equal(C.pendingInvites(guild, MATE).length, 1);
  C.joinClan({ guildId: guild, userId: MATE, clanId: clan.id });
  assert.equal(C.clanSize(clan.id), 2);
  assert.equal(C.membershipOf(guild, MATE).role, "membre");

  C.inviteToClan({ guildId: guild, clanId: clan.id, userId: THIRD, invitedBy: LEAD });
  assert.throws(() => C.inviteToClan({ guildId: guild, clanId: clan.id, userId: THIRD, invitedBy: MATE }), /chef et les officiers/);
});

test("an expired invitation does not open the door", () => {
  const guild = freshGuild();
  fund(LEAD, 200_000, guild);
  const clan = C.createClan({ guildId: guild, userId: LEAD, name: "Patients", tag: "PT" });
  C.inviteToClan({ guildId: guild, clanId: clan.id, userId: MATE, invitedBy: LEAD, now: Date.now() - 3 * C.INVITE_TTL_MS });
  assert.equal(C.pendingInvites(guild, MATE).length, 0);
  assert.throws(() => C.joinClan({ guildId: guild, userId: MATE, clanId: clan.id }), /pas d'invitation/);
});

test("the chief cannot walk out while the clan still has members", () => {
  const guild = freshGuild();
  fund(LEAD, 200_000, guild);
  const clan = C.createClan({ guildId: guild, userId: LEAD, name: "Chefs", tag: "CH" });
  C.inviteToClan({ guildId: guild, clanId: clan.id, userId: MATE, invitedBy: LEAD });
  C.joinClan({ guildId: guild, userId: MATE, clanId: clan.id });
  assert.throws(() => C.leaveClan({ guildId: guild, userId: LEAD }), /Transmets d'abord/);

  C.setClanRole({ guildId: guild, actorId: LEAD, targetId: MATE, role: "chef" });
  assert.equal(C.membershipOf(guild, MATE).role, "chef");
  assert.equal(C.membershipOf(guild, LEAD).role, "officier", "l'ancien chef devient officier");
  assert.equal(C.clanById(clan.id).leader_id, MATE);
  assert.deepEqual(C.leaveClan({ guildId: guild, userId: LEAD }), { dissolved: false });
});

test("the last member leaving dissolves the clan", () => {
  const guild = freshGuild();
  fund(LEAD, 200_000, guild);
  const clan = C.createClan({ guildId: guild, userId: LEAD, name: "Seuls", tag: "SL" });
  assert.deepEqual(C.leaveClan({ guildId: guild, userId: LEAD }), { dissolved: true });
  assert.equal(C.clanById(clan.id), null);
});

test("the vault takes deposits and only the chief withdraws", () => {
  const guild = freshGuild();
  fund(LEAD, 200_000, guild);
  const clan = C.createClan({ guildId: guild, userId: LEAD, name: "Coffres", tag: "CF" });
  fund(MATE, 10_000, guild);
  C.inviteToClan({ guildId: guild, clanId: clan.id, userId: MATE, invitedBy: LEAD });
  C.joinClan({ guildId: guild, userId: MATE, clanId: clan.id });

  C.depositToVault({ guildId: guild, userId: MATE, amount: 4000 });
  assert.equal(C.clanById(clan.id).vault, 4000);
  assert.equal(balance(MATE, guild), 6000);
  assert.equal(C.membershipOf(guild, MATE).contributed, 4000);

  assert.throws(() => C.withdrawFromVault({ guildId: guild, userId: MATE, amount: 1000 }), /Seul le chef/);
  assert.throws(() => C.withdrawFromVault({ guildId: guild, userId: LEAD, amount: 99_999 }), /pas assez/);
  C.withdrawFromVault({ guildId: guild, userId: LEAD, amount: 4000 });
  assert.equal(C.clanById(clan.id).vault, 0);
});

test("dissolving gives the vault back instead of burning it", () => {
  const guild = freshGuild();
  fund(LEAD, 200_000, guild);
  const clan = C.createClan({ guildId: guild, userId: LEAD, name: "Rendus", tag: "RD" });
  C.depositToVault({ guildId: guild, userId: LEAD, amount: 10_000 });
  const before = balance(LEAD, guild);
  assert.deepEqual(C.dissolveClan({ guildId: guild, userId: LEAD }), { refunded: 10_000 });
  assert.equal(balance(LEAD, guild), before + 10_000);
  assert.equal(C.clanById(clan.id), null);
});

test("exclusion follows the hierarchy", () => {
  const guild = freshGuild();
  fund(LEAD, 200_000, guild);
  const clan = C.createClan({ guildId: guild, userId: LEAD, name: "Hierarchie", tag: "HR" });
  for (const user of [MATE, THIRD]) {
    C.inviteToClan({ guildId: guild, clanId: clan.id, userId: user, invitedBy: LEAD });
    C.joinClan({ guildId: guild, userId: user, clanId: clan.id });
  }
  C.setClanRole({ guildId: guild, actorId: LEAD, targetId: MATE, role: "officier" });
  assert.throws(() => C.kickFromClan({ guildId: guild, actorId: THIRD, targetId: MATE }), /chef et les officiers/);
  assert.throws(() => C.kickFromClan({ guildId: guild, actorId: MATE, targetId: LEAD }), /chef ne peut pas/);
  assert.equal(C.kickFromClan({ guildId: guild, actorId: MATE, targetId: THIRD }), true);
  assert.equal(C.clanSize(clan.id), 2);
});

test("activity feeds the clan of the member, and nobody else", () => {
  const guild = freshGuild();
  fund(LEAD, 200_000, guild);
  const clan = C.createClan({ guildId: guild, userId: LEAD, name: "Actifs", tag: "AC" });
  assert.equal(C.addClanPoints(guild, LEAD, 120), 120);
  assert.equal(C.addClanPoints(guild, "200000000000000099", 500), 0, "un sans-clan ne donne rien");
  assert.equal(C.clanById(clan.id).points, 120);
  assert.equal(C.clanById(clan.id).season_points, 120);
});

test("the leaderboard ranks on season points", () => {
  const guild = freshGuild();
  fund(LEAD, 200_000, guild);
  fund(MATE, 200_000, guild);
  const small = C.createClan({ guildId: guild, userId: LEAD, name: "Petits", tag: "PE" });
  const big = C.createClan({ guildId: guild, userId: MATE, name: "Grands", tag: "GR" });
  C.addClanPoints(guild, LEAD, 50);
  C.addClanPoints(guild, MATE, 400);
  const board = C.clanLeaderboard(guild);
  assert.equal(board[0].id, big.id);
  assert.equal(board[1].id, small.id);
});

test("a season starts once, resets the standings and ends with a podium", () => {
  const guild = freshGuild();
  fund(LEAD, 200_000, guild);
  C.createClan({ guildId: guild, userId: LEAD, name: "Saisonniers", tag: "SA" });
  C.addClanPoints(guild, LEAD, 900);

  const season = C.startSeason({ guildId: guild, name: "Première" });
  assert.equal(season.number, 1);
  assert.equal(C.clanLeaderboard(guild)[0].season_points, 0, "le démarrage remet les points de saison à zéro");
  assert.throws(() => C.startSeason({ guildId: guild }), /déjà en cours/);

  C.addClanPoints(guild, LEAD, 300);
  db.prepare("INSERT INTO community_levels(guild_id,user_id,xp,level,messages,voice_minutes,last_message_xp_at) VALUES(?,?,?,?,?,?,0)")
    .run(guild, LEAD, 7777, 11, 100, 10);
  const closed = C.closeSeason({ guildId: guild });
  assert.equal(closed.boards.clans[0].score, 300);
  assert.equal(closed.boards.membres[0].subjectId, LEAD);
  assert.equal(C.currentSeason(guild), null);
  assert.equal(C.clanLeaderboard(guild)[0].season_points, 0);
});

test("the hall of fame keeps past seasons and total points survive the reset", () => {
  const guild = freshGuild();
  fund(LEAD, 200_000, guild);
  const clan = C.createClan({ guildId: guild, userId: LEAD, name: "Memoire", tag: "ME" });
  C.startSeason({ guildId: guild });
  C.addClanPoints(guild, LEAD, 250);
  C.closeSeason({ guildId: guild });

  const fame = C.hallOfFame(guild);
  assert.ok(fame.length >= 1);
  assert.equal(fame[0].board, "clans");
  assert.equal(fame[0].rank, 1);
  assert.match(fame[0].label, /\[ME\]/);
  assert.equal(C.clanById(clan.id).points, 250, "le total à vie ne se remet pas à zéro");
});

test("closing with no season is refused and due seasons are listed", () => {
  const guild = freshGuild();
  assert.throws(() => C.closeSeason({ guildId: guild }), /Aucune saison/);
  C.startSeason({ guildId: guild, lengthMs: 1000, now: Date.now() - 10_000 });
  assert.ok(C.dueSeasons().some((s) => s.guild_id === guild));
});
