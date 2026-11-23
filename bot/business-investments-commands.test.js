import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-business-commands-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { db } = await import("./database.js");
const { handleBusinessInvestmentMessage } = await import("./business-investments-commands.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

const guildId = "123456";
const ownerId = "234567";
const payerId = "345678";
function makeMessage(content, { id = `message-${Math.random()}`, authorId = ownerId, permissions = [] } = {}) {
  const replies = [];
  const mention = content.match(/<@!?([0-9]{5,25})>/)?.[1];
  return {
    id,
    content,
    guild: { id: guildId, ownerId },
    author: { id: authorId, bot: false },
    member: { permissions: { has: (bit) => permissions.includes(Number(bit)) } },
    mentions: { users: { first: () => mention ? { id: mention, bot: false } : null } },
    replies,
    reply: async (payload) => replies.push(payload),
  };
}

test("business and investment prefix commands are callable and reply safely", async () => {
  db.prepare("INSERT INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,1000,0)").run(guildId, ownerId);
  db.prepare("INSERT INTO economy_ledger(guild_id,user_id,delta,reason,created_at) VALUES(?,?,1000,'opening',?)").run(guildId, ownerId, Date.now());
  const create = makeMessage("=business create PND Works", { id: "business-create-01" });
  assert.equal(await handleBusinessInvestmentMessage(create), true);
  assert.match(create.replies[0].content, /Entreprise.*créée/i);
  const id = create.replies[0].content.match(/([0-9a-f-]{36})/i)?.[1];
  assert.ok(id);

  const deposit = makeMessage(`=business deposit ${id} 200`, { id: "business-deposit-01" });
  await handleBusinessInvestmentMessage(deposit);
  assert.match(deposit.replies[0].content, /Contribution versée/);
  assert.equal(db.prepare("SELECT balance FROM wallets WHERE guild_id=? AND user_id=?").get(guildId, ownerId).balance, 800);

  const invest = makeMessage("=invest create 100 500", { id: "investment-create-01" });
  await handleBusinessInvestmentMessage(invest);
  assert.match(invest.replies[0].content, /Placement créé/);
  const list = makeMessage("=invest list");
  await handleBusinessInvestmentMessage(list);
  assert.match(list.replies[0].content, /Tes placements/);
});

test("non-owners cannot withdraw company funds and unauthorized investment policy edits fail", async () => {
  const { createBusiness } = await import("./business-investments.js");
  const business = createBusiness({ guildId, ownerId, name: "Secure Co" });
  const outsider = makeMessage(`=business withdraw ${business.id} 1`, { authorId: payerId });
  await handleBusinessInvestmentMessage(outsider);
  assert.match(outsider.replies[0].content, /Seul le propriétaire/);

  const policy = makeMessage("=invest policy 300 500", { authorId: payerId });
  await handleBusinessInvestmentMessage(policy);
  assert.match(policy.replies[0].content, /Seul le propriétaire/);
});

test("non-owners cannot trigger company payroll", async () => {
  const { createBusiness, hireBusinessEmployee, setBusinessSalary } = await import("./business-investments.js");
  const business = createBusiness({ guildId, ownerId, name: "Protected Payroll" });
  hireBusinessEmployee({ guildId, businessId: business.id, actorId: ownerId, userId: payerId });
  setBusinessSalary({ guildId, businessId: business.id, actorId: ownerId, userId: payerId, salary: 25 });
  const outsider = makeMessage(`=business payroll ${business.id}`, { authorId: payerId });
  await handleBusinessInvestmentMessage(outsider);
  assert.match(outsider.replies[0].content, /Seul le propriétaire/i);
});

test("unrelated messages are ignored", async () => {
  assert.equal(await handleBusinessInvestmentMessage(makeMessage("bonjour")), false);
});
