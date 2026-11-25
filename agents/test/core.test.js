import assert from "node:assert/strict";
import { test } from "node:test";
import { canSpend, costUsd } from "../src/budget.js";
import { parseButton } from "../src/cards.js";
import { loadConfig } from "../src/config.js";
import { buildObservationPrompt, dedupKey, runObserver } from "../src/observer.js";
import { shouldRunDigest } from "../src/scheduler.js";

test("costUsd et canSpend", () => {
  assert.equal(costUsd("claude-haiku-5-5", 1_000_000, 0), 0.1);
  assert.equal(costUsd("claude-sonnet-5-5", 0, 1_000_000), 10);
  assert.throws(() => costUsd("inconnu", 1, 1));
  const base = { budgetUsd: 10, model: "claude-haiku-5-5", estimatedInputTokens: 50_000, maxOutputTokens: 8000 };
  assert.equal(canSpend({ ...base, spentUsd: 1 }).allowed, true);
  assert.equal(canSpend({ ...base, spentUsd: 8.995 }).allowed, false); // 90 % de 10 $
});

test("parseButton n'accepte que nos boutons", () => {
  assert.deepEqual(parseButton("agents:valider:12"), { status: "validee", id: 12 });
  assert.deepEqual(parseButton("agents:plustard:3"), { status: "plus_tard", id: 3 });
  assert.equal(parseButton("agents:supprimer:3"), null);
  assert.equal(parseButton("autre:valider:3"), null);
});

test("dedupKey ignore accents, casse et ponctuation", () => {
  assert.equal(dedupKey("Ajouter un salon « Idées » !"), dedupKey("ajouter un salon idees"));
});

test("shouldRunDigest : une fois par jour à partir de l'heure choisie (Paris)", () => {
  const morning = new Date("2026-11-25T07:30:00Z"); // 8 h 30 à Paris
  const later = new Date("2026-11-25T08:10:00Z"); // 9 h 10 à Paris
  assert.equal(shouldRunDigest(morning, 9, null), false);
  assert.equal(shouldRunDigest(later, 9, null), true);
  assert.equal(shouldRunDigest(later, 9, "2026-11-25"), false);
});

test("loadConfig refuse une configuration incomplète ou dangereuse", () => {
  const ok = {
    AGENTS_DISCORD_TOKEN: "x",
    AGENTS_GUILD_ID: "111111111111111111",
    AGENTS_CHANNEL_ID: "222222222222222222",
    AGENTS_OWNER_ID: "333333333333333333",
    AGENTS_READ_CHANNEL_IDS: "444444444444444444, 555555555555555555",
    AGENTS_DATABASE_URL: "postgres://x",
    AGENTS_PSEUDONYM_SECRET: "s".repeat(32),
    ANTHROPIC_API_KEY: "k",
  };
  assert.deepEqual(loadConfig(ok).errors, []);
  assert.equal(loadConfig(ok).config.readChannelIds.size, 2);
  assert.ok(loadConfig({ ...ok, AGENTS_READ_CHANNEL_IDS: "" }).errors.length);
  assert.ok(loadConfig({ ...ok, AGENTS_READ_CHANNEL_IDS: "222222222222222222" }).errors.length); // #agents lu
  assert.ok(loadConfig({ ...ok, AGENTS_PSEUDONYM_SECRET: "court" }).errors.length);
});

test("buildObservationPrompt n'expose ni identifiants de salon ni empreintes", () => {
  const prompt = buildObservationPrompt(
    {
      channels: [{ channel_id: "444444444444444444", messages: 10, max_authors_per_day: 3, active_days: 2 }],
      commands: [],
      flow: [],
      excerpts: [{ day: "2026-11-24", channel_id: "444444444444444444", kind: "bug", author_hash: "abcdef0123456789", content: "ça marche pas" }],
    },
    [{ title: "Ancienne idée", status: "refusee" }],
    new Map([["444444444444444444", "général"]]),
  );
  assert.ok(!prompt.includes("444444444444444444"));
  assert.ok(!prompt.includes("abcdef0123456789"));
  assert.ok(prompt.includes("#général"));
  assert.ok(prompt.includes("membre A"));
  assert.ok(prompt.includes("Ancienne idée"));
});

test("runObserver gère refus et réponses valides", async () => {
  const fake = (response) => ({ messages: { parse: async () => response } });
  const usage = { input_tokens: 100, output_tokens: 50 };
  const refused = await runObserver({ client: fake({ stop_reason: "refusal", usage }), prompt: "x" });
  assert.equal(refused.ok, false);
  assert.equal(refused.usage.inputTokens, 100);
  const p = { type: "correctif", titre: "t", description: "d", pourquoi: "p", bot_concerne: "GUARD", priorite: "haute", effort: "petit" };
  const good = await runObserver({
    client: fake({ stop_reason: "end_turn", usage, parsed_output: { resume: "r", propositions: Array(8).fill(p) } }),
    prompt: "x",
  });
  assert.equal(good.ok, true);
  assert.equal(good.result.propositions.length, 5);
});
