import { describe, expect, it } from "vitest";
import {
  COINFLIP_MAX_BET, TRIVIA_QUESTIONS, checkTriviaAnswer, clampInt, coinflipPlan, drawGiveawayWinners,
  parseEventDate, pickTriviaQuestion, rollDice,
} from "../../bot/games-policy.js";

describe("games policy", () => {
  it("rolls bounded dice and sums them", () => {
    const result = rollDice(6, 3, () => 0);
    expect(result).toEqual({ faces: 6, values: [1, 1, 1], total: 3 });
    expect(rollDice(1000, 99, () => 0.999999)).toMatchObject({ faces: 100, values: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100] });
    expect(rollDice(1, 0, () => 0).faces).toBe(2);
    expect(clampInt(Number.NaN, 1, 5, 3)).toBe(3);
  });

  it("resolves coinflips and caps the bet", () => {
    expect(coinflipPlan({ bet: 100, choice: "pile", random: () => 0 })).toMatchObject({ allowed: true, result: "pile", won: true, payout: 190 });
    expect(coinflipPlan({ bet: 100, choice: "pile", random: () => 0.99 })).toMatchObject({ result: "face", won: false, payout: 0 });
    expect(coinflipPlan({ bet: 1 }).allowed).toBe(false);
    expect(coinflipPlan({ bet: 10_000 }).bet).toBe(COINFLIP_MAX_BET);
  });

  it("has a valid trivia bank and checks answers", () => {
    expect(TRIVIA_QUESTIONS.length).toBeGreaterThanOrEqual(10);
    for (const question of TRIVIA_QUESTIONS) {
      expect(question.choices).toHaveLength(4);
      expect(question.answer).toBeGreaterThanOrEqual(0);
      expect(question.answer).toBeLessThan(4);
    }
    const question = pickTriviaQuestion(() => 0);
    expect(question).toBe(TRIVIA_QUESTIONS[0]);
    expect(checkTriviaAnswer(question, question.answer)).toBe(true);
    expect(checkTriviaAnswer(question, (question.answer + 1) % 4)).toBe(false);
  });

  it("draws unique giveaway winners without exceeding the entry count", () => {
    const entries = [{ user_id: "a" }, { user_id: "b" }, { user_id: "b" }, { user_id: "c" }];
    const winners = drawGiveawayWinners(entries, 2, () => 0);
    expect(new Set(winners).size).toBe(2);
    expect(winners.every((id) => ["a", "b", "c"].includes(id))).toBe(true);
    expect(drawGiveawayWinners([], 5, () => 0)).toEqual([]);
    expect(drawGiveawayWinners(["a"], 10, () => 0)).toEqual(["a"]);
  });

  it("parses future event dates and rejects the past or garbage", () => {
    const now = Date.UTC(2026, 10, 4, 12, 0, 0);
    expect(parseEventDate("2030-01-01T20:00:00Z", now)).toBe(Date.UTC(2030, 0, 1, 20, 0, 0));
    expect(parseEventDate("01/01/2030 20:00", now)).toBeGreaterThan(now);
    expect(parseEventDate("2020-01-01T20:00:00Z", now)).toBeNull();
    expect(parseEventDate("pas une date", now)).toBeNull();
    expect(parseEventDate("", now)).toBeNull();
  });
});
