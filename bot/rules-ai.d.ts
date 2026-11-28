export const MIN_RULES: number;
export const MAX_RULES: number;
export const RULES_SYSTEM_PROMPT: string;

export function buildRulesPrompt(input?: {
  guildName?: string;
  consignes?: string;
  count?: number;
  previousProblems?: string[];
}): string;

export function generateRules(input?: {
  apiUrl?: string;
  secret?: string;
  guildId?: string;
  userId?: string;
  guildName?: string;
  consignes?: string;
  count?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ title: string; description: string }[]>;

export function rulesToEmbedPages(
  rules: { title: string; description: string }[],
  maxLength?: number,
): string[];

export function rulesToText(rules?: { title: string; description: string }[]): string;
export function parseRulesText(text: string): { title: string; description: string }[];

export function validateRules(
  raw: unknown,
  expectedCount?: number | null,
): {
  ok: boolean;
  rules: { title: string; description: string }[];
  problems: string[];
};
