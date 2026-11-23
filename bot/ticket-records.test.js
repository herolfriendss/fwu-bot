import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const databasePath = `/tmp/pnd-ticket-records-${process.pid}.sqlite`;
process.env.HER_DB_PATH = databasePath;
const records = await import("./ticket-records.js");
const { handleTicketsInteraction, handleTicketsMessage } =
  await import("./tickets.js");
const { db } = await import("./database.js");

const g = "830000000000000001";
const staffId = "830000000000000002";
const authorId = "830000000000000003";
after(() => {
  db.close();
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${databasePath}${suffix}`, { force: true });
  delete process.env.PND_TICKET_TRANSCRIPT_DAYS;
});

test("transcript retention is opt-in and bounded to 1–90 days", () => {
  assert.equal(records.transcriptRetentionDays(undefined), 0);
  assert.equal(records.transcriptRetentionDays("30"), 30);
  assert.equal(records.transcriptRetentionDays("365"), 0);
  assert.equal(records.transcriptRetentionDays("abc"), 0);
});

test("rendering is ordered, bounded and flags truncation", () => {
  const messages = [
    {
      createdTimestamp: 1000,
      authorId: "1",
      authorTag: "a#1",
      content: "bonjour",
      attachments: [],
    },
    {
      createdTimestamp: 2000,
      authorId: "2",
      authorTag: "b#2",
      content: "x".repeat(500),
      attachments: [{}],
    },
  ];
  const full = records.renderTranscript(messages);
  assert.equal(full.count, 2);
  assert.match(full.text, /1 pièce\(s\) jointe\(s\)/);
  const cut = records.renderTranscript(messages, { maxChars: 100 });
  assert.equal(cut.count, 1);
  assert.equal(cut.truncated, true);
});

test("transcripts expire and are purged", () => {
  records.saveTranscript({
    guildId: g,
    ticketId: 99,
    rendered: { text: "t", count: 1, truncated: false },
    days: 1,
    now: 0,
  });
  assert.ok(records.getTranscript(g, 99, 1000));
  assert.equal(records.getTranscript(g, 99, 2 * 86_400_000), null);
  assert.equal(records.purgeExpiredTranscripts(2 * 86_400_000), 1);
});

function member(id, { staff = false } = {}) {
  return {
    id,
    user: { id, bot: false, tag: `${id}#0` },
    guild: { id: g, ownerId: "830000000000000099" },
    permissions: { has: () => staff },
    roles: { cache: new Map() },
  };
}

function openTicketRow(channelId) {
  return Number(
    db
      .prepare(
        "INSERT INTO tickets(guild_id,channel_id,user_id,subject,status,created_at) VALUES(?,?,?,'Aide','open',?)",
      )
      .run(g, channelId, authorId, Date.now()).lastInsertRowid,
  );
}

function interaction({
  sub,
  userId = staffId,
  staff = true,
  channelId,
  options = {},
  fetchMember = null,
}) {
  const log = [];
  return {
    log,
    user: { id: userId, tag: "x" },
    channelId,
    commandName: "ticket",
    member: member(userId, { staff }),
    guild: {
      id: g,
      ownerId: "830000000000000099",
      members: { fetch: async ({ user }) => fetchMember?.(user) ?? null },
      channels: { fetch: async () => null },
    },
    isButton: () => false,
    isChatInputCommand: () => true,
    deferred: false,
    replied: false,
    options: {
      getSubcommand: () => sub,
      getUser: () => options.user ?? null,
      getInteger: () => options.id ?? null,
      getString: () => null,
    },
    reply: async (p) => {
      log.push(p);
    },
    editReply: async (p) => {
      log.push(p);
    },
  };
}

test("assign records the assignee and the timeline; non-staff assignees are refused", async () => {
  const id = openTicketRow("830000000000000500");
  const assignee = member("830000000000000004", { staff: true });
  const ok = interaction({
    sub: "assign",
    channelId: "830000000000000500",
    options: { user: assignee.user },
    fetchMember: () => assignee,
  });
  await handleTicketsInteraction(ok, {});
  assert.match(JSON.stringify(ok.log), /Ticket assigné/);
  assert.equal(
    db.prepare("SELECT claimed_by FROM tickets WHERE id=?").get(id).claimed_by,
    assignee.id,
  );
  const outsider = member("830000000000000005");
  const refused = interaction({
    sub: "assign",
    channelId: "830000000000000500",
    options: { user: outsider.user },
    fetchMember: () => outsider,
  });
  await handleTicketsInteraction(refused, {});
  assert.match(JSON.stringify(refused.log), /staff support/);
  const history = interaction({
    sub: "historique",
    channelId: "830000000000000500",
  });
  await handleTicketsInteraction(history, {});
  assert.match(JSON.stringify(history.log), /assigné par/);
});

test("history and transcripts are staff-only; transcripts require opt-in", async () => {
  const id = openTicketRow("830000000000000501");
  const denied = interaction({
    sub: "historique",
    userId: authorId,
    staff: false,
    channelId: "830000000000000501",
  });
  await handleTicketsInteraction(denied, {});
  assert.match(JSON.stringify(denied.log), /Réservé au staff/);
  delete process.env.PND_TICKET_TRANSCRIPT_DAYS;
  const disabled = interaction({ sub: "transcript", options: { id } });
  await handleTicketsInteraction(disabled, {});
  assert.match(JSON.stringify(disabled.log), /désactivées/);
  process.env.PND_TICKET_TRANSCRIPT_DAYS = "7";
  records.saveTranscript({
    guildId: g,
    ticketId: id,
    rendered: { text: "hello", count: 1, truncated: false },
    days: 7,
  });
  const enabled = interaction({ sub: "transcript", options: { id } });
  await handleTicketsInteraction(enabled, {});
  assert.equal(enabled.log[0].files.length, 1);
  assert.equal(enabled.log[0].ephemeral, true);
});

test("prefix =ticket transcript is refused to keep transcripts private", async () => {
  const replies = [];
  await handleTicketsMessage(
    {
      guild: { id: g },
      member: member(staffId, { staff: true }),
      author: { id: staffId },
      channelId: "c",
      content: "=ticket transcript 1",
      mentions: { users: { first: () => null } },
      reply: async (p) => replies.push(p),
    },
    {},
  );
  assert.match(JSON.stringify(replies), /commande slash/);
});
