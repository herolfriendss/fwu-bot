import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { randomInt, randomUUID } from "node:crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } from "discord.js";

const dataDir = new URL("./data/", import.meta.url);
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(new URL("./data/economy.sqlite", import.meta.url).pathname);
const purchaseLocks = new Set();
const MAX_BALANCE = 1_000_000_000_000;
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS wallets (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS economy_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
    delta INTEGER NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS economy_ledger_member_idx ON economy_ledger(guild_id,user_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS daily_claims (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, claimed_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS shop_items (
    guild_id TEXT NOT NULL, role_id TEXT NOT NULL, price INTEGER NOT NULL CHECK(price > 0),
    PRIMARY KEY (guild_id, role_id)
  );
  CREATE TABLE IF NOT EXISTS active_blackjack (
    game_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
    bet INTEGER NOT NULL CHECK(bet > 0), player_cards TEXT NOT NULL, dealer_cards TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

function transaction(action) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function balance(guildId, userId) {
  db.prepare("INSERT OR IGNORE INTO wallets(guild_id,user_id,balance) VALUES(?,?,0)").run(guildId, userId);
  return Number(db.prepare("SELECT balance FROM wallets WHERE guild_id=? AND user_id=?").get(guildId, userId).balance);
}

function changeBalance(guildId, userId, delta, reason = "adjustment") {
  db.prepare("INSERT OR IGNORE INTO wallets(guild_id,user_id,balance) VALUES(?,?,0)").run(guildId, userId);
  const current = balance(guildId, userId);
  if (current + delta > MAX_BALANCE) throw new Error(`Le solde ne peut pas dépasser ${format(MAX_BALANCE)}.`);
  if (delta < 0) {
    const result = db.prepare("UPDATE wallets SET balance=balance+? WHERE guild_id=? AND user_id=? AND balance>=?").run(delta, guildId, userId, -delta);
    if (!Number(result.changes)) throw new Error("Solde PND insuffisant.");
  } else {
    db.prepare("UPDATE wallets SET balance=balance+? WHERE guild_id=? AND user_id=?").run(delta, guildId, userId);
  }
  if (delta) db.prepare("INSERT INTO economy_ledger(guild_id,user_id,delta,reason,created_at) VALUES(?,?,?,?,?)").run(guildId, userId, delta, reason, Date.now());
  return balance(guildId, userId);
}

function format(value) { return `${Number(value).toLocaleString("fr-FR")} PND`; }
function mention(id) { return `<@${id}>`; }
function admin(member) {
  return member?.permissions?.has(PermissionFlagsBits.Administrator)
    || member?.permissions?.has(PermissionFlagsBits.ManageGuild);
}
function safeReply(message, content) {
  return message.reply({ content, allowedMentions: { parse: [] } });
}
function parseAmount(raw, allowZero = false) {
  const amount = Number(raw);
  if (!Number.isSafeInteger(amount) || amount < (allowZero ? 0 : 1) || amount > 1_000_000_000) throw new Error(`Indique un montant entier entre ${allowZero ? 0 : 1} et 1 000 000 000.`);
  return amount;
}
function getMentionedRole(message, raw) {
  return message.mentions.roles.first() ?? message.guild.roles.cache.get(String(raw ?? "").replace(/[<@&>]/g, ""));
}
function roleIsAssignable(role, bot) {
  return role && !role.managed && role.id !== role.guild.id && role.position < bot.roles.highest.position;
}

const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const activeGameActions = new Set();
function drawCard() { return { rank: RANKS[randomInt(RANKS.length)], suit: SUITS[randomInt(SUITS.length)] }; }
function handValue(cards) {
  let total = 0, aces = 0;
  for (const card of cards) {
    if (card.rank === "A") { total += 11; aces++; }
    else total += ["J", "Q", "K"].includes(card.rank) ? 10 : Number(card.rank);
  }
  while (total > 21 && aces-- > 0) total -= 10;
  return total;
}
function handText(cards, hideHole = false) {
  return cards.map((card, index) => hideHole && index === 1 ? "🂠" : `${card.rank}${card.suit}`).join("  ");
}
function blackjackButtons(gameId, disabled = false) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`economy:bj:${gameId}:hit`).setLabel("Tirer").setEmoji("🃏").setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`economy:bj:${gameId}:stand`).setLabel("Rester").setEmoji("✋").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
  )];
}

