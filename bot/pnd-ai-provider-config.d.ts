export type PndAiTask = "chat" | "action" | "rules";
export type PndAiGatewayConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
  headers: Record<string, string>;
  gateway: "lovable" | "vercel";
};
export function resolvePndAiGatewayConfig(
  env?: Record<string, string | undefined>,
  task?: PndAiTask,
): PndAiGatewayConfig | null;
