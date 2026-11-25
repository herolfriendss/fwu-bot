import { describe, expect, it } from "vitest";
import { applyModuleChanges, applySectionPatch, changedSections, mergeSettingsForWrite, sanitizeSettings, sectionConflicts } from "@/lib/bot-settings";

describe("dashboard section saves", () => {
  it("sends only the sections that changed", () => {
    const loaded = sanitizeSettings({});
    const edited = { ...loaded, tickets: { ...loaded.tickets, enabled: true } };
    expect(Object.keys(changedSections(edited, loaded))).toEqual(["tickets"]);
    expect(changedSections(loaded, loaded)).toEqual({});
  });

  it("keeps a module switched from Discord while the page was open", () => {
    const loaded = sanitizeSettings({});
    // Meanwhile /setup turns on the anti-spam module.
    const latest = sanitizeSettings({ spam: { enabled: true } });
    const edited = { ...loaded, tickets: { ...loaded.tickets, enabled: true } };
    const patch = changedSections(edited, loaded);
    expect(sectionConflicts(latest, patch, { tickets: loaded.tickets })).toEqual([]);
    const next = applySectionPatch(latest, patch);
    expect(next.spam.enabled).toBe(true);
    expect(next.tickets.enabled).toBe(true);
  });

  it("refuses a section that changed elsewhere since it was loaded", () => {
    const loaded = sanitizeSettings({});
    const latest = sanitizeSettings({ tickets: { enabled: true, maxOpenPerUser: 3 } });
    const patch = { tickets: { ...loaded.tickets, maxOpenPerUser: 2 } };
    expect(sectionConflicts(latest, patch, { tickets: loaded.tickets })).toEqual(["tickets"]);
    expect(sectionConflicts(latest, patch, {})).toEqual(["tickets"]);
  });

  it("ignores server-owned keys and sanitizes the patched values", () => {
    const latest = sanitizeSettings({ sysPlus: { roleId: "11111" }, adminPlus: { roleId: "33333" }, voiceAccess: { panelRoleIds: ["44444"], pvRoleIds: [] } });
    const next = applySectionPatch(latest, { sysPlus: { roleId: "99999" }, adminPlus: { roleId: "88888" }, voiceAccess: { panelRoleIds: [] }, spam: { maxMessages: 999 } });
    expect(next.sysPlus.roleId).toBe("11111");
    expect(next.adminPlus.roleId).toBe("33333");
    expect(next.voiceAccess.panelRoleIds).toEqual(["44444"]);
    expect(next.spam.maxMessages).toBeLessThan(999);
  });

  it("edits the DOG limit and WAKEUP channels as sections", () => {
    const latest = sanitizeSettings({ dog: { maxActiveLeashes: 6 } });
    const loaded = sanitizeSettings({});
    expect(sectionConflicts(latest, { dog: { maxActiveLeashes: 4 } }, { dog: loaded.dog })).toEqual(["dog"]);
    const next = applySectionPatch(latest, { wakeup: { ownerChannelId: "123456", excludedChannelIds: ["bad", "654321"] } });
    expect(next.dog).toEqual({ maxActiveLeashes: 6 });
    expect(next.wakeup).toEqual({ ownerChannelId: "123456", waitingChannelId: null, excludedChannelIds: ["654321"] });
    expect(mergeSettingsForWrite(next, latest, false).dog).toEqual({ maxActiveLeashes: 6 });
  });
});

describe("/setup field-level module writes", () => {
  it("applies only the changed fields", () => {
    const current = sanitizeSettings({ tickets: { enabled: false, maxOpenPerUser: 3 } });
    const { conflicts, next } = applyModuleChanges(current, "tickets", { enabled: true }, { enabled: false });
    expect(conflicts).toEqual([]);
    expect(next.tickets).toMatchObject({ enabled: true, maxOpenPerUser: 3 });
  });

  it("reports a field modified elsewhere", () => {
    const current = sanitizeSettings({ tickets: { enabled: true } });
    expect(applyModuleChanges(current, "tickets", { enabled: false }, { enabled: false }).conflicts).toEqual(["enabled"]);
  });

  it("works for optional modules and ignores prototype keys", () => {
    const current = sanitizeSettings({});
    const { conflicts, next } = applyModuleChanges(current, "dog", JSON.parse('{"maxActiveLeashes":5,"__proto__":{"x":1}}'), {});
    expect(conflicts).toEqual([]);
    expect(next.dog).toEqual({ maxActiveLeashes: 5 });
  });
});
