/**
 * Select the AI provider based on the server-side key that is actually present.
 * Never send a Lovable key to Vercel's gateway or the reverse.
 */
export function resolvePndAiGatewayConfig(env = process.env, task = "chat") {
  const configuredModel = (task === "action" ? env.PND_AI_ACTION_MODEL : env.PND_AI_CHAT_MODEL)?.trim()
    || env.PND_AI_MODEL?.trim();
  const vercelKey = env.AI_GATEWAY_API_KEY?.trim();
  if (vercelKey) {
    return {
      apiKey: vercelKey,
      baseURL: "https://ai-gateway.vercel.sh/v1",
      model: configuredModel || (task === "action" ? "openai/gpt-6.2-astra" : "openai/gpt-6.2-sol"),
      headers: {},
      gateway: "vercel",
    };
  }

  const lovableKey = env.LOVABLE_API_KEY?.trim();
  if (lovableKey) {
    return {
      apiKey: lovableKey,
      baseURL: "https://ai.gateway.lovable.dev/v1",
      model: configuredModel || "openai/gpt-5.5",
      headers: { "Lovable-API-Key": lovableKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
      gateway: "lovable",
    };
  }

  return null;
}
