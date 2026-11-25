// /jeu (LE FISC) : morpion et puissance 4 entre deux membres, avec mise en PND
// facultative, et pendu en groupe dans un salon.
//
// Argent : rien ne bouge tant que l'adversaire n'a pas accepté. À l'acceptation,
// les deux mises sont retirées (« jeu_mise ») ; le gagnant reçoit les deux
// (« jeu_gain »), un match nul rend à chacun sa mise (« jeu_rembourse »).
// Chaque fin de partie est réclamée en base avant tout paiement : une partie
// n'est jamais payée deux fois, même avec deux clics simultanés.
//
// Les parties sont en SQLite : un redémarrage ne les perd pas, les boutons
// continuent de marcher. Un joueur qui ne joue plus pendant 3 minutes perd.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { randomInt } from "node:crypto";
import { db, transaction } from "../database.js";
import {
  C4_COLS, C4_EMPTY, TTT_EMPTY, c4ColumnFull, c4Outcome, c4Play, c4Render, hangmanDrawing, hangmanGuess, hangmanMask,
  HANGMAN_MAX_ERRORS, normalizeWord, tttOutcome, tttPlay,
} from "./versus-engine.js";
import { HANGMAN_WORDS } from "./hangman-words.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS versus_games (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, kind TEXT NOT NULL,
    p1 TEXT NOT NULL, p2 TEXT NOT NULL, bet INTEGER NOT NULL DEFAULT 0, board TEXT NOT NULL,
    turn INTEGER NOT NULL DEFAULT 1, moves INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
    winner_id TEXT, channel_id TEXT, message_id TEXT, created_at INTEGER NOT NULL, last_move_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS versus_games_status ON versus_games(status, last_move_at);
  CREATE TABLE IF NOT EXISTS versus_stats (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL,
    wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, draws INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id, kind)
  );
  CREATE TABLE IF NOT EXISTS hangman_games (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT,
    word TEXT NOT NULL, guessed TEXT NOT NULL DEFAULT '', errors INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'playing', starter_id TEXT NOT NULL, winner_id TEXT,
    created_at INTEGER NOT NULL, last_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS hangman_games_channel ON hangman_games(guild_id, channel_id, status);
`);

export const VERSUS_COMMANDS = new Set(["jeu"]);
export const INVITE_TTL_MS = 2 * 60_000;
export const TURN_TTL_MS = 3 * 60_000;
export const HANGMAN_TTL_MS = 10 * 60_000;
export const MAX_BET = 100_000;
const KINDS = { morpion: { label: "Morpion", empty: TTT_EMPTY }, puissance4: { label: "Puissance 4", empty: C4_EMPTY } };
const MARK = { 1: "X", 2: "O" };
const fmt = (n) => `${Number(n).toLocaleString("fr-FR")} PND`;
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });
const noPing = { parse: [] };

// ─── Argent ──────────────────────────────────────────────────────────────────

function balanceOf(guildId, userId) {
  const row = db.prepare("SELECT balance FROM wallets WHERE guild_id=? AND user_id=?").get(guildId, userId);
  return Number(row?.balance ?? 0);
}
function move(guildId, userId, delta, reason, now = Date.now()) {
  if (!delta) return;
  db.prepare("INSERT OR IGNORE INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,0,0)").run(guildId, userId);
  const result = db.prepare("UPDATE wallets SET balance=balance+? WHERE guild_id=? AND user_id=? AND balance+?>=0").run(delta, guildId, userId, delta);
  if (!Number(result.changes)) throw new Error("Solde PND insuffisant.");
  db.prepare("INSERT INTO economy_ledger(guild_id,user_id,delta,reason,created_at) VALUES(?,?,?,?,?)").run(guildId, userId, delta, reason, now);
}
function stat(guildId, userId, kind, column) {
  db.prepare(`INSERT INTO versus_stats(guild_id,user_id,kind,${column}) VALUES(?,?,?,1)
    ON CONFLICT(guild_id,user_id,kind) DO UPDATE SET ${column}=${column}+1`).run(guildId, userId, kind);
}

// ─── Parties à deux ──────────────────────────────────────────────────────────

export const versusGame = (id) => db.prepare("SELECT * FROM versus_games WHERE id=?").get(id) ?? null;

/** Une seule partie (en attente ou en cours) à la fois par joueur et par serveur. */
function busy(guildId, userId) {
  return Boolean(db.prepare("SELECT 1 FROM versus_games WHERE guild_id=? AND status IN ('pending','active') AND (p1=? OR p2=?)").get(guildId, userId, userId));
}

export function createChallenge({ guildId, kind, challengerId, opponentId, opponentIsBot = false, bet = 0, channelId = null, now = Date.now() }) {
  if (!KINDS[kind]) throw new Error("Jeu inconnu.");
  if (opponentIsBot || opponentId === challengerId) throw new Error("Choisis un autre membre (pas un bot, pas toi).");
  if (!Number.isSafeInteger(bet) || bet < 0 || bet > MAX_BET) throw new Error(`La mise doit être entre 0 et ${fmt(MAX_BET)}.`);
  if (busy(guildId, challengerId)) throw new Error("Tu as déjà une partie en cours ou en attente. Termine-la d'abord.");
  if (busy(guildId, opponentId)) throw new Error("Ce membre a déjà une partie en cours.");
  if (bet && balanceOf(guildId, challengerId) < bet) throw new Error("Tu n'as pas assez de PND en poche pour cette mise.");
  const info = db.prepare(`INSERT INTO versus_games(guild_id,kind,p1,p2,bet,board,channel_id,created_at,last_move_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(guildId, kind, challengerId, opponentId, bet, KINDS[kind].empty, channelId, now, now);
  return versusGame(Number(info.lastInsertRowid));
}

export function rememberMessage(id, channelId, messageId) {
  db.prepare("UPDATE versus_games SET channel_id=?, message_id=? WHERE id=?").run(channelId, messageId, id);
}

/** L'adversaire accepte : les deux mises sont bloquées, la partie commence. */
export function acceptChallenge(id, userId, now = Date.now()) {
  return transaction(() => {
    const game = versusGame(id);
    if (!game || game.status !== "pending") throw new Error("Cette invitation n'est plus valable.");
    if (game.p2 !== userId) throw new Error("Seule la personne invitée peut accepter.");
    if (now - Number(game.created_at) > INVITE_TTL_MS) {
      db.prepare("UPDATE versus_games SET status='expired' WHERE id=? AND status='pending'").run(id);
      throw new Error("Invitation expirée.");
    }
    if (game.bet) {
      try {
        move(game.guild_id, game.p1, -game.bet, "jeu_mise", now);
        move(game.guild_id, game.p2, -game.bet, "jeu_mise", now);
      } catch {
        throw new Error("Un des deux joueurs n'a plus assez de PND en poche pour la mise.");
      }
    }
    db.prepare("UPDATE versus_games SET status='active', last_move_at=? WHERE id=?").run(now, id);
    return versusGame(id);
  });
}

export function refuseChallenge(id, userId) {
  const game = versusGame(id);
  if (!game || game.status !== "pending") throw new Error("Cette invitation n'est plus valable.");
  if (userId !== game.p2 && userId !== game.p1) throw new Error("Cette invitation ne te concerne pas.");
  db.prepare("UPDATE versus_games SET status='refused' WHERE id=? AND status='pending'").run(id);
  return versusGame(id);
}

/** Termine une partie et paie, une seule fois. `winnerId` null = match nul. */
function finish(game, winnerId, now) {
  const claimed = db.prepare("UPDATE versus_games SET status='done', winner_id=?, last_move_at=? WHERE id=? AND status='active'")
    .run(winnerId, now, game.id);
  if (!Number(claimed.changes)) return false;
  if (winnerId) {
    move(game.guild_id, winnerId, game.bet * 2, "jeu_gain", now);
    stat(game.guild_id, winnerId, game.kind, "wins");
    stat(game.guild_id, winnerId === game.p1 ? game.p2 : game.p1, game.kind, "losses");
  } else {
    move(game.guild_id, game.p1, game.bet, "jeu_rembourse", now);
    move(game.guild_id, game.p2, game.bet, "jeu_rembourse", now);
    stat(game.guild_id, game.p1, game.kind, "draws");
    stat(game.guild_id, game.p2, game.kind, "draws");
  }
  return true;
}

/**
 * Un coup. `expectedMoves` vient du bouton : un clic sur un vieux plateau est refusé.
 * @returns {{ game: object, outcome: "X" | "O" | "draw" | null }}
 */
export function playMove(id, userId, position, expectedMoves, now = Date.now()) {
  return transaction(() => {
    const game = versusGame(id);
    if (!game || game.status !== "active") throw new Error("Cette partie est terminée.");
    const player = userId === game.p1 ? 1 : userId === game.p2 ? 2 : 0;
    if (!player) throw new Error("Tu ne joues pas dans cette partie.");
    if (Number(game.turn) !== player) throw new Error("Ce n'est pas ton tour.");
    if (Number(game.moves) !== expectedMoves) throw new Error("Le plateau a changé, réessaie.");
    const played = game.kind === "morpion" ? tttPlay(game.board, position, MARK[player]) : c4Play(game.board, position, MARK[player]);
    if (!played.ok) throw new Error(played.reason);
    const updated = db.prepare("UPDATE versus_games SET board=?, turn=?, moves=moves+1, last_move_at=? WHERE id=? AND moves=? AND status='active'")
      .run(played.board, player === 1 ? 2 : 1, now, id, expectedMoves);
    if (!Number(updated.changes)) throw new Error("Le plateau a changé, réessaie.");
    const outcome = game.kind === "morpion" ? tttOutcome(played.board) : c4Outcome(played.board);
    if (outcome) finish({ ...game, board: played.board }, outcome === "draw" ? null : outcome === "X" ? game.p1 : game.p2, now);
    return { game: versusGame(id), outcome };
  });
}

/** Abandon (bouton) ou absence (3 minutes sans jouer) : l'autre joueur gagne. */
export function forfeit(id, loserId, now = Date.now()) {
  return transaction(() => {
    const game = versusGame(id);
    if (!game || game.status !== "active") throw new Error("Cette partie est terminée.");
    if (loserId !== game.p1 && loserId !== game.p2) throw new Error("Tu ne joues pas dans cette partie.");
    finish(game, loserId === game.p1 ? game.p2 : game.p1, now);
    return versusGame(id);
  });
}

// ─── Affichage ───────────────────────────────────────────────────────────────

export function versusPayload(game, note = "") {
  const kind = KINDS[game.kind];
  const pot = game.bet ? ` · mise **${fmt(game.bet)}** chacun` : " · partie amicale";
  const lines = [`🎮 **${kind.label}** : <@${game.p1}> ${game.kind === "morpion" ? "❌" : "🔴"} contre <@${game.p2}> ${game.kind === "morpion" ? "⭕" : "🟡"}${pot}`];
  const over = game.status !== "active";
  if (game.status === "pending") lines.push(`<@${game.p2}>, tu acceptes ? (2 minutes)`);
  if (game.status === "active") lines.push(`À <@${Number(game.turn) === 1 ? game.p1 : game.p2}> de jouer.`);
  if (game.status === "done") {
    lines.push(game.winner_id
      ? `🏆 <@${game.winner_id}> gagne${game.bet ? ` **${fmt(game.bet * 2)}**` : ""} !`
      : `🤝 Match nul${game.bet ? " : chacun récupère sa mise" : ""}.`);
  }
  if (game.status === "expired") lines.push("⌛ Invitation expirée.");
  if (game.status === "refused") lines.push("🏳️ Invitation refusée.");
  if (note) lines.push(note);
  if (game.kind === "puissance4" && game.status !== "pending") lines.push("", c4Render(game.board));

  let components = [];
  if (game.status === "pending") {
    components = [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`vs:acc:${game.id}`).setLabel("Accepter").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`vs:ref:${game.id}`).setLabel("Refuser").setStyle(ButtonStyle.Danger),
    )];
  } else if (game.status === "active" || game.status === "done") {
    components = game.kind === "morpion" ? tttButtons(game, over) : c4Buttons(game, over);
  }
  return { content: lines.join("\n"), components, allowedMentions: game.status === "pending" ? { users: [game.p2] } : noPing };
}

