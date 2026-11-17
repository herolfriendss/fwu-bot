import test from "node:test";
import assert from "node:assert/strict";
import { normalizePrefixAlias } from "./prefix-commands.js";

test("plus prefix aliases the same command without changing arguments", () => {
  assert.equal(normalizePrefixAlias("+anti-move on"), "=anti-move on");
  assert.equal(normalizePrefixAlias("  +rank <@123> <@&456>"), "  =rank <@123> <@&456>");
});

test("historical prefix and ordinary messages remain unchanged", () => {
  assert.equal(normalizePrefixAlias("=daily"), "=daily");
  assert.equal(normalizePrefixAlias("hello + there"), "hello + there");
});
