import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-studio-cmd-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
process.env.PND_OWNER_DISCORD_ID = "123456";
const { db } = await import("../../database.js");
const { runStudioAction, handleStudioPrefix } = await import("./commands.js");
const { grantEntitlement } = await import("../../entitlements.js");
const { listDrafts } = await import("../../creator-studio.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  delete process.env.PND_OWNER_DISCORD_ID;
  rmSync(directory, { recursive: true, force: true });
});

const GUILD = "500000000000000001";
const OTHER_GUILD = "500000000000000002";
const SYS_ROLE = "500000000000000010";
const AUTHOR = "511111111111111111";
const REVIEWER = "522222222222222222";
const NORMAL = "533333333333333333";
const CHANNEL = "544444444444444444";
const FOREIGN_CHANNEL = "555555555555555555";
const OWNERS = "123456";

// Replies are either plain strings (errors) or { content } objects (successes).
const text = (reply) => (typeof reply === "string" ? reply : reply.content);

function member(id, roles = []) {
  return { id, guild: { id: GUILD }, roles: { cache: { has: (r) => roles.includes(r) } }, permissions: { has: () => false } };
}

function prefixMessage(author, args) {
  const replies = [];
  const message = {
    guild: { id: GUILD, ownerId: "owner" },
    member: member(author, [SYS_ROLE]),
    author: { id: author },
    client: null,
    reply: async (payload) => { replies.push(payload); },
  };
  return { message, replies, args };
}

function fakeClient(channels) {
  const sent = [];
  return {
    sent,
    channels: {
      fetch: async (id) => channels[id] ?? null,
    },
  };
}

function channel(guildId, sent) {
  return {
    guildId,
    isTextBased: () => true,
    send: async (payload) => { sent.push(payload); return { id: `m${sent.length}` }; },
  };
}

test("without the creator.studio entitlement, staff are refused and nothing is written", async () => {
  const { message, replies, args } = prefixMessage(AUTHOR, ["create", "announcement | Test | Corps"]);
  await handleStudioPrefix(message, args, { roleId: SYS_ROLE, client: null });
  assert.match(replies.at(-1).content, /n'est pas activé/);
  assert.equal(listDrafts(GUILD).length, 0);
});

test("non-staff members are refused even when the pack is active", async () => {
  grantEntitlement({ guildId: GUILD, packKey: "creator.studio", actorId: "123456", durationDays: 30, configuredOwners: OWNERS });
  const replies = [];
  const outsider = { guild: { id: GUILD }, member: member(NORMAL), author: { id: NORMAL }, reply: async (p) => replies.push(p) };
  await handleStudioPrefix(outsider, ["create", "announcement | Test | Corps"], { roleId: SYS_ROLE, client: null });
  assert.match(replies.at(-1).content, /réservé aux membres/);
  assert.equal(listDrafts(GUILD).length, 0);
});

test("a SYS+ member creates a draft, cannot approve it, and a second reviewer approves and publishes it", async () => {
  const create = prefixMessage(AUTHOR, []);
  await handleStudioPrefix(create.message, ["create", "announcement | Soirée PND | Rendez-vous à 20h"], { roleId: SYS_ROLE, client: null });
  assert.match(text(create.replies.at(-1)), /Brouillon \*\*Soirée PND\*\* créé/);
  const [draft] = listDrafts(GUILD);
  const id = draft.draftId.slice(0, 8);

  const submit = prefixMessage(AUTHOR, []);
  await handleStudioPrefix(submit.message, ["submit", id], { roleId: SYS_ROLE, client: null });
  assert.match(text(submit.replies.at(-1)), /envoyé en relecture/);

  const selfApprove = prefixMessage(AUTHOR, []);
  await handleStudioPrefix(selfApprove.message, ["approve", id], { roleId: SYS_ROLE, client: null });
  assert.match(text(selfApprove.replies.at(-1)), /propre brouillon/);

  const reviewer = { ...prefixMessage(REVIEWER, []) };
  reviewer.message.member = member(REVIEWER, [SYS_ROLE]);
  reviewer.message.author = { id: REVIEWER };
  await handleStudioPrefix(reviewer.message, ["approve", id], { roleId: SYS_ROLE, client: null });
  assert.match(text(reviewer.replies.at(-1)), /validé/);

  const sent = [];
  const client = fakeClient({ [CHANNEL]: channel(GUILD, sent) });
  const publish = prefixMessage(REVIEWER, []);
  publish.message.member = member(REVIEWER, [SYS_ROLE]);
  await handleStudioPrefix(publish.message, ["publish", `${id} | ${CHANNEL}`], { roleId: SYS_ROLE, client });
  assert.match(text(publish.replies.at(-1)), /Publié/);
  assert.equal(sent.length, 1);
  assert.ok(!("parse" in sent[0].allowedMentions), "no mass-mention parse");
});

test("publishing to a channel of another guild is refused and the draft is marked failed", async () => {
  const storyCreate = prefixMessage(AUTHOR, []);
  storyCreate.message.member = member(AUTHOR, [SYS_ROLE]);
  await handleStudioPrefix(storyCreate.message, ["create", "story | Histoire | Texte court"], { roleId: SYS_ROLE, client: null });
  const drafts = listDrafts(GUILD);
  const story = drafts.find((d) => d.title === "Histoire");
  assert.ok(story, "story draft created");
  const id = story.draftId.slice(0, 8);

  const approver = prefixMessage(AUTHOR, []);
  approver.message.member = member(AUTHOR, [SYS_ROLE]);
  await handleStudioPrefix(approver.message, ["submit", id], { roleId: SYS_ROLE, client: null });
  const reviewer = prefixMessage(REVIEWER, []);
  reviewer.message.member = member(REVIEWER, [SYS_ROLE]);
  await handleStudioPrefix(reviewer.message, ["approve", id], { roleId: SYS_ROLE, client: null });

  const sent = [];
  const client = fakeClient({ [FOREIGN_CHANNEL]: channel(OTHER_GUILD, sent) });
  const publish = prefixMessage(REVIEWER, []);
  publish.message.member = member(REVIEWER, [SYS_ROLE]);
  await handleStudioPrefix(publish.message, ["publish", `${id} | ${FOREIGN_CHANNEL}`], { roleId: SYS_ROLE, client });
  assert.match(text(publish.replies.at(-1)), /Publication échouée/);
  assert.equal(sent.length, 0, "nothing was sent to the foreign guild");
  const status = db.prepare("SELECT status FROM creator_drafts WHERE draft_id LIKE ?").get(`${id}%`).status;
  assert.equal(status, "failed");
});

test("the shared runner rejects unknown actions even for entitled staff", async () => {
  await assert.rejects(() => runStudioAction({
    guild: { id: GUILD }, member: member(AUTHOR, [SYS_ROLE]), actorId: AUTHOR, roleId: SYS_ROLE,
    params: { action: "delete-everything" },
  }), /inconnue/);
});