function tttButtons(game, over) {
  const rows = [];
  for (let r = 0; r < 3; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      const mark = game.board[i];
      row.addComponents(new ButtonBuilder()
        .setCustomId(`vs:play:${game.id}:${i}:${game.moves}`)
        .setEmoji(mark === "X" ? "❌" : mark === "O" ? "⭕" : "➖")
        .setStyle(mark === "X" ? ButtonStyle.Danger : mark === "O" ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(over || mark !== "."));
    }
    rows.push(row);
  }
  if (!over) rows.push(new ActionRowBuilder().addComponents(forfeitButton(game)));
  return rows;
}

function c4Buttons(game, over) {
  const buttons = [];
  for (let c = 0; c < C4_COLS; c++) {
    buttons.push(new ButtonBuilder().setCustomId(`vs:play:${game.id}:${c}:${game.moves}`).setLabel(String(c + 1))
      .setStyle(ButtonStyle.Secondary).setDisabled(over || c4ColumnFull(game.board, c)));
  }
  const rows = [new ActionRowBuilder().addComponents(...buttons.slice(0, 5)), new ActionRowBuilder().addComponents(...buttons.slice(5))];
  if (!over) rows[1].addComponents(forfeitButton(game));
  return rows;
}

const forfeitButton = (game) => new ButtonBuilder().setCustomId(`vs:ff:${game.id}`).setLabel("Abandonner").setStyle(ButtonStyle.Danger).setEmoji("🏳️");

