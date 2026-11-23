import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { armSlowCommandWatchdog } from "./interaction-watchdog.js";

function fake() {
  const calls = [];
  const i = {
    deferred: false, replied: false,
    isChatInputCommand: () => true,
    reply: async (p) => { i.replied = true; calls.push(["reply", p]); },
    deferReply: async (p) => { i.deferred = true; calls.push(["defer", p]); },
    editReply: async (p) => { calls.push(["edit", p]); },
  };
  return { i, calls };
}

test("a fast handler is untouched", async () => {
  const { i, calls } = fake();
  let fire;
  armSlowCommandWatchdog(i, { setTimer: (fn) => { fire = fn; return 1; }, clearTimer: () => { fire = null; } });
  await i.reply({ content: "ok", ephemeral: false });
  assert.deepEqual(calls, [["reply", { content: "ok", ephemeral: false }]]);
  assert.equal(fire, null);
});

test("a slow handler is acknowledged in time, then its reply becomes an edit", async () => {
  const { i, calls } = fake();
  let fire;
  armSlowCommandWatchdog(i, { setTimer: (fn) => { fire = fn; return 1; }, clearTimer: () => {} });
  fire();
  await i.reply({ content: "fini", ephemeral: true });
  assert.deepEqual(calls, [["defer", { ephemeral: true }], ["edit", { content: "fini" }]]);
});

test("a handler that defers itself after the watchdog does not defer twice", async () => {
  const { i, calls } = fake();
  let fire;
  armSlowCommandWatchdog(i, { setTimer: (fn) => { fire = fn; return 1; }, clearTimer: () => {} });
  fire();
  await i.deferReply({ ephemeral: true });
  await i.editReply({ content: "x" });
  assert.deepEqual(calls.map((c) => c[0]), ["defer", "edit"]);
});

test("the watchdog is armed for every interaction before the reply rewriter", () => {
  const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(source, /armSlowCommandWatchdog\(interaction\);\n  slashifyInteractionReplies\(interaction\);/);
});
