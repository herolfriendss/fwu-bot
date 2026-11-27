import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "fwu-heist-"));
process.env.HER_DB_PATH = join(directory, "runtime.sqlite");
const H = await import("./heist.js");
const { walletOf, move } = await import("./fisc.js");
const { changeTreasury, treasury } = await import("./fisc-config.js");
const { db } = await import("../database.js");
after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });

const HOUR = 3_600_000;
let guildSeq = 0;
function freshGuild(cash = 50_000) {
  const g = `20000000000000000${guildSeq++}`;
  if (cash) changeTreasury(g, cash);
  return g;
}

test("chance et butin : bornés", () => {
  assert.equal(H.successChance(3), 0.35);
  assert.ok(Math.abs(H.successChance(5) - 0.49) < 1e-9);
  assert.equal(H.lootFor(50_000), 5_000);
  assert.equal(H.lootFor(10_000_000), H.HEIST.lootCap);
});

test("équipe : ouverture, doublons, départ de l'organisateur, minimum de membres", () => {
  const g = freshGuild();
  const id = H.openHeist(g, "a", 1_000);
  assert.throws(() => H.openHeist(g, "z", 1_001), /déjà en train/);
  assert.throws(() => H.joinHeist(g, id, "a", 1_002), /déjà partie/);
  assert.equal(H.joinHeist(g, id, "b", 1_003), 2);
  assert.throws(() => H.runHeist(g, id, "a", { now: 1_004, roll: 0 }), /au moins 3/);
  assert.throws(() => H.runHeist(g, id, "b", { now: 1_004, roll: 0 }), /organisateur/);
  assert.equal(H.leaveHeist(g, id, "b", 1_005), "left");
  assert.equal(H.leaveHeist(g, id, "a", 1_006), "cancelled");
  assert.throws(() => H.joinHeist(g, id, "c", 1_007), /terminé/);
  // Après annulation, une nouvelle équipe peut se former.
  assert.ok(H.openHeist(g, "a", 1_008));
});

test("équipe : 5 membres maximum, expiration après 3 minutes", () => {
  const g = freshGuild();
  const id = H.openHeist(g, "a", 0);
  for (const u of ["b", "c", "d", "e"]) H.joinHeist(g, id, u, 10);
  assert.throws(() => H.joinHeist(g, id, "f", 11), /complète/);
  const g2 = freshGuild();
  const id2 = H.openHeist(g2, "a", 0);
  assert.throws(() => H.joinHeist(g2, id2, "b", H.HEIST.lobbyMs + 1), /pas formée/);
});

test("caisse presque vide : pas de braquage", () => {
  const g = freshGuild(500);
  assert.throws(() => H.openHeist(g, "a", 0), /presque vide/);
});

test("réussite : le butin sort de la caisse et est partagé à parts égales", () => {
  const g = freshGuild(30_000);
  const id = H.openHeist(g, "a", 0);
  H.joinHeist(g, id, "b", 1); H.joinHeist(g, id, "c", 2);
  const result = H.runHeist(g, id, "a", { roll: 0, now: 3 });
  assert.equal(result.success, true);
  assert.equal(result.share, 1_000);
  assert.equal(result.loot, 3_000);
  assert.equal(treasury(g), 27_000);
  for (const u of ["a", "b", "c"]) assert.equal(walletOf(g, u).balance, 1_000);
  assert.throws(() => H.runHeist(g, id, "a", { roll: 0, now: 4 }), /terminé/);
});

test("échec : amendes (portefeuille puis banque) versées à la caisse ; jamais de solde négatif", () => {
  const g = freshGuild(10_000);
  move(g, "a", 500, "test");
  move(g, "b", 50, "test");
  db.prepare("UPDATE wallets SET bank = 100 WHERE guild_id = ? AND user_id = ?").run(g, "b");
  const id = H.openHeist(g, "a", 0);
  H.joinHeist(g, id, "b", 1); H.joinHeist(g, id, "c", 2);
  const result = H.runHeist(g, id, "a", { roll: 0.99, now: 3 });
  assert.equal(result.success, false);
  assert.deepEqual(result.fines, { a: 200, b: 150, c: 0 });
  assert.equal(treasury(g), 10_350);
  assert.equal(walletOf(g, "a").balance, 300);
  assert.deepEqual(walletOf(g, "b"), { balance: 0, bank: 0 });
});

test("délais : 2 h par serveur, 6 h par membre", () => {
  const g = freshGuild();
  const id = H.openHeist(g, "a", 0);
  H.joinHeist(g, id, "b", 1); H.joinHeist(g, id, "c", 2);
  H.runHeist(g, id, "a", { roll: 0.99, now: 3 });
  assert.throws(() => H.openHeist(g, "x", HOUR), /police/);
  assert.throws(() => H.openHeist(g, "a", 3 * HOUR), /oublier/);
  const next = H.openHeist(g, "x", 3 * HOUR);
  assert.throws(() => H.joinHeist(g, next, "b", 3 * HOUR + 1), /oublier/);
  assert.equal(H.joinHeist(g, next, "y", 3 * HOUR + 1), 2);
  // Un autre serveur n'est pas concerné.
  assert.ok(H.openHeist(freshGuild(), "a", 3));
});