export function versusStats(guildId, userId) {
  return db.prepare("SELECT kind, wins, losses, draws FROM versus_stats WHERE guild_id=? AND user_id=?").all(guildId, userId)
    .map((r) => ({ kind: r.kind, wins: Number(r.wins), losses: Number(r.losses), draws: Number(r.draws) }));
}

export function versusLeaderboard(guildId, kind, limit = 10) {
  return db.prepare("SELECT user_id AS userId, wins, losses, draws FROM versus_stats WHERE guild_id=? AND kind=? AND wins>0 ORDER BY wins DESC, losses ASC LIMIT ?")
    .all(guildId, kind, limit).map((r) => ({ userId: r.userId, wins: Number(r.wins), losses: Number(r.losses), draws: Number(r.draws) }));
}

// ─── Pendu ───────────────────────────────────────────────────────────────────

export const hangmanGame = (id) => db.prepare("SELECT * FROM hangman_games WHERE id=?").get(id) ?? null;

export function startHangman({ guildId, channelId, starterId, now = Date.now(), pick = (n) => randomInt(n) }) {
  const running = db.prepare("SELECT id FROM hangman_games WHERE guild_id=? AND channel_id=? AND status='playing'").get(guildId, channelId);
  if (running) throw new Error("Un pendu est déjà en cours dans ce salon.");
  const word = normalizeWord(HANGMAN_WORDS[pick(HANGMAN_WORDS.length)]);
  const info = db.prepare("INSERT INTO hangman_games(guild_id,channel_id,word,starter_id,created_at,last_at) VALUES(?,?,?,?,?,?)")
    .run(guildId, channelId, word, starterId, now, now);
  return hangmanGame(Number(info.lastInsertRowid));
}

