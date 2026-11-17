import test from "node:test";
import assert from "node:assert/strict";
import {
  activeWarnings,
  formatDuration,
  parseDuration,
  parseMemberReference,
  sanitizeReason,
  warningExpiry,
} from "./moderation-policy.js";

test("mute durations accept minutes, hours and days up to Discord's 28-day limit", () => {
  assert.equal(parseDuration("10m"), 10);
  assert.equal(parseDuration("2h"), 120);
  assert.equal(parseDuration("1d"), 1_440);
  assert.equal(parseDuration("28d"), 40_320);
  assert.equal(parseDuration("4j"), 5_760);
});

test("invalid, zero, seconds and over-limit durations are rejected", () => {
  for (const value of ["", "abc", "0m", "1s", "-5m", "29d", "999999999999999999999d"]) {
    assert.equal(parseDuration(value), null, `expected ${value} to be rejected`);
  }
});

test("warnings expire and expired rows are filtered", () => {
  const now = 1_000_000;
  assert.equal(warningExpiry(now, 0), null);
  assert.equal(warningExpiry(now, 7), now + 7 * 86_400_000);
  const active = activeWarnings([
    { id: 1, expires_at: null },
    { id: 2, expires_at: now + 1 },
    { id: 3, expires_at: now },
  ], now);
  assert.deepEqual(active.map((row) => row.id), [1, 2]);
});

test("reasons are single-line and bounded; durations are formatted", () => {
  assert.equal(sanitizeReason("first line\nsecond line"), "first line second line");
  assert.equal(sanitizeReason("x".repeat(400)).length, 300);
  assert.equal(formatDuration(10), "10 min");
  assert.equal(formatDuration(120), "2 h");
  assert.equal(formatDuration(2_880), "2 j");
});


test("prefix member references accept mentions and snowflakes only", () => {
  assert.equal(parseMemberReference("<@12345678901234567>"), "12345678901234567");
  assert.equal(parseMemberReference("<@!12345678901234567>"), "12345678901234567");
  assert.equal(parseMemberReference("12345678901234567"), "12345678901234567");
  assert.equal(parseMemberReference("reason-12345678901234567"), null);
  assert.equal(parseMemberReference("<@&12345678901234567>"), null);
  assert.equal(parseMemberReference("1234"), null);
});
