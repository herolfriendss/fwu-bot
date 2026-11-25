import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "pnd-versus-")), "economy.sqlite");
const { db } = await import("../database.js");
const engine = await import("./versus-engine.js");
const {
  createChallenge, acceptChallenge, refuseChallenge, playMove, forfeit, versusGame, versusPayload, versusStats,
  versusLeaderboard, startHangman, guessHangman, hangmanPayload, expireGames, handleVersusInteraction,
  INVITE_TTL_MS, TURN_TTL_MS, HANGMAN_TTL_MS, MAX_BET,
} = await import("./versus.js");
const { HANGMAN_WORDS } = await import("./hangman-words.js");

const G = "100000000000000555";
let n = 0;
const member = () => `2000000000000${String(++n).padStart(5, "0")}`;
const setBalance = (userId, balance) =>
  db.prepare("INSERT INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,?,0) ON CONFLICT(guild_id,user_id) DO UPDATE SET balance=excluded.balance").run(G, userId, balance);
const balance = (userId) => Number(db.prepare("SELECT balance FROM wallets WHERE guild_id=? AND user_id=?").get(G, userId)?.balance ?? 0);
const ledger = (userId) => db.prepare("SELECT delta, reason FROM economy_ledger WHERE guild_id=? AND user_id=? ORDER BY id").all(G, userId).map((r) => [Number(r.delta), r.reason]);

// ─── Règles ──────────────────────────────────────────────────────────────────

test("tic-tac-toe: lines, columns, diagonals, draw, occupied cell", () => {
  assert.equal(engine.tttOutcome("XXX......"), "X");
  assert.equal(engine.tttOutcome("O..O..O.."), "O");
  assert.equal(engine.tttOutcome("X...X...X"), "X");
  assert.equal(engine.tttOutcome("..O.O.O.."), "O");
  assert.equal(engine.tttOutcome("XOXXOOOXX"), "draw");
  assert.equal(engine.tttOutcome("XO......."), null);
  assert.equal(engine.tttPlay("X........", 0, "O").ok, false);
  assert.equal(engine.tttPlay(".........", 9, "O").ok, false);
  assert.equal(engine.tttPlay(".........", 4, "O").board, "....O....");
});

test("connect four: gravity, full column, four in a row in every direction", () => {
  let board = engine.C4_EMPTY;
  for (let i = 0; i < 6; i++) board = engine.c4Play(board, 0, i % 2 ? "O" : "X").board;
  assert.equal(engine.c4ColumnFull(board, 0), true);
  assert.match(engine.c4Play(board, 0, "X").reason, /pleine/);
  const drop = (cols, marks) => cols.reduce((b, col, i) => engine.c4Play(b, col, marks[i]).board, engine.C4_EMPTY);
  assert.equal(engine.c4Outcome(drop([0, 1, 2, 3], "XXXX")), "X", "horizontale");
  assert.equal(engine.c4Outcome(drop([4, 4, 4, 4], "OOOO")), "O", "verticale");
  // Diagonale montante X : (5,0) (4,1) (3,2) (2,3)
  assert.equal(engine.c4Outcome(drop([0, 1, 1, 2, 2, 2, 3, 3, 3, 3], "XOXOOXOOOX")), "X", "diagonale");
  assert.equal(engine.c4Outcome(drop([0, 1, 2], "XXX")), null);
  assert.match(engine.c4Render(engine.C4_EMPTY), /^⚫{7}\n/);
});