export function rememberHangmanMessage(id, messageId) {
  db.prepare("UPDATE hangman_games SET message_id=? WHERE id=?").run(messageId, id);
}

/** @returns {{ game: object, result: ReturnType<typeof hangmanGuess> }} */
export function guessHangman(id, userId, raw, now = Date.now()) {
  return transaction(() => {
    const game = hangmanGame(id);
    if (!game || game.status !== "playing") throw new Error("Ce pendu est terminé.");
    const result = hangmanGuess({ word: game.word, guessed: game.guessed, errors: Number(game.errors) }, raw);
    if (!result.ok) throw new Error(result.reason);
    db.prepare("UPDATE hangman_games SET guessed=?, errors=?, status=?, winner_id=?, last_at=? WHERE id=? AND status='playing'")
      .run(result.guessed, result.errors, result.status, result.status === "won" ? userId : null, now, id);
    if (result.status === "won") stat(game.guild_id, userId, "pendu", "wins");
    return { game: hangmanGame(id), result };
  });
}

export function hangmanPayload(game, note = "") {
  const playing = game.status === "playing";
  const missed = [...game.guessed].filter((ch) => !game.word.includes(ch));
  const lines = [
    "🪢 **Pendu**",
    hangmanDrawing(Number(game.errors)),
    `\`${hangmanMask(game.word, playing ? game.guessed : game.word)}\` (${game.word.length} lettres)`,
    `Erreurs : **${game.errors} / ${HANGMAN_MAX_ERRORS}**${missed.length ? ` · ratées : ${missed.join(" ")}` : ""}`,
  ];
  if (game.status === "won") lines.push(`🏆 <@${game.winner_id}> a trouvé **${game.word}** !`);
  if (game.status === "lost") lines.push(`💀 Perdu ! Le mot était **${game.word}**.`);
  if (game.status === "expired") lines.push(`⌛ Personne n'a joué depuis 10 minutes. Le mot était **${game.word}**.`);
  if (note) lines.push(note);
  const components = playing ? [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pendu:guess:${game.id}`).setLabel("Proposer une lettre ou le mot").setStyle(ButtonStyle.Primary).setEmoji("✏️"),
  )] : [];
  return { content: lines.join("\n"), components, allowedMentions: noPing };
}

// ─── Expirations (tâche de LE FISC, chaque minute) ───────────────────────────

/**
 * Pur côté Discord : applique les expirations en base et renvoie ce qu'il faut
 * mettre à jour à l'écran.
 */
export function expireGames(now = Date.now()) {
  const updates = [];
  for (const game of db.prepare("SELECT * FROM versus_games WHERE status='pending' AND created_at<?").all(now - INVITE_TTL_MS)) {
    db.prepare("UPDATE versus_games SET status='expired' WHERE id=? AND status='pending'").run(game.id);
    updates.push({ type: "versus", id: game.id, note: "" });
  }
  for (const game of db.prepare("SELECT * FROM versus_games WHERE status='active' AND last_move_at<?").all(now - TURN_TTL_MS)) {
    const loser = Number(game.turn) === 1 ? game.p1 : game.p2;
    try {
      forfeit(game.id, loser, now);
      updates.push({ type: "versus", id: game.id, note: `⌛ <@${loser}> n'a pas joué depuis 3 minutes et perd la partie.` });
    } catch { /* déjà terminée entre-temps */ }
  }
  for (const game of db.prepare("SELECT * FROM hangman_games WHERE status='playing' AND last_at<?").all(now - HANGMAN_TTL_MS)) {
    db.prepare("UPDATE hangman_games SET status='expired' WHERE id=? AND status='playing'").run(game.id);
    updates.push({ type: "pendu", id: game.id, note: "" });
  }
  return updates;
}

