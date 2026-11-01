import { describe, expect, it } from "vitest";
import { assertSameVoice } from "../../bot/music/music-policy.js";

describe("music voice controls", () => {
  it("allows controls only from the bot's current voice channel", () => {
    expect(() => assertSameVoice("voice-a", "voice-a")).not.toThrow();
    expect(() => assertSameVoice("voice-b", "voice-a")).toThrow("même salon vocal");
    expect(() => assertSameVoice(null, "voice-a")).toThrow("même salon vocal");
  });
});
