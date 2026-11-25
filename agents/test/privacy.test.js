import assert from "node:assert/strict";
import { test } from "node:test";
import { classifySignal, labelAuthors, looksLikeBotError, pseudonymize, redact } from "../src/privacy.js";

test("pseudonymize : stable, non réversible et dépendant du secret", () => {
  const a = pseudonymize("123456789012345678", "s".repeat(32));
  assert.equal(a, pseudonymize("123456789012345678", "s".repeat(32)));
  assert.notEqual(a, pseudonymize("123456789012345678", "t".repeat(32)));
  assert.ok(!a.includes("123456789012345678"));
  assert.equal(a.length, 16);
});

test("redact masque mentions, liens, e-mails, numéros et secrets", () => {
  const out = redact(
    "<@123456789012345678> regarde https://exemple.fr/x et discord.gg/abc, écris à a.b@c.fr ou 06 12 34 56 78, token MTIzNDU2Nzg5MDEyMzQ1Njc4.abcdef <#123> <@&456>",
  );
  assert.ok(!/\d{6,}/.test(out), out);
  for (const tag of ["[membre]", "[lien]", "[invitation]", "[e-mail]", "[numéro]", "[secret]", "[salon]", "[rôle]"])
    assert.ok(out.includes(tag), `${tag} absent de : ${out}`);
});

test("redact coupe les messages trop longs", () => {
  assert.ok(redact("a ".repeat(400)).length <= 300);
});

test("classifySignal repère bugs, idées et questions, ignore le reste", () => {
  assert.equal(classifySignal("le bot musique marche pas depuis hier"), "bug");
  assert.equal(classifySignal("ce serait bien d'avoir un salon mèmes"), "idee");
  assert.equal(classifySignal("comment on récupère son daily ?"), "question");
  assert.equal(classifySignal("salut tout le monde, bonne soirée"), null);
  assert.equal(classifySignal("ok"), null);
});

test("looksLikeBotError", () => {
  assert.ok(looksLikeBotError("❌ Une erreur est survenue"));
  assert.ok(!looksLikeBotError("Bienvenue sur le serveur !"));
});

test("labelAuthors remplace les empreintes par des lettres", () => {
  const out = labelAuthors([{ author_hash: "x" }, { author_hash: "y" }, { author_hash: "x" }, { author_hash: null }]);
  assert.deepEqual(out.map((e) => e.author), ["membre A", "membre B", "membre A", "bot"]);
  assert.ok(out.every((e) => e.author_hash === undefined));
});
