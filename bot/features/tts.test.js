import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { TTS, enqueue, handleTtsMessage, speakableText, synthesize, ttsEngine } from "./tts.js";

test("texte lisible : mentions, salons, émojis, liens, mise en forme, rien à lire", () => {
  const names = { userName: (id) => (id === "123456789012345678" ? "Ryan" : null), roleName: () => "Modos", channelName: () => "général" };
  assert.equal(speakableText("salut <@123456789012345678> regarde https://x.y/z", names), "salut Ryan regarde un lien");
  assert.equal(speakableText("**trop** bien <:pepe_happy:123456789012345678> dans <#123456789012345678>", names), "trop bien pepe happy dans général");
  assert.equal(speakableText("<@&123456789012345678> @everyone", names), "Modos tout le monde");
  assert.equal(speakableText("noooooooon"), "nooon");
  assert.equal(speakableText("😀😀 ..."), "", "rien à prononcer");
  assert.equal(speakableText("<@999999999999999999>"), "quelqu'un");
  const long = speakableText("mot ".repeat(100));
  assert.ok(long.length <= TTS.maxChars + 30 && long.endsWith("la suite est coupée"));
});

test("moteur : espeak-ng par défaut (texte par l'entrée standard), Piper si un modèle est réglé", () => {
  assert.deepEqual(ttsEngine({}), { name: "espeak-ng", bin: "espeak-ng", args: ["-v", "fr", "-s", "165", "--stdin", "--stdout"] });
  const piper = ttsEngine({ PND_PIPER_MODEL: "/opt/fr.onnx", PND_PIPER_PATH: "/usr/local/bin/piper" });
  assert.equal(piper.bin, "/usr/local/bin/piper");
  assert.deepEqual(piper.args, ["--model", "/opt/fr.onnx", "--output_file", "-"]);
});

function fakeSpawn({ missing = false } = {}) {
  const calls = [];
  const spawnProcess = (bin, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = new PassThrough();
    child.exitCode = null;
    child.kill = () => { child.exitCode = 1; };
    let written = "";
    child.stdin.on("data", (c) => { written += c; });
    child.stdin.on("finish", () => calls.push({ bin, args, written }));
    setImmediate(() => (missing ? child.emit("error", Object.assign(new Error("x"), { code: "ENOENT" })) : child.stdout.write(Buffer.from("RIFF"))));
    return child;
  };
  return { spawnProcess, calls };
}

test("synthèse : texte envoyé sur l'entrée standard (jamais en argument), moteur absent = message clair", async () => {
  const ok = fakeSpawn();
  const audio = await synthesize("bonjour --help", { engine: ttsEngine({}), spawnProcess: ok.spawnProcess });
  assert.ok(audio.stream && typeof audio.stop === "function");
  assert.equal(ok.calls[0].written, "bonjour --help\n");
  assert.ok(!ok.calls[0].args.includes("bonjour --help"));
  await assert.rejects(synthesize("x", { engine: ttsEngine({}), spawnProcess: fakeSpawn({ missing: true }).spawnProcess }), /pas installée.*espeak-ng/);
});

test("file de lecture bornée : les plus anciens sautent", () => {
  const session = { queue: [] };
  for (let i = 0; i < 8; i++) enqueue(session, `m${i}`);
  assert.deepEqual(session.queue, ["m3", "m4", "m5", "m6", "m7"]);
});

test("messages ignorés sans lecture active, hors du chat du vocal, ou venant d'un bot", () => {
  assert.equal(handleTtsMessage({ guild: { id: "g" }, author: { bot: false }, channelId: "v", content: "salut" }), false);
  assert.equal(handleTtsMessage(null), false);
});
