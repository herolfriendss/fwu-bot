import test from "node:test";
import assert from "node:assert/strict";
import {
  canActOnTicket,
  sanitizeTicketSubject,
  ticketChannelName,
  ticketDuration,
  ticketOpenAllowed,
  parseTicketPrefixCommand,
} from "./tickets-policy.js";

test("ticket subject is normalized and bounded", () => {
  assert.equal(sanitizeTicketSubject("  Besoin   d'aide\nurgent  "), "Besoin d'aide urgent");
  assert.equal(sanitizeTicketSubject("x".repeat(30), 12), "x".repeat(12));
});

test("ticket channel names are Discord-safe and bounded", () => {
  assert.equal(ticketChannelName("Élodie / PND", "1234567890123456"), "ticket-elodie-pnd-3456");
  assert.ok(ticketChannelName("x".repeat(120), "1234").length <= 100);
});

test("ticket opening respects per-member limits", () => {
  assert.equal(ticketOpenAllowed(0, 1), true);
  assert.equal(ticketOpenAllowed(1, 1), false);
  assert.equal(ticketOpenAllowed(2, 3), true);
  assert.equal(ticketOpenAllowed(3, 3), false);
});

test("ticket actions are limited to the author, current claimant or staff", () => {
  const base = { ticketUserId: "author", claimedBy: "agent", isStaff: false };
  assert.equal(canActOnTicket({ ...base, actorId: "author" }), true);
  assert.equal(canActOnTicket({ ...base, actorId: "agent" }), true);
  assert.equal(canActOnTicket({ ...base, actorId: "staff", isStaff: true }), true);
  assert.equal(canActOnTicket({ ...base, actorId: "stranger" }), false);
  assert.equal(canActOnTicket({ ...base, actorId: null }), false);
});

test("ticket duration never becomes negative", () => {
  assert.equal(ticketDuration(10_000, 9_000), "0 min");
  assert.equal(ticketDuration(0, 3_600_000), "1 h");
  assert.equal(ticketDuration(0, 86_400_000), "1 j");
});

test("ticket prefix parser recognizes safe actions and bounded reasons", () => {
  assert.equal(parseTicketPrefixCommand("=ticket panel").action, "panel");
  assert.equal(parseTicketPrefixCommand("=ticket").action, "help");
  assert.equal(parseTicketPrefixCommand("=ticket close  Besoin   réglé").reason, "Besoin réglé");
  assert.equal(parseTicketPrefixCommand("=ticket add", null).error, "member_required");
  assert.equal(parseTicketPrefixCommand("=ticket remove", "1234567890123456").memberId, "1234567890123456");
  assert.equal(parseTicketPrefixCommand("=ticket drop").action, "invalid");
  assert.equal(parseTicketPrefixCommand("=balance"), null);
});