function blackjackEmbed(game, reveal = false, result = "À toi de jouer.") {
  return new EmbedBuilder().setColor(0x5865f2).setTitle("🃏 Blackjack · PND")
    .addFields(
      { name: `Ta main (${handValue(game.playerCards)})`, value: handText(game.playerCards), inline: true },
      { name: `Croupier${reveal ? ` (${handValue(game.dealerCards)})` : ""}`, value: handText(game.dealerCards, !reveal), inline: true },
      { name: "Mise", value: format(game.bet), inline: true },
    ).setDescription(result);
}

function settleGame(game, outcome) {
  return transaction(() => {
    const exists = db.prepare("SELECT game_id FROM active_blackjack WHERE game_id=?").get(game.gameId);
    if (!exists) throw new Error("Cette partie est déjà terminée.");
    if (outcome === "win") changeBalance(game.guildId, game.userId, game.bet * 2, "blackjack_win");
    else if (outcome === "blackjack") changeBalance(game.guildId, game.userId, Math.floor(game.bet * 2.5), "blackjack_natural");
    else if (outcome === "push") changeBalance(game.guildId, game.userId, game.bet, "blackjack_push");
    db.prepare("DELETE FROM active_blackjack WHERE game_id=?").run(game.gameId);
  });
}

/** Refund in-progress bets after a crash/restart; no player loses a stake to a process restart. */
export function recoverBlackjackGames() {
  transaction(() => {
    const games = db.prepare("SELECT guild_id,user_id,bet FROM active_blackjack").all();
    for (const game of games) changeBalance(game.guild_id, game.user_id, Number(game.bet), "blackjack_restart_refund");
    db.exec("DELETE FROM active_blackjack");
    db.prepare("DELETE FROM economy_ledger WHERE created_at < ?").run(Date.now() - 365 * 24 * 60 * 60_000);
  });
}

