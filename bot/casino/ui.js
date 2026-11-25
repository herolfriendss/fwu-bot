// Embeds and components for the PND Casino. Rendering only: every decision is
// taken by the engines, so these functions can be read as the visual contract.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from "discord.js";
import { applyBanner } from "../banners.js";
import { handLabel, handValue, hiddenCard } from "./cards.js";
import { blackjackActions } from "./blackjack.js";
import { COLOR_EMOJI } from "./roulette.js";
import { TILES, SIZE, minesCashoutValue, minesCurrentMultiplier, minesNextMultiplier } from "./mines.js";
import { crashMultiplierAt } from "./crash.js";
import { BUCKETS } from "./plinko.js";

export const RED = 0xe21d2f;
const WIN = 0x16a34a;
const LOSE = 0x7f1d1d;
const PUSH = 0x6b7280;

export const pnd = (value) => `${Number(value).toLocaleString("fr-FR")} PND`;
const signed = (value) => `${value >= 0 ? "+" : "−"}${pnd(Math.abs(value))}`;
const resultColor = (net) => (net > 0 ? WIN : net < 0 ? LOSE : PUSH);

/** Every casino embed carries the casino banner and the same footer. */
export function casinoEmbed({ title, description, color = RED, fields = [], footer }) {
  const embed = new EmbedBuilder().setColor(color).setTitle(title);
  if (description) embed.setDescription(description);
  if (fields.length) embed.addFields(fields);
  embed.setFooter({ text: footer ?? "PND Casino · monnaie virtuelle, sans valeur réelle" });
  return applyBanner(embed, "casino");
}

const button = (id, label, style = ButtonStyle.Secondary, emoji) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
};
export const rows = (...buttons) => {
  const out = [];
  for (let i = 0; i < buttons.length; i += 5) out.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  return out;
};

// ------------------------------------------------------------ blackjack ----

const ACTION_LABELS = {
  hit: ["Tirer", ButtonStyle.Primary, "🃏"],
  stand: ["Rester", ButtonStyle.Success, "✋"],
  double: ["Doubler", ButtonStyle.Danger, "✌️"],
  split: ["Séparer", ButtonStyle.Danger, "🔀"],
  surrender: ["Abandonner", ButtonStyle.Secondary, "🏳️"],
  insurance: ["Assurance", ButtonStyle.Secondary, "🛡️"],
};

export function blackjackView({ roundId, state, settlement = null, staked, balance = null }) {
  const final = Boolean(settlement);
  const dealerCards = final ? handLabel(state.dealer) : `${handLabel([state.dealer[0]])} ${hiddenCard()}`;
  const dealerTotal = final ? ` · **${handValue(state.dealer).total}**` : "";
  const fields = state.hands.map((hand, index) => {
    const value = handValue(hand.cards);
    const active = !final && index === state.active ? " ◀" : "";
    const outcome = settlement ? ` · ${settlement.hands[index].label}` : "";
    return {
      name: `${state.hands.length > 1 ? `Main ${index + 1}` : "Ta main"} — ${pnd(hand.bet)}${active}`,
      value: `${handLabel(hand.cards)}\n**${value.total}**${value.soft ? " (souple)" : ""}${value.busted ? " · sauté" : ""}${outcome}`,
    };
  });
  if (state.insurance) fields.push({ name: "Assurance", value: pnd(state.insurance), inline: true });

  const embed = casinoEmbed({
    title: "🃏 Blackjack",
    description: `**Croupier**\n${dealerCards}${dealerTotal}`,
    color: final ? resultColor(settlement.net) : RED,
    fields,
    footer: final
      ? `Misé ${pnd(settlement.totalBet)} · récupéré ${pnd(settlement.totalPayout)}${balance === null ? "" : ` · solde ${pnd(balance)}`}`
      : `Mise engagée ${pnd(staked)} · le croupier reste à 17`,
  });
  if (final) embed.addFields({ name: "Résultat", value: `**${signed(settlement.net)}**` });

  const components = final
    ? []
    : rows(...blackjackActions(state).map((action) => {
      const [label, style, emoji] = ACTION_LABELS[action];
      return button(`casino:bj:${action}:${roundId}`, label, style, emoji);
    }));
  return { embeds: [embed], components };
}

// ---------------------------------------------------------------- mines ----

const TILE_HIDDEN = "⬛";
const TILE_SAFE = "💎";
const TILE_BOMB = "💣";
const TILE_HIT = "💥";

