import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "fwu-music-")), "db.sqlite");
const x = await import("./music-extras.js");
const { ffmpegOpusArgs } = await import("./audio-source-policy.js");

test("audio effects become an ffmpeg -af chain, never user text", () => {
  assert.ok(!ffmpegOpusArgs().includes("-af"));
  const args = ffmpegOpusArgs(x.AUDIO_FILTERS.bassboost);
  assert.equal(args[args.indexOf("-af") + 1], "bass=g=12,dynaudnorm=f=200");
  assert.ok(args.indexOf("-af") < args.indexOf("-c:a"));
  assert.equal(x.AUDIO_FILTERS.aucun, null);
});

test("DJ role: everyone is DJ until a role is set", () => {
  const member = (roles = [], perms = []) => ({ id: "m", guild: { id: "g", ownerId: "o" }, roles: { cache: new Map(roles.map((r) => [r, {}])) }, permissions: { has: (f) => perms.includes(f) } });
  assert.equal(x.isDj(member()), true);
  x.setDjRole("g", "dj");
  assert.equal(x.isDj(member()), false);
  assert.equal(x.isDj(member(["dj"])), true);
  assert.equal(x.isDj(member([], [16n])), true, "Manage Channels");
  assert.ok(x.DJ_COMMANDS.has("=stop") && !x.DJ_COMMANDS.has("=play"));
});

test("vote skip needs a majority of the listeners", () => {
  const v = x.createVoteSkip();
  const listeners = ["a", "b", "c", "d"];
  assert.deepEqual(v.vote("g", "t", "a", listeners), { skip: false, votes: 1, needed: 3 });
  assert.equal(v.vote("g", "t", "a", listeners).votes, 1, "same voter counts once");
  v.vote("g", "t", "b", listeners);
  assert.equal(v.vote("g", "t", "c", listeners).skip, true);
});

test("playlists: save, list, load, delete, limits", () => {
  assert.throws(() => x.savePlaylist("g", "u", "vide", []), /Rien à enregistrer/);
  const saved = x.savePlaylist("g", "u", "  Soirée   chill ", [{ title: "A", url: "https://a", duration: 10, requesterId: "z" }, { title: "B", url: "https://b" }]);
  assert.deepEqual(saved, { name: "Soirée chill", count: 2 });
  assert.deepEqual(x.listPlaylists("g", "u"), [{ name: "Soirée chill", count: 2 }]);
  assert.deepEqual(x.loadPlaylist("g", "u", "Soirée chill")[0], { title: "A", url: "https://a", duration: 10 });
  assert.equal(x.deletePlaylist("g", "u", "Soirée chill"), true);
  assert.throws(() => x.loadPlaylist("g", "u", "Soirée chill"), /introuvable/);
});

test("autoplay search seeds on the artist and skips excluded tracks", async () => {
  const { autoplaySearch, resolveMusicInput } = await import("./music-resolver.js");
  assert.equal(autoplaySearch({ artist: "Ninho - Topic", title: "Jefe (Clip officiel)" }), "ytsearch6:Ninho mix");
  assert.equal(autoplaySearch({ artist: "", title: "Some Song [Official Video] lyrics" }), "ytsearch6:Some Song similaire");
  assert.equal(autoplaySearch({}), null);
  const { EventEmitter } = await import("node:events");
  const fake = () => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {};
    setImmediate(() => { c.stdout.emit("data", Buffer.from(JSON.stringify({ entries: [
      { title: "Old", webpage_url: "https://www.youtube.com/watch?v=a", url: "https://rr1.googlevideo.com/a" },
      { title: "New", webpage_url: "https://www.youtube.com/watch?v=b", url: "https://rr1.googlevideo.com/b" },
    ] }))); c.emit("close", 0); }); return c; };
  const track = await resolveMusicInput("ytsearch6:x mix", { rawSearch: true, exclude: new Set(["https://www.youtube.com/watch?v=a"]), spawn: fake });
  assert.equal(track.title, "New");
});
