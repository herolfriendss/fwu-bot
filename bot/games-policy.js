// Her? V4 — règles de jeux et d’événements pures (aucun accès Discord/DB).
export const DICE_MIN_FACES = 2;
export const DICE_MAX_FACES = 100;
export const DICE_MAX_COUNT = 10;
export const COINFLIP_MIN_BET = 10;
export const COINFLIP_MAX_BET = 10_000;
export const COINFLIP_WIN_MULTIPLIER = 1.9;
export const TRIVIA_REWARD = 50;
export const GIVEAWAY_MAX_WINNERS = 10;

/** Borne un entier dans [min,max] en retombant sur la valeur par défaut. */
export function clampInt(raw, min, max, fallback) {
  const value = Math.floor(Number(raw));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function rollDice(faces = 6, count = 1, random = Math.random) {
  const sides = clampInt(faces, DICE_MIN_FACES, DICE_MAX_FACES, 6);
  const dice = clampInt(count, 1, DICE_MAX_COUNT, 1);
  const values = Array.from({ length: dice }, () => {
    const roll = Math.min(0.999999, Math.max(0, Number(random()) || 0));
    return 1 + Math.floor(roll * sides);
  });
  return { faces: sides, values, total: values.reduce((sum, value) => sum + value, 0) };
}

export function coinflipResult(random = Math.random) {
  const roll = Math.min(0.999999, Math.max(0, Number(random()) || 0));
  return roll < 0.5 ? "pile" : "face";
}

export function coinflipPlan({ bet, choice = null, random = Math.random } = {}) {
  const rawBet = Math.floor(Number(bet));
  if (!Number.isFinite(rawBet) || rawBet < COINFLIP_MIN_BET) return { allowed: false, reason: "Mise invalide (minimum 10 PND)." };
  const stake = Math.min(COINFLIP_MAX_BET, rawBet);
  const result = coinflipResult(random);
  const picked = choice === "pile" || choice === "face" ? choice : "pile";
  const won = picked === result;
  return {
    allowed: true,
    reason: null,
    bet: stake,
    choice: picked,
    result,
    won,
    payout: won ? Math.floor(stake * COINFLIP_WIN_MULTIPLIER) : 0,
  };
}

export const TRIVIA_QUESTIONS = [
  { question: "Quelle est la capitale de la France ?", choices: ["Lyon", "Paris", "Marseille", "Bordeaux"], answer: 1 },
  { question: "Combien de pattes possède une araignée ?", choices: ["6", "8", "10", "12"], answer: 1 },
  { question: "Quel est le plus grand océan du monde ?", choices: ["Atlantique", "Indien", "Pacifique", "Arctique"], answer: 2 },
  { question: "Quel langage sert à styliser une page web ?", choices: ["HTML", "CSS", "SQL", "Python"], answer: 1 },
  { question: "Combien de joueurs compose une équipe de football sur le terrain ?", choices: ["9", "10", "11", "12"], answer: 2 },
  { question: "Quelle planète est la plus proche du Soleil ?", choices: ["Vénus", "Mercure", "Mars", "Terre"], answer: 1 },
  { question: "Qui a peint la Joconde ?", choices: ["Michel-Ange", "Léonard de Vinci", "Raphaël", "Van Gogh"], answer: 1 },
  { question: "Quel est le symbole chimique de l’or ?", choices: ["Ag", "Au", "Fe", "Cu"], answer: 1 },
  { question: "Combien de minutes dure une partie de football ?", choices: ["60", "80", "90", "120"], answer: 2 },
  { question: "Quel animal est le plus grand du monde ?", choices: ["L’éléphant", "La baleine bleue", "Le requin", "La girafe"], answer: 1 },
  { question: "Quelle est la monnaie du Japon ?", choices: ["Yuan", "Won", "Yen", "Baht"], answer: 2 },
  { question: "Combien de continents y a-t-il ?", choices: ["5", "6", "7", "8"], answer: 2 },
  { question: "Quel est l’organe qui pompe le sang ?", choices: ["Le foie", "Le cœur", "Les poumons", "Les reins"], answer: 1 },
  { question: "Quel est le plus long fleuve de France ?", choices: ["La Seine", "La Loire", "Le Rhône", "La Garonne"], answer: 1 },
  { question: "En quelle année a eu lieu la Révolution française ?", choices: ["1789", "1799", "1804", "1815"], answer: 0 },
  { question: "Quel est le résultat de 7 × 8 ?", choices: ["54", "56", "58", "64"], answer: 1 },
  { question: "Quelle couleur obtient-on en mélangeant bleu et jaune ?", choices: ["Vert", "Orange", "Violet", "Marron"], answer: 0 },
  { question: "Quel est le plus haut sommet du monde ?", choices: ["K2", "Mont Blanc", "Everest", "Kilimandjaro"], answer: 2 },
  { question: "Quel gaz les plantes absorbent-elles ?", choices: ["Oxygène", "Azote", "Dioxyde de carbone", "Hydrogène"], answer: 2 },
  { question: "Combien de côtés possède un hexagone ?", choices: ["5", "6", "7", "8"], answer: 1 },
];

export function pickTriviaQuestion(random = Math.random) {
  const roll = Math.min(0.999999, Math.max(0, Number(random()) || 0));
  return TRIVIA_QUESTIONS[Math.floor(roll * TRIVIA_QUESTIONS.length)];
}

export function checkTriviaAnswer(question, index) {
  return Number(index) === question.answer;
}

/** Tire des gagnants uniques ; l’ordre dépend du générateur injecté. */
export function drawGiveawayWinners(entries, count = 1, random = Math.random) {
  const users = [...new Set((entries ?? []).map((entry) => (typeof entry === "string" ? entry : entry.user_id)).filter(Boolean))];
  const wanted = clampInt(count, 1, GIVEAWAY_MAX_WINNERS, 1);
  for (let i = users.length - 1; i > 0; i--) {
    const roll = Math.min(0.999999, Math.max(0, Number(random()) || 0));
    const j = Math.floor(roll * (i + 1));
    [users[i], users[j]] = [users[j], users[i]];
  }
  return users.slice(0, Math.min(wanted, users.length));
}

/** Accepte une date ISO ou JJ/MM/AAAA HH:mm (heure locale du serveur). */
export function parseEventDate(raw, now = Date.now()) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const french = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(text);
  const date = french
    ? new Date(Number(french[3]), Number(french[2]) - 1, Number(french[1]), Number(french[4] ?? 20), Number(french[5] ?? 0), 0, 0)
    : new Date(text);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  if (time < now - 60_000) return null;
  return time;
}
