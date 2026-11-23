import test from "node:test";
import assert from "node:assert/strict";
import {
  ffmpegOpusArgs,
  isPlayableAudioContentType,
  isPublicIpv4,
  normalizeAudioHost,
  validateAudioUrl,
} from "./audio-source-policy.js";

test("audio source hosts are exact public DNS names", () => {
  assert.equal(normalizeAudioHost("Radio.Example.org."), "radio.example.org");
  assert.throws(() => normalizeAudioHost("*.example.org"), /nom d’hôte exact/);
  assert.throws(() => normalizeAudioHost("127.0.0.1"), /nom DNS public exact/);
  assert.throws(() => normalizeAudioHost("music.local"), /nom DNS public exact/);
});

test("only allowlisted HTTPS media URLs are accepted", () => {
  const url = validateAudioUrl("https://media.example.org/live.mp3", ["media.example.org"]);
  assert.equal(url.hostname, "media.example.org");
  assert.throws(
    () => validateAudioUrl("http://media.example.org/live.mp3", ["media.example.org"]),
    /HTTPS/,
  );
  assert.throws(
    () => validateAudioUrl("https://media.example.org.evil.test/live.mp3", ["media.example.org"]),
    /n’est pas autorisé/,
  );
  assert.throws(
    () => validateAudioUrl("https://user:pass@media.example.org/live.mp3", ["media.example.org"]),
    /sans identifiant/,
  );
  assert.throws(
    () => validateAudioUrl("https://media.example.org:8443/live.mp3", ["media.example.org"]),
    /port personnalisé/,
  );
  const signed = validateAudioUrl("https://media.example.org/live.mp3?token=private", ["media.example.org"]);
  assert.equal(signed.searchParams.get("token"), "private");
});

test("private, loopback, link-local and reserved IPv4 destinations are rejected", () => {
  for (const address of [
    "0.1.2.3",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.2",
    "172.20.0.1",
    "192.0.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "203.0.113.5",
    "224.0.0.1",
  ]) {
    assert.equal(isPublicIpv4(address), false, address);
  }
  assert.equal(isPublicIpv4("8.8.8.8"), true);
  assert.equal(isPublicIpv4("::1"), false);
});

test("FFmpeg input accepts media content but rejects nested playlists", () => {
  assert.equal(isPlayableAudioContentType("audio/mpeg; charset=binary"), true);
  assert.equal(isPlayableAudioContentType("application/octet-stream"), true);
  assert.equal(isPlayableAudioContentType("application/vnd.apple.mpegurl"), false);
  assert.equal(isPlayableAudioContentType("application/dash+xml"), false);
  assert.ok(ffmpegOpusArgs().includes("-protocol_whitelist"));
  assert.ok(ffmpegOpusArgs().includes("libopus"));
});
