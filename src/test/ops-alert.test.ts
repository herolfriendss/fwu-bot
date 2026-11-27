import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
const { describeDevice } = await import("@/lib/ops-alert.server");

describe("describeDevice", () => {
  it("returns a coarse label, never the raw user agent", () => {
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari/604.1")).toBe("Safari sur iPhone/iPad");
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537")).toBe("Chrome sur Windows");
    expect(describeDevice(null)).toBe("navigateur inconnu sur appareil inconnu");
  });
});
