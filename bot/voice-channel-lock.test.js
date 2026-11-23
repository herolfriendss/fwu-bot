import test from "node:test";
import assert from "node:assert/strict";
import { withVoiceChannelLock } from "./voice-channel-lock.js";

test("voice mutations are serialized per channel and released after completion", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const first = withVoiceChannelLock("123456", async () => pending);
  await assert.rejects(
    withVoiceChannelLock("123456", async () => {}),
    /modification est déjà en cours/,
  );
  // A different voice channel can be changed independently.
  assert.equal(await withVoiceChannelLock("654321", async () => "ok"), "ok");
  release("done");
  assert.equal(await first, "done");
  assert.equal(await withVoiceChannelLock("123456", async () => "recovered"), "recovered");
});

test("invalid channel IDs are rejected before a mutation starts", async () => {
  await assert.rejects(withVoiceChannelLock("not-an-id", async () => {}), /Identifiant/);
});
