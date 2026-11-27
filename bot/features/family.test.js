import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "fwu-family-"));
process.env.HER_DB_PATH = join(directory, "runtime.sqlite");
const F = await import("./family.js");
const { db } = await import("../database.js");
after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });
const G = "100000000000000001";
const OTHER_GUILD = "100000000000000002";

function propose(kind, from, to, now = 1_000) {
  const problem = F.checkProposal(G, kind, from, to);
  if (problem) return problem;
  return F.answerProposal(G, F.createProposal(G, kind, from, to, now), to, true, now + 1);
}

test("mariage : accord de la personne demandée, un seul conjoint, ni soi ni bot", () => {
  assert.match(F.checkProposal(G, "marriage", "a", "a"), /toi-même/);
  assert.match(F.checkProposal(G, "marriage", "a", "bot", { toIsBot: true }), /bots/);
  const id = F.createProposal(G, "marriage", "a", "b", 1_000);
  assert.throws(() => F.answerProposal(G, id, "c", true, 1_001), /pas adressée/);
  assert.match(F.answerProposal(G, id, "b", true, 1_002), /marié/);
  assert.equal(F.spouseOf(G, "a").id, "b");
  assert.equal(F.spouseOf(G, "b").id, "a");
  assert.equal(F.spouseOf(OTHER_GUILD, "a"), null, "isolé par serveur");
  assert.match(F.checkProposal(G, "marriage", "a", "c"), /déjà marié/);
  assert.match(F.checkProposal(G, "marriage", "c", "b"), /déjà mariée/);
});

test("une demande expire après 15 minutes et un refus ne crée aucun lien", () => {
  const late = F.createProposal(G, "marriage", "x", "y", 10_000);
  assert.throws(() => F.answerProposal(G, late, "y", true, 10_000 + F.PROPOSAL_TTL_MS + 1), /expiré/);
  const refused = F.createProposal(G, "marriage", "x", "y", 20_000);
  assert.match(F.answerProposal(G, refused, "y", false, 20_001), /refusé/);
  assert.equal(F.spouseOf(G, "x"), null);
});

test("adoption : le conjoint devient co-parent, pas de boucle dans l'arbre", () => {
  assert.match(propose("adoption", "a", "kid"), /adopté/);
  assert.deepEqual(F.parentsOf(G, "kid").sort(), ["a", "b"]);
  assert.match(F.checkProposal(G, "adoption", "c", "kid"), /déjà des parents/);
  assert.match(F.checkProposal(G, "adoption", "kid", "a"), /ancêtres/);
  assert.match(F.checkProposal(G, "adoption", "a", "b"), /conjoint/);
  propose("adoption", "kid", "grandkid");
  assert.match(F.checkProposal(G, "marriage", "kid", "grandkid"), /famille proche/);
  assert.match(F.checkProposal(G, "adoption", "grandkid", "a"), /ancêtres/);
  const tree = F.familyTree(G, "kid");
  assert.match(tree, /Parents : <@a>, <@b>|Parents : <@b>, <@a>/);
  assert.match(tree, /Enfants : <@grandkid>/);
  assert.match(F.familyTree(G, "grandkid"), /Grands-parents/);
});

test("renier ne retire que son lien ; émancipation et divorce se font seul", () => {
  assert.match(F.disown(G, "a", "kid"), /ne compte plus/);
  assert.deepEqual(F.parentsOf(G, "kid"), ["b"], "l'autre parent garde son enfant");
  assert.throws(() => F.disown(G, "a", "kid"), /pas ton enfant/);
  assert.match(F.emancipate(G, "kid"), /quitté/);
  assert.deepEqual(F.parentsOf(G, "kid"), []);
  assert.match(F.divorce(G, "b"), /divorcé/);
  assert.equal(F.spouseOf(G, "a"), null);
  assert.throws(() => F.divorce(G, "a"), /pas marié/);
});

test("6 enfants au plus ; bonus de couple de 10 % pour les personnes mariées", () => {
  for (let i = 0; i < F.MAX_CHILDREN; i += 1) propose("adoption", "p", `c${i}`);
  assert.match(F.checkProposal(G, "adoption", "p", "c-extra"), /maximum/);
  assert.equal(F.coupleBonus(G, "p", 200), 0);
  propose("marriage", "p", "q");
  assert.equal(F.coupleBonus(G, "p", 200), 20);
  assert.equal(F.coupleBonus(G, "q", 3), 1, "au moins 1 PND");
  assert.match(F.familySummary(G, "p"), /Marié\(e\) à <@q>/);
  assert.match(F.familySummary(G, "p"), /Enfants/);
  assert.equal(F.familySummary(G, "nobody"), "");
});

test("la situation est revérifiée à l'acceptation", () => {
  const id = F.createProposal(G, "marriage", "m1", "m2", 50_000);
  propose("marriage", "m2", "m3", 50_100);
  assert.throws(() => F.answerProposal(G, id, "m2", true, 50_200), /déjà mariée/);
});
