import test from "node:test";
import assert from "node:assert/strict";
import { resolvePublicAudioIpv4 } from "./audio-source.js";

test("audio DNS resolution pins only public IPv4 answers", async () => {
  const ip = await resolvePublicAudioIpv4("media.example.org", async () => [
    { address: "8.8.8.8", family: 4 },
    { address: "2001:4860:4860::8888", family: 6 },
  ]);
  assert.equal(ip, "8.8.8.8");
  await assert.rejects(
    resolvePublicAudioIpv4("media.example.org", async () => [{ address: "127.0.0.1", family: 4 }]),
    /IPv4 publique/,
  );
  await assert.rejects(
    resolvePublicAudioIpv4("media.example.org", async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]),
    /IPv4 publique/,
  );
});
