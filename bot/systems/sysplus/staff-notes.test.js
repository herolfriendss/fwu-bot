import { test } from "node:test";
import assert from "node:assert/strict";
import { addMemberNote, handleStaffNotesCommand, purgeOldNotes, readMemberNotes, removeMemberNote, NOTE_RETENTION_MS } from "./staff-notes.js";
import { listSysPlusAudit } from "./audit.js";

const G = "notes-g";

test("notes : ajout, lecture journalisée, retrait par l'auteur ou un SYS+ seulement, purge après 1 an", () => {
  const now = Date.now();
  const id = addMemberNote({ guildId: G, userId: "u1", authorId: "a1", body: "prévenu à l'oral", now });
  const old = addMemberNote({ guildId: G, userId: "u1", authorId: "a1", body: "très vieille note", now: now - NOTE_RETENTION_MS - 1000 });
  assert.throws(() => addMemberNote({ guildId: G, userId: "u1", authorId: "a1", body: "x" }), /trop courte/);
  const notes = readMemberNotes({ guildId: G, userId: "u1", readerId: "r1" });
  assert.equal(notes.length, 2);
  assert.ok(listSysPlusAudit(G, 10, { action: "note.lecture" }).some((row) => row.actorId === "r1" && row.targetId === "u1"), "la lecture est journalisée");
  assert.match(removeMemberNote({ guildId: G, noteId: id, actorId: "autre", canModerate: false }), /Seuls l'auteur/);
  assert.equal(removeMemberNote({ guildId: G, noteId: id, actorId: "sys", canModerate: true }).id, id);
  assert.equal(purgeOldNotes(now), 1);
  assert.equal(readMemberNotes({ guildId: G, userId: "u1", readerId: "r1" }).length, 0);
  assert.ok(old > 0);
});

test("notes : refusées hors staff", async () => {
  const replies = [];
  const interaction = { guildId: G, user: { id: "x" }, reply: async (r) => replies.push(r), options: {} };
  await handleStaffNotesCommand(interaction, { subcommand: "notes", member: {}, isStaff: async () => false, isSysPlusOrOwner: false });
  assert.match(replies[0].content, /réservées au staff/);
});
