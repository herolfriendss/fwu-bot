import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-creator-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { db } = await import("./database.js");
const cs = await import("./creator-studio.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

const G = "300000000000000001";
const OTHER = "300000000000000002";
const AUTHOR = "311111111111111111";
const REVIEWER = "322222222222222222";
const CHANNEL = "333333333333333333";
const NOW = Date.UTC(2026, 10, 17, 12);
const HOUR = 3_600_000;

function make(extra = {}) {
  return cs.createDraft({
    guildId: G, kind: "announcement", actorId: AUTHOR, canCreate: true, now: NOW,
    input: { title: "Soirée PND", body: "Rendez-vous à 20h.", ...extra },
  });
}

test("content is validated: https only, hex colour, bounded mentions, non-empty body", () => {
  assert.throws(() => cs.normalizeContent("announcement", { title: "Test", body: "x", imageUrl: "http://a.b/c.png" }), /https/);
  assert.throws(() => cs.normalizeContent("announcement", { title: "Test", body: "x", color: "zzz" }), /Couleur/);
  assert.throws(() => cs.normalizeContent("announcement", { title: "Test", body: "" }), /vide/);
  assert.throws(() => cs.normalizeContent("announcement", { title: "Test", body: "x", mentionUsers: Array.from({ length: 11 }, (_, i) => `1000000000000000${String(i).padStart(2, "0")}`) }), /10 maximum/);
  assert.throws(() => cs.normalizeContent("video", { title: "Test", body: "x" }), /inconnu/);
  assert.equal(cs.normalizeContent("announcement", { title: "Test", body: "x", color: "#ff00aa" }).color, "FF00AA");
});

test("creation is refused without a staff capability, and nothing is written", () => {
  assert.throws(() => cs.createDraft({ guildId: G, kind: "story", input: { title: "Hello", body: "x" }, actorId: AUTHOR, canCreate: false, now: NOW }), /réservée/);
});

test("editing keeps mentions and event data (regression: edits used to drop them)", () => {
  const event = cs.createDraft({
    guildId: G, kind: "event", actorId: AUTHOR, canCreate: true, now: NOW,
    input: { title: "Tournoi", body: "Inscriptions ouvertes", mentionUsers: [REVIEWER], startsAt: NOW + 2 * 86_400_000, location: "Vocal principal" },
  });
  const edited = cs.updateDraft({ guildId: G, draftId: event.draftId, actorId: AUTHOR, canCreate: true, input: { body: "Inscriptions fermées bientôt" }, now: NOW + 1000 });
  assert.deepEqual(edited.content.mentions.users, [REVIEWER]);
  assert.equal(edited.content.event.location, "Vocal principal");
  assert.equal(edited.content.event.startsAt, NOW + 2 * 86_400_000);
  assert.equal(edited.body, "Inscriptions fermées bientôt");
});

test("only the author edits, submits, and the lifecycle follows the four-eyes rule", () => {
  const draft = make();
  assert.throws(() => cs.updateDraft({ guildId: G, draftId: draft.draftId, actorId: REVIEWER, canCreate: true, input: { body: "x" }, now: NOW }), /auteur/);
  const submitted = cs.submitDraft({ guildId: G, draftId: draft.draftId, actorId: AUTHOR, canCreate: true, now: NOW });
  assert.equal(submitted.status, "pending_review");
  assert.throws(() => cs.reviewDraft({ guildId: G, draftId: draft.draftId, reviewerId: AUTHOR, decision: "approve", canReview: true, now: NOW }), /propre brouillon/);
  assert.throws(() => cs.reviewDraft({ guildId: G, draftId: draft.draftId, reviewerId: REVIEWER, decision: "approve", canReview: false, now: NOW }), /relecteurs/);
  const rejected = cs.reviewDraft({ guildId: G, draftId: draft.draftId, reviewerId: REVIEWER, decision: "reject", note: "Précise l'heure", canReview: true, now: NOW });
  assert.equal(rejected.status, "draft");
  assert.equal(rejected.reviewNote, "Précise l'heure");
  cs.submitDraft({ guildId: G, draftId: draft.draftId, actorId: AUTHOR, canCreate: true, now: NOW });
  const approved = cs.reviewDraft({ guildId: G, draftId: draft.draftId, reviewerId: REVIEWER, decision: "approve", canReview: true, now: NOW });
  assert.equal(approved.status, "approved");
  assert.equal(approved.reviewerId, REVIEWER);
});

test("scheduling needs an approved draft, a future time within one year, and a channel", () => {
  const draft = make({ title: "Planifié" });
  assert.throws(() => cs.scheduleDraft({ guildId: G, draftId: draft.draftId, actorId: AUTHOR, channelId: CHANNEL, at: NOW + HOUR, canCreate: true, now: NOW }), /validé/);
  cs.submitDraft({ guildId: G, draftId: draft.draftId, actorId: AUTHOR, canCreate: true, now: NOW });
  cs.reviewDraft({ guildId: G, draftId: draft.draftId, reviewerId: REVIEWER, decision: "approve", canReview: true, now: NOW });
  assert.throws(() => cs.scheduleDraft({ guildId: G, draftId: draft.draftId, actorId: AUTHOR, channelId: CHANNEL, at: NOW + 10_000, canCreate: true, now: NOW }), /une minute/);
  assert.throws(() => cs.scheduleDraft({ guildId: G, draftId: draft.draftId, actorId: AUTHOR, channelId: CHANNEL, at: NOW + 400 * 86_400_000, canCreate: true, now: NOW }), /un an/);
  assert.throws(() => cs.scheduleDraft({ guildId: G, draftId: draft.draftId, actorId: AUTHOR, channelId: "abc", at: NOW + HOUR, canCreate: true, now: NOW }), /Salon/);
  const scheduled = cs.scheduleDraft({ guildId: G, draftId: draft.draftId, actorId: AUTHOR, channelId: CHANNEL, at: NOW + HOUR, canCreate: true, now: NOW });
  assert.equal(scheduled.status, "scheduled");
  const back = cs.cancelSchedule({ guildId: G, draftId: draft.draftId, actorId: AUTHOR, canCreate: true, now: NOW });
  assert.equal(back.status, "approved");
});

test("due scheduled drafts are published once, with a payload that never allows mass pings", async () => {
  const draft = make({ title: "Annonce due", body: "Hello @everyone et @here", mentionUsers: [REVIEWER] });
  cs.submitDraft({ guildId: G, draftId: draft.draftId, actorId: AUTHOR, canCreate: true, now: NOW });
  cs.reviewDraft({ guildId: G, draftId: draft.draftId, reviewerId: REVIEWER, decision: "approve", canReview: true, now: NOW });
  cs.scheduleDraft({ guildId: G, draftId: draft.draftId, actorId: AUTHOR, channelId: CHANNEL, at: NOW + HOUR, canCreate: true, now: NOW });

  const sent = [];
  const sender = { send: async (channelId, payload) => { sent.push({ channelId, payload }); return "msg-1"; } };
  assert.deepEqual(await cs.publishDueDrafts({ sender, now: NOW + HOUR - 1 }), { published: 0, failed: 0 }, "not due yet");
  assert.deepEqual(await cs.publishDueDrafts({ sender, now: NOW + HOUR + 1 }), { published: 1, failed: 0 });
  assert.deepEqual(await cs.publishDueDrafts({ sender, now: NOW + 2 * HOUR }), { published: 0, failed: 0 }, "never published twice");

  assert.equal(sent.length, 1);
  assert.equal(sent[0].channelId, CHANNEL);
  assert.ok(!("parse" in sent[0].payload.allowedMentions), "allowedMentions must not contain parse");
  assert.deepEqual(sent[0].payload.allowedMentions.users, [REVIEWER]);
  assert.equal(sent[0].payload.content, `<@${REVIEWER}>`);
  const stored = cs.getDraft(G, draft.draftId);
  assert.equal(stored.status, "published");
  assert.equal(stored.publishedMessageId, "msg-1");
});

test("a failing Discord send marks the draft failed, records why, and never reports success", async () => {
  const draft = make({ title: "Échec envoi" });
  cs.submitDraft({ guildId: G, draftId: draft.draftId, actorId: AUTHOR, canCreate: true, now: NOW });
  cs.reviewDraft({ guildId: G, draftId: draft.draftId, reviewerId: REVIEWER, decision: "approve", canReview: true, now: NOW });
  const result = await cs.publishDraft({ guildId: G, draftId: draft.draftId, actorId: AUTHOR, channelId: CHANNEL, sender: { send: async () => { throw new Error("Missing Access"); } }, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(cs.getDraft(G, draft.draftId).status, "failed");
  assert.ok(cs.getHistory(G, draft.draftId).some((row) => row.action === "publish_failed"));
});

test("unapproved drafts cannot be published", async () => {
  const draft = make({ title: "Pas validé" });
  await assert.rejects(() => cs.publishDraft({ guildId: G, draftId: draft.draftId, actorId: AUTHOR, channelId: CHANNEL, sender: { send: async () => "x" }, now: NOW }), /validé ou planifié/);
});

test("templates store layout only: they never copy mentions or fixed event dates, and names are unique", () => {
  const source = cs.createDraft({
    guildId: G, kind: "event", actorId: AUTHOR, canCreate: true, now: NOW,
    input: { title: "Soirée type", body: "Gabarit", mentionUsers: [REVIEWER], startsAt: NOW + 5 * 86_400_000, location: "Salon vocal" },
  });
  const template = cs.saveTemplate({ guildId: G, draftId: source.draftId, name: "Soirée", actorId: AUTHOR, canCreate: true, now: NOW });
  assert.equal(template.name, "Soirée");
  assert.throws(() => cs.saveTemplate({ guildId: G, draftId: source.draftId, name: "Soirée", actorId: AUTHOR, canCreate: true, now: NOW }), /déjà/);
  const fromTemplate = cs.createFromTemplate({ guildId: G, templateName: "Soirée", input: { title: "Nouvelle soirée" }, actorId: AUTHOR, canCreate: true, now: NOW });
  assert.deepEqual(fromTemplate.content.mentions, { users: [], roles: [] });
  assert.equal(fromTemplate.content.event.startsAt, null);
  assert.equal(fromTemplate.content.event.location, "Salon vocal");
  assert.equal(fromTemplate.title, "Nouvelle soirée");
});

test("favorites toggle per user and history is ordered newest first", () => {
  const draft = make({ title: "Favori" });
  assert.equal(cs.toggleFavorite({ guildId: G, userId: REVIEWER, draftId: draft.draftId, now: NOW }).favorite, true);
  assert.equal(cs.listDrafts(G, { favoritesOf: REVIEWER }).length >= 1, true);
  assert.equal(cs.toggleFavorite({ guildId: G, userId: REVIEWER, draftId: draft.draftId, now: NOW }).favorite, false);
  cs.submitDraft({ guildId: G, draftId: draft.draftId, actorId: AUTHOR, canCreate: true, now: NOW + 5 });
  const history = cs.getHistory(G, draft.draftId);
  assert.deepEqual(history.map((row) => row.action), ["submitted", "created"], "newest first");
  assert.equal(history[0].actorId, AUTHOR);
});

test("drafts are isolated per guild", () => {
  const draft = make({ title: "Serveur A" });
  assert.throws(() => cs.getDraft(OTHER, draft.draftId), /introuvable/);
  assert.throws(() => cs.submitDraft({ guildId: OTHER, draftId: draft.draftId, actorId: AUTHOR, canCreate: true, now: NOW }), /introuvable/);
});

test("the preview uses the exact payload that would be sent", () => {
  const draft = make({ title: "Aperçu", mentionRoles: ["344444444444444444"] });
  const { payload, text } = cs.previewDraft(draft);
  assert.deepEqual(payload, cs.buildDiscordPayload(draft));
  assert.match(text, /Aperçu/);
  assert.match(text, /<@&344444444444444444>/);
});


test("concurrent publication attempts claim a draft only once", async () => {
  const draft = make({ title: "Publication unique" });
  cs.submitDraft({ guildId: G, draftId: draft.draftId, actorId: AUTHOR, canCreate: true, now: NOW });
  cs.reviewDraft({ guildId: G, draftId: draft.draftId, reviewerId: REVIEWER, decision: "approve", canReview: true, now: NOW });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let sends = 0;
  const sender = { send: async () => { sends += 1; await gate; return "unique-message"; } };
  const first = cs.publishDraft({ guildId: G, draftId: draft.draftId, channelId: CHANNEL, sender, now: NOW + 1 });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    () => cs.publishDraft({ guildId: G, draftId: draft.draftId, channelId: CHANNEL, sender, now: NOW + 2 }),
    /validé ou planifié|déjà en cours|traité/i,
  );
  release();
  const result = await first;
  assert.equal(result.ok, true);
  assert.equal(sends, 1);
});

test("stale publishing drafts are marked failed with an unknown outcome, never auto-retried", () => {
  const draft = make({ title: "Publication interrompue" });
  cs.submitDraft({ guildId: G, draftId: draft.draftId, actorId: AUTHOR, canCreate: true, now: NOW });
  cs.reviewDraft({ guildId: G, draftId: draft.draftId, reviewerId: REVIEWER, decision: "approve", canReview: true, now: NOW });
  db.prepare("UPDATE creator_drafts SET status='publishing',updated_at=? WHERE guild_id=? AND draft_id=?")
    .run(NOW, G, draft.draftId);
  assert.equal(cs.recoverInterruptedStudioPublishes({ now: NOW + 299_999, staleAfterMs: 300_000 }), 0);
  assert.equal(cs.recoverInterruptedStudioPublishes({ now: NOW + 300_000, staleAfterMs: 300_000 }), 1);
  assert.equal(cs.getDraft(G, draft.draftId).status, "failed");
  const event = cs.getHistory(G, draft.draftId).find((row) => row.action === "publish_interrupted");
  assert.equal(event.detail.outcome, "unknown");
  assert.equal(event.detail.requiresManualReview, true);
  assert.equal(cs.recoverInterruptedStudioPublishes({ now: NOW + 400_000, staleAfterMs: 300_000 }), 0);
});
