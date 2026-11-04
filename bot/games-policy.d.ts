export const DICE_MIN_FACES: number;
export const DICE_MAX_FACES: number;
export const DICE_MAX_COUNT: number;
export const COINFLIP_MIN_BET: number;
export const COINFLIP_MAX_BET: number;
export const COINFLIP_WIN_MULTIPLIER: number;
export const TRIVIA_REWARD: number;
export const GIVEAWAY_MAX_WINNERS: number;
export function clampInt(raw: unknown, min: number, max: number, fallback: number): number;
export function rollDice(faces?: number, count?: number, random?: () => number): { faces: number; values: number[]; total: number };
export function coinflipResult(random?: () => number): "pile" | "face";
export function coinflipPlan(input: { bet: unknown; choice?: string | null; random?: () => number }): {
  allowed: boolean; reason?: string; bet?: number; choice?: "pile" | "face"; result?: "pile" | "face"; won?: boolean; payout?: number;
};
export const TRIVIA_QUESTIONS: { question: string; choices: string[]; answer: number }[];
export function pickTriviaQuestion(random?: () => number): { question: string; choices: string[]; answer: number };
export function checkTriviaAnswer(question: { answer: number }, index: unknown): boolean;
export function drawGiveawayWinners(entries: (string | { user_id: string })[] | null | undefined, count?: number, random?: () => number): string[];
export function parseEventDate(raw: unknown, now?: number): number | null;
