import { describe, expect, it } from "vitest";
import { sanitizeSettings } from "@/lib/bot-settings";
import { diagnoseSettings } from "@/lib/settings-diagnostic";

const channels = [{ id: "100001", name: "logs", type: 0 }, { id: "100002", name: "verif", type: 0 }];
const roles = [{ id: "200001", name: "Membre" }];

describe("configuration diagnostic", () => {
  it("is clean for a complete configuration", () => {
    const s = sanitizeSettings({ logs: { channelId: "100001" }, verification: { enabled: true, roleId: "200001", channelId: "100002" } });
    expect(diagnoseSettings(s, { channels, roles })).toEqual([]);
  });

  it("uses the /setup requirement rule for an enabled module", () => {
    const s = sanitizeSettings({ logs: { channelId: "100001" }, verification: { enabled: true } });
    expect(diagnoseSettings(s, { channels, roles })[0]).toMatchObject({ level: "error", module: "Vérification des membres" });
  });

  it("flags deleted channels and roles, errors first", () => {
    const s = sanitizeSettings({ tickets: { enabled: true, supportRoleId: "999999", categoryId: "888888" } });
    const issues = diagnoseSettings(s, { channels, roles });
    expect(issues.map((i) => i.level)).toEqual(["error", "error", "info"]);
    expect(issues.some((i) => /rôle qui n’existe plus/.test(i.message))).toBe(true);
    expect(issues.at(-1)?.module).toBe("Journal centralisé");
  });
});
