// PND Casino — slash commands, buttons and live tables.
// Every game goes through openRound/closeRound: the stake always leaves the
// wallet before a card is dealt, and a payout is written exactly once.
import { randomInt } from "node:crypto";
import { MessageFlags } from "discord.js";
import {
  getCasinoControls, setCasinoDailyWagerLimit, setCasinoSelfExclusion, casinoHistory, casinoStats,
  resolveCasinoCoinflipOutcome, resolveCasinoDiceOutcome,
} from "../casino.js";
import { newBlackjackGame, blackjackAct, blackjackActions, blackjackDealerPlay, blackjackSettle } from "./blackjack.js";
import { parseRouletteBets, resolveRouletteSpin } from "./roulette.js";
import { spinSlots, resolveSlots } from "./slots.js";
import { newMinesGame, minesReveal, minesCashout, minesPayout, MIN_MINES, MAX_MINES } from "./mines.js";
import { newCrashGame, crashAdvance, crashCashout, crashPayout, TICK_MS } from "./crash.js";
import { dropPlinko, resolvePlinko, RISK_LEVELS } from "./plinko.js";
import {
  openRound, loadRound, saveRoundState, stakeMore, closeRound, openRoundOf,
  jackpotInfo, awardJackpot, vipStatus, cashbackDue, claimCashback, walletBalance, casinoLeaderboard,
} from "./store.js";
import { permissionFor } from "../trust.js";
import { perkActive } from "../features/perks.js";
import {
  blackjackView, minesView, crashView, slotsView, rouletteView, plinkoView,
  jackpotView, vipView, leaderboardView, casinoEmbed, pnd,
} from "./ui.js";

export const CASINO_COMMANDS = new Set(["casino", "blackjack", "roulette"]);
const uniform = () => randomInt(1 << 30) / (1 << 30);
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });

const CASINO_BASE_MAX_BET = 100_000;
const SELF_EXCLUSION = { "24h": 24 * 60 * 60_000, "7j": 7 * 24 * 60 * 60_000, "30j": 30 * 24 * 60 * 60_000, permanent: Number.MAX_SAFE_INTEGER };

// --------------------------------------------------------------- helpers ----

async function failed(interaction, error) {
  const content = `❌ ${error instanceof Error ? error.message : "Partie impossible."}`;
  if (interaction.deferred || interaction.replied) await interaction.editReply({ content, embeds: [], components: [] }).catch(() => {});
  else await interaction.reply(ephemeral(content)).catch(() => {});
}

/**
 * The shared trust score decides who may bet and how much: a fresh account, a
 * warned member or someone GUARD froze is limited here without the casino
 * knowing anything about moderation.
 */
function guardStake(interaction, total) {
  const verdict = permissionFor(interaction.guildId, interaction.user.id, "casino", {
    member: interaction.member, baseBet: CASINO_BASE_MAX_BET,
  });
  if (!verdict.allowed) throw new Error(verdict.reason);
  const ceiling = verdict.maxBet && perkActive(interaction.guildId, interaction.user.id, "vip_casino")
    ? verdict.maxBet * 2
    : verdict.maxBet;
  if (ceiling && total > ceiling) {
    throw new Error(`Ton rang de confiance ${verdict.trust.tier.emoji} ${verdict.trust.tier.label} limite tes mises à ${pnd(ceiling)} par partie.`);
  }
  return verdict;
}

/** Resolves the round behind a component and checks the presser owns it. */
function roundFor(interaction, id) {
  const round = loadRound(id);
  if (!round || round.status !== "open") throw new Error("Cette partie est terminée.");
  if (round.userId !== interaction.user.id) throw new Error("Cette table n'est pas la tienne.");
  if (round.guildId !== interaction.guildId) throw new Error("Cette partie appartient à un autre serveur.");
  return round;
}

// ------------------------------------------------------------- blackjack ----

async function startBlackjack(interaction, bet) {
  guardStake(interaction, bet);
  const state = newBlackjackGame({ bet, rng: randomInt });
  const round = openRound({ guildId: interaction.guildId, userId: interaction.user.id, game: "blackjack", bet, state });
  if (state.phase === "dealer") return finishBlackjack(interaction, round.id, state);
  await interaction.editReply(blackjackView({ roundId: round.id, state, staked: bet }));
  return true;
}

