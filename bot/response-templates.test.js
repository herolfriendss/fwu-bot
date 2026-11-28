import test from "node:test";
import assert from "node:assert/strict";
import { listResponseTemplates, renderResponseTemplate } from "./response-templates.js";

test("ticket response templates are reviewed, selectable and non-empty", () => {
  const templates = listResponseTemplates("ticket");
  assert.deepEqual(templates.map((template) => template.id), ["received", "need-info", "in-progress", "resolved"]);
  assert.ok(templates.every((template) => template.label && template.description));
});

test("response templates render known placeholders and neutralize mentions", () => {
  const rendered = renderResponseTemplate("ticket", "received", {
    member: "<@123456789012345678>",
    staff: "@everyone",
    ticket_id: 42,
  });
  assert.match(rendered, /@membre/);
  assert.match(rendered, /@​everyone/);
  assert.match(rendered, /#42/);
  assert.doesNotMatch(rendered, /<@123456789012345678>/);
  const needInfo = renderResponseTemplate("ticket", "need-info", { subject: "Compte bloqué" });
  assert.match(needInfo, /Compte bloqué/);
});

test("unknown templates fail closed", () => {
  assert.equal(renderResponseTemplate("ticket", "unknown"), null);
  assert.deepEqual(listResponseTemplates("unknown"), []);
});
