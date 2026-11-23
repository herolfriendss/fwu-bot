import test from "node:test";
import assert from "node:assert/strict";
import {
  getKnowledgeTopic,
  KNOWLEDGE_TOPICS,
  normalizeKnowledgePage,
  parseKnowledgePrefixCommand,
} from "./pnd-knowledge-policy.js";

test("knowledge catalogue has unique stable keys and expected core pages", () => {
  const keys = KNOWLEDGE_TOPICS.map(({ key }) => key);
  assert.equal(new Set(keys).size, keys.length);
  for (const key of ["permissions", "recruitment", "tickets", "rules", "guide", "sysplus"]) {
    assert.ok(getKnowledgeTopic(key));
  }
  assert.equal(getKnowledgeTopic("not-real"), null);
});

test("knowledge page content is normalized and bounded", () => {
  assert.deepEqual(normalizeKnowledgePage({ title: "  Guide   PND ", content: "  Texte utile ici.  " }), {
    title: "Guide PND",
    content: "Texte utile ici.",
  });
  assert.throws(() => normalizeKnowledgePage({ title: "x", content: "text" }), /titre/);
  assert.throws(() => normalizeKnowledgePage({ title: "Titre", content: "x" }), /contenu/);
  assert.throws(() => normalizeKnowledgePage({ title: "Titre", content: "x".repeat(4001) }), /4 000/);
});

test("knowledge prefix command parses panel, show and edit syntax", () => {
  assert.deepEqual(parseKnowledgePrefixCommand("=knowledge panel"), { action: "panel" });
  assert.deepEqual(parseKnowledgePrefixCommand("=knowledge show sysplus"), { action: "show", topic: "sysplus" });
  assert.deepEqual(parseKnowledgePrefixCommand("=knowledge edit rules | Règlement | Respecte les autres."), {
    action: "edit", topic: "rules", title: "Règlement", content: "Respecte les autres.",
  });
  assert.equal(parseKnowledgePrefixCommand("=balance"), null);
  assert.deepEqual(parseKnowledgePrefixCommand("=knowledge"), { action: "panel" });
});
