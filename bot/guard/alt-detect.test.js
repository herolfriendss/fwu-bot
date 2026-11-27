import test from "node:test";
import assert from "node:assert/strict";
import { ALT, checkAltOnJoin, findAltMatches, forgetBanList, nameSimilarity, normalizeName, scoreAgainst } from "./alt-detect.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 27);

test("normalisation des noms : accents, leet, chiffres finaux, répétitions, décorations", () => {
  assert.equal(normalizeName("xX_D4rk.V4d0r_99Xx"), "darkvador");
  assert.equal(normalizeName("Élodie"), "elodie");
  assert.equal(normalizeName("toxxxic777"), "toxic");
  assert.equal(normalizeName("Max"), "max");
});

test("ressemblance : noms identiques après normalisation, proches, ou sans rapport", () => {
  assert.equal(nameSimilarity("DarkVador", "d4rkv4d0r_2"), 1);
  assert.ok(nameSimilarity("darkvador", "darkvadorr") === 1, "répétition écrasée");
  assert.ok(nameSimilarity("darkvador", "darkvadar") >= 0.85);
  assert.ok(nameSimilarity("darkvador", "sunflower") < 0.5);
  assert.equal(nameSimilarity("bob", "bobby"), 0, "noms courts : identiques ou rien");
  assert.equal(nameSimilarity("", "x"), 0);
});

const banned = { id: "1", username: "d4rkv4d0r", globalName: "Dark Vador", avatar: "abc123" };

test("score : photo identique et nom proche ; compte récent et photo par défaut ne comptent qu'avec une ressemblance", () => {
  const twin = { id: "2", username: "darkvador_2", globalName: null, avatar: "abc123", createdTimestamp: NOW - 2 * DAY };
  const r = scoreAgainst(twin, banned, NOW);
  assert.equal(r.score, 100);
  assert.ok(r.reasons.includes("même photo de profil"));
  const stranger = { id: "3", username: "sunflower", globalName: null, avatar: null, createdTimestamp: NOW - DAY };
  assert.equal(scoreAgainst(stranger, banned, NOW).score, 0, "un compte récent sans ressemblance n'est pas suspect");
  const nameOnly = { id: "4", username: "dark.vador", avatar: null, createdTimestamp: NOW - 400 * DAY };
  assert.equal(scoreAgainst(nameOnly, banned, NOW).score, ALT.similarName + ALT.defaultAvatar);
  assert.equal(scoreAgainst({ ...banned, createdTimestamp: NOW }, banned, NOW).score, 0, "le banni lui-même");
});

test("correspondances : seuil, tri, limite", () => {
  const user = { id: "9", username: "darkvador", avatar: "zzz", createdTimestamp: NOW - 3 * DAY };
  const list = [banned, { id: "5", username: "sunflower", avatar: "zzz" }, { id: "6", username: "darkvadorr", avatar: null }];
  const matches = findAltMatches(user, list, { now: NOW });
  assert.equal(matches[0].banned.id, "5", "même photo : la plus forte");
  assert.deepEqual(new Set(matches.map((m) => m.banned.id)), new Set(["5", "1", "6"]));
  assert.ok(matches.every((m) => m.score >= ALT.threshold));
  assert.deepEqual(findAltMatches({ id: "7", username: "quelquun", avatar: null, createdTimestamp: NOW }, list, { now: NOW }), []);
});

function fakeGuild(bans) {
  let fetches = 0;
  return {
    id: "g1",
    get fetches() { return fetches; },
    bans: { fetch: async () => { fetches += 1; return new Map(bans.map((u) => [u.id, { user: u, reason: "spam" }])); } },
  };
}

test("arrivée : alerte au staff si ressemblance, rien sinon ; liste des bannis mise en cache", async () => {
  const guild = fakeGuild([banned]);
  const sent = [];
  const records = [];
  const member = (user) => ({ id: user.id, guild, user });
  const twin = await checkAltOnJoin(member({ id: "2", username: "darkvador", avatar: "abc123", createdTimestamp: NOW - DAY, bot: false }), { sendLog: async (e) => sent.push(e), record: (c) => records.push(c), now: NOW });
  assert.equal(twin.length, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].data.description, /d4rkv4d0r/);
  assert.match(sent[0].data.description, /Aucune sanction automatique/);
  assert.deepEqual(records, ["alt_suspect"]);
  assert.equal(await checkAltOnJoin(member({ id: "3", username: "sunflower", avatar: null, createdTimestamp: NOW }), { sendLog: async (e) => sent.push(e), now: NOW + 1 }), null);
  assert.equal(guild.fetches, 1, "cache de 10 minutes");
  forgetBanList("g1");
  await checkAltOnJoin(member({ id: "3", username: "sunflower", avatar: null, createdTimestamp: NOW }), { now: NOW + 2 });
  assert.equal(guild.fetches, 2, "vidé après un ban ou un déban");
  assert.equal(await checkAltOnJoin(member({ id: "8", username: "darkvador", avatar: "abc123", bot: true }), { now: NOW }), null, "bots ignorés");
});