function minesGrid(state, { reveal = false } = {}) {
  const lines = [];
  for (let row = 0; row < SIZE; row += 1) {
    const cells = [];
    for (let col = 0; col < SIZE; col += 1) {
      const tile = row * SIZE + col;
      if (state.hit === tile) cells.push(TILE_HIT);
      else if (state.revealed.includes(tile)) cells.push(TILE_SAFE);
      else if (reveal && state.bombs.includes(tile)) cells.push(TILE_BOMB);
      else cells.push(TILE_HIDDEN);
    }
    lines.push(cells.join(" "));
  }
  return lines.join("\n");
}

export function minesView({ roundId, state, payout = null, balance = null }) {
  const over = state.phase !== "playing";
  const multiplier = minesCurrentMultiplier(state);
  const next = minesNextMultiplier(state);
  const net = over ? (payout ?? 0) - state.bet : 0;

  const embed = casinoEmbed({
    title: "💣 Mines",
    description: minesGrid(state, { reveal: over }),
    color: over ? resultColor(net) : RED,
    fields: [
      { name: "Mines", value: `${state.mines} sur ${TILES}`, inline: true },
      { name: "Cases sûres", value: `${state.revealed.length}`, inline: true },
      { name: "Multiplicateur", value: `×${multiplier.toFixed(2)}`, inline: true },
    ],
    footer: over
      ? `Misé ${pnd(state.bet)} · récupéré ${pnd(payout ?? 0)}${balance === null ? "" : ` · solde ${pnd(balance)}`}`
      : `Mise ${pnd(state.bet)}${next ? ` · case suivante ×${next.toFixed(2)}` : ""}`,
  });
  if (over) {
    embed.addFields({
      name: state.phase === "lost" ? "Mine touchée" : "Encaissé",
      value: `**${signed(net)}**`,
    });
    return { embeds: [embed], components: [] };
  }

  const free = Array.from({ length: TILES }, (_, i) => i).filter((tile) => !state.revealed.includes(tile));
  const select = new StringSelectMenuBuilder()
    .setCustomId(`casino:mines:pick:${roundId}`)
    .setPlaceholder("Choisis une case à retourner")
    .addOptions(free.slice(0, 25).map((tile) => ({
      label: `Case ${String.fromCharCode(65 + (tile % SIZE))}${Math.floor(tile / SIZE) + 1}`,
      value: String(tile),
    })));
  const actions = rows(
    button(`casino:mines:cash:${roundId}`, `Encaisser ${pnd(minesCashoutValue(state))}`, ButtonStyle.Success, "💰")
      .setDisabled(!state.revealed.length),
  );
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select), ...actions] };
}

// ---------------------------------------------------------------- crash ----

export function crashView({ roundId, state, payout = null, balance = null }) {
  const multiplier = crashMultiplierAt(state.tick);
  const running = state.phase === "running";
  const net = running ? 0 : (payout ?? 0) - state.bet;
  const bar = "▰".repeat(Math.min(20, state.tick)) + "▱".repeat(Math.max(0, 20 - state.tick));

  const embed = casinoEmbed({
    title: running ? "📈 Crash — en vol" : state.phase === "crashed" ? "💥 Crash" : "📈 Crash — encaissé",
    description: running
      ? `# ×${multiplier.toFixed(2)}\n${bar}`
      : state.phase === "crashed"
        ? `# 💥 ×${state.crashPoint.toFixed(2)}\nLa courbe a lâché avant ton encaissement.`
        : `# ×${state.cashedAt.toFixed(2)}\nEncaissé à temps — la courbe a lâché à ×${state.crashPoint.toFixed(2)}.`,
    color: running ? RED : resultColor(net),
    footer: running
      ? `Mise ${pnd(state.bet)}${state.autoCashout ? ` · encaissement auto à ×${state.autoCashout}` : ""}`
      : `Misé ${pnd(state.bet)} · récupéré ${pnd(payout ?? 0)}${balance === null ? "" : ` · solde ${pnd(balance)}`}`,
  });
  if (!running) embed.addFields({ name: "Résultat", value: `**${signed(net)}**` });
  return {
    embeds: [embed],
    components: running
      ? rows(button(`casino:crash:cash:${roundId}`, `Encaisser ×${multiplier.toFixed(2)}`, ButtonStyle.Success, "💰"))
      : [],
  };
}

// ----------------------------------------------------- single-shot games ----

/** Discord caps a custom id at 100 characters, so a long roulette line gets no replay button. */
const replayRow = (game, userId, bet, extra = "") => {
  const id = `casino:replay:${game}:${userId}:${bet}:${extra}`;
  return id.length > 100 ? [] : rows(button(id, "Rejouer", ButtonStyle.Secondary, "🔁"));
};

