import { describe, expect, it } from "vitest";
import { isDiscordSnowflake } from "@/lib/discord-ids";

describe("Discord identifier validation", () => {
  it("accepts snowflake-shaped numeric IDs and rejects escaped-pattern literals", () => {
    expect(isDiscordSnowflake("123456789012345678")).toBe(true);
    expect(isDiscordSnowflake("\\dddddd")).toBe(false);
    expect(isDiscordSnowflake("1234")).toBe(false);
    expect(isDiscordSnowflake("12345/../users")).toBe(false);
  });
});
