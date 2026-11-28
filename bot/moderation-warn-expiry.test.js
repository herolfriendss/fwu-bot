import assert from "node:assert/strict";
import test from "node:test";
import { warningExpiry, warningExpiryDays } from "./moderation-policy.js";

test("/warn uses the server's default expiry unless the moderator sets one", () => {
  assert.equal(warningExpiryDays(null, { warnExpiryDays: 90 }), 90, "réglage du serveur");
  assert.equal(warningExpiryDays(0, { warnExpiryDays: 90 }), 0, "0 explicite = jamais");
  assert.equal(warningExpiryDays(7, { warnExpiryDays: 90 }), 7, "option explicite");
  assert.equal(warningExpiryDays(null, null), 0, "sans réglage : jamais, comme avant");
  assert.equal(warningExpiryDays(null, { warnExpiryDays: "abc" }), 0);
  assert.equal(warningExpiryDays(null, { warnExpiryDays: 9999 }), 0, "valeur hors limites ignorée");
  assert.equal(warningExpiry(1_000, warningExpiryDays(null, { warnExpiryDays: 1 })), 1_000 + 86_400_000);
});
