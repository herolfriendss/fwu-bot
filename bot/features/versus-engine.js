// Règles pures des jeux de /jeu : morpion, puissance 4 et pendu.
// Aucune dépendance à Discord ni à la base : tout se teste à part.

// ─── Morpion (3 × 3) ─────────────────────────────────────────────────────────
// Plateau : chaîne de 9 caractères, "." vide, "X" (joueur 1) ou "O" (joueur 2).

export const TTT_EMPTY = ".".repeat(9);
const TTT_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

/** @returns {{ ok: true, board: string } | { ok: false, reason: string }} */
export function tttPlay(board, cell, mark) {
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) return { ok: false, reason: "Case invalide." };
  if (board[cell] !== ".") return { ok: false, reason: "Cette case est déjà prise." };
  return { ok: true, board: board.slice(0, cell) + mark + board.slice(cell + 1) };
}

/** "X" / "O" : gagnant ; "draw" : plateau plein ; null : la partie continue. */
export function tttOutcome(board) {
  for (const [a, b, c] of TTT_LINES) {
    if (board[a] !== "." && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return board.includes(".") ? null : "draw";
}

// ─── Puissance 4 (7 colonnes × 6 lignes) ─────────────────────────────────────
// Plateau : 42 caractères, ligne 0 en haut. "." vide, "X" ou "O".

export const C4_COLS = 7;
export const C4_ROWS = 6;
export const C4_EMPTY = ".".repeat(C4_COLS * C4_ROWS);
const at = (board, row, col) => board[row * C4_COLS + col];

/** Le jeton tombe dans la colonne. */
export function c4Play(board, col, mark) {
  if (!Number.isInteger(col) || col < 0 || col >= C4_COLS) return { ok: false, reason: "Colonne invalide." };
  for (let row = C4_ROWS - 1; row >= 0; row--) {
    if (at(board, row, col) === ".") {
      const i = row * C4_COLS + col;
      return { ok: true, board: board.slice(0, i) + mark + board.slice(i + 1), row };
    }
  }
  return { ok: false, reason: "Cette colonne est pleine." };
}

export function c4Outcome(board) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let row = 0; row < C4_ROWS; row++) {
    for (let col = 0; col < C4_COLS; col++) {
      const mark = at(board, row, col);
      if (mark === ".") continue;
      for (const [dr, dc] of dirs) {
        let n = 1;
        while (n < 4) {
          const r = row + dr * n;
          const c = col + dc * n;
          if (r < 0 || r >= C4_ROWS || c < 0 || c >= C4_COLS || at(board, r, c) !== mark) break;
          n++;
        }
        if (n === 4) return mark;
      }
    }
  }
  return board.includes(".") ? null : "draw";
}

export const c4ColumnFull = (board, col) => at(board, 0, col) !== ".";

export function c4Render(board) {
  const cell = { ".": "⚫", X: "🔴", O: "🟡" };
  const rows = [];
  for (let row = 0; row < C4_ROWS; row++) {
    let line = "";
    for (let col = 0; col < C4_COLS; col++) line += cell[at(board, row, col)];
    rows.push(line);
  }
  rows.push("1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣");
  return rows.join("\n");
}

// ─── Pendu ───────────────────────────────────────────────────────────────────

export const HANGMAN_MAX_ERRORS = 6;

/** Majuscules sans accents : « Éléphant » → « ELEPHANT ». */
export function normalizeWord(raw) {
  return String(raw ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]/g, "");
}

export function hangmanMask(word, guessed) {
  return [...word].map((ch) => (guessed.includes(ch) ? ch : "_")).join(" ");
}

export const hangmanSolved = (word, guessed) => [...word].every((ch) => guessed.includes(ch));

/**
 * Une proposition : une lettre, ou le mot entier.
 * @returns {{ ok: false, reason: string }
 *   | { ok: true, guessed: string, errors: number, hit: boolean, status: "playing" | "won" | "lost" }}
 */
export function hangmanGuess({ word, guessed, errors }, raw) {
  const guess = normalizeWord(raw);
  if (!guess) return { ok: false, reason: "Propose une lettre ou un mot (lettres uniquement)." };
  if (guess.length === 1) {
    if (guessed.includes(guess)) return { ok: false, reason: `La lettre ${guess} a déjà été proposée.` };
    const hit = word.includes(guess);
    const nextGuessed = guessed + guess;
    const nextErrors = errors + (hit ? 0 : 1);
    const status = hangmanSolved(word, nextGuessed) ? "won" : nextErrors >= HANGMAN_MAX_ERRORS ? "lost" : "playing";
    return { ok: true, guessed: nextGuessed, errors: nextErrors, hit, status };
  }
  if (guess === word) {
    const all = [...new Set([...guessed, ...word])].join("");
    return { ok: true, guessed: all, errors, hit: true, status: "won" };
  }
  // Un mauvais mot coûte deux erreurs : sinon on tenterait tout au hasard.
  const nextErrors = Math.min(HANGMAN_MAX_ERRORS, errors + 2);
  return { ok: true, guessed, errors: nextErrors, hit: false, status: nextErrors >= HANGMAN_MAX_ERRORS ? "lost" : "playing" };
}

const GALLOWS = [
  "```\n  +---+\n      |\n      |\n      |\n     ===```",
  "```\n  +---+\n  O   |\n      |\n      |\n     ===```",
  "```\n  +---+\n  O   |\n  |   |\n      |\n     ===```",
  "```\n  +---+\n  O   |\n /|   |\n      |\n     ===```",
  "```\n  +---+\n  O   |\n /|\\  |\n      |\n     ===```",
  "```\n  +---+\n  O   |\n /|\\  |\n /    |\n     ===```",
  "```\n  +---+\n  O   |\n /|\\  |\n / \\  |\n     ===```",
];
export const hangmanDrawing = (errors) => GALLOWS[Math.min(GALLOWS.length - 1, Math.max(0, errors))];
