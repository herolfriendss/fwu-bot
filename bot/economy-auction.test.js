import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-economy-auction-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { db } = await import("./database.js");
const {
  cancelEconomyAuction,
  createEconomyAuction,
  grantPnd,
  listEconomyAuctions,
  placeEconomyAuctionBid,
  pndBalance,
  settleExpiredEconomyAuctions,
} = await import("./economy.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

function addShopRole(roleId) {
  db.prepare("INSERT INTO shop_items(guild_id,role_id,price) VALUES('guild-a',?,100)").run(roleId);
}

test("auction bids reserve only the current high offer and refund outbid members", () => {
  addShopRole("role-a");
  grantPnd("guild-a", "bidder-a", 100, "test_seed");
  grantPnd("guild-a", "bidder-b", 200, "test_seed");
  const now = 2_000_000_000_000;
  const auctionId = createEconomyAuction("guild-a", "seller", "role-a", 25, 60, now);
  assert.throws(() => placeEconomyAuctionBid("guild-a", "seller", auctionId, 25, now + 1), /propre enchère/);
  assert.equal(placeEconomyAuctionBid("guild-a", "bidder-a", auctionId, 25, now + 1).amount, 25);
  assert.throws(() => cancelEconomyAuction("guild-a", "seller", auctionId), /sans offre/);
  assert.equal(pndBalance("guild-a", "bidder-a").balance, 75);
  assert.throws(() => placeEconomyAuctionBid("guild-a", "bidder-a", auctionId, 30, now + 2), /meilleur enchérisseur/);
  assert.equal(placeEconomyAuctionBid("guild-a", "bidder-b", auctionId, 40, now + 2).previousBid, 25);
  assert.equal(pndBalance("guild-a", "bidder-a").balance, 100);
  assert.equal(pndBalance("guild-a", "bidder-b").balance, 160);
  assert.equal(listEconomyAuctions("guild-b", now + 3).length, 0);
  assert.throws(() => placeEconomyAuctionBid("guild-a", "late", auctionId, 50, now + 61 * 60_000), /terminée/);
  db.prepare("DELETE FROM economy_auctions WHERE id=?").run(auctionId);
});

test("expired auctions settle the escrowed bid or refund it on transfer failure", async () => {
  addShopRole("role-b");
  addShopRole("role-c");
  addShopRole("role-d");
  grantPnd("guild-a", "winner", 60, "test_seed");
  grantPnd("guild-a", "failed-winner", 50, "test_seed");
  const now = 2_100_000_000_000;
  const soldId = createEconomyAuction("guild-a", "seller", "role-b", 20, 10, now);
  placeEconomyAuctionBid("guild-a", "winner", soldId, 30, now + 1);
  const failedId = createEconomyAuction("guild-a", "seller", "role-c", 20, 10, now);
  placeEconomyAuctionBid("guild-a", "failed-winner", failedId, 25, now + 1);
  const noBidId = createEconomyAuction("guild-a", "seller", "role-d", 10, 10, now);

  const transfers = [];
  const outcome = await settleExpiredEconomyAuctions(now + 11 * 60_000, async (transfer) => {
    transfers.push(transfer);
    if (transfer.roleId === "role-c") throw new Error("Role hierarchy changed");
  });
  assert.deepEqual(outcome, { sold: 1, expired: 1, failed: 1 });
  assert.equal(transfers.length, 2);
  assert.equal(pndBalance("guild-a", "seller").balance, 30);
  assert.equal(pndBalance("guild-a", "winner").balance, 30);
  assert.equal(pndBalance("guild-a", "failed-winner").balance, 50);
  assert.equal(db.prepare("SELECT status FROM economy_auctions WHERE id=?").get(soldId).status, "sold");
  assert.equal(db.prepare("SELECT status FROM economy_auctions WHERE id=?").get(failedId).status, "failed");
  assert.equal(db.prepare("SELECT status FROM economy_auctions WHERE id=?").get(noBidId).status, "expired");
  assert.deepEqual(await settleExpiredEconomyAuctions(now + 12 * 60_000, async () => {}), { sold: 0, expired: 0, failed: 0 });
});
