import { describe, expect, it } from "vitest";
import {
  BOT_MODULE_SETTINGS_KEYS,
  DOG_LEASH_LIMIT,
  mergeSettingsForWrite,
  sanitizeDogSettings,
  sanitizeSettings,
} from "@/lib/bot-settings";

describe("DOG leash limit settings", () => {
  it("accepts the dog module as a bot-sync module setting", () => {
    expect(BOT_MODULE_SETTINGS_KEYS).toContain("dog");
  });

  it("keeps the bounds in one place: 1 to 10, default 3", () => {
    expect(DOG_LEASH_LIMIT).toEqual({ min: 1, max: 10, default: 3 });
  });

  it("leaves dog absent when the input does not carry it", () => {
    expect(sanitizeSettings({}).dog).toBeUndefined();
    expect(sanitizeSettings({ tickets: { enabled: true } }).dog).toBeUndefined();
  });

  it("accepts integers from 1 to 10 as stored", () => {
    expect(sanitizeSettings({ dog: { maxActiveLeashes: 1 } }).dog).toEqual({ maxActiveLeashes: 1 });
    expect(sanitizeSettings({ dog: { maxActiveLeashes: 5 } }).dog).toEqual({ maxActiveLeashes: 5 });
    expect(sanitizeSettings({ dog: { maxActiveLeashes: 10 } }).dog).toEqual({ maxActiveLeashes: 10 });
  });

  it("falls back to 3 for any value that is not an integer in range (no clamping)", () => {
    for (const bad of [0, 11, 99, -1, 2.5, Number.NaN, "5", null, undefined, {}]) {
      expect(sanitizeDogSettings({ maxActiveLeashes: bad }).maxActiveLeashes).toBe(3);
    }
  });

  it("a module update for dog replaces the stored limit", () => {
    const current = sanitizeSettings({ dog: { maxActiveLeashes: 6 } });
    const merged = sanitizeSettings({ ...current, dog: { maxActiveLeashes: 9 } });
    expect(merged.dog).toEqual({ maxActiveLeashes: 9 });
  });

  it("a general save that does not mention dog keeps the stored limit", () => {
    const latest = sanitizeSettings({ dog: { maxActiveLeashes: 7 } });
    const incoming = sanitizeSettings({ tickets: { enabled: true } });
    expect(mergeSettingsForWrite(incoming, latest, false).dog).toEqual({ maxActiveLeashes: 7 });
  });

  it("a save that carries dog takes precedence over the stored limit", () => {
    const latest = sanitizeSettings({ dog: { maxActiveLeashes: 7 } });
    const incoming = sanitizeSettings({ dog: { maxActiveLeashes: 4 } });
    expect(mergeSettingsForWrite(incoming, latest, false).dog).toEqual({ maxActiveLeashes: 4 });
  });

  it("without any stored limit, a save that does not mention dog stays without dog", () => {
    const merged = mergeSettingsForWrite(sanitizeSettings({}), sanitizeSettings({}), false);
    expect(merged.dog).toBeUndefined();
  });

  it("does not disturb the other modules when dog is preserved", () => {
    const current = sanitizeSettings({ dog: { maxActiveLeashes: 6 }, spam: { enabled: true } });
    const merged = mergeSettingsForWrite(
      sanitizeSettings({ ...current, tickets: { enabled: true } }),
      current,
      false,
    );
    expect(merged.dog).toEqual({ maxActiveLeashes: 6 });
    expect(merged.spam.enabled).toBe(true);
    expect(merged.tickets.enabled).toBe(true);
  });
});
