import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const databasePath = `/tmp/pnd-econ-reconcile-${process.pid}.sqlite`;
process.env.HER_DB_PATH = databasePath;
const economy = await import("./economy.js");
const { db } = await import("./database.js");

const g = "800000000000000001";
const seller = "800000000000000002";
const buyer = "800000000000000003";
after(() => {
  db.close();
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${databasePath}${suffix}`, { force: true });
});

let nextRole = 10;
function pendingListing({ withBuyer = true, price = 500 } = {}) {
  const role = `80000000000000${String(nextRole++).padStart(4, "0")}`;
  const id = Number(
    db
      .prepare(
        `INSERT INTO economy_market_listings(guild_id,seller_id,role_id,price,status,buyer_id,created_at,updated_at)
    VALUES(?,?,?,?, 'pending',?,0,0)`,
      )
      .run(g, seller, role, price, withBuyer ? buyer : null).lastInsertRowid,
  );
  return { id, role };
}
function pendingAuction(bid = 700) {
  const role = `80000000000000${String(nextRole++).padStart(4, "0")}`;
  const id = Number(
    db
      .prepare(
        `INSERT INTO economy_auctions(guild_id,seller_id,role_id,start_price,highest_bid,highest_bidder_id,status,ends_at,created_at,updated_at)
    VALUES(?,?,?,100,?,?,'pending',0,0,0)`,
      )
      .run(g, seller, role, bid, buyer).lastInsertRowid,
  );
  return { id, role };
}
const status = (table, id) =>
  db.prepare(`SELECT status FROM ${table} WHERE id=?`).get(id).status;
const bal = (user) => economy.pndBalance(g, user).balance;

test("a completed transfer is settled exactly once", async () => {
  economy.grantPnd(g, buyer, 10_000, "test");
  const { id } = pendingListing();
  const before = { b: bal(buyer), s: bal(seller) };
  const inspectRoles = async () => ({ sellerHas: false, buyerHas: true });
  const first = await economy.reconcilePendingEconomy({
    inspectRoles,
    minAgeMs: 0,
  });
  assert.equal(first.settled, 1);
  assert.equal(status("economy_market_listings", id), "sold");
  assert.equal(bal(buyer), before.b - 500);
  assert.equal(bal(seller), before.s + 500);
  const second = await economy.reconcilePendingEconomy({
    inspectRoles,
    minAgeMs: 0,
  });
  assert.equal(second.settled, 0);
  assert.equal(bal(buyer), before.b - 500, "never paid twice");
});

test("a transfer that never happened reopens the listing without moving PND", async () => {
  const { id } = pendingListing();
  const before = bal(buyer);
  const result = await economy.reconcilePendingEconomy({
    inspectRoles: async () => ({ sellerHas: true, buyerHas: false }),
    minAgeMs: 0,
  });
  assert.equal(result.reopened, 1);
  assert.equal(status("economy_market_listings", id), "open");
  assert.equal(
    db
      .prepare("SELECT buyer_id FROM economy_market_listings WHERE id=?")
      .get(id).buyer_id,
    null,
  );
  assert.equal(bal(buyer), before);
});

test("unknown buyer, ambiguous ownership or unreadable Discord never decide", async () => {
  const legacy = pendingListing({ withBuyer: false });
  const ambiguous = pendingListing();
  const unreadable = pendingListing();
  const result = await economy.reconcilePendingEconomy({
    inspectRoles: async (_g, { roleId }) =>
      roleId === unreadable.role ? null : { sellerHas: true, buyerHas: true },
    minAgeMs: 0,
  });
  assert.equal(status("economy_market_listings", legacy.id), "pending");
  assert.equal(status("economy_market_listings", ambiguous.id), "pending");
  assert.equal(status("economy_market_listings", unreadable.id), "pending");
  assert.ok(result.review >= 2);
  assert.ok(result.skipped >= 1);
  const kinds = economy.listReconciliationReviews(g).map((r) => r.ref_id);
  assert.ok(kinds.includes(legacy.id) && kinds.includes(ambiguous.id));
});

test("insufficient funds after transfer: role is reversed and listing reopened", async () => {
  const poor = "800000000000000009";
  const role = "800000000000009999";
  const id = Number(
    db
      .prepare(
        `INSERT INTO economy_market_listings(guild_id,seller_id,role_id,price,status,buyer_id,created_at,updated_at)
    VALUES(?,?,?,999999,'pending',?,0,0)`,
      )
      .run(g, seller, role, poor).lastInsertRowid,
  );
  const reversed = [];
  const result = await economy.reconcilePendingEconomy({
    inspectRoles: async () => ({ sellerHas: false, buyerHas: true }),
    transferRole: async (t) => {
      reversed.push(t);
    },
    minAgeMs: 0,
  });
  assert.equal(reversed[0].reverse, true);
  assert.equal(status("economy_market_listings", id), "open");
  assert.ok(result.reopened >= 1);
});

test("auction: done transfer pays the seller from escrow; untouched auction returns to the worker", async () => {
  const done = pendingAuction(700);
  const untouched = pendingAuction(300);
  const sellerBefore = bal(seller);
  await economy.reconcilePendingEconomy({
    inspectRoles: async (_g, { roleId }) =>
      roleId === done.role
        ? { sellerHas: false, buyerHas: true }
        : { sellerHas: true, buyerHas: false },
    minAgeMs: 0,
  });
  assert.equal(status("economy_auctions", done.id), "sold");
  assert.equal(bal(seller), sellerBefore + 700);
  assert.equal(status("economy_auctions", untouched.id), "open");
});

test("recent pending rows are left to the in-flight operation", async () => {
  const id = Number(
    db
      .prepare(
        `INSERT INTO economy_market_listings(guild_id,seller_id,role_id,price,status,buyer_id,created_at,updated_at)
    VALUES(?,?,'800000000000008888',10,'pending',?,?,?)`,
      )
      .run(g, seller, buyer, Date.now(), Date.now()).lastInsertRowid,
  );
  await economy.reconcilePendingEconomy({
    inspectRoles: async () => ({ sellerHas: true, buyerHas: false }),
  });
  assert.equal(status("economy_market_listings", id), "pending");
});