export async function handleEconomyMessage(message) {
  if (!message.guild || !message.member) return false;
  const parts = message.content.trim().split(/\s+/);
  const command = (parts[0] ?? "").toLowerCase();
  const known = new Set(["=balance", "=solde", "=daily", "=pay", "=shop", "=buy", "=inventory", "=leaderboard", "=roulette", "=blackjack", "=pnd"]);
  if (!known.has(command)) return false;
  const gid = message.guild.id, uid = message.author.id;
  try {
    if (command === "=balance" || command === "=solde") {
      const target = message.mentions.users.first() ?? message.author;
      const amount = balance(gid, target.id);
      await safeReply(message, `💰 Solde de ${target.id === uid ? "toi" : mention(target.id)} : **${format(amount)}**.`);
    } else if (command === "=daily") {
      const reward = 100 + randomInt(151), now = Date.now(), cooldown = 20 * 60 * 60_000;
      const claim = transaction(() => {
        const previous = db.prepare("SELECT claimed_at FROM daily_claims WHERE guild_id=? AND user_id=?").get(gid, uid);
        if (previous && now - Number(previous.claimed_at) < cooldown) return { remaining: cooldown - (now - Number(previous.claimed_at)) };
        db.prepare("INSERT INTO daily_claims(guild_id,user_id,claimed_at) VALUES(?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET claimed_at=excluded.claimed_at").run(gid, uid, now);
        changeBalance(gid, uid, reward, "daily_reward");
        return { reward, total: balance(gid, uid) };
      });
      if (claim.remaining) await safeReply(message, `⏳ Ton bonus quotidien est déjà récupéré. Réessaie dans **${Math.ceil(claim.remaining / 3_600_000)} h**.`);
      else await safeReply(message, `🎁 Tu as reçu **${format(claim.reward)}**. Nouveau solde : **${format(claim.total)}**.`);
    } else if (command === "=pay") {
      const target = message.mentions.users.first();
      if (!target || target.bot || target.id === uid) throw new Error("Utilisation : `=pay @membre montant` (membre non-bot, différent de toi).");
      const amount = parseAmount(parts[2]);
      const senderBalance = transaction(() => {
        changeBalance(gid, uid, -amount, "transfer_sent");
        changeBalance(gid, target.id, amount, "transfer_received");
        return balance(gid, uid);
      });
      await safeReply(message, `💸 ${mention(uid)} a envoyé **${format(amount)}** à ${mention(target.id)}. Solde restant : **${format(senderBalance)}**.`);
    } else if (command === "=pnd") {
      if (!admin(message.member)) throw new Error("Cette commande est réservée aux administrateurs et aux membres ayant Gérer le serveur.");
      const action = parts[1]?.toLowerCase(), target = message.mentions.users.first();
      const amount = parseAmount(parts[3], action === "set");
      if (!["add", "remove", "set"].includes(action) || !target || target.bot) throw new Error("Utilisation : `=pnd add|remove|set @membre montant`.");
      const total = transaction(() => {
        if (action === "set") {
          const current = balance(gid, target.id);
          changeBalance(gid, target.id, amount - current, "admin_set");
          return amount;
        }
        return changeBalance(gid, target.id, action === "add" ? amount : -amount, action === "add" ? "admin_add" : "admin_remove");
      });
      await safeReply(message, `✅ Solde de ${mention(target.id)} : **${format(total)}**.`);
    } else if (command === "=shop") {
      if (parts[1]?.toLowerCase() === "add" || parts[1]?.toLowerCase() === "remove") {
        if (!admin(message.member)) throw new Error("Seuls les administrateurs peuvent gérer la boutique.");
        const role = getMentionedRole(message, parts[2]);
        const bot = await message.guild.members.fetchMe();
        if (!roleIsAssignable(role, bot)) throw new Error("Mentionne un rôle achetable situé sous le rôle du bot.");
        if (parts[1].toLowerCase() === "remove") {
          db.prepare("DELETE FROM shop_items WHERE guild_id=? AND role_id=?").run(gid, role.id);
          await safeReply(message, `🗑️ **${role.name}** retiré de la boutique.`);
        } else {
          const price = parseAmount(parts[3]);
          db.prepare("INSERT INTO shop_items(guild_id,role_id,price) VALUES(?,?,?) ON CONFLICT(guild_id,role_id) DO UPDATE SET price=excluded.price").run(gid, role.id, price);
          await safeReply(message, `✅ **${role.name}** ajouté à la boutique pour **${format(price)}**. Utilisation : =buy @${role.name}.`);
        }
      } else {
        const items = db.prepare("SELECT role_id,price FROM shop_items WHERE guild_id=? ORDER BY price ASC LIMIT 25").all(gid);
        if (!items.length) await safeReply(message, "🛍️ La boutique est vide. Un administrateur peut y ajouter des rôles avec `=shop add @Rôle prix`.");
        else {
          const lines = await Promise.all(items.map(async (item) => {
            const role = await message.guild.roles.fetch(item.role_id).catch(() => null);
            return role ? `• **${role.name}** — ${format(item.price)} — commande =buy @${role.name}` : null;
          }));
          await message.reply({ embeds: [new EmbedBuilder().setTitle("🛍️ Boutique PND").setDescription(lines.filter(Boolean).join("\n") || "Aucun rôle disponible.")], allowedMentions: { parse: [] } });
        }
      }
    } else if (command === "=buy") {
      const role = getMentionedRole(message, parts[1]);
      if (!role) throw new Error("Utilisation : `=buy @Rôle`.");
      const bot = await message.guild.members.fetchMe();
      if (!roleIsAssignable(role, bot)) throw new Error("Ce rôle ne peut pas être distribué par le bot.");
      const purchaseKey = `${gid}:${uid}:${role.id}`;
      if (purchaseLocks.has(purchaseKey)) throw new Error("Cet achat est déjà en cours.");
      purchaseLocks.add(purchaseKey);
      try {
        if (message.member.roles.cache.has(role.id)) throw new Error("Tu as déjà ce rôle.");
        const row = db.prepare("SELECT price FROM shop_items WHERE guild_id=? AND role_id=?").get(gid, role.id);
        if (!row) throw new Error("Ce rôle n’est pas dans la boutique.");
        const price = Number(row.price);
        transaction(() => changeBalance(gid, uid, -price, "shop_purchase"));
        try {
          await message.member.roles.add(role, `Achat boutique PND (${price})`);
        } catch {
          const refreshed = await message.guild.members.fetch({ user: uid, force: true }).catch(() => null);
          if (!refreshed?.roles.cache.has(role.id)) {
            transaction(() => changeBalance(gid, uid, price, "shop_refund"));
            throw new Error("Discord n’a pas pu donner le rôle ; le paiement a été remboursé.");
          }
        }
        await safeReply(message, `🎉 Tu as acheté **${role.name}** pour **${format(price)}**.`);
      } finally {
        purchaseLocks.delete(purchaseKey);
      }
    } else if (command === "=inventory") {
      const roles = [...message.member.roles.cache.values()].filter((role) => db.prepare("SELECT 1 FROM shop_items WHERE guild_id=? AND role_id=?").get(gid, role.id));
      await safeReply(message, roles.length ? `🎒 Tes rôles achetés : ${roles.map((role) => `**${role.name}**`).join(", ")}.` : "🎒 Ton inventaire de rôles achetés est vide.");
    } else if (command === "=leaderboard") {
      const leaders = db.prepare("SELECT user_id,balance FROM wallets WHERE guild_id=? AND balance>0 ORDER BY balance DESC LIMIT 10").all(gid);
      const lines = leaders.map((entry, index) => `**${index + 1}.** ${mention(entry.user_id)} — ${format(entry.balance)}`);
      await message.reply({ embeds: [new EmbedBuilder().setTitle("🏆 Classement PND").setDescription(lines.length ? lines.join("\n") : "Aucun portefeuille positif pour le moment.")], allowedMentions: { parse: [] } });
    } else if (command === "=roulette") {
      const bet = parseAmount(parts[1]), choice = parts[2]?.toLowerCase();
      if (!["red", "black", "green", "rouge", "noir", "vert"].includes(choice)) throw new Error("Utilisation : `=roulette mise red|black|green`.");
      const normalized = ({ rouge: "red", noir: "black", vert: "green" })[choice] ?? choice;
      const spin = randomInt(37), color = spin === 0 ? "green" : RED.has(spin) ? "red" : "black";
      const winnings = color === normalized ? bet * (color === "green" ? 36 : 2) : 0;
      const total = transaction(() => { changeBalance(gid, uid, -bet, "roulette_bet"); if (winnings) changeBalance(gid, uid, winnings, "roulette_payout"); return balance(gid, uid); });
      await safeReply(message, `🎡 La bille tombe sur **${spin} ${color}**. ${winnings ? `Tu gagnes **${format(winnings)}** !` : `Tu perds **${format(bet)}**.`} Solde : **${format(total)}**.`);
    } else if (command === "=blackjack") {
      const bet = parseAmount(parts[1]);
      const previousGame = db.prepare("SELECT * FROM active_blackjack WHERE guild_id=? AND user_id=?").get(gid, uid);
      if (previousGame && Date.now() - Number(previousGame.created_at) <= 15 * 60_000) throw new Error("Tu as déjà une partie en cours.");
      if (previousGame) transaction(() => {
        changeBalance(gid, uid, Number(previousGame.bet), "blackjack_timeout_refund");
        db.prepare("DELETE FROM active_blackjack WHERE game_id=?").run(previousGame.game_id);
      });
      const gameId = randomUUID().replaceAll("-", "").slice(0, 20);
      const game = { gameId, guildId: gid, userId: uid, bet, playerCards: [drawCard(), drawCard()], dealerCards: [drawCard(), drawCard()] };
      transaction(() => {
        changeBalance(gid, uid, -bet, "blackjack_bet");
        db.prepare("INSERT INTO active_blackjack(game_id,guild_id,user_id,bet,player_cards,dealer_cards,created_at) VALUES(?,?,?,?,?,?,?)").run(gameId, gid, uid, bet, JSON.stringify(game.playerCards), JSON.stringify(game.dealerCards), Date.now());
      });
      if (handValue(game.playerCards) === 21) {
        settleGame(game, "blackjack");
        await message.reply({ embeds: [blackjackEmbed(game, true, `Blackjack ! Tu gagnes **${format(Math.floor(bet * 1.5))}** de bénéfice.`)], allowedMentions: { parse: [] } });
      } else {
        await message.reply({ embeds: [blackjackEmbed(game)], components: blackjackButtons(gameId), allowedMentions: { parse: [] } });
      }
    }
  } catch (error) {
    await safeReply(message, `❌ ${error.message}`).catch(() => {});
  }
  return true;
}