async function finishBlackjack(interaction, roundId, state) {
  const played = blackjackDealerPlay(state);
  const settlement = blackjackSettle(played);
  const closed = closeRound({ id: roundId, payout: settlement.totalPayout, outcome: { game: "blackjack", ...settlement } });
  await interaction.editReply(blackjackView({
    roundId, state: played, settlement, staked: closed.staked, balance: closed.balance,
  }));
  return true;
}

async function blackjackButton(interaction, action, id) {
  const round = roundFor(interaction, id);
  await interaction.deferUpdate();
  let state = round.state;
  if (!blackjackActions(state).includes(action)) throw new Error("Action impossible sur cette main.");
  const next = blackjackAct(state, action, randomInt);
  if (next.extraStake > 0) stakeMore({ id, amount: next.extraStake });
  delete next.extraStake;
  state = next;
  saveRoundState(id, state);
  if (state.phase === "player") {
    await interaction.editReply(blackjackView({ roundId: id, state, staked: loadRound(id).staked }));
    return true;
  }
  return finishBlackjack(interaction, id, state);
}

// ----------------------------------------------------------------- mines ----

async function startMines(interaction, bet, mines) {
  guardStake(interaction, bet);
  const state = newMinesGame({ bet, mines, rng: randomInt });
  const round = openRound({ guildId: interaction.guildId, userId: interaction.user.id, game: "mines", bet, state });
  await interaction.editReply(minesView({ roundId: round.id, state }));
  return true;
}

async function minesPick(interaction, id) {
  const round = roundFor(interaction, id);
  await interaction.deferUpdate();
  const state = minesReveal(round.state, Number(interaction.values[0]));
  saveRoundState(id, state);
  if (state.phase === "playing") {
    await interaction.editReply(minesView({ roundId: id, state }));
    return true;
  }
  const payout = state.phase === "lost" ? 0 : minesPayout(minesCashout(state));
  const closed = closeRound({ id, payout, outcome: { game: "mines", phase: state.phase, mines: state.mines, safe: state.revealed.length } });
  await interaction.editReply(minesView({ roundId: id, state, payout, balance: closed.balance }));
  return true;
}

async function minesCash(interaction, id) {
  const round = roundFor(interaction, id);
  await interaction.deferUpdate();
  const state = minesCashout(round.state);
  const closed = closeRound({ id, payout: state.payout, outcome: { game: "mines", phase: "cashed", safe: state.revealed.length } });
  await interaction.editReply(minesView({ roundId: id, state, payout: state.payout, balance: closed.balance }));
  return true;
}

// ----------------------------------------------------------------- crash ----

/**
 * Drives the live table. The crash point was drawn when the round opened, so a
 * slow edit or a lost message never changes the outcome.
 */
function runCrash(interaction, id) {
  const tick = async () => {
    const round = loadRound(id);
    if (!round || round.status !== "open") return;
    const state = crashAdvance(round.state);
    saveRoundState(id, state);
    if (state.phase === "running") {
      await interaction.editReply(crashView({ roundId: id, state })).catch(() => {});
      setTimeout(tick, TICK_MS).unref?.();
      return;
    }
    const payout = crashPayout(state);
    const closed = closeRound({ id, payout, outcome: { game: "crash", phase: state.phase, crashPoint: state.crashPoint, cashedAt: state.cashedAt } });
    await interaction.editReply(crashView({ roundId: id, state, payout, balance: closed.balance })).catch(() => {});
  };
  setTimeout(tick, TICK_MS).unref?.();
}

async function startCrash(interaction, bet, autoCashout) {
  guardStake(interaction, bet);
  const state = newCrashGame({ bet, uniform, autoCashout });
  const round = openRound({ guildId: interaction.guildId, userId: interaction.user.id, game: "crash", bet, state });
  await interaction.editReply(crashView({ roundId: round.id, state }));
  runCrash(interaction, round.id);
  return true;
}

