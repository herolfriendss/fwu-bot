import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { normalizeMusicQuery, resolveMusicInput } from "./music-resolver.js";

function fakeSpawn(payload, code = 0) {
  return (_binary, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    process.nextTick(() => {
      child.stdout.end(JSON.stringify(payload));
      child.emit("close", code);
    });
    child.args = args;
    return child;
  };
}

test("music query accepts YouTube links and converts plain text to a YouTube search", () => {
  assert.equal(normalizeMusicQuery("https://youtu.be/abc123"), "https://youtu.be/abc123");
  assert.equal(normalizeMusicQuery("Daft Punk One More Time"), "ytsearch1:Daft Punk One More Time");
  assert.throws(() => normalizeMusicQuery("http://youtube.com/watch?v=x"), /Source non prise en charge/);
  assert.throws(() => normalizeMusicQuery("https://example.com/audio"), /Source non prise en charge/);
});

test("resolver extracts metadata and a trusted signed YouTube CDN URL", async () => {
  const track = await resolveMusicInput("https://youtube.com/watch?v=abc", {
    spawn: fakeSpawn({ title: "Track", uploader: "Artist", duration: 123, thumbnail: "https://i.ytimg.com/thumb.jpg", webpage_url: "https://www.youtube.com/watch?v=abc", url: "https://rr.googlevideo.com/audio?sig=secret" }),
  });
  assert.equal(track.title, "Track");
  assert.equal(track.artist, "Artist");
  assert.equal(track.duration, 123);
  assert.equal(track.allowedMediaHost, "rr.googlevideo.com");
  assert.match(track.url, /sig=secret/);
});

test("resolver rejects an untrusted extractor media host", async () => {
  await assert.rejects(resolveMusicInput("https://youtube.com/watch?v=abc", {
    spawn: fakeSpawn({ title: "bad", url: "https://127.0.0.1/private" }),
  }), /source audio non autorisée/);
});
