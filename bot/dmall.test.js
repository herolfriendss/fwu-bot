import assert from "node:assert/strict";
import test from "node:test";
import { db } from "./database.js";
import {
  DMALL_DENIED,
  cancelDmAllPreview,
  claimDmAllJob,
  createDmAllPreview,
  executeDmAllJob,
  getDmAllJob,
  handleDmAllInteraction,
  handleDmAllMessage,
  isDmAllOwner,
  normalizeDmAllMessage,
  parseDmAllPrefix,
  planDmAll,
  recoverInterruptedDmAllJobs,
  requestDmAllStop,
} from "./dmall.js";

const OWNER = "100000000000000001";
const OTHER = "100000000000000002";
process.env.PND_OWNER_DISCORD_ID = OWNER;
const reset = () => db.exec("DELETE FROM dmall_jobs");
const member = (id, { bot = false, roles = [], dm = true } = {}) => ({
  id,
  user: { id, bot },
  roles: { cache: new Map(roles.map((r) => [r, {}])) },
  sent: [],
  async send(payload) { if (!dm) throw new Error("closed"); this.sent.push(payload); },
});

test("only the configured owner: not the guild owner, not SYS+", () => {
  assert.equal(isDmAllOwner(OWNER), true);
  assert.equal(isDmAllOwner(OTHER), false);
  const saved = process.env.PND_OWNER_DISCORD_ID;
  delete process.env.PND_OWNER_DISCORD_ID;
  assert.equal(isDmAllOwner(OWNER), false, "sans OWNER configuré, personne");
  process.env.PND_OWNER_DISCORD_ID = saved;
});

test("plan excludes bots and filters by role", () => {
  const members = [member("1"), member("2", { bot: true }), member("3", { roles: ["r"] })];
  assert.equal(planDmAll(members).recipients.length, 2);
  assert.equal(planDmAll(members).bots, 1);
  assert.deepEqual(planDmAll(members, "r").recipients.map((m) => m.id), ["3"]);
});

test("message validation and prefix parsing", () => {
  assert.throws(() => normalizeDmAllMessage("   "), /vide/);
  assert.throws(() => normalizeDmAllMessage("x".repeat(1801)), /trop long/);
  assert.equal(normalizeDmAllMessage(" Salut "), "Salut");
  assert.deepEqual(parseDmAllPrefix("=dmall Bonsoir à tous"), { roleId: null, message: "Bonsoir à tous" });
  assert.deepEqual(parseDmAllPrefix("=dmall <@&123456789> Réunion ce soir"), { roleId: "123456789", message: "Réunion ce soir" });
  assert.deepEqual(parseDmAllPrefix("=dmall"), { roleId: null, message: "" });
  assert.equal(parseDmAllPrefix("=dmallx"), null);
});

test("preview → confirm once → run; cooldown blocks a second run", async () => {
  reset();
  const job = createDmAllPreview({ guildId: "g", actorId: OWNER, message: "Hello", targetCount: 3, now: 1_000 });
  assert.equal(claimDmAllJob(job.id, OTHER, 1_100).ok, false, "pas un autre utilisateur");
  const claim = claimDmAllJob(job.id, OWNER, 1_100);
  assert.equal(claim.ok, true);
  assert.equal(claimDmAllJob(job.id, OWNER, 1_200).ok, false, "double clic sans effet");
  const recipients = [member("1"), member("2", { dm: false }), member("3")];
  const result = await executeDmAllJob({ job: claim.job, guildName: "PND", recipients, sleep: async () => {}, stepDelayMs: 0 });
  assert.deepEqual({ status: result.status, sent: result.sent, failed: result.failed }, { status: "completed", sent: 2, failed: 1 });
  assert.equal(recipients[0].sent[0].embeds[0].description, "Hello");
  assert.deepEqual(recipients[0].sent[0].allowedMentions, { parse: [] });
  assert.equal(getDmAllJob(job.id).status, "completed");
  assert.throws(() => createDmAllPreview({ guildId: "g", actorId: OWNER, message: "Encore", targetCount: 3, now: 1_100 + 10 * 60_000 }), /déjà été lancé/);
  assert.ok(createDmAllPreview({ guildId: "g", actorId: OWNER, message: "Encore", targetCount: 3, now: 1_100 + 61 * 60_000 }));
});

