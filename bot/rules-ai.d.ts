export const MIN_RULES: number;
export const MAX_RULES: number;
export const RULES_SYSTEM_PROMPT: string;

export function buildRulesPrompt(input?: {
  guildName?: string;
  consignes?: string;
  count?: number;
  previousProblems?: string[];
}): string;

export function validateRules(
  raw: unknown,
  expectedCount?: number | null,
): {
  ok: boolean;
  rules: { title: string; description: string }[];
  problems: string[];
};
