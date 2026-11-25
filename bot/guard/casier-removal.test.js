import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "fwu-casier-")), "db.sqlite");
const { db } = await import("../database.js");
const { removeModerationCase, listRemovedCases } = await import("./commands.js");

const G = "123456789012345678";
const add = (moderator) => Number(db.prepare("INSERT INTO moderation_cases(guild_id,user_id,moderator_id,action,reason,created_at) VALUES(?,?,?,?,?,?)").run(G, "victim", moderator, "ban", "abus", 1_000).lastInsertRowid);

test("une affaire retirée est archivée avec qui et pourquoi, jamais effacée", () => {
  const id = add("mod1");
  assert.match(removeModerationCase({ guildId: G, caseId: id, actorId: "sys1", reason: "" }), /motif/);
  const removed = removeModerationCase({ guildId: G, caseId: id, actorId: "sys1", reason: "erreur de cible" });
  assert.equal(removed.removedBy, "sys1");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM moderation_cases WHERE id=?").get(id).n, 0);
  const archived = listRemovedCases(G, "victim");
  assert.equal(archived[0].id, id);
  assert.equal(archived[0].removal_reason, "erreur de cible");
  assert.equal(archived[0].moderator_id, "mod1", "l'auteur d'origine reste visible");
});

test("on ne retire pas sa propre affaire, sauf l'owner ; affaire d'un autre serveur introuvable", () => {
  const own = add("mod2");
  assert.match(removeModerationCase({ guildId: G, caseId: own, actorId: "mod2", reason: "je me suis trompé" }), /toi-même/);
  assert.equal(typeof removeModerationCase({ guildId: G, caseId: own, actorId: "owner", reason: "décision owner", ownerId: "owner" }), "object");
  const other = add("mod3");
  assert.match(removeModerationCase({ guildId: "999999999999999999", caseId: other, actorId: "sys1", reason: "xxx" }), /introuvable/);
});
