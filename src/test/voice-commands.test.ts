import { describe, expect, it } from "vitest";
import { canManageVoice, canUseVoiceCommand, CONNECT, connectState, privateVoicePlan, restoreVoicePlan, voiceCommand } from "../../bot/voice-permissions.js";

describe("equal-prefix voice commands", () => {
  const access = { panelRoleIds: ["11111"], pvRoleIds: ["22222"] };
  it("allows only the selected panel roles, without requiring ManageChannels", () => {
    expect(canUseVoiceCommand("=panel", "0", ["11111"], access)).toBe(true);
    expect(canUseVoiceCommand("=panel", "16", ["22222"], access)).toBe(false);
  });
  it("checks pv roles independently including locks from the panel", () => {
    expect(canUseVoiceCommand("=pv", "0", ["22222"], access)).toBe(true);
    expect(canUseVoiceCommand("=pv", "0", ["11111"], access)).toBe(false);
  });
  it("revokes access when a role is removed from the current policy or member", () => {
    expect(canUseVoiceCommand("=panel", "0", ["11111"], access)).toBe(true);
    expect(canUseVoiceCommand("=panel", "0", ["11111"], { ...access, panelRoleIds: [] })).toBe(false);
    expect(canUseVoiceCommand("=panel", "0", [], access)).toBe(false);
  });
  it("keeps administrator and guild owner access when no roles are allowed", () => {
    const empty = { panelRoleIds: [], pvRoleIds: [] };
    expect(canUseVoiceCommand("=panel", "8", [], empty)).toBe(true);
    expect(canUseVoiceCommand("=pv", "0", [], empty, true)).toBe(true);
    expect(canUseVoiceCommand("=pv", "16", [], empty)).toBe(false);
  });
  it("preserves legacy permissions when role restrictions are off", () => {
    expect(canUseVoiceCommand("=panel", "16", [])).toBe(true);
    expect(canUseVoiceCommand("=pv", "0", [], { panelRoleIds: null, pvRoleIds: null })).toBe(false);
  });
  it("recognizes =panel and =pv, never their old-prefix variants", () => {
    expect(voiceCommand("=panel")).toBe("=panel");
    expect(voiceCommand("=pv")).toBe("=pv");
    expect(voiceCommand("!panel")).toBeNull();
    expect(voiceCommand("!pv")).toBeNull();
    expect(voiceCommand("texte =pv")).toBeNull();
  });
  it("requires Manage Channels or Administrator", () => {
    expect(canManageVoice("16")).toBe(true);
    expect(canManageVoice("8")).toBe(true);
    expect(canManageVoice("8192")).toBe(false);
    expect(canManageVoice("0")).toBe(false);
    expect(canManageVoice("invalid")).toBe(false);
  });
  it("private mode denies existing role and member grants, except actor and bot", () => {
    const plan = privateVoicePlan([{ id: "role", type: 0 }, { id: "other", type: 1 }], "guild", "actor", "bot");
    expect(plan).toContainEqual({ id: "role", type: 0, Connect: false });
    expect(plan).toContainEqual({ id: "other", type: 1, Connect: false });
    expect(plan).toContainEqual({ id: "guild", type: 0, Connect: false });
    expect(plan).toContainEqual({ id: "actor", type: 1, Connect: true });
    expect(plan).toContainEqual({ id: "bot", type: 1, Connect: true });
  });
  it("restores only Connect and clears grants created during private mode", () => {
    const plan = restoreVoicePlan([{ id: "new", type: 1, allow: CONNECT.toString(), deny: "0" }], [
      { id: "role", type: 0, allow: (CONNECT | 16n).toString(), deny: "0" },
      { id: "blocked", type: 1, allow: "0", deny: CONNECT.toString() },
    ]);
    expect(plan).toEqual([{ id: "role", type: 0, Connect: true }, { id: "blocked", type: 1, Connect: false }, { id: "new", type: 1, Connect: null }]);
    expect(connectState("16", "0")).toBeNull();
  });
});