export async function handleEconomyInteraction(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith("economy:bj:")) return false;
  const [, , gameId, action] = interaction.customId.split(":");
  const row = db.prepare("SELECT * FROM active_blackjack WHERE game_id=?").get(gameId);
  if (!row) { await interaction.reply({ content: "Cette partie a expiré ou a déjà été réglée.", ephemeral: true }); return true; }
  if (interaction.user.id !== row.user_id || interaction.guildId !== row.guild_id) {
    await interaction.reply({ content: "Seule la personne qui a lancé cette partie peut jouer.", ephemeral: true });
    return true;
  }
  if (Date.now() - Number(row.created_at) > 15 * 60_000) {
    await interaction.deferUpdate();
    const refunded = transaction(() => {
      if (!db.prepare("SELECT 1 FROM active_blackjack WHERE game_id=?").get(gameId)) return false;
      changeBalance(row.guild_id, row.user_id, Number(row.bet), "blackjack_timeout_refund");
      db.prepare("DELETE FROM active_blackjack WHERE game_id=?").run(gameId);
      return true;
    });
    await interaction.editReply({ content: refunded ? `⌛ La partie a expiré. Ta mise de ${format(row.bet)} a été rendue.` : "Cette partie a déjà été réglée.", components: [], embeds: [], allowedMentions: { parse: [] } });
    return true;
  }
  if (activeGameActions.has(gameId)) {
    await interaction.reply({ content: "Cette action est déjà en cours.", ephemeral: true });
    return true;
  }
  activeGameActions.add(gameId);
  try {
  await interaction.deferUpdate();
  const game = {
    gameId, guildId: row.guild_id, userId: row.user_id, bet: Number(row.bet),
    playerCards: JSON.parse(row.player_cards), dealerCards: JSON.parse(row.dealer_cards),
  };
  let result = "À toi de jouer.", done = false, outcome = null;
  if (action === "hit") {
    game.playerCards.push(drawCard());
    const value = handValue(game.playerCards);
    if (value > 21) { done = true; outcome = "loss"; result = `Tu dépasses 21 (**${value}**). Tu perds **${format(game.bet)}**.`; }
  } else if (action === "stand") {
    while (handValue(game.dealerCards) < 17) game.dealerCards.push(drawCard());
    const player = handValue(game.playerCards), dealer = handValue(game.dealerCards);
    if (dealer > 21 || player > dealer) { done = true; outcome = "win"; result = `Tu gagnes ! Bénéfice : **${format(game.bet)}**.`; }
    else if (player === dealer) { done = true; outcome = "push"; result = `Égalité : ta mise de **${format(game.bet)}** est rendue.`; }
    else { done = true; outcome = "loss"; result = `Le croupier gagne (${dealer}). Tu perds **${format(game.bet)}**.`; }
  } else {
    await interaction.editReply({ content: "Action inconnue.", components: [] });
    return true;
  }
  if (!done && handValue(game.playerCards) === 21) {
    while (handValue(game.dealerCards) < 17) game.dealerCards.push(drawCard());
    const dealer = handValue(game.dealerCards);
    if (dealer < 21) { done = true; outcome = "win"; result = `21 ! Tu gagnes **${format(game.bet)}**.`; }
    else if (dealer === 21) { done = true; outcome = "push"; result = "Égalité à 21 : ta mise est rendue."; }
  }
  if (done) settleGame(game, outcome);
  else db.prepare("UPDATE active_blackjack SET player_cards=?,dealer_cards=? WHERE game_id=?").run(JSON.stringify(game.playerCards), JSON.stringify(game.dealerCards), gameId);
  await interaction.editReply({ embeds: [blackjackEmbed(game, done, result)], components: blackjackButtons(gameId, done), allowedMentions: { parse: [] } });
  } finally {
    activeGameActions.delete(gameId);
  }
  return true;
}
