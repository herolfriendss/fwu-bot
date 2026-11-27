import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-malus-voice-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { activeKinds } = await import("./commands.js");
const { eligibleForGame, handleExileVoiceState, handlePatateMessage, punish, tribunalVerdict } = await import("./voice-games.js");
const { db } = await import("../../database.js");

const member = (id, position, extra = {}) => ({ id, user: { id, bot: false }, guild: { id: "g", ownerId: "owner", roles: { cache: new Map() } }, roles: { highest: { position }, cache: new Map() }, ...extra });

test("games: eligibility, verdict, penalties, exile", async (context) => {
  context.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  const actor = member("sys", 5);
  assert.equal(await eligibleForGame(member("a", 1), actor), true);
  assert.equal(await eligibleForGame(member("b", 7), actor), false, "rang supérieur");
  assert.equal(await eligibleForGame(member("owner", 1), actor), false, "propriétaire");
  assert.equal(await eligibleForGame(actor, actor), false);
  assert.equal(tribunalVerdict(3, 2), "coupable");
  assert.equal(tribunalVerdict(2, 2), "innocent");

  let muted = null;
  const inVoice = member("v", 1, { voice: { channelId: "voc", serverMute: false, setMute: async (m) => { muted = m; } } });
  assert.match(await punish(inVoice, { reason: "test", actorId: "sys" }), /muet en vocal/);
  assert.equal(muted, true);
  const outside = member("t", 1, { voice: { channelId: null } });
  assert.match(await punish(outside, { reason: "test", actorId: "sys" }), /MIME/);
  assert.deepEqual(activeKinds("g", "t"), ["mime"]);

  db.prepare("INSERT INTO malus_active VALUES ('g','x','exil','sys',0,?,NULL)").run(Date.now() + 60_000);
  let movedTo = null;
  const afk = { id: "afk" };
  const guild = { id: "g", afkChannel: afk, afkChannelId: "afk" };
  const exiled = { id: "x", guild, voice: { channelId: "voc", setChannel: async (c) => { movedTo = c.id; } } };
  assert.equal(await handleExileVoiceState({ channelId: null }, { channelId: "voc", guild, member: exiled }), true);
  assert.equal(movedTo, "afk");
  assert.equal(await handleExileVoiceState({ channelId: null }, { channelId: "afk", guild, member: exiled }), false, "déjà dans l'AFK");
  assert.equal(await handlePatateMessage({ channel: { id: "nope" }, author: { id: "x" } }), false, "pas de partie");
});
