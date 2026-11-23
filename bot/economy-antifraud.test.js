import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const databasePath = `/tmp/pnd-antifraud-${process.pid}.sqlite`;
process.env.HER_DB_PATH = databasePath;
const fraud = await import("./economy-antifraud.js");
const { handleEconomyMessage, grantPnd, pndBalance } =
  await import("./economy.js");
const { db } = await import("./database.js");

const DAY = 86_400_000;
const now = Date.now();
const guildId = "600000000000000001";
after(() => {
  db.close();
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${databasePath}${suffix}`, { force: true });
});
beforeEach(() => {
  for (const table of ["economy_transfers", "economy_fraud_signals"])
    db.prepare(`DELETE FROM ${table}`).run();
});

const old = {
  accountCreatedAt: now - 400 * DAY,
  joinedAt: now - 100 * DAY,
  now,
};

test("young accounts and recent members cannot transfer", () => {
  assert.match(
    fraud.evaluateTransfer({
      ...old,
      amount: 10,
      accountCreatedAt: now - 2 * DAY,
    }).reason,
    /compte Discord/,
  );
  assert.match(
    fraud.evaluateTransfer({ ...old, amount: 10, joinedAt: now - DAY }).reason,
    /membre du serveur/,
  );
  assert.equal(
    fraud.evaluateTransfer({ ...old, amount: 10, joinedAt: NaN }).allowed,
    false,
    "unknown join date fails closed",
  );
});

test("daily cap and count apply, WHITELIST lifts only the limits", () => {
  assert.equal(
    fraud.evaluateTransfer({ ...old, amount: 100, sentLast24h: 49_950 })
      .allowed,
    false,
  );
  assert.equal(
    fraud.evaluateTransfer({ ...old, amount: 10, countLast24h: 20 }).allowed,
    false,
  );
  assert.equal(
    fraud.evaluateTransfer({
      ...old,
      amount: 100,
      sentLast24h: 49_950,
      whitelisted: true,
    }).allowed,
    true,
  );
  assert.equal(
    fraud.evaluateTransfer({
      ...old,
      amount: 10,
      whitelisted: true,
      accountCreatedAt: now - DAY,
    }).allowed,
    false,
    "WHITELIST never bypasses account age",
  );
});

test("funnel: one recipient fed by five recent members raises a single signal", () => {
  for (let i = 0; i < 5; i += 1) {
    fraud.recordTransfer({
      guildId,
      senderId: `60000000000000010${i}`,
      recipientId: "600000000000000200",
      amount: 100,
      senderJoinedAt: now - 2 * DAY,
      now,
    });
  }
  const signals = fraud.detectTransferSignals({
    guildId,
    senderId: "600000000000000104",
    recipientId: "600000000000000200",
    now,
  });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].kind, "funnel");
  assert.equal(
    fraud.detectTransferSignals({
      guildId,
      senderId: "x",
      recipientId: "600000000000000200",
      now,
    }).length,
    0,
    "deduplicated for 24 h",
  );
  assert.match(
    fraud.describeSignal(fraud.listFraudSignals(guildId)[0]),
    /5 comptes récents/,
  );
});

test("ping-pong between two members raises a signal", () => {
  for (let i = 0; i < 2; i += 1) {
    fraud.recordTransfer({
      guildId,
      senderId: "a1",
      recipientId: "b1",
      amount: 10,
      now,
    });
    fraud.recordTransfer({
      guildId,
      senderId: "b1",
      recipientId: "a1",
      amount: 10,
      now,
    });
  }
  assert.equal(
    fraud.detectTransferSignals({
      guildId,
      senderId: "a1",
      recipientId: "b1",
      now,
    })[0].kind,
    "ping_pong",
  );
});

function payMessage({
  userId = "600000000000000300",
  createdAt = now - 400 * DAY,
  joinedAt = now - 100 * DAY,
  amount = 100,
  roles = [],
} = {}) {
  const replies = [];
  const target = { id: "600000000000000301", bot: false };
  return {
    replies,
    guild: { id: guildId },
    member: {
      joinedTimestamp: joinedAt,
      guild: { id: guildId },
      roles: { cache: new Map(roles.map((r) => [r, {}])) },
      permissions: { has: () => false },
    },
    author: { id: userId, createdTimestamp: createdAt },
    content: `=pay <@${target.id}> ${amount}`,
    mentions: { users: { first: () => target }, roles: { first: () => null } },
    reply: async (payload) => replies.push(payload),
  };
}

test("=pay refuses a young account without moving any PND", async () => {
  grantPnd(guildId, "600000000000000390", 1_000, "test");
  const message = payMessage({
    userId: "600000000000000390",
    createdAt: now - DAY,
  });
  const before = pndBalance(guildId, "600000000000000301").balance;
  await handleEconomyMessage(message, {});
  assert.match(JSON.stringify(message.replies), /compte Discord/);
  assert.equal(pndBalance(guildId, "600000000000000390").balance, 1_000);
  assert.equal(pndBalance(guildId, "600000000000000301").balance, before);
});

test("=pay records the counterparty and enforces the cap atomically", async () => {
  grantPnd(guildId, "600000000000000300", 100_000, "test");
  const first = payMessage({ amount: 50_000 });
  await handleEconomyMessage(first, {});
  const base = pndBalance(guildId, "600000000000000301").balance - 50_000;
  assert.equal(
    db.prepare("SELECT COUNT(*) c FROM economy_transfers").get().c,
    1,
  );
  const second = payMessage({ amount: 1 });
  await handleEconomyMessage(second, {});
  assert.match(JSON.stringify(second.replies), /Plafond/);
  assert.equal(
    pndBalance(guildId, "600000000000000301").balance,
    base + 50_000,
  );
  const whitelisted = payMessage({ amount: 1, roles: ["wl"] });
  await handleEconomyMessage(whitelisted, {
    sysPlus: { whitelistRoleId: "wl" },
  });
  assert.equal(
    pndBalance(guildId, "600000000000000301").balance,
    base + 50_001,
  );
});
