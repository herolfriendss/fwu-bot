import assert from "node:assert/strict";
import { test } from "node:test";
import { Collector, MAX_EXCERPTS_PER_DAY, detectPrefixCommand, parisDay } from "../src/collector.js";

const READ = "111111111111111111";
const OTHER = "222222222222222222";
const BOT = "333333333333333333";
const make = (now = () => new Date("2026-11-25T10:00:00Z")) =>
  new Collector({ readChannelIds: new Set([READ]), watchedBotIds: new Set([BOT]), pseudonymSecret: "s".repeat(32), now });
const msg = (over) => ({ guildMatches: true, channelId: READ, authorId: "999999999999999999", authorIsBot: false, content: "salut", ...over });

test("detectPrefixCommand reconnaît les 4 préfixes", () => {
  assert.deepEqual(detectPrefixCommand("+ban @x"), { bot: "GUARD", command: "ban" });
  assert.deepEqual(detectPrefixCommand(";pv"), { bot: "FDPDLAVOC", command: "pv" });
  assert.deepEqual(detectPrefixCommand("=dog"), { bot: "SUCK ME", command: "dog" });
  assert.deepEqual(detectPrefixCommand("-daily"), { bot: "LE FISC", command: "daily" });
  assert.equal(detectPrefixCommand("- une liste"), null);
  assert.equal(detectPrefixCommand("bonjour"), null);
});

test("ignore les salons non autorisés et les autres serveurs", () => {
  const c = make();
  c.onMessage(msg({ channelId: OTHER, content: "le bot marche pas" }));
  c.onMessage(msg({ guildMatches: false, content: "le bot marche pas" }));
  const out = c.flush();
  assert.equal(out.messages.length, 0);
  assert.equal(out.excerpts.length, 0);
});

test("compte messages, membres distincts, commandes et extraits anonymisés", () => {
  const c = make();
  c.onMessage(msg({ authorId: "100000000000000001", content: "le bot musique marche pas" }));
  c.onMessage(msg({ authorId: "100000000000000002", content: "+ban quelqu'un" }));
  c.onMessage(msg({ authorId: "100000000000000001", content: "salut" }));
  const out = c.flush();
  assert.equal(out.messages[0].count, 3);
  assert.equal(out.messages[0].authors, 2);
  assert.deepEqual(out.commands, [{ day: parisDay(new Date("2026-11-25T10:00:00Z")), bot: "GUARD", command: "ban", uses: 1, errors: 0 }]);
  assert.equal(out.excerpts.length, 1);
  assert.equal(out.excerpts[0].kind, "bug");
  assert.ok(!JSON.stringify(out).includes("100000000000000001"));
});

test("messages des bots : seulement les bots surveillés, erreurs gardées", () => {
  const c = make();
  c.onMessage(msg({ authorIsBot: true, authorId: "444444444444444444", content: "❌ erreur" }));
  c.onMessage(msg({ authorIsBot: true, authorId: BOT, content: "❌ Une erreur est survenue", slashCommand: "warn" }));
  const out = c.flush();
  assert.equal(out.messages.length, 0);
  assert.equal(out.excerpts.length, 1);
  assert.equal(out.excerpts[0].authorHash, null);
  assert.equal(out.commands[0].errors, 1);
});

test("flush remet à zéro, plafond d'extraits par jour", () => {
  const c = make();
  for (let i = 0; i < MAX_EXCERPTS_PER_DAY + 20; i++) c.onMessage(msg({ content: `le bot marche pas ${i}` }));
  assert.equal(c.flush().excerpts.length, MAX_EXCERPTS_PER_DAY);
  assert.equal(c.flush().messages.length, 0);
});

test("arrivées et départs", () => {
  const c = make();
  c.onMemberFlow(true, "join");
  c.onMemberFlow(true, "join");
  c.onMemberFlow(true, "leave");
  c.onMemberFlow(false, "join");
  assert.deepEqual(c.flush().flow[0], { day: "2026-11-25", joins: 2, leaves: 1 });
});