export async function runVersusExpiry(client, now = Date.now()) {
  for (const update of expireGames(now)) {
    const game = update.type === "versus" ? versusGame(update.id) : hangmanGame(update.id);
    if (!game?.channel_id || !game.message_id) continue;
    const channel = await client.channels.fetch(game.channel_id).catch(() => null);
    const message = channel?.isTextBased?.() ? await channel.messages.fetch(game.message_id).catch(() => null) : null;
    if (!message) continue;
    const payload = update.type === "versus" ? versusPayload(game, update.note) : hangmanPayload(game);
    await message.edit(payload).catch(() => {});
  }
}

// ─── Interactions ────────────────────────────────────────────────────────────

const LABELS = { morpion: "Morpion", puissance4: "Puissance 4", pendu: "Pendu" };

async function command(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  if (sub === "morpion" || sub === "puissance4") {
    const opponent = interaction.options.getUser("adversaire", true);
    const game = createChallenge({
      guildId, kind: sub, challengerId: interaction.user.id, opponentId: opponent.id, opponentIsBot: Boolean(opponent.bot),
      bet: interaction.options.getInteger("mise") ?? 0, channelId: interaction.channelId,
    });
    const reply = await interaction.reply({ ...versusPayload(game), withResponse: true });
    const message = reply?.resource?.message ?? await interaction.fetchReply().catch(() => null);
    if (message?.id) rememberMessage(game.id, interaction.channelId, message.id);
    return;
  }
  if (sub === "pendu") {
    const game = startHangman({ guildId, channelId: interaction.channelId, starterId: interaction.user.id });
    const reply = await interaction.reply({ ...hangmanPayload(game), withResponse: true });
    const message = reply?.resource?.message ?? await interaction.fetchReply().catch(() => null);
    if (message?.id) rememberHangmanMessage(game.id, message.id);
    return;
  }
  if (sub === "stats") {
    const target = interaction.options.getUser("membre") ?? interaction.user;
    const rows = versusStats(guildId, target.id);
    const text = rows.length
      ? rows.map((r) => `**${LABELS[r.kind] ?? r.kind}** : ${r.wins} victoire${r.wins > 1 ? "s" : ""}${r.kind === "pendu" ? "" : ` · ${r.losses} défaite${r.losses > 1 ? "s" : ""} · ${r.draws} nul${r.draws > 1 ? "s" : ""}`}`).join("\n")
      : "Aucune partie jouée pour l'instant.";
    return interaction.reply({ content: `🎮 **Jeux de <@${target.id}>**\n${text}`, allowedMentions: noPing });
  }
  if (sub === "classement") {
    const kind = interaction.options.getString("jeu", true);
    const rows = versusLeaderboard(guildId, kind);
    const medal = (i) => ["🥇", "🥈", "🥉"][i] ?? `**${i + 1}.**`;
    return interaction.reply({
      content: `🏆 **Classement ${LABELS[kind] ?? kind}**\n${rows.length ? rows.map((r, i) => `${medal(i)} <@${r.userId}> · ${r.wins} victoire${r.wins > 1 ? "s" : ""}`).join("\n") : "Personne n'a encore gagné."}`,
      allowedMentions: noPing,
    });
  }
  return interaction.reply(ephemeral("Sous-commande inconnue."));
}

