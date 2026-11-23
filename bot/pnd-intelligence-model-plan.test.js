import test from "node:test";
import assert from "node:assert/strict";
import { parsePndIntelligenceModelPlan } from "./pnd-intelligence-model-plan.js";

test("model plan accepts only the supported category action", () => {
  assert.deepEqual(parsePndIntelligenceModelPlan('{"type":"create_category","name":"Équipe Staff"}'), {
    type: "create_category", name: "Équipe Staff",
  });
});

test("model plan normalizes channel names and handles an omitted category", () => {
  assert.deepEqual(parsePndIntelligenceModelPlan('```json\n{"type":"create_text_channel","name":"Annonces générales"}\n```'), {
    type: "create_text_channel", name: "annonces-generales", categoryName: null,
  });
});

test("model plan accepts a category only when it is a safe string", () => {
  assert.deepEqual(parsePndIntelligenceModelPlan('{"type":"create_voice_channel","name":"Réunion","categoryName":"Équipe"}'), {
    type: "create_voice_channel", name: "reunion", categoryName: "Équipe",
  });
  assert.throws(() => parsePndIntelligenceModelPlan('{"type":"create_voice_channel","name":"Réunion","categoryName":{}}'), /Catégorie invalide/i);
});

test("model plan validates announcement channel and content", () => {
  assert.deepEqual(parsePndIntelligenceModelPlan('{"type":"send_announcement","channelId":"123456789012345678","content":"Bienvenue dans PND !"}'), {
    type: "send_announcement", channelId: "123456789012345678", content: "Bienvenue dans PND !",
  });
  assert.throws(() => parsePndIntelligenceModelPlan('{"type":"send_announcement","channelId":"#annonces","content":"Bienvenue"}'), /identifiant/i);
  assert.throws(() => parsePndIntelligenceModelPlan(JSON.stringify({ type: "send_announcement", channelId: "123456", content: "x".repeat(1701) })), /1 700/i);
});

test("model plan rejects unsupported actions and unexpected properties", () => {
  assert.throws(() => parsePndIntelligenceModelPlan('{"type":"ban_member","userId":"123456"}'), /hors de la liste/i);
  assert.throws(() => parsePndIntelligenceModelPlan('{"type":"create_category","name":"Staff","permissions":["Administrator"]}'), /champs inattendus/i);
});

test("model plan fails closed on malformed, oversized and non-object output", () => {
  assert.throws(() => parsePndIntelligenceModelPlan("not-json"), /JSON valide/i);
  assert.throws(() => parsePndIntelligenceModelPlan("[]"), /invalide/i);
  assert.throws(() => parsePndIntelligenceModelPlan("x".repeat(10_001)), /trop volumineuse/i);
});

test("model plan normalizes mass mentions in names and bounds rejection reasons", () => {
  assert.equal(parsePndIntelligenceModelPlan('{"type":"create_category","name":"@everyone"}').name, "＠everyone");
  assert.deepEqual(parsePndIntelligenceModelPlan('{"type":"none","reason":"Action hors périmètre"}'), {
    type: "none", reason: "Action hors périmètre",
  });
  assert.throws(() => parsePndIntelligenceModelPlan(JSON.stringify({ type: "none", reason: "x".repeat(241) })), /Motif de refus/i);
});


test("model planner supports safe role, rename, topic and slowmode proposals", () => {
  assert.deepEqual(parsePndIntelligenceModelPlan('{"type":"create_role","name":"Animateur"}'), {
    type: "create_role", name: "Animateur",
  });
  assert.deepEqual(parsePndIntelligenceModelPlan('{"type":"rename_channel","channelId":"123456789012345678","name":"Annonces générales"}'), {
    type: "rename_channel", channelId: "123456789012345678", name: "annonces-generales",
  });
  assert.deepEqual(parsePndIntelligenceModelPlan('{"type":"set_channel_topic","channelId":"123456789012345678","topic":"Bienvenue"}'), {
    type: "set_channel_topic", channelId: "123456789012345678", topic: "Bienvenue",
  });
  assert.deepEqual(parsePndIntelligenceModelPlan('{"type":"set_channel_slowmode","channelId":"123456789012345678","seconds":30}'), {
    type: "set_channel_slowmode", channelId: "123456789012345678", seconds: 30,
  });
});

test("model planner refuses privileged or malformed management proposals", () => {
  assert.throws(() => parsePndIntelligenceModelPlan('{"type":"create_role","name":"Admin","permissions":["ADMINISTRATOR"]}'), /champs inattendus/i);
  assert.throws(() => parsePndIntelligenceModelPlan('{"type":"rename_channel","channelId":"not-a-snowflake","name":"ok"}'), /identifiant/i);
  assert.throws(() => parsePndIntelligenceModelPlan('{"type":"set_channel_slowmode","channelId":"123456","seconds":21601}'), /mode lent/i);
});
