import test from "node:test";
import assert from "node:assert/strict";
import { TRANSLATE, TRANSLATE_MODEL, flagLanguage, forgetTranslations, handleFlagReaction, translate, translationGate } from "./flag-translate.js";

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

const fakeApi = (text, calls = []) => ({ messages: { create: async (req) => { calls.push(req); return { stop_reason: "end_turn", content: [{ type: "text", text }] }; } } });

test("traduction : modèle rapide, langue dans la consigne, texte borné", async () => {
  const calls = [];
  assert.equal(await translate("bonjour ".repeat(500), "anglais", { anthropic: fakeApi("hello", calls) }), "hello");
  assert.equal(calls[0].model, TRANSLATE_MODEL);
  assert.match(calls[0].system, /en anglais/);
  assert.ok(calls[0].messages[0].content.length <= TRANSLATE.maxChars);
  await assert.rejects(translate("x", "anglais", { anthropic: null }), /ANTHROPIC_API_KEY/);
});

test("réaction : réponse sous le message, sans mention ; échec = rien de posté, nouvel essai possible", async () => {
  forgetTranslations();
  const replies = [];
  const message = { id: "m2", guild: { id: "g" }, content: "Salut tout le monde", reply: async (p) => replies.push(p) };
  const reaction = { emoji: { name: "🇬🇧" }, message };
  assert.equal(await handleFlagReaction(reaction, { id: "u", bot: false }, { anthropic: fakeApi("Hi everyone"), now: 0 }), true);
  assert.match(replies[0].content, /Traduction.*<@u>[\s\S]*Hi everyone/);
  assert.deepEqual(replies[0].allowedMentions, { parse: [], repliedUser: false });
  const failing = { messages: { create: async () => { throw new Error("down"); } } };
  assert.equal(await handleFlagReaction({ emoji: { name: "🇪🇸" }, message }, { id: "v" }, { anthropic: failing, now: 0 }), false);
  assert.equal(await handleFlagReaction({ emoji: { name: "🇪🇸" }, message }, { id: "w" }, { anthropic: fakeApi("Hola"), now: 0 }), true, "réessai après échec");
  assert.equal(await handleFlagReaction({ emoji: { name: "🇬🇧" }, message }, { id: "x" }, { env: { PND_FLAG_TRANSLATE: "off" } }), false);
  assert.equal(await handleFlagReaction({ emoji: { name: "👍" }, message }, { id: "x" }), false);
});
