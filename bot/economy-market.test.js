import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-economy-market-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { db } = await import("./database.js");
const {
  buyMarketListing,
  cancelMarketListing,
  createMarketListing,
  grantPnd,
  listMarketListings,
  pndBalance,
} = await import("./economy.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

function addShopRole(guildId, roleId) {
  db.prepare("INSERT INTO shop_items(guild_id,role_id,price) VALUES(?,?,100)").run(guildId, roleId);
}

test("market sale transfers a listed role and settles both guild-scoped wallets", async () => {
  addShopRole("guild-a", "role-a");
  addShopRole("guild-b", "role-b");
  grantPnd("guild-a", "buyer", 80, "test_seed");
  const listingId = createMarketListing("guild-a", "seller", "role-a", 50);
  assert.equal(createMarketListing("guild-b", "seller", "role-b", 20), listingId + 1);
  assert.throws(() => createMarketListing("guild-a", "seller", "role-a", 40), /déjà une annonce/);
  assert.throws(() => cancelMarketListing("guild-a", "other", listingId), /n’en es pas l’auteur/);

  const transfers = [];
  const sold = await buyMarketListing("guild-a", "buyer", listingId, async (transfer) => transfers.push(transfer));
  assert.equal(sold.role_id, "role-a");
  assert.equal(transfers.length, 1);
  assert.deepEqual(pndBalance("guild-a", "buyer"), { balance: 30, bank: 0 });
  assert.deepEqual(pndBalance("guild-a", "seller"), { balance: 50, bank: 0 });
  assert.equal(pndBalance("guild-b", "seller").balance, 0);
  assert.equal(listMarketListings("guild-a").length, 0);
});

test("market failure reopens an offer and reverses a transfer when settlement cannot charge", async () => {
  addShopRole("guild-c", "role-c");
  const listingId = createMarketListing("guild-c", "seller", "role-c", 10);
  const calls = [];
  await assert.rejects(
    buyMarketListing("guild-c", "poor-buyer", listingId, async (transfer) => calls.push(transfer)),
    /règlement PND a échoué/,
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1].reverse, true);
  assert.equal(listMarketListings("guild-c")[0].id, listingId);
  assert.equal(pndBalance("guild-c", "poor-buyer").balance, 0);

  await assert.rejects(
    buyMarketListing("guild-c", "other-buyer", listingId, async () => { throw new Error("Discord indisponible"); }),
    /aucun PND n’a été débité/,
  );
  assert.equal(listMarketListings("guild-c")[0].id, listingId);
  cancelMarketListing("guild-c", "seller", listingId);
  assert.equal(listMarketListings("guild-c").length, 0);
});
