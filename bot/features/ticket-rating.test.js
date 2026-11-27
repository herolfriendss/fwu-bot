import test from "node:test";
import assert from "node:assert/strict";
import { RATING_TTL_MS, formatRatingStats, handleTicketRatingButton, prepareRating, rateTicket, ratingButtons, ratingStats } from "./ticket-rating.js";

test("à qui va la note : preneur du ticket, sinon celui qui ferme ; rien si l'auteur ferme seul", () => {
  assert.deepEqual(prepareRating({ guildId: "g", ticketId: 1, userId: "u", claimedBy: "m1", closerId: "m2" }, 0), { ticketId: 1, moderatorId: "m1" });
  assert.deepEqual(prepareRating({ guildId: "g", ticketId: 2, userId: "u", claimedBy: null, closerId: "m2" }, 0), { ticketId: 2, moderatorId: "m2" });
  assert.equal(prepareRating({ guildId: "g", ticketId: 3, userId: "u", claimedBy: null, closerId: "u" }, 0), null);
  assert.equal(ratingButtons("g", 1)[0].components.length, 5);
});

test("note : auteur seul, une fois, 7 jours, puis moyenne par modérateur", () => {
  assert.match(rateTicket({ ticketId: 1, userId: "x", value: 5 }, 1).message, /Seul l'auteur/);
  assert.equal(rateTicket({ ticketId: 1, userId: "u", value: 4 }, 1).ok, true);
  assert.match(rateTicket({ ticketId: 1, userId: "u", value: 1 }, 2).message, /Déjà noté/);
  prepareRating({ guildId: "g", ticketId: 4, userId: "v", claimedBy: "m1", closerId: "m1" }, 0);
  assert.equal(rateTicket({ ticketId: 4, userId: "v", value: 5 }, 3).ok, true);
  assert.match(rateTicket({ ticketId: 2, userId: "u", value: 3 }, RATING_TTL_MS + 1).message, /Trop tard/);
  assert.deepEqual(ratingStats("g"), [{ moderatorId: "m1", average: 4.5, count: 2 }]);
  assert.match(formatRatingStats(ratingStats("g")), /<@m1> · \*\*4,5\/5\*\*.*\(2 notes\)/);
  assert.equal(formatRatingStats([]), "Aucune note de ticket pour l'instant.");
});

test("bouton en MP : la note remplace les boutons", async () => {
  prepareRating({ guildId: "g", ticketId: 9, userId: "w", claimedBy: "m3", closerId: "m3" }, 0);
  let updated = null;
  const click = { isButton: () => true, customId: "trating:g:9:2", user: { id: "w" }, update: async (p) => { updated = p; } };
  assert.equal(await handleTicketRatingButton(click, 10), true);
  assert.match(updated.content, /★★☆☆☆/);
  assert.deepEqual(updated.components, []);
  assert.equal(await handleTicketRatingButton({ isButton: () => true, customId: "x" }), false);
});
