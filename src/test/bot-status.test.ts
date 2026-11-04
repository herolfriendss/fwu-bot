import { describe, expect, it } from "vitest";
import { connectionState, runtimeEventCodes, runtimeReportSchema, slashRuntimeStatus, formatRuntimeDuration, type RuntimeStatus } from "@/lib/bot-status";
const now = Date.parse("2026-10-30T11:00:00Z");
const status: RuntimeStatus = { connected: true, startedAt: "2026-10-30T10:00:00Z", lastSeen: "2026-10-30T11:00:00Z", lastSync: null, events: [], guilds: [] };
describe("Bot runtime", () => {
  it("accepts every fixed event code emitted by the bot process", () => {
    expect(runtimeEventCodes).toEqual(expect.arrayContaining([
      "interaction_error", "dog_enforcement_error", "sysplus_role_updated",
    ]));
  });
  it("uses process start time for uptime while connected", () => {
    expect(slashRuntimeStatus(status, now)).toEqual({ state: "online", uptimeSeconds: 3600 });
    expect(formatRuntimeDuration(90061)).toBe("1 j 1 h 1 min 1 s");
    expect(formatRuntimeDuration(0)).toBe("0 j 0 h 0 min 0 s");
  });
  it("does not invent uptime without a fresh connected report", () => {
    expect(slashRuntimeStatus(null, now)).toEqual({ state: "unknown", uptimeSeconds: null });
    expect(slashRuntimeStatus(status, now + 70001)).toEqual({ state: "offline", uptimeSeconds: null });
    expect(slashRuntimeStatus({ ...status, connected: false }, now)).toEqual({ state: "offline", uptimeSeconds: null });
    expect(slashRuntimeStatus({ ...status, startedAt: "2026-10-30T12:00:00Z" }, now)).toEqual({ state: "online", uptimeSeconds: null });
  });
  it("keeps absence of telemetry unknown", () => expect(connectionState(null, now)).toBe("unknown"));
  it("marks a missing heartbeat offline after 70 seconds", () => {
    expect(connectionState(status, now + 70_000)).toBe("online");
    expect(connectionState(status, now + 70_001)).toBe("offline");
  });
  it("honors a reported Discord disconnection", () => expect(connectionState({ ...status, connected: false }, now)).toBe("offline"));
  it("rejects arbitrary log messages and extra fields", () => {
    expect(runtimeReportSchema.safeParse({ ...status, events: [{ at: status.startedAt, code: "sync_ok", message: "arbitrary-data" }] }).success).toBe(false);
  });
  it("accepts at most 50 known events", () => {
    const { lastSeen, ...report } = status;
    const event = { at: lastSeen, code: "sync_ok" };
    expect(runtimeReportSchema.safeParse({ ...report, events: Array(50).fill(event) }).success).toBe(true);
    expect(runtimeReportSchema.safeParse({ ...report, events: Array(51).fill(event) }).success).toBe(false);
  });
});