async function button(interaction) {
  const parts = interaction.customId.split(":");
  if (parts[0] === "pendu") {
    const game = hangmanGame(Number(parts[2]));
    if (!game || game.guild_id !== interaction.guildId || game.status !== "playing") return interaction.reply(ephemeral("Ce pendu est terminé."));
    const modal = new ModalBuilder().setCustomId(`pendu:modal:${game.id}`).setTitle("Pendu").addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("proposition").setLabel("Une lettre, ou le mot entier")
        .setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(20).setRequired(true)),
    );
    return interaction.showModal(modal);
  }
  const [, action, rawId, rawPos, rawMoves] = parts;
  const id = Number(rawId);
  const existing = versusGame(id);
  if (!existing || existing.guild_id !== interaction.guildId) return interaction.reply(ephemeral("Partie introuvable."));
  let game;
  let note = "";
  if (action === "acc") game = acceptChallenge(id, interaction.user.id);
  else if (action === "ref") game = refuseChallenge(id, interaction.user.id);
  else if (action === "ff") { game = forfeit(id, interaction.user.id); note = `🏳️ <@${interaction.user.id}> abandonne.`; }
  else if (action === "play") game = playMove(id, interaction.user.id, Number(rawPos), Number(rawMoves)).game;
  else return interaction.reply(ephemeral("Action inconnue."));
  return interaction.update(versusPayload(game, note));
}

async function modal(interaction) {
  const id = Number(interaction.customId.split(":")[2]);
  const existing = hangmanGame(id);
  if (!existing || existing.guild_id !== interaction.guildId) return interaction.reply(ephemeral("Pendu introuvable."));
  const raw = interaction.fields.getTextInputValue("proposition");
  const { game, result } = guessHangman(id, interaction.user.id, raw);
  const shown = normalizeWord(raw);
  const note = result.status === "playing"
    ? `<@${interaction.user.id}> propose **${shown}** : ${result.hit ? "✅ bien vu !" : "❌ raté."}`
    : "";
  // Le modal vient d'un bouton du message : on met ce message à jour directement.
  if (interaction.isFromMessage?.()) return interaction.update(hangmanPayload(game, note));
  return interaction.reply(hangmanPayload(game, note));
}

export async function handleVersusInteraction(interaction) {
  const isCommand = interaction.isChatInputCommand?.() && VERSUS_COMMANDS.has(interaction.commandName);
  const isButton = interaction.isButton?.() && /^(vs:(acc|ref|ff|play):\d+(:\d+:\d+)?|pendu:guess:\d+)$/.test(interaction.customId ?? "");
  const isModal = interaction.isModalSubmit?.() && /^pendu:modal:\d+$/.test(interaction.customId ?? "");
  if (!isCommand && !isButton && !isModal) return false;
  if (!interaction.guildId) { await interaction.reply(ephemeral("Les jeux se jouent sur un serveur.")).catch(() => {}); return true; }
  try {
    if (isCommand) await command(interaction);
    else if (isButton) await button(interaction);
    else await modal(interaction);
  } catch (error) {
    const content = `❌ ${error instanceof Error ? error.message : "Action impossible."}`;
    if (interaction.replied || interaction.deferred) await interaction.followUp(ephemeral(content)).catch(() => {});
    else await interaction.reply(ephemeral(content)).catch(() => {});
  }
  return true;
}
