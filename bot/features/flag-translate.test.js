import test from "node:test";
import assert from "node:assert/strict";
import { TRANSLATE, flagLanguage, forgetTranslations, handleFlagReaction, translate, translationGate } from "./flag-translate.js";

test("drapeaux : langue reconnue, autres émojis ignorés", () => {
  assert.deepEqual(flagLanguage("🇬🇧"), { code: "GB", language: "anglais" });
  assert.equal(flagLanguage("🇪🇸").language, "espagnol");
  assert.equal(flagLanguage("🇯🇵").language, "japonais");
  assert.equal(flagLanguage("👍"), null);
  assert.equal(flagLanguage("🇦🇶"), null, "drapeau sans langue associée");
  assert.equal(flagLanguage(null), null);
});

test("garde-fous : une fois par message et par langue, 10 s par membre", () => {
  forgetTranslations();
  assert.equal(translationGate({ messageId: "m", language: "anglais", userId: "u", now: 0 }), null);
  assert.equal(translationGate({ messageId: "m", language: "anglais", userId: "v", now: 1 }), "déjà traduit");
  assert.equal(translationGate({ messageId: "m", language: "espagnol", userId: "u", now: 2 }), "trop rapide");
  assert.equal(translationGate({ messageId: "m", language: "espagnol", userId: "u", now: TRANSLATE.userCooldownMs + 1 }), null);
});

const fakeFetch = (translation, calls = []) => async (url, options) => {
  calls.push({ url, options });
  return { ok: true, status: 200, json: async () => ({ translation }) };
};

test("traduction : utilise la passerelle FWU, borne le texte et ne demande aucune clé fournisseur", async () => {
  const calls = [];
  assert.equal(await translate("bonjour ".repeat(500), "anglais", {
    apiUrl: "https://fwu.example/api/public/bot-sync",
    secret: "bot-sync-secret",
    guildId: "100000000000000001",
    userId: "200000000000000002",
    fetchImpl: fakeFetch("hello", calls),
  }), "hello");
  assert.equal(calls[0].options.headers.Authorization, "Bearer bot-sync-secret");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.action, "ai-translate");
  assert.equal(body.language, "anglais");
  assert.ok(body.text.length <= TRANSLATE.maxChars);
  await assert.rejects(translate("x", "anglais", {}), /Passerelle IA/);
  await assert.rejects(translate("x", "anglais", {
    apiUrl: "https://fwu.example/api/public/bot-sync",
    secret: "bot-sync-secret",
    guildId: "100000000000000001",
    userId: "200000000000000002",
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ error: "unavailable" }) }),
  }), /Fournisseur IA/);
});

test("réaction : réponse sous le message, sans mention ; échec = rien de posté, nouvel essai possible", async () => {
  forgetTranslations();
  const replies = [];
  const message = { id: "m2", guild: { id: "g" }, content: "Salut tout le monde", reply: async (p) => replies.push(p) };
  const reaction = { emoji: { name: "🇬🇧" }, message };
  assert.equal(await handleFlagReaction(reaction, { id: "u", bot: false }, { apiUrl: "https://fwu.example/api/public/bot-sync", secret: "bot-sync-secret", fetchImpl: fakeFetch("Hi everyone"), now: 0 }), true);
  assert.match(replies[0].content, /Traduction.*<@u>[\s\S]*Hi everyone/);
  assert.deepEqual(replies[0].allowedMentions, { parse: [], repliedUser: false });
  assert.equal(await handleFlagReaction({ emoji: { name: "🇪🇸" }, message }, { id: "v" }, { apiUrl: "https://fwu.example/api/public/bot-sync", secret: "bot-sync-secret", fetchImpl: async () => { throw new Error("down"); }, now: 0 }), false);
  assert.equal(await handleFlagReaction({ emoji: { name: "🇪🇸" }, message }, { id: "w" }, { apiUrl: "https://fwu.example/api/public/bot-sync", secret: "bot-sync-secret", fetchImpl: fakeFetch("Hola"), now: 0 }), true, "réessai après échec");
  assert.equal(await handleFlagReaction({ emoji: { name: "🇬🇧" }, message }, { id: "x" }, { env: { PND_FLAG_TRANSLATE: "off" } }), false);
  assert.equal(await handleFlagReaction({ emoji: { name: "👍" }, message }, { id: "x" }), false);
});