test("hangman: accents removed, letters, whole word, wrong word costs two", () => {
  assert.equal(engine.normalizeWord("Éléphant !"), "ELEPHANT");
  const state = { word: "CHAT", guessed: "", errors: 0 };
  const a = engine.hangmanGuess(state, "a");
  assert.deepEqual([a.hit, a.guessed, a.status], [true, "A", "playing"]);
  assert.match(engine.hangmanGuess({ ...state, guessed: "A" }, "A").reason, /déjà/);
  assert.equal(engine.hangmanGuess(state, "z").errors, 1);
  assert.equal(engine.hangmanGuess(state, "chien").errors, 2);
  assert.equal(engine.hangmanGuess(state, "chat").status, "won");
  assert.equal(engine.hangmanGuess({ ...state, errors: 5 }, "z").status, "lost");
  assert.equal(engine.hangmanGuess({ ...state, guessed: "CHA" }, "t").status, "won");
  assert.equal(engine.hangmanGuess(state, "1").ok, false);
  assert.equal(engine.hangmanMask("CHAT", "A"), "_ _ A _");
});

test("the word list is clean: 150 distinct playable words", () => {
  const words = HANGMAN_WORDS.map(engine.normalizeWord);
  assert.equal(new Set(words).size, HANGMAN_WORDS.length);
  for (const w of words) assert.ok(w.length >= 5 && w.length <= 12, w);
});

// ─── Parties et argent ───────────────────────────────────────────────────────

test("nothing is taken before acceptance; the winner gets both stakes exactly once", () => {
  const [a, b] = [member(), member()];
  setBalance(a, 1000); setBalance(b, 500);
  const game = createChallenge({ guildId: G, kind: "morpion", challengerId: a, opponentId: b, bet: 200 });
  assert.equal(balance(a), 1000, "rien ne bouge avant l'acceptation");
  assert.throws(() => acceptChallenge(game.id, a), /Seule la personne invitée/);
  acceptChallenge(game.id, b);
  assert.deepEqual([balance(a), balance(b)], [800, 300]);
  assert.throws(() => acceptChallenge(game.id, b), /plus valable/, "deux clics sur Accepter ne prennent pas deux mises");
  // X : 0, 1, 2 ; O : 3, 4
  assert.throws(() => playMove(game.id, b, 3, 0), /pas ton tour/);
  playMove(game.id, a, 0, 0);
  assert.throws(() => playMove(game.id, b, 4, 0), /plateau a changé/, "un vieux bouton est refusé");
  playMove(game.id, b, 3, 1);
  playMove(game.id, a, 1, 2);
  playMove(game.id, b, 4, 3);
  const end = playMove(game.id, a, 2, 4);
  assert.equal(end.outcome, "X");
  assert.equal(end.game.status, "done");
  assert.equal(end.game.winner_id, a);
  assert.deepEqual([balance(a), balance(b)], [1200, 300]);
  assert.deepEqual(ledger(a), [[-200, "jeu_mise"], [400, "jeu_gain"]]);
  assert.throws(() => playMove(game.id, b, 5, 5), /terminée/);
  assert.throws(() => forfeit(game.id, b), /terminée/, "pas de second paiement");
  assert.deepEqual(versusStats(G, a), [{ kind: "morpion", wins: 1, losses: 0, draws: 0 }]);
  assert.deepEqual(versusStats(G, b), [{ kind: "morpion", wins: 0, losses: 1, draws: 0 }]);
  assert.equal(versusLeaderboard(G, "morpion")[0].userId, a);
});

test("a draw gives each player their stake back", () => {
  const [a, b] = [member(), member()];
  setBalance(a, 100); setBalance(b, 100);
  const game = createChallenge({ guildId: G, kind: "morpion", challengerId: a, opponentId: b, bet: 50 });
  acceptChallenge(game.id, b);
  // X O X / X O O / O X X
  const order = [[a, 0], [b, 1], [a, 2], [b, 4], [a, 3], [b, 5], [a, 7], [b, 6], [a, 8]];
  let last;
  order.forEach(([who, cell], i) => { last = playMove(game.id, who, cell, i); });
  assert.equal(last.outcome, "draw");
  assert.deepEqual([balance(a), balance(b)], [100, 100]);
  assert.match(versusPayload(last.game).content, /Match nul : chacun récupère sa mise/);
});

