import test from "node:test";
import assert from "node:assert/strict";
import { awardMonth, pickRichest } from "./richest-month.js";

test("richest of the month: first eligible member with a positive balance", () => {
  const rows = [{ user_id: "bot", balance: 900 }, { user_id: "gone", balance: 800 }, { user_id: "a", balance: 500 }, { user_id: "b", balance: 0 }];
  assert.equal(pickRichest(rows, (id) => id === "a" || id === "b").user_id, "a");
  assert.equal(pickRichest([{ user_id: "b", balance: 0 }]), null);
  assert.equal(awardMonth(Date.UTC(2026, 11, 1)), "2026-12");
});
