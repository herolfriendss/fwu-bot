import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "pnd-confess-")), "economy.sqlite");
const { db } = await import("../database.js");
const {
  confessionConfig, saveConfessionConfig, validateAttachment, canConfess, recordConfession,
  confessionById, markConfession, confessionEmbed, confessionStats, confessionPayload,
  blockConfessor, unblockConfessor, isBlocked, mirrorAttachment, MAX_BODY, MAX_FILE_BYTES,
} = await import("./confessions.js");

const GUILD = "100000000000000001";
const USER = "200000000000000001";
const cdn = (name, type, size = 1000) => ({ url: `https://cdn.discordapp.com/attachments/1/2/${name}`, contentType: type, size });
const trusted = (guildId, userId) =>
  db.prepare("INSERT OR REPLACE INTO fwu_trust(guild_id,user_id,score,tier,reasons_json,computed_at) VALUES(?,?,?,?,'[]',?)")
    .run(guildId, userId, 90, "veteran", Date.now());

test("an image is accepted only in a known format, under the size cap, from Discord", () => {
  assert.equal(validateAttachment(cdn("a.png", "image/png"), "image").ok, true);
  assert.equal(validateAttachment(cdn("a.png", "image/png; charset=binary"), "image").ok, true, "le paramètre MIME ne doit pas gêner");
  assert.match(validateAttachment(cdn("a.exe", "application/x-msdownload"), "image").reason, /Format d'image/);
  assert.match(validateAttachment(cdn("a.png", "image/png", MAX_FILE_BYTES + 1), "image").reason, /trop lourd/);
  assert.match(validateAttachment({ url: "https://example.com/a.png", contentType: "image/png", size: 10 }, "image").reason, /joint au message/);
});

test("a voice note is accepted in the usual recording formats", () => {
  for (const type of ["audio/ogg", "audio/mpeg", "audio/mp4", "audio/webm"]) {
    assert.equal(validateAttachment(cdn("v.ogg", type), "audio").ok, true, type);
  }
  assert.match(validateAttachment(cdn("v.png", "image/png"), "audio").reason, /Format audio/);
});

test("no attachment is not an error", () => {
  assert.deepEqual(validateAttachment(null, "image"), { ok: true, url: null });
});

test("confessions are refused until a channel is set", () => {
  const guild = "100000000000000002";
  trusted(guild, USER);
  assert.match(canConfess(guild, USER).reason, /Aucun salon/);
  saveConfessionConfig(guild, { channelId: "400000000000000001" });
  assert.equal(canConfess(guild, USER).ok, true);
});

test("a low trust score blocks confessing, and says the threshold", () => {
  const guild = "100000000000000003";
  saveConfessionConfig(guild, { channelId: "400000000000000001", minTrust: 60 });
  db.prepare("INSERT OR REPLACE INTO fwu_trust(guild_id,user_id,score,tier,reasons_json,computed_at) VALUES(?,?,?,?,'[]',?)")
    .run(guild, USER, 20, "surveille", Date.now());
  const verdict = canConfess(guild, USER);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /60/);
});

test("a blocked member cannot confess, and can be unblocked", () => {
  const guild = "100000000000000004";
  saveConfessionConfig(guild, { channelId: "400000000000000001" });
  trusted(guild, USER);
  blockConfessor(guild, USER, "300000000000000001", "spam");
  assert.equal(isBlocked(guild, USER), true);
  assert.match(canConfess(guild, USER).reason, /plus accès/);
  assert.equal(unblockConfessor(guild, USER), 1);
  assert.equal(canConfess(guild, USER).ok, true);
});

test("the cooldown and the daily limit both hold", () => {
  const guild = "100000000000000005";
  // Short delays on purpose: a jump of hours would expire the trust cache too.
  saveConfessionConfig(guild, { channelId: "400000000000000001", cooldownMs: 60_000, dailyLimit: 2 });
  trusted(guild, USER);
  recordConfession({ guildId: guild, authorId: USER, body: "une", status: "published" });
  assert.match(canConfess(guild, USER).reason, /nouvelle confession/);

  const later = Date.now() + 61_000;
  assert.equal(canConfess(guild, USER, { now: later }).ok, true);
  recordConfession({ guildId: guild, authorId: USER, body: "deux", status: "published", now: later });
  assert.match(canConfess(guild, USER, { now: later + 61_000 }).reason, /limite de 2/);
});

