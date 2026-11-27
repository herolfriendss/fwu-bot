import test from "node:test";
import assert from "node:assert/strict";
import { SNIPE, forgetSnipes, rememberDeleted, rememberEdited, snipeEmbed, snipeOf } from "./snipe.js";

const msg = (o = {}) => ({ guild: { id: "g" }, channelId: "c", author: { id: "a", bot: false }, content: "coucou", attachments: new Map(), url: "https://discord.com/x", ...o });

test("supprimé : gardé 10 minutes en mémoire, bots et messages inconnus ignorés", () => {
  forgetSnipes();
  assert.equal(rememberDeleted(msg(), 1_000), true);
  assert.equal(snipeOf("c", "deleted", 1_000 + SNIPE.ttlMs).content, "coucou");
  assert.equal(snipeOf("c", "deleted", 1_001 + SNIPE.ttlMs), null, "oublié après 10 min");
  assert.equal(rememberDeleted(msg({ author: { id: "b", bot: true } }), 2_000), false);
  assert.equal(rememberDeleted(msg({ partial: true }), 2_000), false);
  assert.equal(rememberDeleted(msg({ content: "" }), 2_000), false);
  assert.equal(rememberDeleted(msg({ content: "", attachments: new Map([["1", {}]]) }), 3_000), true, "image seule");
  assert.equal(snipeOf("c", "deleted", 3_000).attachments, 1);
  rememberDeleted(msg({ content: "x".repeat(2_000) }), 4_000);
  assert.ok(snipeOf("c", "deleted", 4_000).content.length <= SNIPE.maxChars + 1);
});

test("modifié : avant et après ; ignoré si le texte n'a pas changé (aperçus de liens)", () => {
  forgetSnipes();
  assert.equal(rememberEdited(msg({ content: "avant" }), msg({ content: "après" }), 1_000), true);
  assert.deepEqual([snipeOf("c", "edited", 1_000).before, snipeOf("c", "edited", 1_000).after], ["avant", "après"]);
  assert.equal(rememberEdited(msg(), msg(), 2_000), false);
  assert.equal(rememberEdited(msg({ partial: true, content: null }), msg(), 2_000), false);
  assert.equal(snipeOf("autre", "edited", 1_000), null);
});

test("embed : auteur, salon, contenu", () => {
  const e = snipeEmbed("deleted", { authorId: "a", content: "", attachments: 2, at: 0 }, "c").toJSON();
  assert.match(e.description, /<@a>/);
  assert.match(e.description, /Pièces jointes : 2/);
  assert.equal(e.fields[0].value, "*(aucun texte)*");
});