async function crashCash(interaction, id) {
  const round = roundFor(interaction, id);
  await interaction.deferUpdate();
  const state = crashCashout(round.state);
  const payout = crashPayout(state);
  const closed = closeRound({ id, payout, outcome: { game: "crash", phase: "cashed", crashPoint: state.crashPoint, cashedAt: state.cashedAt } });
  await interaction.editReply(crashView({ roundId: id, state, payout, balance: closed.balance }));
  return true;
}

// --------------------------------------------------- single-shot games ----

async function playSlots(interaction, bet) {
  guardStake(interaction, bet);
  const round = openRound({ guildId: interaction.guildId, userId: interaction.user.id, game: "slots", bet, state: {} });
  const result = resolveSlots({ bet, grid: spinSlots(randomInt) });
  const jackpotWon = result.jackpotWon ? awardJackpot({ guildId: interaction.guildId, userId: interaction.user.id }) : 0;
  const closed = closeRound({ id: round.id, payout: result.payout, outcome: { game: "slots", ...result, jackpotWon } });
  await interaction.editReply(slotsView({ result, bet, balance: closed.balance, userId: interaction.user.id, jackpotWon }));
  return true;
}

async function playRoulette(interaction, text, fallbackBet) {
  const bets = parseRouletteBets(text, fallbackBet);
  const total = bets.reduce((sum, b) => sum + b.amount, 0);
  guardStake(interaction, total);
  const round = openRound({ guildId: interaction.guildId, userId: interaction.user.id, game: "roulette", bet: total, state: {} });
  const spin = resolveRouletteSpin(bets, randomInt(37));
  const closed = closeRound({ id: round.id, payout: spin.totalPayout, outcome: { game: "roulette", number: spin.number, color: spin.color, net: spin.net } });
  await interaction.editReply(rouletteView({ spin, balance: closed.balance, bets: text, userId: interaction.user.id }));
  return true;
}

/** Coin flip and dice keep their simple one-shot form, on the same round pipeline. */
async function playSimple(interaction, game, bet, outcome, title, description) {
  guardStake(interaction, bet);
  const round = openRound({ guildId: interaction.guildId, userId: interaction.user.id, game, bet, state: {} });
  const closed = closeRound({ id: round.id, payout: outcome.payout, outcome: { game, ...outcome } });
  const net = outcome.payout - bet;
  await interaction.editReply({
    embeds: [casinoEmbed({
      title,
      description,
      color: net > 0 ? 0x16a34a : net < 0 ? 0x7f1d1d : 0x6b7280,
      fields: [{ name: "Résultat", value: `**${net >= 0 ? "+" : "−"}${pnd(Math.abs(net))}**` }],
      footer: `Misé ${pnd(bet)} · récupéré ${pnd(outcome.payout)} · solde ${pnd(closed.balance)}`,
    })],
  });
  return true;
}

async function playPlinko(interaction, bet, risk) {
  guardStake(interaction, bet);
  const round = openRound({ guildId: interaction.guildId, userId: interaction.user.id, game: "plinko", bet, state: {} });
  const drop = dropPlinko(randomInt);
  const result = resolvePlinko({ bet, risk, bucket: drop.bucket });
  const closed = closeRound({ id: round.id, payout: result.payout, outcome: { game: "plinko", ...result } });
  await interaction.editReply(plinkoView({ drop, result, bet, balance: closed.balance, userId: interaction.user.id }));
  return true;
}

// ----------------------------------------------------------------- slash ----

const RULES = [
  "**🃏 Blackjack** — sabot de 6 jeux, le croupier reste à 17. Blackjack payé 3:2, assurance 2:1. Doubler, séparer (jusqu'à 4 mains) et abandonner sont disponibles.",
  "**🎡 Roulette** — roulette européenne à un seul zéro. Plein ×36, cheval ×18, transversale ×12, carré ×9, sixain ×6, douzaine et colonne ×3, chances simples ×2. Plusieurs mises par tour : `rouge:100, 17:50`.",
  "**🎰 Machine à sous** — 5 lignes, joker qui remplace, scatters qui paient partout. Trois 7️⃣ sur une ligne décrochent le jackpot.",
  "**💣 Mines** — retourne des cases, le multiplicateur monte, encaisse avant la bombe.",
  "**📈 Crash** — la courbe monte, encaisse avant qu'elle lâche. 1 % des manches lâchent à ×1.00.",
  "**🎯 Plinko** — la bille tombe sur 16 rangées. Les bords paient, le centre prend.",
  "",
  "1 % de chaque mise alimente le jackpot. Les rangs VIP donnent un cashback quotidien sur les pertes.",
  "La monnaie est le PND : virtuelle, sans valeur réelle. `/casino limite` et `/casino pause` sont là si tu veux te brider.",
].join("\n");