test("numbering is per guild and never reuses a number", () => {
  const guild = "100000000000000006";
  assert.equal(recordConfession({ guildId: guild, authorId: USER, body: "a", status: "pending" }).number, 1);
  assert.equal(recordConfession({ guildId: guild, authorId: USER, body: "b", status: "pending" }).number, 2);
  assert.equal(recordConfession({ guildId: "100000000000000007", authorId: USER, body: "c", status: "pending" }).number, 1);
});

test("an empty confession and an overlong one are refused", () => {
  assert.throws(() => recordConfession({ guildId: GUILD, authorId: USER, body: "   ", status: "pending" }), /texte, une image ou un vocal/);
  assert.throws(() => recordConfession({ guildId: GUILD, authorId: USER, body: "x".repeat(MAX_BODY + 1), status: "pending" }), /trop long/);
});

test("a confession with only an image is allowed", () => {
  const saved = recordConfession({ guildId: GUILD, authorId: USER, body: "", imageUrl: cdn("a.png", "image/png").url, status: "pending" });
  assert.ok(saved.id > 0);
  assert.equal(confessionById(saved.id).body, null);
});

test("the public embed never carries the author", () => {
  const saved = recordConfession({ guildId: GUILD, authorId: USER, body: "mon secret", status: "pending" });
  const json = JSON.stringify(confessionEmbed(confessionById(saved.id)).toJSON());
  assert.ok(json.includes("mon secret"));
  assert.ok(!json.includes(USER), "l'identifiant de l'auteur ne doit jamais sortir");
});

test("the stored row keeps the author for the staff", () => {
  const saved = recordConfession({ guildId: GUILD, authorId: USER, body: "tracé", status: "pending" });
  assert.equal(confessionById(saved.id).author_id, USER);
});

test("a mirrored attachment is refused when the server answers badly or too big", async () => {
  assert.equal(await mirrorAttachment(null, "a.png"), null);
  assert.equal(await mirrorAttachment("https://cdn.discordapp.com/x.png", "a.png", async () => ({ ok: false })), null);
  const huge = async () => ({ ok: true, headers: new Map([["content-length", String(MAX_FILE_BYTES + 1)]]), arrayBuffer: async () => new ArrayBuffer(0) });
  assert.equal(await mirrorAttachment("https://cdn.discordapp.com/x.png", "a.png", huge), null);
});

test("a payload with an unreachable image still publishes the text", async () => {
  const saved = recordConfession({ guildId: GUILD, authorId: USER, body: "texte", imageUrl: cdn("a.png", "image/png").url, status: "pending" });
  const payload = await confessionPayload(confessionById(saved.id), async () => { throw new Error("réseau"); });
  assert.equal(payload.files.length, 0);
  assert.match(JSON.stringify(payload.embeds[0].toJSON()), /texte/);
});

test("statistics count each state", () => {
  const guild = "100000000000000008";
  const a = recordConfession({ guildId: guild, authorId: USER, body: "a", status: "pending" });
  const b = recordConfession({ guildId: guild, authorId: USER, body: "b", status: "pending" });
  markConfession(a.id, "published", "300000000000000001");
  markConfession(b.id, "rejected", "300000000000000001");
  const stats = confessionStats(guild);
  assert.equal(stats.total, 2);
  assert.equal(stats.published, 1);
  assert.equal(stats.rejected, 1);
});

test("configuration round-trips and keeps its defaults", () => {
  const guild = "100000000000000009";
  assert.equal(confessionConfig(guild).moderated, true);
  const saved = saveConfessionConfig(guild, { channelId: "1", reviewChannelId: "2", moderated: false, minTrust: 10 });
  assert.equal(saved.moderated, false);
  assert.equal(confessionConfig(guild).reviewChannelId, "2");
  assert.equal(confessionConfig(guild).minTrust, 10);
  assert.equal(confessionConfig(guild).dailyLimit, 3, "les valeurs non précisées restent par défaut");
});
