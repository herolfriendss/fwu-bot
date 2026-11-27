import test from "node:test";
import assert from "node:assert/strict";
import { bebe, canStartMalus, chuchote, decideMessage, isEmojiOnly, mockCase, parseMinutes, perroquet, robot, signature, yoda } from "./policy.js";

const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };

test("text transforms", () => {
  assert.equal(mockCase("salut toi"), "sAlUt ToI");
  assert.equal(perroquet("abc", seq(0.5)), "cba");
  assert.equal(perroquet("abc", seq(0.9)), "ABC !!!");
  assert.match(robot("je suis là", seq(0.9)), /^🤖 .*JE\. SUIS\. LÀ\./);
  assert.match(bebe("je cherche mon rire", seq(0)), /^ze ssewsse mon wiwe 👶$/);
  assert.equal(yoda("je vais au marché demain"), "marché demain, je vais au, hmm.");
  assert.equal(chuchote("Salut 2"), "ˢᵃˡᵘᵗ ²");
  assert.equal(signature("@everyone*"), "\\@everyone\\*");
});

test("emoji-only detection for MIME", () => {
  for (const ok of ["😀", "👍🏽 🔥", "❤️", "<:pepe:123456789012345678>", "🇫🇷", "👨‍👩‍👧"]) assert.ok(isEmojiOnly(ok), ok);
  for (const bad of ["salut 😀", "", "123", "ok"]) assert.ok(!isEmojiOnly(bad), bad);
});

test("decideMessage combines malus", () => {
  const now = 1_000_000;
  assert.deepEqual(decideMessage({ kinds: ["mime"], text: "coucou", now }).remove, true);
  assert.equal(decideMessage({ kinds: ["mime"], text: "😀", now }).remove, false);
  assert.equal(decideMessage({ kinds: ["sablier"], text: "a", lastSablierAt: now - 10_000, now }).remove, true);
  const kept = decideMessage({ kinds: ["sablier"], text: "a", lastSablierAt: now - 70_000, now });
  assert.deepEqual([kept.remove, kept.sablierStamp], [false, true]);
  const both = decideMessage({ kinds: ["perroquet", "clown", "fantome"], text: "abc", now, random: seq(0.5) });
  assert.deepEqual([both.remove, both.repost, both.react, both.removeAfterMs], [true, "cba", "🤡", 5000]);
  assert.equal(decideMessage({ kinds: ["malediction"], text: "x", now, random: seq(0.1, 0) }).remove, true);
  assert.equal(decideMessage({ kinds: ["malediction"], text: "x", now, random: seq(0.9) }).remove, false);
});

test("limits", () => {
  assert.equal(parseMinutes(null), 10);
  assert.throws(() => parseMinutes(61));
  assert.equal(canStartMalus(4), true);
  assert.equal(canStartMalus(5), false);
});

test("reposts never carry links (no phishing through the bot)", async () => {
  const { rewriteFor, stripLinks } = await import("./policy.js");
  assert.equal(stripLinks("va sur https://evil.example/x et discord.gg/abc ou [ici](https://x.y)"), "va sur [lien retiré] et [lien retiré] ou ici");
  const out = rewriteFor(["perroquet"], "free nitro https://dlscord.gift/a", () => 0.9).text;
  assert.doesNotMatch(out, /https?:|dlscord\.gift/i);
});
