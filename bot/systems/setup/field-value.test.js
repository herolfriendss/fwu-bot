import test from "node:test";
import assert from "node:assert/strict";
import { fieldValue } from "./panel-setup.js";

const integerField = { key: "maxActiveLeashes", kind: "integer", min: 1, max: 10, default: 3 };

test("a stored value always takes priority over the field default", () => {
  assert.equal(fieldValue(integerField, { maxActiveLeashes: 5 }), "5");
  assert.equal(fieldValue(integerField, { maxActiveLeashes: 1 }), "1");
  assert.equal(fieldValue(integerField, { maxActiveLeashes: 10 }), "10");
});

test("an absent value (null or undefined) falls back to the field default", () => {
  assert.equal(fieldValue(integerField, {}), "3");
  assert.equal(fieldValue(integerField, { maxActiveLeashes: null }), "3");
  assert.equal(fieldValue(integerField, undefined), "3");
  assert.equal(fieldValue(integerField, null), "3");
});

test("a field without default keeps the previous empty-string behaviour", () => {
  const plain = { key: "minAccountAgeDays", kind: "integer" };
  assert.equal(fieldValue(plain, {}), "");
  assert.equal(fieldValue(plain, { minAccountAgeDays: null }), "");
  assert.equal(fieldValue(plain, { minAccountAgeDays: 0 }), "0");
});

test("other field kinds keep their previous behaviour", () => {
  assert.equal(fieldValue({ key: "enabled", kind: "boolean" }, { enabled: false }), "false");
  assert.equal(fieldValue({ key: "enabled", kind: "boolean" }, { enabled: true }), "true");
  assert.equal(fieldValue({ key: "welcome", kind: "text" }, { welcome: "" }), "");
  assert.equal(fieldValue({ key: "roleId", kind: "role" }, {}), "");
});

test("roleList fields keep their list rendering and never use a default", () => {
  const roles = { key: "roleIds", kind: "roleList", default: 3 };
  assert.equal(fieldValue(roles, { roleIds: ["1", "2"] }), "1, 2");
  assert.equal(fieldValue(roles, { roleIds: "not-an-array" }), "");
  assert.equal(fieldValue(roles, {}), "");
});