export function slotsView({ result, bet, balance, userId, jackpotWon = 0 }) {
  const grid = [0, 1, 2].map((row) => [0, 1, 2].map((col) => result.grid[col][row]).join(" │ ")).join("\n");
  const net = result.payout + jackpotWon - bet;
  const lines = result.lines.length
    ? result.lines.map((line) => `${line.symbol} ×${line.length} · ${line.name} · **${pnd(line.win)}**`).join("\n")
    : "Aucune ligne gagnante.";
  const embed = casinoEmbed({
    title: "🎰 Machine à sous",
    description: `\`\`\`\n${grid}\n\`\`\`\n${lines}`,
    color: resultColor(net),
    fields: [
      ...(result.scatters >= 2 ? [{ name: `💰 Scatters ×${result.scatters}`, value: pnd(result.scatterWin), inline: true }] : []),
      ...(jackpotWon ? [{ name: "🎉 JACKPOT", value: `**${pnd(jackpotWon)}**`, inline: true }] : []),
      { name: "Résultat", value: `**${signed(net)}**`, inline: true },
    ],
    footer: `Misé ${pnd(bet)} · récupéré ${pnd(result.payout + jackpotWon)} · solde ${pnd(balance)}`,
  });
  return { embeds: [embed], components: replayRow("slots", userId, bet) };
}

export function rouletteView({ spin, balance, bets, userId }) {
  const detail = spin.results
    .map((r) => `${r.won ? "✅" : "❌"} ${r.label} · ${pnd(r.amount)}${r.won ? ` → **${pnd(r.payout)}**` : ""}`)
    .join("\n");
  const embed = casinoEmbed({
    title: "🎡 Roulette",
    description: `# ${COLOR_EMOJI[spin.color]} ${spin.number}\n**${spin.color}**\n\n${detail}`,
    color: resultColor(spin.net),
    fields: [{ name: "Résultat", value: `**${signed(spin.net)}**` }],
    footer: `Misé ${pnd(spin.totalBet)} · récupéré ${pnd(spin.totalPayout)} · solde ${pnd(balance)}`,
  });
  return { embeds: [embed], components: replayRow("roulette", userId, spin.totalBet, bets) };
}

export function plinkoView({ drop, result, bet, balance, userId }) {
  const slots = Array.from({ length: BUCKETS }, (_, i) => (i === result.bucket ? "🔴" : "▫️")).join("");
  const embed = casinoEmbed({
    title: "🎯 Plinko",
    description: `\`${drop.path.join("")}\`\n${slots}\n\n La bille tombe en case **${result.bucket + 1}** · **×${result.multiplier}**`,
    color: resultColor(result.net),
    fields: [{ name: "Résultat", value: `**${signed(result.net)}**` }],
    footer: `Risque ${result.risk} · misé ${pnd(bet)} · récupéré ${pnd(result.payout)} · solde ${pnd(balance)}`,
  });
  return { embeds: [embed], components: replayRow("plinko", userId, bet, result.risk) };
}

// ------------------------------------------------------------- meta views ----

export function jackpotView(info) {
  const last = info.lastWinner
    ? `Dernier gagnant : <@${info.lastWinner}> · ${pnd(info.lastWinAmount)} <t:${Math.floor(info.lastWinAt / 1000)}:R>`
    : "Personne ne l'a encore décroché.";
  return {
    embeds: [casinoEmbed({
      title: "🎉 Jackpot progressif",
      description: `# ${pnd(info.amount)}\n1 % de chaque mise alimente la cagnotte.\nTrois 7️⃣ sur une ligne de la machine à sous et elle est à toi.\n\n${last}`,
    })],
  };
}

export function vipView({ tier, cashback, username }) {
  const progress = tier.next
    ? `Encore **${pnd(tier.toNext)}** misés pour passer ${tier.next.emoji} ${tier.next.label}.`
    : "Tu es au sommet de l'échelle.";
  return {
    embeds: [casinoEmbed({
      title: `${tier.emoji} Rang ${tier.label} — ${username}`,
      description: progress,
      fields: [
        { name: "Total misé", value: pnd(tier.wagered), inline: true },
        { name: "Cashback", value: tier.cashback ? `${Math.round(tier.cashback * 100)} % des pertes` : "—", inline: true },
        { name: "Disponible", value: cashback.amount ? pnd(cashback.amount) : cashback.reason ?? "—", inline: true },
      ],
      footer: "Le cashback se récupère avec /casino cashback",
    })],
  };
}

export function leaderboardView(entries) {
  const medals = ["🥇", "🥈", "🥉"];
  const lines = entries.length
    ? entries.map((row, i) => `${medals[i] ?? `**${i + 1}.**`} <@${row.userId}> · ${signed(row.net)} · ${row.rounds} parties`).join("\n")
    : "Aucune partie jouée pour l'instant.";
  return { embeds: [casinoEmbed({ title: "🏆 Classement du casino", description: lines })] };
}
