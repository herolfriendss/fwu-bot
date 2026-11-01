import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

// AI reply for the self-hosted bot. Returns { reply } or { error, status }.
export async function botAiReply(prompt: string, instructions: string, author: string): Promise<{ reply?: string; error?: string; status: number }> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return { error: "ai not configured", status: 500 };
  let runId: string | undefined;
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      if (runId) headers.set("X-Lovable-AIG-Run-ID", runId);
      const res = await fetch(input, { ...init, headers });
      runId ??= res.headers.get("X-Lovable-AIG-Run-ID") ?? undefined;
      return res;
    },
  });
  try {
    const result = streamText({
      model: provider.responses("openai/gpt-6-astra"),
      instructions: `${instructions}\nRéponds en moins de 1800 caractères. N’utilise jamais @everyone ni @here.`,
      messages: [{ role: "user", content: author ? `${author} : ${prompt}` : prompt }],
      maxRetries: 1,
      providerOptions: {
        openai: { forceReasoning: true, reasoningEffort: "low", reasoningSummary: "auto", store: false, include: ["reasoning.encrypted_content"] },
      },
    });
    let text = "";
    for await (const chunk of result.textStream) text += chunk;
    return { reply: text.slice(0, 1900), status: 200 };
  } catch (e) {
    const status = (e as { statusCode?: number })?.statusCode;
    if (status === 429) return { error: "rate_limited", status: 429 };
    if (status === 402) return { error: "credits", status: 402 };
    console.error("bot AI failed:", e instanceof Error ? e.message : e);
    return { error: "ai failed", status: 502 };
  }
}
