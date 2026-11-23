import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-economy-jobs-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { handleEconomyMessage } = await import("./economy.js");
const { db } = await import("./database.js");

function makeMessage(guildId, userId, content) {
  const replies = [];
  return {
    replies,
    guild: { id: guildId },
    member: { permissions: { has: () => false } },
    author: { id: userId },
    content,
    mentions: { users: { first: () => null }, roles: { first: () => null } },
    reply: async (payload) => replies.push(payload),
  };
}

test("job selection, guild isolation, work XP and capped progression persist in the isolated DB", async (context) => {
  context.after(() => {
    db.close();
    delete process.env.HER_DB_PATH;
    rmSync(directory, { recursive: true, force: true });
  });

  const first = makeMessage("guild-one", "member-one", "=job choose artisan");
  assert.equal(await handleEconomyMessage(first), true);
  assert.match(first.replies[0].content, /Artisane/);
  const otherGuild = makeMessage("guild-two", "member-one", "=job choose courier");
  await handleEconomyMessage(otherGuild);

  const work = makeMessage("guild-one", "member-one", "=work");
  await handleEconomyMessage(work);
  const profile = db
    .prepare(
      "SELECT job_key,level,experience FROM economy_job_profiles WHERE guild_id=? AND user_id=?",
    )
    .get("guild-one", "member-one");
  const otherProfile = db
    .prepare(
      "SELECT job_key,level,experience FROM economy_job_profiles WHERE guild_id=? AND user_id=?",
    )
    .get("guild-two", "member-one");
  assert.deepEqual({ ...profile }, { job_key: "artisan", level: 1, experience: 25 });
  assert.deepEqual({ ...otherProfile }, { job_key: "courier", level: 1, experience: 0 });
  assert.ok(
    db
      .prepare("SELECT balance FROM wallets WHERE guild_id=? AND user_id=?")
      .get("guild-one", "member-one").balance > 0,
  );
  assert.match(work.replies[0].content, /Artisane.*niveau 1.*25\/100 XP/);

  await handleEconomyMessage(makeMessage("guild-one", "member-one", "=job choose explorer"));
  const explorer = db
    .prepare(
      "SELECT level,experience FROM economy_job_profiles WHERE guild_id=? AND user_id=? AND job_key=?",
    )
    .get("guild-one", "member-one", "explorer");
  assert.deepEqual({ ...explorer }, { level: 1, experience: 0 });
  await handleEconomyMessage(makeMessage("guild-one", "member-one", "=job choose artisan"));
  const artisan = db
    .prepare(
      "SELECT level,experience FROM economy_job_profiles WHERE guild_id=? AND user_id=? AND job_key=?",
    )
    .get("guild-one", "member-one", "artisan");
  assert.deepEqual({ ...artisan }, { level: 1, experience: 25 });

  db.prepare(
    "UPDATE economy_job_profiles SET level=9,experience=90 WHERE guild_id=? AND user_id=? AND job_key=?",
  ).run("guild-one", "member-one", "artisan");
  db.prepare("DELETE FROM economy_cooldowns WHERE guild_id=? AND user_id=? AND action='work'").run(
    "guild-one",
    "member-one",
  );
  await handleEconomyMessage(makeMessage("guild-one", "member-one", "=work"));
  const maxed = db
    .prepare(
      "SELECT level,experience FROM economy_job_profiles WHERE guild_id=? AND user_id=? AND job_key=?",
    )
    .get("guild-one", "member-one", "artisan");
  assert.deepEqual({ ...maxed }, { level: 10, experience: 0 });
});
