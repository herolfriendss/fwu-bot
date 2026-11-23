import test from "node:test";
import assert from "node:assert/strict";
import { parsePndIntelligenceRequest, validatePndIntelligenceAction } from "./pnd-intelligence-policy.js";

test("PND Intelligence parses a category and channel creation request", () => {
  assert.deepEqual(parsePndIntelligenceRequest("crée une catégorie Staff"), { type: "create_category", name: "Staff" });
  assert.deepEqual(parsePndIntelligenceRequest("crée un salon texte annonces dans la catégorie Staff"), {
    type: "create_text_channel", name: "annonces", categoryName: "Staff",
  });
  assert.deepEqual(parsePndIntelligenceRequest("crée un salon vocal Réunion"), {
    type: "create_voice_channel", name: "reunion", categoryName: null,
  });
});

test("announcements retain their channel target and never allow malformed mentions", () => {
  assert.deepEqual(parsePndIntelligenceRequest("publie une annonce Bienvenue ! dans <#123456>"), {
    type: "send_announcement", content: "Bienvenue !", channelId: "123456",
  });
  assert.throws(() => parsePndIntelligenceRequest("publie une annonce Salut dans #123456"), /ne reconnais pas/i);
});

test("unsupported and oversized actions fail closed", () => {
  assert.throws(() => parsePndIntelligenceRequest("bannis tous les membres"), /ne reconnais pas/i);
  assert.throws(() => parsePndIntelligenceRequest(`publie une annonce ${"x".repeat(1701)} dans <#123456>`), /1 700 caractères/i);
  assert.equal(parsePndIntelligenceRequest("crée une catégorie @everyone").name, "＠everyone");
});


test("model-proposed actions are reduced to a strict allowlist and validated", () => {
  assert.deepEqual(validatePndIntelligenceAction({ type: "create_text_channel", name: "Annonces générales", categoryName: "Communauté" }), {
    type: "create_text_channel", name: "annonces-generales", categoryName: "Communauté",
  });
  assert.throws(() => validatePndIntelligenceAction({ type: "ban_all" }), /outils autorisés/i);
  assert.throws(() => validatePndIntelligenceAction({ type: "send_announcement", content: "Salut" }), /Plan d'annonce invalide/i);
});

test("channel management requests are parsed and constrained to explicit targets", () => {
  assert.deepEqual(parsePndIntelligenceRequest("renomme le salon <#123456> en Présentations générales"), {
    type: "rename_channel", channelId: "123456", name: "presentations-generales",
  });
  assert.deepEqual(parsePndIntelligenceRequest("change le sujet du salon <#123456> en Bienvenue dans PND"), {
    type: "set_channel_topic", channelId: "123456", topic: "Bienvenue dans PND",
  });
  assert.deepEqual(parsePndIntelligenceRequest("active le mode lent à 10 secondes sur <#123456>"), {
    type: "set_channel_slowmode", channelId: "123456", seconds: 10,
  });
  assert.deepEqual(parsePndIntelligenceRequest("désactive le mode lent sur <#123456>"), {
    type: "set_channel_slowmode", channelId: "123456", seconds: 0,
  });
  assert.throws(() => parsePndIntelligenceRequest("active le mode lent à 500 minutes sur <#123456>"), /21 600 secondes/);
  assert.throws(() => validatePndIntelligenceAction({ type: "set_channel_slowmode", channelId: "123456", seconds: 21601 }), /invalide/);
  assert.throws(() => validatePndIntelligenceAction({ type: "rename_channel", channelId: "bad", name: "ok" }), /cible invalide/);
});

test("role creation is restricted to a safe no-permission role action", () => {
  assert.deepEqual(parsePndIntelligenceRequest("crée un rôle Animateur"), { type: "create_role", name: "Animateur" });
  assert.deepEqual(validatePndIntelligenceAction({ type: "create_role", name: "Modérateur junior" }), { type: "create_role", name: "Modérateur junior" });
  assert.equal(validatePndIntelligenceAction({ type: "create_role", name: "@everyone" }).name, "＠everyone");
});
