import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireOwner: vi.fn(), discord: vi.fn(), read: vi.fn(), upsert: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({ inputValidator: (validate: (input: unknown) => unknown) => ({ handler: (handler: (args: { data: unknown }) => unknown) => (args: { data: unknown }) => handler({ data: validate(args.data) }) }) }) }));
vi.mock("@/lib/discord.server", () => ({ requireOwner: mocks.requireOwner, discord: mocks.discord }));
vi.mock("@/lib/bot-settings.server", () => ({ readBotSettings: mocks.read }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => ({ upsert: mocks.upsert }) } }));
import { saveVoiceAdmin, getVoiceAdmin } from "@/lib/voice-admin.functions";
import { DEFAULT_SETTINGS } from "@/lib/bot-settings";

describe("owner-only voice admin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue(undefined);
    mocks.discord.mockResolvedValue([{ id: "11111", name: "Mod", position: 1 }]);
    mocks.read.mockResolvedValue({ ...DEFAULT_SETTINGS, prefixCommands: [{ name: "regles", response: "R", permission: "0" }] });
    mocks.upsert.mockResolvedValue({ error: null });
  });
  it("refuses reads and writes before Discord or Cloud access for non-owners", async () => {
    mocks.requireOwner.mockRejectedValue(new Error("unauthorized"));
    await expect(getVoiceAdmin({ data: { guildId: "99999" } })).rejects.toThrow("unauthorized");
    await expect(saveVoiceAdmin({ data: { guildId: "99999", access: { panelRoleIds: ["11111"], pvRoleIds: [] } } })).rejects.toThrow("unauthorized");
    expect(mocks.discord).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("saves guild-specific access without losing custom commands", async () => {
    const access = { panelRoleIds: ["11111"], pvRoleIds: [] };
    await saveVoiceAdmin({ data: { guildId: "99999", access } });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ guild_id: "99999", settings: expect.objectContaining({ voiceAccess: { ...access, requestChannelId: null }, prefixCommands: [{ name: "regles", response: "R", permission: "0" }] }) }));
  });
  it("rejects roles from another guild and everyone", async () => {
    await expect(saveVoiceAdmin({ data: { guildId: "99999", access: { panelRoleIds: ["22222"], pvRoleIds: [] } } })).rejects.toThrow("rôle");
    await expect(saveVoiceAdmin({ data: { guildId: "99999", access: { panelRoleIds: ["99999"], pvRoleIds: [] } } })).rejects.toThrow("rôle");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});