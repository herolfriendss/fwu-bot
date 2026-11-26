import { randomInt, randomUUID } from "node:crypto";
import { db, transaction } from "./database.js";

const MAX_BET = 1_000_000_000;
const MAX_BALANCE = 1_000_000_000_000;
const CASINO_BET_REASONS = Object.freeze([
  "casino_roulette_bet", "casino_slots_bet", "casino_coinflip_bet", "casino_dice_bet",
  "blackjack_bet", "roulette_bet", "coinflip_bet", "casino_grattage_bet", "casino_course_bet",
]);
const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const SLOT_SYMBOLS = Object.freeze([
  { symbol: "🍒", weight: 30 }, { symbol: "🍋", weight: 25 },
  { symbol: "🔔", weight: 18 }, { symbol: "⭐", weight: 14 },
  { symbol: "💎", weight: 9 }, { symbol: "7️⃣", weight: 4 },
]);
const SLOT_TOTAL_WEIGHT = SLOT_SYMBOLS.reduce((sum, item) => sum + item.weight, 0);

function validId(value) {
  return typeof value === "string" && /^\d{5,25}$/.test(value);
}

function validateBet(bet) {
  if (!Number.isSafeInteger(bet) || bet < 1 || bet > MAX_BET) {
    throw new Error(`La mise doit être un entier entre 1 et ${MAX_BET.toLocaleString("fr-FR")} PND.`);
  }
}

function rouletteColor(number) {
  if (number === 0) return "green";
  return RED_NUMBERS.has(number) ? "red" : "black";
}

function validContextId(value) {
  return typeof value === "string" && /^\d{5,25}$/.test(value);
}

/** Start of the current calendar day in Europe/Paris, returned as an epoch. */
export function parisDayStart(now = Date.now()) {
  if (!Number.isFinite(now)) throw new Error("Date invalide.");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(now));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(values.year), month = Number(values.month), day = Number(values.day);
  const localWallAtUtcMidnight = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(Date.UTC(year, month - 1, day)));
  const wall = Object.fromEntries(localWallAtUtcMidnight.map((part) => [part.type, part.value]));
  const offset = Date.UTC(Number(wall.year), Number(wall.month) - 1, Number(wall.day), Number(wall.hour), Number(wall.minute)) - Date.UTC(year, month - 1, day);
  return Date.UTC(year, month - 1, day) - offset;
}

export function getCasinoControls(guildId, userId) {
  if (!validContextId(guildId) || !validContextId(userId)) throw new Error("Serveur ou membre invalide.");
  const row = db.prepare(`SELECT self_excluded_until,daily_wager_limit,created_at,updated_at
    FROM casino_controls WHERE guild_id=? AND user_id=?`).get(guildId, userId);
  return row ? {
    selfExcludedUntil: row.self_excluded_until == null ? null : Number(row.self_excluded_until),
    dailyWagerLimit: row.daily_wager_limit == null ? null : Number(row.daily_wager_limit),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  } : { selfExcludedUntil: null, dailyWagerLimit: null, createdAt: null, updatedAt: null };
}

export function setCasinoSelfExclusion({ guildId, userId, durationMs, now = Date.now() }) {
  if (!validContextId(guildId) || !validContextId(userId)) throw new Error("Serveur ou membre invalide.");
  const allowed = new Set([24 * 60 * 60_000, 7 * 24 * 60 * 60_000, 30 * 24 * 60 * 60_000]);
  if (!allowed.has(durationMs) && durationMs !== Number.MAX_SAFE_INTEGER) throw new Error("Durée invalide. Choisis 24h, 7j, 30j ou permanent.");
  const proposedUntil = durationMs === Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : now + durationMs;
  if (!Number.isSafeInteger(proposedUntil) || proposedUntil <= now) throw new Error("Date d'auto-exclusion invalide.");
  transaction(() => {
    db.prepare(`INSERT INTO casino_controls(guild_id,user_id,self_excluded_until,created_at,updated_at)
      VALUES(?,?,?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET
      self_excluded_until=MAX(COALESCE(casino_controls.self_excluded_until,0),excluded.self_excluded_until),
      updated_at=excluded.updated_at`).run(guildId, userId, proposedUntil, now, now);
  });
  return getCasinoControls(guildId, userId);
}