test("expired preview, cancel, cap, stop and restart recovery", async () => {
  reset();
  const expired = createDmAllPreview({ guildId: "g", actorId: OWNER, message: "a", targetCount: 1, now: 0 });
  assert.match(claimDmAllJob(expired.id, OWNER, 61_000).reason, /expiré/);
  const cancelled = createDmAllPreview({ guildId: "g", actorId: OWNER, message: "a", targetCount: 1, now: 100_000 });
  assert.equal(cancelDmAllPreview(cancelled.id, OWNER, 100_100), true);
  assert.throws(() => createDmAllPreview({ guildId: "g", actorId: OWNER, message: "a", targetCount: 0 }), /Aucun membre/);
  assert.throws(() => createDmAllPreview({ guildId: "g", actorId: OWNER, message: "a", targetCount: 100_000 }), /Plafond/);

  const job = createDmAllPreview({ guildId: "g2", actorId: OWNER, message: "a", targetCount: 30, now: 200_000 });
  const claim = claimDmAllJob(job.id, OWNER, 200_001);
  assert.throws(() => createDmAllPreview({ guildId: "g2", actorId: OWNER, message: "b", targetCount: 1, now: 200_002 }), /déjà en cours/);
  const recipients = Array.from({ length: 30 }, (_, i) => member(String(i)));
  let stopAfter = 0;
  const result = await executeDmAllJob({
    job: claim.job, guildName: "PND", recipients, stepDelayMs: 1,
    sleep: async () => { stopAfter += 1; if (stopAfter === 5) requestDmAllStop(job.id, OWNER); },
  });
  assert.equal(result.status, "stopped");
  assert.equal(result.sent, 5);

  const running = createDmAllPreview({ guildId: "g3", actorId: OWNER, message: "a", targetCount: 1, now: 300_000 });
  claimDmAllJob(running.id, OWNER, 300_001);
  assert.equal(recoverInterruptedDmAllJobs(400_000), 1);
  assert.equal(getDmAllJob(running.id).status, "interrupted", "jamais relancé automatiquement");
});

test("Discord surface refuses everyone but the owner", async () => {
  reset();
  const replies = [];
  const slash = (userId) => ({
    isChatInputCommand: () => true, commandName: "dmall", guild: { id: "g" }, user: { id: userId },
    reply: async (p) => replies.push(p),
  });
  assert.equal(await handleDmAllInteraction(slash(OTHER)), true);
  assert.equal(replies.at(-1).content, DMALL_DENIED);
  assert.equal(replies.at(-1).ephemeral, true);
  const message = (userId, content) => ({ content, guild: { id: "g" }, member: {}, author: { id: userId }, reply: async (p) => replies.push(p) });
  assert.equal(await handleDmAllMessage(message(OTHER, "=dmall coucou")), true);
  assert.equal(replies.at(-1).content, DMALL_DENIED);
  await handleDmAllMessage(message(OWNER, "=dmall"));
  assert.match(replies.at(-1).content, /Utilisation/);
  assert.equal(await handleDmAllMessage(message(OWNER, "=play")), false);
  assert.equal(await handleDmAllInteraction({ isChatInputCommand: () => true, commandName: "play" }), false);
});

test("full preview through Discord objects never sends anything before confirmation", async () => {
  reset();
  const members = new Map([["1", member("1")], ["2", member("2", { bot: true })]]);
  const replies = [];
  const message = {
    content: "=dmall Bonsoir",
    guild: { id: "gp", name: "PND", members: { fetch: async () => members }, roles: { fetch: async () => null } },
    member: {}, author: { id: OWNER },
    reply: async (p) => replies.push(p),
  };
  await handleDmAllMessage(message);
  assert.match(replies[0].content, /Destinataires : \*\*1\*\*/);
  assert.equal(replies[0].embeds[0].description, "Bonsoir");
  assert.equal(replies[0].components.length, 1);
  assert.equal(members.get("1").sent.length, 0);
});