test("challenges are refused when they make no sense", () => {
  const [a, b, c] = [member(), member(), member()];
  setBalance(a, 10);
  assert.throws(() => createChallenge({ guildId: G, kind: "morpion", challengerId: a, opponentId: a }), /autre membre/);
  assert.throws(() => createChallenge({ guildId: G, kind: "morpion", challengerId: a, opponentId: b, opponentIsBot: true }), /pas un bot/);
  assert.throws(() => createChallenge({ guildId: G, kind: "morpion", challengerId: a, opponentId: b, bet: 50 }), /assez de PND/);
  assert.throws(() => createChallenge({ guildId: G, kind: "morpion", challengerId: a, opponentId: b, bet: MAX_BET + 1 }), /mise/);
  assert.throws(() => createChallenge({ guildId: G, kind: "echecs", challengerId: a, opponentId: b }), /inconnu/);
  createChallenge({ guildId: G, kind: "puissance4", challengerId: a, opponentId: b });
  assert.throws(() => createChallenge({ guildId: G, kind: "morpion", challengerId: a, opponentId: c }), /déjà une partie/);
  assert.throws(() => createChallenge({ guildId: G, kind: "morpion", challengerId: c, opponentId: b }), /déjà une partie/);
});

test("acceptance fails cleanly when a player spent their PND in the meantime", () => {
  const [a, b] = [member(), member()];
  setBalance(a, 100); setBalance(b, 10);
  const game = createChallenge({ guildId: G, kind: "puissance4", challengerId: a, opponentId: b, bet: 50 });
  assert.throws(() => acceptChallenge(game.id, b), /n'a plus assez/);
  assert.deepEqual([balance(a), balance(b)], [100, 10], "aucune mise retirée à moitié");
  assert.equal(versusGame(game.id).status, "pending");
  refuseChallenge(game.id, b);
  assert.equal(versusGame(game.id).status, "refused");
});

test("forfeit and idle timeouts: the other player wins, invitations simply expire", () => {
  const [a, b, c, d] = [member(), member(), member(), member()];
  for (const u of [a, b, c, d]) setBalance(u, 100);
  const t0 = Date.UTC(2026, 10, 25, 10, 0);
  const ff = createChallenge({ guildId: G, kind: "puissance4", challengerId: a, opponentId: b, bet: 30, now: t0 });
  acceptChallenge(ff.id, b, t0);
  forfeit(ff.id, b, t0);
  assert.deepEqual([balance(a), balance(b)], [130, 70]);

  const idle = createChallenge({ guildId: G, kind: "puissance4", challengerId: c, opponentId: d, bet: 20, now: t0 });
  acceptChallenge(idle.id, d, t0);
  playMove(idle.id, c, 3, 0, t0 + 1000);
  const pending = createChallenge({ guildId: G, kind: "morpion", challengerId: a, opponentId: b, now: t0 });
  const mine = (updates) => updates.filter((u) => [idle.id, pending.id].includes(u.id));
  assert.deepEqual(mine(expireGames(t0 + 60_000)), [], "rien avant les délais");
  const updates = expireGames(t0 + TURN_TTL_MS + 2000);
  assert.ok(updates.some((u) => u.id === idle.id && /n'a pas joué depuis 3 minutes/.test(u.note)));
  assert.equal(versusGame(idle.id).winner_id, c, "d devait jouer : c gagne");
  assert.deepEqual([balance(c), balance(d)], [120, 80]);
  assert.equal(versusGame(pending.id).status, "expired");
  assert.ok(INVITE_TTL_MS < TURN_TTL_MS);
});

test("the board message pings only the invited player, and never after", () => {
  const [a, b] = [member(), member()];
  const game = createChallenge({ guildId: G, kind: "puissance4", challengerId: a, opponentId: b });
  const invite = versusPayload(game);
  assert.deepEqual(invite.allowedMentions, { users: [b] });
  assert.equal(invite.components[0].toJSON().components[0].custom_id, `vs:acc:${game.id}`);
  const active = versusPayload(acceptChallenge(game.id, b));
  assert.deepEqual(active.allowedMentions, { parse: [] });
  assert.match(active.content, /partie amicale/);
  assert.equal(active.components.length, 2, "7 colonnes + abandon sur deux lignes");
  assert.equal(active.components[1].toJSON().components.at(-1).custom_id, `vs:ff:${game.id}`);
  forfeit(game.id, a);
});

// ─── Pendu ───────────────────────────────────────────────────────────────────

test("hangman: one game per channel, the finder wins, idle games expire", () => {
  const [a, b] = [member(), member()];
  const t0 = Date.UTC(2026, 10, 25, 11, 0);
  const pickChat = () => HANGMAN_WORDS.indexOf("tigre");
  const game = startHangman({ guildId: G, channelId: "c1", starterId: a, now: t0, pick: pickChat });
  assert.equal(game.word, "TIGRE");
  assert.throws(() => startHangman({ guildId: G, channelId: "c1", starterId: b }), /déjà en cours/);
  guessHangman(game.id, a, "e", t0);
  const { game: won, result } = guessHangman(game.id, b, "Tigre", t0);
  assert.equal(result.status, "won");
  assert.equal(won.winner_id, b);
  assert.match(hangmanPayload(won).content, /a trouvé \*\*TIGRE\*\*/);
  assert.deepEqual(hangmanPayload(won).allowedMentions, { parse: [] });
  assert.deepEqual(versusStats(G, b).find((r) => r.kind === "pendu"), { kind: "pendu", wins: 1, losses: 0, draws: 0 });

  const idle = startHangman({ guildId: G, channelId: "c1", starterId: a, now: t0 });
  assert.ok(expireGames(t0 + HANGMAN_TTL_MS + 1).some((u) => u.type === "pendu" && u.id === idle.id));
  assert.match(hangmanPayload({ ...idle, status: "expired" }).content, /Le mot était/);
});

// ─── Interactions ────────────────────────────────────────────────────────────

test("only /jeu and its own buttons and modal are handled here", async () => {
  assert.equal(await handleVersusInteraction({ isChatInputCommand: () => true, commandName: "duel" }), false);
  assert.equal(await handleVersusInteraction({ isButton: () => true, customId: "duel:accept:1" }), false);
  assert.equal(await handleVersusInteraction({ isButton: () => true, customId: "vs:play:1:x:0" }), false);
  assert.equal(await handleVersusInteraction({ isModalSubmit: () => true, customId: "embed:x" }), false);
});

test("a button from another server's game is refused", async () => {
  const [a, b] = [member(), member()];
  const game = createChallenge({ guildId: G, kind: "morpion", challengerId: a, opponentId: b });
  const replies = [];
  const handled = await handleVersusInteraction({
    isButton: () => true, customId: `vs:acc:${game.id}`, guildId: "100000000000000666", user: { id: b },
    reply: async (p) => { replies.push(p); },
  });
  assert.equal(handled, true);
  assert.match(replies[0].content, /introuvable/);
  assert.equal(versusGame(game.id).status, "pending");
  refuseChallenge(game.id, a);
});

test("a click updates the board message; an error is shown only to the clicker", async () => {
  const [a, b] = [member(), member()];
  const game = createChallenge({ guildId: G, kind: "morpion", challengerId: a, opponentId: b });
  const updates = [];
  const replies = [];
  const click = (userId, customId) => handleVersusInteraction({
    isButton: () => true, customId, guildId: G, user: { id: userId },
    update: async (p) => { updates.push(p); }, reply: async (p) => { replies.push(p); },
  });
  await click(b, `vs:acc:${game.id}`);
  await click(b, `vs:play:${game.id}:4:0`);
  assert.equal(updates.length, 1);
  assert.match(replies[0].content, /pas ton tour/);
  assert.equal(replies[0].flags, 64, "message éphémère");
  await click(a, `vs:play:${game.id}:4:0`);
  assert.equal(updates.length, 2);
  assert.equal(versusGame(game.id).board, "....X....");
  forfeit(game.id, a);
});