export function setCasinoDailyWagerLimit({ guildId, userId, limit, now = Date.now() }) {
  if (!validContextId(guildId) || !validContextId(userId)) throw new Error("Serveur ou membre invalide.");
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BET)) {
    throw new Error(`La limite quotidienne doit être comprise entre 1 et ${MAX_BET.toLocaleString("fr-FR")} PND, ou désactivée.`);
  }
  transaction(() => {
    db.prepare(`INSERT INTO casino_controls(guild_id,user_id,daily_wager_limit,created_at,updated_at)
      VALUES(?,?,?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET
      daily_wager_limit=excluded.daily_wager_limit,updated_at=excluded.updated_at`).run(guildId, userId, limit, now, now);
  });
  return getCasinoControls(guildId, userId);
}

/** Must be called inside the same SQLite transaction as the bet debit. */
export function assertCasinoCanStart({ guildId, userId, bet, now = Date.now() }) {
  if (!validContextId(guildId) || !validContextId(userId)) throw new Error("Serveur ou membre invalide.");
  validateBet(bet);
  const controls = getCasinoControls(guildId, userId);
  if (controls.selfExcludedUntil && controls.selfExcludedUntil > now) {
    const until = controls.selfExcludedUntil === Number.MAX_SAFE_INTEGER
      ? "sans date de fin"
      : `jusqu'au <t:${Math.floor(controls.selfExcludedUntil / 1000)}:F>`;
    throw new Error(`Tu as activé ton auto-exclusion du PND Casino ${until}. Les nouvelles mises sont bloquées.`);
  }
  if (controls.dailyWagerLimit !== null) {
    const placeholders = CASINO_BET_REASONS.map(() => "?").join(",");
    const used = Number(db.prepare(`SELECT COALESCE(SUM(-delta),0) AS total FROM economy_ledger
      WHERE guild_id=? AND user_id=? AND delta<0 AND created_at>=? AND reason IN (${placeholders})`)
      .get(guildId, userId, parisDayStart(now), ...CASINO_BET_REASONS).total);
    if (used + bet > controls.dailyWagerLimit) {
      throw new Error(`Ta limite quotidienne est de ${formatPnd(controls.dailyWagerLimit)}. Tu as déjà misé ${formatPnd(used)} aujourd'hui (heure de Paris).`);
    }
  }
  return controls;
}

export function resolveRouletteOutcome({ bet, choice, number }) {
  validateBet(bet);
  if (!Number.isInteger(number) || number < 0 || number > 36) throw new Error("Numéro de roulette invalide.");
  const normalizedChoice = String(choice).toLowerCase();
  const color = rouletteColor(number);
  const numericChoice = /^\d{1,2}$/.test(normalizedChoice) ? Number(normalizedChoice) : null;
  if (numericChoice !== null && (numericChoice < 0 || numericChoice > 36)) throw new Error("Choisis un numéro entre 0 et 36.");
  if (numericChoice === null && !["red", "black", "green", "rouge", "noir", "vert"].includes(normalizedChoice)) {
    throw new Error("Choix invalide : rouge, noir, vert ou un numéro de 0 à 36.");
  }
  const canonical = ({ rouge: "red", noir: "black", vert: "green" })[normalizedChoice] ?? normalizedChoice;
  const won = numericChoice !== null ? number === numericChoice : color === canonical;
  const multiplier = numericChoice !== null || canonical === "green" ? 36 : 2;
  return { number, color, choice: canonical, won, multiplier, payout: won ? bet * multiplier : 0 };
}

function drawSlotSymbol() {
  let value = randomInt(SLOT_TOTAL_WEIGHT);
  for (const item of SLOT_SYMBOLS) {
    value -= item.weight;
    if (value < 0) return item.symbol;
  }
  return SLOT_SYMBOLS[0].symbol;
}

export function resolveSlotsOutcome({ bet, symbols }) {
  validateBet(bet);
  if (!Array.isArray(symbols) || symbols.length !== 3 || symbols.some((symbol) => !SLOT_SYMBOLS.some((item) => item.symbol === symbol))) {
    throw new Error("Combinaison de machine à sous invalide.");
  }
  const [a, b, c] = symbols;
  let multiplier = 0;
  let label = "Aucune combinaison";
  if (a === b && b === c) {
    multiplier = ({ "7️⃣": 15, "💎": 10, "⭐": 7, "🔔": 5, "🍒": 4, "🍋": 3 })[a] ?? 0;
    label = multiplier ? `Triple ${a}` : label;
  } else if (a === b || a === c || b === c) {
    multiplier = 2;
    label = "Paire";
  }
  return { symbols: [...symbols], multiplier, label, payout: bet * multiplier, won: multiplier > 0 };
}

