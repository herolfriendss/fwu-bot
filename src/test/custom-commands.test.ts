import { describe, expect, it, vi } from "vitest";
import { commandFormSchema, canUseCommand } from "@/lib/custom-commands";
const mocks = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock("@/lib/custom-commands.server", () => ({ findCustomCommand: mocks.find }));
vi.mock("@/lib/discord.server", () => ({ discord: vi.fn(), discordWrite: vi.fn(), invalidateCache: vi.fn() }));
import { handleInteraction } from "@/lib/discord-interactions.server";

describe("custom command management", () => {
  const input = { name: "reglement", description: "Lire les règles", response: "Respectez les membres.", ephemeral: false, permission: "0" };
  it("accepts a creatable command and rejects an invalid name", () => {
    expect(commandFormSchema.parse(input).name).toBe("reglement");
    expect(commandFormSchema.safeParse({ ...input, name: "nom avec espace" }).success).toBe(false);
  });
  it("allows public commands but enforces moderation permissions", () => {
    expect(canUseCommand("0", "0")).toBe(true);
    expect(canUseCommand("8192", "0")).toBe(false);
    expect(canUseCommand("8192", "8192")).toBe(true);
    expect(canUseCommand("32", "8")).toBe(true);
  });
  it("returns the saved response with mentions disabled", async () => {
    mocks.find.mockResolvedValue({ response: "Bonjour @everyone", permission: "0", ephemeral: true });
    const r = await handleInteraction({ type: 2, application_id: "123456", data: { id: "654321", name: "reglement" } });
    expect(mocks.find).toHaveBeenCalledWith("123456", "654321");
    expect(r).toEqual({ type: 4, data: { content: "Bonjour @everyone", flags: 64, allowed_mentions: { parse: [] } } });
  });
  it("refuses a restricted saved command to a regular member", async () => {
    mocks.find.mockResolvedValue({ response: "Secret", permission: "32", ephemeral: false });
    const r = await handleInteraction({ type: 2, application_id: "123456", member: { permissions: "0" }, data: { id: "654321", name: "reglement" } });
    expect(r.data?.["content"]).not.toContain("Secret");
    expect(r.data?.["flags"]).toBe(64);
  });
});