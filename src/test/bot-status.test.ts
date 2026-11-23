import { describe, expect, it } from "vitest";
import { connectionState, runtimeEventCodes, runtimeReportSchema, slashRuntimeStatus, formatRuntimeDuration, type RuntimeStatus } from "@/lib/bot-status";
const now = Date.parse("2026-10-30T11:00:00Z");
const status: RuntimeStatus = { connected: true, startedAt: "2026-10-30T10:00:00Z", lastSeen: "2026-10-30T11:00:00Z", lastSync: null, events: [], guilds: [] };
describe("Bot runtime", () => {
  it("accepts every fixed event code emitted by the bot process", () => {
    expect(runtimeEventCodes).toEqual(expect.arrayContaining([
      "interaction_error", "dog_enforcement_error", "sysplus_role_updated",
      "lockname_restored", "lockname_reconcile_error", "lockname_restore_error",
      "menotte_expired", "menotte_expiration_error",
      "waouf_expired", "waouf_expiration_error", "waouf_error", "waouf_permission_error",
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

describe("bot event codes", () => {
  it("lists every fixed code the bot records, otherwise the whole status report is rejected", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const files = (readdirSync("bot", { recursive: true }) as string[])
      .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js") && !f.includes("node_modules") && !f.startsWith("scripts"))
      .map((f) => `bot/${f}`);
    const codes = new Set<string>();
    for (const file of files) for (const m of readFileSync(file, "utf8").matchAll(/record\(\s*"([a-z_]+)"\s*\)/g)) codes.add(m[1] as string);
    const known = new Set<string>(runtimeEventCodes);
    expect([...codes].filter((code) => !known.has(code))).toEqual([]);
  });
});

describe("FWU multi-bot status", () => {
  it("stores FWU in the historical row and each dedicated bot in its own row", async () => {
    const { runtimeStatusRowId } = await import("@/lib/bot-status");
    expect(runtimeStatusRowId(undefined)).toBe("primary");
    expect(runtimeStatusRowId("fwu")).toBe("primary");
    expect(runtimeStatusRowId("guard")).toBe("guard");
  });
  it("accepts a known profile and refuses an unknown one", () => {
    const report = { connected: true, startedAt: "2026-10-30T10:00:00Z", lastSync: null, events: [], guilds: [] };
    expect(runtimeReportSchema.safeParse({ ...report, profile: "fisc" }).success).toBe(true);
    expect(runtimeReportSchema.safeParse({ ...report, profile: "core" }).success).toBe(false);
  });
});
