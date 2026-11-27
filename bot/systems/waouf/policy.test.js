import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WAOUF_PHRASES,
  isWaoufExpired,
  parseWaoufDuration,
  sanitizeWaoufPhrase,
  waoufResponse,
  formatWaoufAnnouncement,
} from "./policy.js";

test("WAOUF duration is limited to 1 minute through 24 hours", () => {
  assert.equal(parseWaoufDuration("15"), 15);
  assert.equal(parseWaoufDuration(1440), 1440);
  for (const value of [0, -1, 1441, 1.5, "abc"]) assert.throws(() => parseWaoufDuration(value));
});

test("custom WAOUF phrases reject empty content and broad mentions", () => {
  assert.equal(sanitizeWaoufPhrase(" Wouaf {membre} ! "), "Wouaf {membre} !");
  assert.throws(() => sanitizeWaoufPhrase("  "));
  assert.throws(() => sanitizeWaoufPhrase("Wouf @everyone"));
  assert.equal(sanitizeWaoufPhrase("a".repeat(200)).length, 180);
});

test("WAOUF uses barks before cycling custom phrases after the configured count", () => {
  assert.equal(waoufResponse(1, 3, [], "12345"), "Wouaf !");
  assert.equal(waoufResponse(3, 3, ["Coucou {membre}"], "12345"), "Coucou <@12345>");
  assert.equal(waoufResponse(4, 3, ["A", "B"], "12345"), "B");
  assert.equal(
    waoufResponse(3, 3, [], "12345"),
    DEFAULT_WAOUF_PHRASES[0].replace("{membre}", "<@12345>"),
  );
});

test("WAOUF active windows expire at their deadline", () => {
  assert.equal(isWaoufExpired(999, 1000), true);
  assert.equal(isWaoufExpired(1001, 1000), false);
  assert.equal(isWaoufExpired(null, 1000), false);
});

test("WAOUF announcement always identifies the member whose message was replaced", () => {
  assert.equal(formatWaoufAnnouncement("Ryan", "Wouaf !"), "**Ryan** : Wouaf !");
  assert.equal(formatWaoufAnnouncement("@everyone", "Wouaf !"), "**\\@everyone** : Wouaf !");
  assert.equal(formatWaoufAnnouncement("", "Wouaf !"), "**Membre** : Wouaf !");
});

test("WOUAF answers each message with a different random bark", async () => {
  const { randomWaoufResponse, generateBark } = await import("./policy.js");
  let previous = null;
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const response = randomWaoufResponse({ phrases: ["Coucou {membre}"], memberId: "42", previous });
    assert.notEqual(response, previous, "jamais deux fois la même réponse d'affilée");
    assert.doesNotMatch(response, /@everyone|@here/);
    seen.add(response);
    previous = response;
  }
  assert.ok(seen.size > 20, `assez de variété (${seen.size})`);
  assert.ok(seen.has("Coucou <@42>"), "les phrases configurées restent utilisées");
  const fixed = [0.9, 0, 0, 0, 0];
  assert.equal(generateBark(() => fixed.shift() ?? 0), "Wouaf !");
});
