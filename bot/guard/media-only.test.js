import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChannelType } from "discord.js";

const directory = mkdtempSync(join(tmpdir(), "fwu-media-"));
process.env.HER_DB_PATH = join(directory, "runtime.sqlite");
const M = await import("./media-only.js");
const { db } = await import("../database.js");
after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });

function message({ content = "", attachments = [], staff = false, channelId = "media", bot = false } = {}) {
  const calls = { deleted: false, threads: [], sent: [] };
  return {
    calls, guild: { id: "g" }, channelId, content, author: { id: "u", bot, username: "u" },
    member: { displayName: "Lulu", permissions: { has: () => staff } },
    attachments: new Map(attachments.map((type, i) => [String(i), { contentType: type }])), stickers: new Map(),
    channel: { type: ChannelType.GuildText, send: async (p) => { calls.sent.push(p); return { delete: async () => {} }; } },
    delete: async () => { calls.deleted = true; },
    startThread: async (opts) => { calls.threads.push(opts); },
  };
}

test("détection des médias : images, vidéos, liens ; pas les fichiers texte", () => {
  assert.ok(M.hasMedia({ attachments: new Map([["1", { contentType: "image/png" }]]) }));
  assert.ok(M.hasMedia({ attachments: new Map([["1", { contentType: "video/mp4" }]]) }));
  assert.ok(M.hasMedia({ content: "regardez https://youtu.be/x" }));
  assert.ok(!M.hasMedia({ content: "trop beau", attachments: new Map([["1", { contentType: "text/plain" }]]) }));
  assert.ok(!M.hasMedia({ content: "trop beau" }));
});

test("salon médias : texte seul supprimé, média gardé avec un fil, staff libre, autres salons intacts", async () => {
  M.setMediaChannel("g", "media", { actorId: "admin" });
  const text = message({ content: "trop beau" });
  assert.equal(await M.handleMediaOnlyMessage(text), true);
  assert.ok(text.calls.deleted);
  assert.match(text.calls.sent[0].content, /réservé aux médias/);
  const media = message({ attachments: ["image/jpeg"] });
  assert.equal(await M.handleMediaOnlyMessage(media), false, "la suite du traitement continue");
  assert.ok(!media.calls.deleted);
  assert.equal(media.calls.threads[0].name, "💬 Commentaires · Lulu");
  const staff = message({ content: "règle : que des photos", staff: true });
  assert.equal(await M.handleMediaOnlyMessage(staff), false);
  assert.ok(!staff.calls.deleted);
  assert.equal(await M.handleMediaOnlyMessage(message({ content: "salut", channelId: "general" })), false);
  assert.equal(await M.handleMediaOnlyMessage(message({ content: "x", bot: true })), false);
});

test("réglage : sans fils, liste, retrait", async () => {
  M.setMediaChannel("g", "media2", { threads: false });
  const media = message({ attachments: ["image/png"], channelId: "media2" });
  await M.handleMediaOnlyMessage(media);
  assert.equal(media.calls.threads.length, 0);
  assert.deepEqual(M.listMediaChannels("g").map((r) => r.channel_id), ["media", "media2"]);
  assert.equal(M.removeMediaChannel("media2"), true);
  assert.equal(M.mediaChannel("media2"), null);
});
