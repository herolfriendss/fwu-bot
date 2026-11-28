import test from "node:test";
import assert from "node:assert/strict";
import { resolvePndAiGatewayConfig } from "./pnd-ai-provider-config.js";

test("AI provider config selects documented Lovable defaults and its own key", () => {
  const config = resolvePndAiGatewayConfig({ LOVABLE_API_KEY: "lovable-secret" });
  assert.equal(config.gateway, "lovable");
  assert.equal(config.apiKey, "lovable-secret");
  assert.equal(config.baseURL, "https://ai.gateway.lovable.dev/v1");
  assert.equal(config.model, "openai/gpt-5.5");
  assert.equal(config.headers["Lovable-API-Key"], "lovable-secret");
});

test("AI provider config selects GPT-6.2 on Vercel and never mixes provider keys", () => {
  const config = resolvePndAiGatewayConfig({ AI_GATEWAY_API_KEY: "vercel-secret", LOVABLE_API_KEY: "lovable-secret" }, "action");
  assert.equal(config.gateway, "vercel");
  assert.equal(config.apiKey, "vercel-secret");
  assert.equal(config.baseURL, "https://ai-gateway.vercel.sh/v1");
  assert.equal(config.model, "openai/gpt-6.2-astra");
  assert.deepEqual(config.headers, {});
});

test("AI model can be explicitly overridden per task", () => {
  const config = resolvePndAiGatewayConfig({ LOVABLE_API_KEY: "k", PND_AI_CHAT_MODEL: "openai/custom-chat", PND_AI_ACTION_MODEL: "openai/custom-action" }, "action");
  assert.equal(config.model, "openai/custom-action");
  assert.equal(resolvePndAiGatewayConfig({ LOVABLE_API_KEY: "k", PND_AI_MODEL: "openai/shared" }).model, "openai/shared");
  assert.equal(resolvePndAiGatewayConfig({}), null);
});


test("rules generation reuses the action provider and supports a dedicated model override", () => {
  const fallback = resolvePndAiGatewayConfig({ AI_GATEWAY_API_KEY: "vercel-secret", PND_AI_ACTION_MODEL: "openai/action" }, "rules");
  assert.equal(fallback.model, "openai/action");
  const dedicated = resolvePndAiGatewayConfig({ AI_GATEWAY_API_KEY: "vercel-secret", PND_AI_RULES_MODEL: "openai/rules" }, "rules");
  assert.equal(dedicated.model, "openai/rules");
  const lovable = resolvePndAiGatewayConfig({ LOVABLE_API_KEY: "lovable-secret" }, "rules");
  assert.equal(lovable.model, "openai/gpt-5.5");
});