async function handleSlash(interaction) {
  const sub = interaction.options.getSubcommand(false);
  const name = interaction.commandName;
  const bet = interaction.options.getInteger("mise");
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  if (name === "blackjack") { await interaction.deferReply(); return startBlackjack(interaction, bet); }
  if (name === "roulette") {
    await interaction.deferReply();
    return playRoulette(interaction, interaction.options.getString("choix") ?? "rouge", bet);
  }

  switch (sub) {
    case "blackjack": await interaction.deferReply(); return startBlackjack(interaction, bet);
    case "slots": await interaction.deferReply(); return playSlots(interaction, bet);
    case "roulette": await interaction.deferReply(); return playRoulette(interaction, interaction.options.getString("mises"), bet);
    case "mines": await interaction.deferReply(); return startMines(interaction, bet, interaction.options.getInteger("bombes") ?? 3);
    case "crash": await interaction.deferReply(); return startCrash(interaction, bet, interaction.options.getNumber("auto") ?? null);
    case "plinko": await interaction.deferReply(); return playPlinko(interaction, bet, interaction.options.getString("risque") ?? "moyen");
    case "coinflip": {
      await interaction.deferReply();
      const result = randomInt(2) === 0 ? "pile" : "face";
      const outcome = resolveCasinoCoinflipOutcome({ bet, choice: interaction.options.getString("choix"), result });
      return playSimple(interaction, "coinflip", bet, outcome, "🪙 Pile ou face", `# ${result === "pile" ? "Pile" : "Face"}\nTon choix : **${outcome.choice}**`);
    }
    case "dice": {
      await interaction.deferReply();
      const result = randomInt(1, 7);
      const outcome = resolveCasinoDiceOutcome({ bet, choice: interaction.options.getString("choix"), result });
      return playSimple(interaction, "dice", bet, outcome, "🎲 Dé", `# ${result}\nTon choix : **${outcome.choice}**`);
    }

    case "jackpot":
      await interaction.reply(jackpotView(jackpotInfo(guildId)));
      return true;
    case "vip":
      await interaction.reply({
        ...vipView({ tier: vipStatus(guildId, userId), cashback: cashbackDue(guildId, userId), username: interaction.user.username }),
        flags: MessageFlags.Ephemeral,
      });
      return true;
    case "cashback": {
      const claimed = claimCashback({ guildId, userId });
      await interaction.reply(ephemeral(claimed.amount
        ? `💸 Cashback ${claimed.tier.emoji} ${claimed.tier.label} récupéré : **${pnd(claimed.amount)}**.`
        : `Aucun cashback à récupérer. ${claimed.reason ?? ""}`.trim()));
      return true;
    }
    case "classement":
      await interaction.reply(leaderboardView(casinoLeaderboard(guildId, 10)));
      return true;
    case "stats": {
      const stats = casinoStats(guildId, userId);
      const tier = vipStatus(guildId, userId);
      await interaction.reply({
        embeds: [casinoEmbed({
          title: `📊 Tes statistiques — ${interaction.user.username}`,
          fields: [
            { name: "Parties", value: String(stats.rounds), inline: true },
            { name: "Total misé", value: pnd(stats.wagered), inline: true },
            { name: "Rang", value: `${tier.emoji} ${tier.label}`, inline: true },
            { name: "Récupéré", value: pnd(stats.returned), inline: true },
            { name: "Résultat net", value: `**${stats.net >= 0 ? "+" : "−"}${pnd(Math.abs(stats.net))}**`, inline: true },
            { name: "Solde", value: pnd(walletBalance(guildId, userId)), inline: true },
          ],
        })],
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    case "historique": {
      const rows = casinoHistory(guildId, userId, 10);
      await interaction.reply({
        embeds: [casinoEmbed({
          title: "🧾 Tes dernières parties",
          description: rows.length
            ? rows.map((r) => `<t:${Math.floor(r.createdAt / 1000)}:R> · ${r.game} · ${pnd(r.bet)} → ${pnd(r.payout)} · **${r.net >= 0 ? "+" : "−"}${pnd(Math.abs(r.net))}**`).join("\n")
            : "Aucune partie enregistrée.",
        })],
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    case "regles":
      await interaction.reply({ embeds: [casinoEmbed({ title: "🎰 Règles du PND Casino", description: RULES })], flags: MessageFlags.Ephemeral });
      return true;
    case "limite": {
      const limit = interaction.options.getInteger("montant");
      setCasinoDailyWagerLimit({ guildId, userId, limit });
      await interaction.reply(ephemeral(`✅ Limite fixée à **${pnd(limit)} par jour** (heure de Paris).`));
      return true;
    }
    case "limite-off":
      setCasinoDailyWagerLimit({ guildId, userId, limit: null });
      await interaction.reply(ephemeral("✅ Limite quotidienne désactivée."));
      return true;
    case "pause": {
      const duration = SELF_EXCLUSION[interaction.options.getString("duree")];
      const controls = setCasinoSelfExclusion({ guildId, userId, durationMs: duration });
      const until = controls.selfExcludedUntil === Number.MAX_SAFE_INTEGER
        ? "sans date de fin" : `jusqu'au <t:${Math.floor(controls.selfExcludedUntil / 1000)}:F>`;
      await interaction.reply(ephemeral(`🛡️ Auto-exclusion activée ${until}. Les mises sont bloquées et cette décision ne peut pas être annulée avant l'échéance.`));
      return true;
    }
    case "limites": {
      const controls = getCasinoControls(guildId, userId);
      await interaction.reply(ephemeral([
        "🛡️ **Tes garde-fous**",
        `Auto-exclusion : **${controls.selfExcludedUntil == null ? "aucune"
          : controls.selfExcludedUntil === Number.MAX_SAFE_INTEGER ? "sans date de fin"
          : `jusqu'au <t:${Math.floor(controls.selfExcludedUntil / 1000)}:F>`}**`,
        `Limite de mises : **${controls.dailyWagerLimit == null ? "aucune" : `${pnd(controls.dailyWagerLimit)} par jour`}**`,
      ].join("\n")));
      return true;
    }
    default:
      return false;
  }
}

// ------------------------------------------------------------ components ----

async function handleComponent(interaction) {
  const [prefix, game, action, ...rest] = interaction.customId.split(":");
  if (prefix !== "casino") return false;

  if (game === "replay") {
    const [owner, rawBet, ...tail] = rest;
    if (owner !== interaction.user.id) {
      await interaction.reply(ephemeral("Ce bouton appartient au joueur de la partie. Lance la tienne avec `/casino`."));
      return true;
    }
    const bet = Number(rawBet);
    const extra = tail.join(":");
    await interaction.deferReply();
    if (action === "slots") return playSlots(interaction, bet);
    if (action === "roulette") return playRoulette(interaction, extra || "rouge", bet);
    if (action === "plinko") return playPlinko(interaction, bet, extra || "moyen");
    return false;
  }
  if (game === "bj") return blackjackButton(interaction, action, rest.join(":"));
  if (game === "mines") {
    const id = rest.join(":");
    return action === "pick" ? minesPick(interaction, id) : minesCash(interaction, id);
  }
  if (game === "crash") return crashCash(interaction, rest.join(":"));
  return false;
}

export async function handleCasinoInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand?.() && CASINO_COMMANDS.has(interaction.commandName)) return await handleSlash(interaction);
    if ((interaction.isButton?.() || interaction.isStringSelectMenu?.()) && interaction.customId?.startsWith("casino:")) {
      return await handleComponent(interaction);
    }
    return false;
  } catch (error) {
    await failed(interaction, error);
    return true;
  }
}

export { MIN_MINES, MAX_MINES, RISK_LEVELS };
