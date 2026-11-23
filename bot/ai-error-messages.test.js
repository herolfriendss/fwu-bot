import test from "node:test";
import assert from "node:assert/strict";
import { describePndAiFailure } from "./ai-error-messages.js";

test("AI errors explain missing credentials and billing separately", () => {
  assert.match(describePndAiFailure(503, { error: "ai not configured" }), /LOVABLE_API_KEY.*AI_GATEWAY_API_KEY/);
  assert.match(describePndAiFailure(402, { error: "credits" }), /crédits IA/);
});

test("AI errors distinguish rate limits, unavailable models and empty replies", () => {
  assert.match(describePndAiFailure(429, { error: "rate_limited" }), /limite temporairement/);
  assert.match(describePndAiFailure(404, {}), /son identifiant/);
  assert.match(describePndAiFailure(502, { error: "empty_ai_response" }), /aucun texte/);
});

test("action-planning failures identify the planner without exposing provider internals", () => {
  const message = describePndAiFailure(503, { error: "action planning failed" }, "action");
  assert.match(message, /planificateur PND Intelligence/);
  assert.doesNotMatch(message, /stack|Bearer|secret\s*=/i);
});
