import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ upsert: vi.fn().mockResolvedValue({ error: null }), read: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.read }) }), upsert: mocks.upsert }) } }));
import { writeBotSettings } from "@/lib/bot-settings.server";
import { DEFAULT_SETTINGS } from "@/lib/bot-settings";

describe("voice settings preservation", () => {
  it.each([false, true])("preserves saved role restrictions when unrelated settings save updates commands: %s", async (updateCommands) => {
    const voiceAccess = { panelRoleIds: ["11111"], pvRoleIds: ["22222"], requestChannelId: "333333333333333333" };
    mocks.read.mockResolvedValue({ data: { settings: { ...DEFAULT_SETTINGS, voiceAccess } }, error: null });
    const saved = await writeBotSettings("99999", DEFAULT_SETTINGS, updateCommands);
    expect(saved.voiceAccess).toEqual(voiceAccess);
    expect(mocks.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ guild_id: "99999", settings: expect.objectContaining({ voiceAccess }) }));
  });
});