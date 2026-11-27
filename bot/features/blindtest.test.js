import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "fwu-blindtest-"));
process.env.HER_DB_PATH = join(directory, "runtime.sqlite");
const B = await import("./blindtest.js");
const { db } = await import("../database.js");
after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });

test("normalisation : accents, casse, parenthèses, feat", () => {
  assert.equal(B.normalizeAnswer("Dernière Danse (Clip Officiel)"), "derniere danse");
  assert.equal(B.normalizeAnswer("Bella feat. Vitaa"), "bella");
  assert.equal(B.normalizeAnswer("Pour que tu m'aimes encore !"), "pour que tu m aimes encore");
});

test("réponses : exactes, fautes légères, contenues dans une phrase courte ; pas de faux positifs", () => {
  assert.ok(B.answerMatches("alors on danse", "Alors on danse"));
  assert.ok(B.answerMatches("alors on dance", "Alors on danse"), "une faute");
  assert.ok(B.answerMatches("c'est alors on danse", "Alors on danse"));
  assert.ok(B.answerMatches("stromae", "Stromae"));
  assert.ok(!B.answerMatches("alors", "Alors on danse"));
  assert.ok(!B.answerMatches("jul", "PNL"), "réponses courtes : exactes seulement");
  assert.ok(B.answerMatches("pnl", "PNL"));
  assert.ok(!B.answerMatches("", "Djadja"));
  assert.ok(!B.answerMatches("un message très long qui parle de tout et de rien et qui contient djadja quelque part", "Djadja"));
});

test("découpage « Artiste - Titre » et titres YouTube", () => {
  assert.deepEqual(B.splitSong("Stromae - Papaoutai"), { artist: "Stromae", title: "Papaoutai" });
  assert.deepEqual(B.splitSong("Indila - Dernière danse (Clip Officiel)"), { artist: "Indila", title: "Dernière danse" });
  assert.deepEqual(B.splitSong("Bohemian Rhapsody"), { artist: null, title: "Bohemian Rhapsody" });
});

test("manche : artiste 1 pt, titre 2 pts, le premier seulement ; le titre clôt la manche", () => {
  const s = B.createSession({ guildId: "g1", channelId: "c", voiceChannelId: "v", hostId: "h", songs: ["Stromae - Papaoutai"] });
  assert.ok(B.isBlindTestRunning("g1"));
  assert.throws(() => B.createSession({ guildId: "g1", channelId: "c", voiceChannelId: "v", hostId: "x", songs: [] }), /déjà en cours/);
  B.startRound(s, { artist: "Stromae", title: "Papaoutai" });
  assert.equal(B.checkGuess(s, "a", "aucune idée"), null);
  assert.deepEqual(B.checkGuess(s, "a", "stromae"), { points: 1, found: ["artist"], roundOver: false });
  assert.equal(B.checkGuess(s, "b", "stromae"), null, "artiste déjà trouvé");
  assert.deepEqual(B.checkGuess(s, "b", "papaoutai"), { points: 2, found: ["title"], roundOver: true });
  assert.equal(B.checkGuess(s, "c", "papaoutai"), null, "manche close");
  B.startRound(s, { artist: "Daft Punk", title: "Get Lucky" });
  assert.deepEqual(B.checkGuess(s, "c", "daft punk get lucky"), { points: 3, found: ["artist", "title"], roundOver: true });
  assert.deepEqual(B.ranking(s.scores), [["c", 3], ["b", 2], ["a", 1]]);
  B.endSession("g1");
  assert.ok(!B.isBlindTestRunning("g1"));
});

test("classement : points cumulés, victoires (ex aequo compris), parties jouées", () => {
  B.recordGame("g2", new Map([["a", 5], ["b", 5], ["c", 1], ["d", 0]]));
  B.recordGame("g2", new Map([["c", 4], ["a", 1]]));
  const rows = B.leaderboard("g2");
  assert.deepEqual(rows.map((r) => [r.user_id, r.points, r.games, r.wins]), [["a", 6, 2, 1], ["b", 5, 1, 1], ["c", 5, 2, 1]]);
  assert.deepEqual(B.leaderboard("autre"), []);
});

test("tirage : sans doublon, nombre demandé", () => {
  const picked = B.pickSongs(["a", "b", "b", "c", "d"], 3, () => 0.5);
  assert.equal(picked.length, 3);
  assert.equal(new Set(picked).size, 3);
  assert.ok(B.DEFAULT_SONGS.length >= B.BT.maxRounds);
});

test("gains PND : 20 par point, bonus au gagnant (ex aequo compris), une erreur d'économie n'arrête rien", () => {
  const calls = [];
  const gains = B.rewardPlayers("g3", [["a", 5], ["b", 5], ["c", 2]], (g, u, n, r) => calls.push([g, u, n, r]));
  assert.deepEqual(gains, { a: 200, b: 200, c: 40 });
  assert.ok(calls.every((c) => c[0] === "g3" && c[3] === "blindtest_gain"));
  assert.deepEqual(B.rewardPlayers("g3", [["a", 1]], () => { throw new Error("x"); }), {});
  assert.deepEqual(B.rewardPlayers("g3", []), {});
});
