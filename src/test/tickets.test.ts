import { describe, expect, it } from "vitest";
import {
  canActOnTicket, sanitizeTicketSubject, ticketChannelName, ticketDuration, ticketOpenAllowed, ticketStatusLabel,
} from "../../bot/tickets-policy.js";

describe("tickets policy", () => {
  it("sanitizes subjects and builds safe channel names", () => {
    expect(sanitizeTicketSubject("  Problème\navec   mon rôle  ")).toBe("Problème avec mon rôle");
    expect(sanitizeTicketSubject("x".repeat(500))).toHaveLength(200);
    expect(ticketChannelName("Élodie Dupont", "123456789012345678")).toBe("ticket-elodie-dupont-5678");
    expect(ticketChannelName("!!!", "1")).toBe("ticket-membre-1");
    expect(ticketChannelName("a".repeat(200), "42").length).toBeLessThanOrEqual(100);
  });

  it("limits open tickets per member", () => {
    expect(ticketOpenAllowed(0, 1)).toBe(true);
    expect(ticketOpenAllowed(1, 1)).toBe(false);
    expect(ticketOpenAllowed(1, 2)).toBe(true);
    expect(ticketOpenAllowed(0, 0)).toBe(true);
  });

  it("allows the author, the claimer or staff only", () => {
    expect(canActOnTicket({ actorId: "author", ticketUserId: "author" })).toBe(true);
    expect(canActOnTicket({ actorId: "claimer", ticketUserId: "author", claimedBy: "claimer" })).toBe(true);
    expect(canActOnTicket({ actorId: "staff", ticketUserId: "author", isStaff: true })).toBe(true);
    expect(canActOnTicket({ actorId: "other", ticketUserId: "author" })).toBe(false);
    expect(canActOnTicket({ actorId: null, ticketUserId: "author" })).toBe(false);
  });

  it("formats statuses and durations", () => {
    expect(ticketStatusLabel("open")).toContain("Ouvert");
    expect(ticketStatusLabel("closed")).toContain("Fermé");
    expect(ticketDuration(0, 30 * 60_000)).toBe("30 min");
    expect(ticketDuration(0, 2 * 3_600_000)).toBe("2 h");
    expect(ticketDuration(0, 2 * 86_400_000)).toBe("2 j");
  });
});