export function resolveCasinoCoinflipOutcome({ bet, choice, result }) {
  validateBet(bet);
  const normalizedChoice = String(choice).toLowerCase();
  const normalizedResult = String(result).toLowerCase();
  if (!["pile", "face", "heads", "tails"].includes(normalizedChoice) || !["pile", "face"].includes(normalizedResult)) {
    throw new Error("Choix invalide : pile ou face.");
  }
  const choiceSide = normalizedChoice === "heads" ? "pile" : normalizedChoice === "tails" ? "face" : normalizedChoice;
  const won = choiceSide === normalizedResult;
  return { choice: choiceSide, result: normalizedResult, won, multiplier: 2, payout: won ? bet * 2 : 0 };
}

export function resolveCasinoDiceOutcome({ bet, choice, result }) {
  validateBet(bet);
  const target = Number(choice);
  if (!Number.isInteger(target) || target < 1 || target > 6 || !Number.isInteger(result) || result < 1 || result > 6) {
    throw new Error("Choisis une face de dé entre 1 et 6.");
  }
  const won = target === result;
  return { choice: target, result, won, multiplier: 6, payout: won ? bet * 6 : 0 };
}

/** Atomic, idempotent round settlement. payout is gross and includes any returned stake. */
export function settleCasinoRound({ idempotencyKey, guildId, userId, game, bet, payout, outcome, now = Date.now() }) {
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 6 || idempotencyKey.length > 100) throw new Error("Clé d'idempotence invalide.");
  if (!validId(guildId) || !validId(userId)) throw new Error("Serveur ou joueur invalide.");
  if (typeof game !== "string" || !/^[a-z_]{2,24}$/.test(game)) throw new Error("Jeu invalide.");
  validateBet(bet);
  if (!Number.isSafeInteger(payout) || payout < 0 || payout > bet * 36) throw new Error("Paiement du jeu invalide.");
  const outcomeJson = JSON.stringify(outcome ?? {});

  return transaction(() => {
    const existing = db.prepare("SELECT * FROM casino_rounds WHERE idempotency_key=?").get(idempotencyKey);
    if (existing) {
      if (existing.guild_id !== guildId || existing.user_id !== userId || existing.game !== game || Number(existing.bet) !== bet) {
        throw new Error("Cette clé d'idempotence est déjà utilisée par une autre partie.");
      }
      return {
        idempotencyKey: existing.idempotency_key,
        game: existing.game,
        bet: Number(existing.bet),
        payout: Number(existing.payout),
        outcome: JSON.parse(existing.outcome_json),
        duplicate: true,
      };
    }

    assertCasinoCanStart({ guildId, userId, bet, now });
    db.prepare("INSERT OR IGNORE INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,0,0)").run(guildId, userId);
    const debit = db.prepare("UPDATE wallets SET balance=balance-? WHERE guild_id=? AND user_id=? AND balance>=?")
      .run(bet, guildId, userId, bet);
    if (!Number(debit.changes)) throw new Error("Solde PND insuffisant pour cette mise.");

    if (payout > 0) {
      const credit = db.prepare("UPDATE wallets SET balance=balance+? WHERE guild_id=? AND user_id=? AND balance<=?")
        .run(payout, guildId, userId, MAX_BALANCE - payout);
      if (!Number(credit.changes)) throw new Error("Le paiement dépasserait le solde maximal autorisé.");
    }
    db.prepare("INSERT INTO economy_ledger(guild_id,user_id,delta,reason,created_at) VALUES(?,?,?,?,?)")
      .run(guildId, userId, -bet, `casino_${game}_bet`, now);
    if (payout > 0) {
      db.prepare("INSERT INTO economy_ledger(guild_id,user_id,delta,reason,created_at) VALUES(?,?,?,?,?)")
        .run(guildId, userId, payout, `casino_${game}_payout`, now);
    }
    db.prepare(`INSERT INTO casino_rounds(idempotency_key,guild_id,user_id,game,bet,payout,outcome_json,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(idempotencyKey, guildId, userId, game, bet, payout, outcomeJson, now);
    const current = db.prepare("SELECT balance FROM wallets WHERE guild_id=? AND user_id=?").get(guildId, userId);
    return { idempotencyKey, game, bet, payout, outcome: JSON.parse(outcomeJson), balance: Number(current.balance), duplicate: false };
  });
}

export function playCasinoRoulette({ idempotencyKey, guildId, userId, bet, choice, now = Date.now(), draw = () => randomInt(37) }) {
  const outcome = resolveRouletteOutcome({ bet, choice, number: draw() });
  return settleCasinoRound({ idempotencyKey, guildId, userId, game: "roulette", bet, payout: outcome.payout, outcome, now });
}

export function playCasinoSlots({ idempotencyKey, guildId, userId, bet, now = Date.now(), draw = drawSlotSymbol }) {
  const outcome = resolveSlotsOutcome({ bet, symbols: [draw(), draw(), draw()] });
  return settleCasinoRound({ idempotencyKey, guildId, userId, game: "slots", bet, payout: outcome.payout, outcome, now });
}

export function playCasinoCoinflip({ idempotencyKey, guildId, userId, bet, choice, now = Date.now(), draw = () => randomInt(2) }) {
  const result = draw() === 0 ? "pile" : "face";
  const outcome = resolveCasinoCoinflipOutcome({ bet, choice, result });
  return settleCasinoRound({ idempotencyKey, guildId, userId, game: "coinflip", bet, payout: outcome.payout, outcome, now });
}

export function playCasinoDice({ idempotencyKey, guildId, userId, bet, choice, now = Date.now(), draw = () => randomInt(1, 7) }) {
  const result = draw();
  const outcome = resolveCasinoDiceOutcome({ bet, choice, result });
  return settleCasinoRound({ idempotencyKey, guildId, userId, game: "dice", bet, payout: outcome.payout, outcome, now });
}

export function casinoHistory(guildId, userId, limit = 10) {
  if (!validId(guildId) || !validId(userId)) return [];
  const bounded = Math.min(20, Math.max(1, Number(limit) || 10));
  return db.prepare(`SELECT game,bet,payout,outcome_json,created_at
    FROM casino_rounds WHERE guild_id=? AND user_id=? ORDER BY created_at DESC LIMIT ?`).all(guildId, userId, bounded)
    .map((row) => ({ game: row.game, bet: Number(row.bet), payout: Number(row.payout), net: Number(row.payout) - Number(row.bet), outcome: JSON.parse(row.outcome_json), createdAt: Number(row.created_at) }));
}

export function casinoStats(guildId, userId) {
  const row = db.prepare(`SELECT COUNT(*) AS rounds, COALESCE(SUM(bet),0) AS wagered,
    COALESCE(SUM(payout),0) AS returned, COALESCE(SUM(payout-bet),0) AS net
    FROM casino_rounds WHERE guild_id=? AND user_id=?`).get(guildId, userId);
  return { rounds: Number(row.rounds), wagered: Number(row.wagered), returned: Number(row.returned), net: Number(row.net) };
}

function formatPnd(value) { return `${Number(value).toLocaleString("fr-FR")} PND`; }

export async function handleCasinoMessage(message) {
  const content = String(message.content ?? "").trim();
  if (!/^=casino(?:\s|$)/i.test(content)) return false;
  if (!message.guild || !message.author || message.author.bot) return true;
  const [, action = "aide", rawBet, rawChoice] = content.split(/\s+/);
  const uid = message.author.id;
  const gid = message.guild.id;
  try {
    if (action.toLowerCase() === "aide" || action.toLowerCase() === "panel") {
      await message.reply({
        content: "🎰 **PND Casino**\n`=casino roulette mise rouge|noir|vert|0-36`\n`=casino slots mise`\n`=casino coinflip mise pile|face`\n`=casino dice mise 1-6`\n`=blackjack mise`\n`=casino historique` · `=casino stats`\n`=casino limite montant|off` · `=casino pause 24h|7j|30j|permanent`\nLa monnaie utilisée est exclusivement virtuelle : PND.",
        allowedMentions: { parse: [] },
      });
      return true;
    }
    if (action.toLowerCase() === "limites" || action.toLowerCase() === "controle" || action.toLowerCase() === "contrôle") {
      const controls = getCasinoControls(gid, uid);
      const exclusion = controls.selfExcludedUntil == null ? "Aucune" : controls.selfExcludedUntil === Number.MAX_SAFE_INTEGER
        ? "Activée sans date de fin" : `Jusqu'au <t:${Math.floor(controls.selfExcludedUntil / 1000)}:F>`;
      const limit = controls.dailyWagerLimit == null ? "Aucune" : `${formatPnd(controls.dailyWagerLimit)} par jour (heure de Paris)`;
      await message.reply({ content: `🛡️ **Tes limites PND Casino**\nAuto-exclusion : **${exclusion}**\nLimite de mises : **${limit}**\n\nCommandes : \`=casino limite 5000\`, \`=casino limite off\`, \`=casino pause 24h|7j|30j|permanent\`.`, allowedMentions: { parse: [] } });
      return true;
    }
    if (action.toLowerCase() === "limite") {
      const value = String(rawBet ?? "").toLowerCase();
      if (value === "off" || value === "désactiver" || value === "desactiver") {
        setCasinoDailyWagerLimit({ guildId: gid, userId: uid, limit: null });
        await message.reply({ content: "✅ Ta limite quotidienne de mises a été désactivée.", allowedMentions: { parse: [] } });
        return true;
      }
      const limit = Number(value);
      setCasinoDailyWagerLimit({ guildId: gid, userId: uid, limit });
      await message.reply({ content: `✅ Ta limite de mises est fixée à **${formatPnd(limit)} par jour** (heure de Paris).`, allowedMentions: { parse: [] } });
      return true;
    }
    if (action.toLowerCase() === "pause" || action.toLowerCase() === "auto-exclusion") {
      const duration = String(rawBet ?? "").toLowerCase();
      const durations = { "24h": 24 * 60 * 60_000, "7j": 7 * 24 * 60 * 60_000, "30j": 30 * 24 * 60 * 60_000, permanent: Number.MAX_SAFE_INTEGER };
      if (!Object.hasOwn(durations, duration)) throw new Error("Utilisation : `=casino pause 24h|7j|30j|permanent`. Une auto-exclusion ne peut pas être annulée avant son échéance.");
      const controls = setCasinoSelfExclusion({ guildId: gid, userId: uid, durationMs: durations[duration] });
      const until = controls.selfExcludedUntil === Number.MAX_SAFE_INTEGER ? "sans date de fin" : `jusqu'au <t:${Math.floor(controls.selfExcludedUntil / 1000)}:F>`;
      await message.reply({ content: `🛡️ Auto-exclusion activée ${until}. Les nouvelles mises sont bloquées. Cette décision ne peut pas être annulée avant l'échéance.`, allowedMentions: { parse: [] } });
      return true;
    }
    if (action.toLowerCase() === "stats") {
      const stats = casinoStats(gid, uid);
      await message.reply({ content: `🎰 **Tes statistiques PND Casino**\nParties : **${stats.rounds}**\nTotal misé : **${formatPnd(stats.wagered)}**\nTotal récupéré : **${formatPnd(stats.returned)}**\nRésultat net : **${stats.net >= 0 ? "+" : ""}${formatPnd(stats.net)}**`, allowedMentions: { parse: [] } });
      return true;
    }
    if (action.toLowerCase() === "historique") {
      const rows = casinoHistory(gid, uid, 10);
      const lines = rows.map((row) => `• <t:${Math.floor(row.createdAt / 1000)}:R> · ${row.game} · mise ${formatPnd(row.bet)} · retour ${formatPnd(row.payout)} · net ${row.net >= 0 ? "+" : ""}${formatPnd(row.net)}`);
      await message.reply({ content: `🧾 **Ton historique Casino**\n${lines.length ? lines.join("\n") : "Aucune partie enregistrée."}`, allowedMentions: { parse: [] } });
      return true;
    }
    const bet = Number(rawBet);
    validateBet(bet);
    if (action.toLowerCase() === "coinflip") {
      if (!rawChoice) throw new Error("Utilisation : `=casino coinflip 100 pile|face`.");
      const result = playCasinoCoinflip({ idempotencyKey: `msg:${message.id || randomUUID()}`, guildId: gid, userId: uid, bet, choice: rawChoice });
      const net = result.payout - bet;
      await message.reply({ content: `🪙 **Pile ou face** : ${result.outcome.result === "pile" ? "Pile" : "Face"}. ${result.outcome.won ? `✅ Gain net : **+${formatPnd(net)}**` : `❌ Perdu : **${formatPnd(bet)}**`}. Retour : **${formatPnd(result.payout)}**.`, allowedMentions: { parse: [] } });
      return true;
    }
    if (action.toLowerCase() === "dice" || action.toLowerCase() === "dé") {
      if (!rawChoice) throw new Error("Utilisation : `=casino dice 100 1-6`.");
      const result = playCasinoDice({ idempotencyKey: `msg:${message.id || randomUUID()}`, guildId: gid, userId: uid, bet, choice: rawChoice });
      const net = result.payout - bet;
      await message.reply({ content: `🎲 Le dé tombe sur **${result.outcome.result}**. ${result.outcome.won ? `✅ Gain net : **+${formatPnd(net)}**` : `❌ Perdu : **${formatPnd(bet)}**`}. Retour : **${formatPnd(result.payout)}**.`, allowedMentions: { parse: [] } });
      return true;
    }
    if (action.toLowerCase() === "blackjack") {
      await message.reply({ content: "🃏 Le Blackjack PND utilise les boutons de partie : lance `=blackjack <mise>` pour démarrer. Les gains sont enregistrés dans l'historique Casino.", allowedMentions: { parse: [] } });
      return true;
    }
    if (action.toLowerCase() === "roulette") {
      if (!rawChoice) throw new Error("Utilisation : `=casino roulette 100 rouge|noir|vert|0-36`.");
      const result = playCasinoRoulette({ idempotencyKey: `msg:${message.id || randomUUID()}`, guildId: gid, userId: uid, bet, choice: rawChoice.toLowerCase() });
      const net = result.payout - bet;
      const colorLabel = result.outcome.color === "red" ? "rouge" : result.outcome.color === "black" ? "noir" : "vert";
      const { sendToLogsHub } = await import("./logs-hub.js");
      const { systemLogEmbed } = await import("./logs.js");
      void sendToLogsHub(message.client, message.guild, systemLogEmbed({ category: "casino", title: "🎡 PND Casino — Roulette", description: `Joueur : <@${uid}>\nMise : ${formatPnd(bet)}\nChoix : ${rawChoice}\nRésultat : ${result.outcome.number} ${colorLabel}\nRetour : ${formatPnd(result.payout)}\nNet : ${net >= 0 ? "+" : ""}${formatPnd(net)}` }), "PND Casino — Roulette").catch(() => {});
      await message.reply({ content: `🎡 **PND Roulette**\nLa bille tombe sur **${result.outcome.number} ${colorLabel}**.\n${net > 0 ? `✅ Gain net : **+${formatPnd(net)}**` : net === 0 ? "➖ Mise récupérée." : `❌ Perte : **${formatPnd(bet)}**.`}\nRetour : **${formatPnd(result.payout)}**.`, allowedMentions: { parse: [] } });
      return true;
    }
    if (action.toLowerCase() === "slots" || action.toLowerCase() === "machines") {
      const result = playCasinoSlots({ idempotencyKey: `msg:${message.id || randomUUID()}`, guildId: gid, userId: uid, bet });
      const net = result.payout - bet;
      const { sendToLogsHub } = await import("./logs-hub.js");
      const { systemLogEmbed } = await import("./logs.js");
      void sendToLogsHub(message.client, message.guild, systemLogEmbed({ category: "casino", title: "🎰 PND Casino — Slots", description: `Joueur : <@${uid}>\nMise : ${formatPnd(bet)}\nRésultat : ${result.outcome.symbols.join(" ")}\nRetour : ${formatPnd(result.payout)}\nNet : ${net >= 0 ? "+" : ""}${formatPnd(net)}` }), "PND Casino — Slots").catch(() => {});
      await message.reply({ content: `🎰 **PND Slots**\n${result.outcome.symbols.join("  │  ")}\n${result.outcome.label}\n${net > 0 ? `✅ Gain net : **+${formatPnd(net)}**` : net === 0 ? "➖ Mise récupérée." : `❌ Perte : **${formatPnd(bet)}**.`}\nRetour : **${formatPnd(result.payout)}**.`, allowedMentions: { parse: [] } });
      return true;
    }
    throw new Error("Jeu inconnu. Utilise `=casino aide`.");
  } catch (error) {
    await message.reply({ content: `❌ ${error instanceof Error ? error.message : "Partie impossible."}`, allowedMentions: { parse: [] } }).catch(() => {});
    return true;
  }
}

export function createCasinoRoundId() { return randomUUID(); }
