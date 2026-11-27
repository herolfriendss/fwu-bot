import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "fwu-bounty-"));
process.env.HER_DB_PATH = join(directory, "runtime.sqlite");
await import("../economy.js");
const B = await import("./bounty.js");
const { db } = await import("../database.js");
after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });

const G = "g1";
const bal = (u) => Number(db.prepare("SELECT balance FROM wallets WHERE guild_id=? AND user_id=?").get(G, u)?.balance ?? 0);
const give = (u, n) => db.prepare("INSERT INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,?,0) ON CONFLICT(guild_id,user_id) DO UPDATE SET balance=excluded.balance").run(G, u, n);

test("poser : argent bloqué, primes cumulées, garde-fous", () => {
  give("a", 1_000); give("c", 500);
  assert.throws(() => B.placeBounty({ guildId: G, posterId: "a", targetId: "a", amount: 200 }), /propre tête/);
  assert.throws(() => B.placeBounty({ guildId: G, posterId: "a", targetId: "bot", amount: 200, targetIsBot: true }), /bot/);
  assert.throws(() => B.placeBounty({ guildId: G, posterId: "a", targetId: "t", amount: 50 }), /Montant/);
  assert.throws(() => B.placeBounty({ guildId: G, posterId: "a", targetId: "t", amount: 5_000 }), /insuffisant/);
  B.placeBounty({ guildId: G, posterId: "a", targetId: "t", amount: 600 }, 1_000);
  const state = B.placeBounty({ guildId: G, posterId: "c", targetId: "t", amount: 300 }, 1_001);
  assert.deepEqual(state, { total: 900, posters: ["a", "c"], count: 2 });
  assert.equal(bal("a"), 400);
  assert.equal(bal("c"), 200);
});

test("empocher : le chasseur prend les primes qu'il n'a pas posées ; une seule fois", () => {
  assert.equal(B.claimBounty(G, "t", "t", "duel", 2_000), 0, "la cible elle-même");
  assert.equal(B.claimBounty(G, "t", "c", "duel", 2_000), 600, "c ne touche pas sa propre prime");
  assert.equal(bal("c"), 800);
  assert.equal(B.bountyOn(G, "t", 2_001).total, 300, "la prime de c reste ouverte");
  assert.equal(B.claimBounty(G, "t", "h", "rob", 2_002), 300);
  assert.equal(B.claimBounty(G, "t", "h", "rob", 2_003), 0);
  assert.deepEqual(B.openBounties(G, 2_004), []);
});

test("expiration : remboursement après 7 jours, plus rien à empocher", () => {
  give("p", 1_000);
  B.placeBounty({ guildId: G, posterId: "p", targetId: "z", amount: 400 }, 10_000);
  assert.deepEqual(B.openBounties(G, 10_001), [{ targetId: "z", total: 400, count: 1 }]);
  assert.equal(B.expireBounties(10_000 + B.BOUNTY.ttlMs + 1), 1);
  assert.equal(bal("p"), 1_000);
  assert.equal(B.claimBounty(G, "z", "h", "duel", 10_000 + B.BOUNTY.ttlMs + 2), 0);
});
