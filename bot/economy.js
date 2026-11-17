import { randomInt, randomUUID } from "node:crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { db, transaction } from "./database.js";
import { LOTTERY_MAX_TICKETS, lotteryPayout, robPlan, ticketCost, workReward } from "./economy-policy.js";

const purchaseLocks = new Set();
const MAX_BALANCE = 1_000_000_000_000;

function balance(guildId, userId) {
  db.prepare("INSERT OR IGNORE INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,0,0)").run(guildId, userId);
  return Number(db.prepare("SELECT balance FROM wallets WHERE guild_id=? AND user_id=?").get(guildId, userId).balance);
}

function wallet(guildId, userId) {
  db.prepare("INSERT OR IGNORE INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,0,0)").run(guildId, userId);
  const row = db.prepare("SELECT balance, bank FROM wallets WHERE guild_id=? AND user_id=?").get(guildId, userId);
  return { balance: Number(row.balance), bank: Number(row.bank) };
}

function changeBank(guildId, userId, delta) {
  db.prepare("INSERT OR IGNORE INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,0,0)").run(guildId, userId);
  const current = wallet(guildId, userId);
  if (current.bank + delta < 0) throw new Error("Banque PND insuffisante.");
  if (current.bank + delta > MAX_BALANCE) throw new Error(`La banque ne peut pas dépasser ${format(MAX_BALANCE)}.`);
  db.prepare("UPDATE wallets SET bank=bank+? WHERE guild_id=? AND user_id=?").run(delta, guildId, userId);
}

/** Crédit/débit contrôlé utilisable par les autres modules (jeux, cartes…). */
export function grantPnd(guildId, userId, amount, reason = "module_reward") {
  if (!Number.isSafeInteger(amount) || amount === 0) throw new Error("Montant PND invalide.");
  return transaction(() => changeBalance(guildId, userId, amount, reason));
}

export function pndBalance(guildId, userId) {
  return wallet(guildId, userId);
}

export function cooldownRemaining(guildId, userId, action, now = Date.now()) {
  const row = db.prepare("SELECT ready_at FROM economy_cooldowns WHERE guild_id=? AND user_id=? AND action=?").get(guildId, userId, action);
  return row ? Math.max(0, Number(row.ready_at) - now) : 0;
}

export function setCooldown(guildId, userId, action, readyAt) {
  db.prepare("INSERT INTO economy_cooldowns(guild_id,user_id,action,ready_at) VALUES(?,?,?,?) ON CONFLICT(guild_id,user_id,action) DO UPDATE SET ready_at=excluded.ready_at")
    .run(guildId, userId, action, readyAt);
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
export function recoverBlackjackGames(allowedGuildIds = []) {
  const guildIds = [...new Set(
    (Array.isArray(allowedGuildIds) ? allowedGuildIds : []).filter((id) => typeof id === "string" && /^\\d{5,25}$/.test(id)),
  )];
  if (!guildIds.length) return 0;

  const placeholders = guildIds.map(() => "?").join(",");
  return transaction(() => {
    const games = db.prepare(`SELECT guild_id,user_id,bet FROM active_blackjack WHERE guild_id IN (${placeholders})`).all(...guildIds);
    for (const game of games) changeBalance(game.guild_id, game.user_id, Number(game.bet), "blackjack_restart_refund");
    db.prepare(`DELETE FROM active_blackjack WHERE guild_id IN (${placeholders})`).run(...guildIds);
    db.prepare(`DELETE FROM economy_ledger WHERE guild_id IN (${placeholders}) AND created_at < ?`)
      .run(...guildIds, Date.now() - 365 * 24 * 60 * 60_000);
    return games.length;
  });
}

/**
 * Read-only, bounded mirror of one guild's economy for the V4 dashboard.
 * SQLite stays the source of truth; the dashboard only displays this snapshot.
 */
export function economySnapshot(guildId, guild = null) {
  const totals = db.prepare("SELECT COUNT(*) AS wallets, COALESCE(SUM(balance + bank), 0) AS total FROM wallets WHERE guild_id=?").get(guildId);
  const ledger = db.prepare("SELECT COUNT(*) AS count FROM economy_ledger WHERE guild_id=?").get(guildId);
  const daily = db.prepare("SELECT COUNT(*) AS count FROM daily_claims WHERE guild_id=?").get(guildId);
  const games = db.prepare("SELECT COUNT(*) AS count FROM active_blackjack WHERE guild_id=?").get(guildId);
  const top = db.prepare("SELECT user_id, balance + bank AS balance FROM wallets WHERE guild_id=? AND balance + bank > 0 ORDER BY balance DESC, user_id ASC LIMIT 10").all(guildId);
  const shop = db.prepare("SELECT role_id, price FROM shop_items WHERE guild_id=? ORDER BY price ASC LIMIT 25").all(guildId);

  const displayName = (userId) => {
    const name = guild?.members?.cache?.get(userId)?.displayName;
    return typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : null;
  };

  return {
    guildId,
    guildName: typeof guild?.name === "string" && guild.name.trim() ? guild.name.trim().slice(0, 100) : null,
    totalBalance: Number(totals?.total ?? 0),
    walletCount: Number(totals?.wallets ?? 0),
    ledgerCount: Number(ledger?.count ?? 0),
    dailyClaims: Number(daily?.count ?? 0),
    activeGames: Number(games?.count ?? 0),
    topWallets: top.map((entry) => ({
      userId: entry.user_id,
      displayName: displayName(entry.user_id),
      balance: Number(entry.balance),
    })),
    shopItems: shop.map((item) => {
      const roleName = guild?.roles?.cache?.get(item.role_id)?.name;
      return {
        roleId: item.role_id,
        roleName: typeof roleName === "string" ? roleName.slice(0, 100) : null,
        price: Number(item.price),
      };
    }),
    capturedAt: new Date().toISOString(),
  };
}

export async function handleEconomyMessage(message) {
  if (!message.guild || !message.member) return false;
  const parts = message.content.trim().split(/\s+/);
  const command = (parts[0] ?? "").toLowerCase();
  const known = new Set(["=balance", "=solde", "=daily", "=pay", "=shop", "=buy", "=inventory", "=leaderboard", "=roulette", "=blackjack", "=pnd", "=work", "=bank", "=history", "=rob", "=lottery"]);
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
    } else if (command === "=work") {
      const remaining = cooldownRemaining(gid, uid, "work");
      if (remaining) throw new Error(`⏳ Tu pourras retravailler dans **${Math.ceil(remaining / 60_000)} min**.`);
      const reward = workReward(randomInt(1_000_000) / 1_000_000);
      const total = transaction(() => {
        setCooldown(gid, uid, "work", Date.now() + 60 * 60_000);
        return changeBalance(gid, uid, reward, "work_reward");
      });
      await safeReply(message, `🛠️ Tu as travaillé et gagné **${format(reward)}**. Solde : **${format(total)}**.`);
    } else if (command === "=bank") {
      const action = (parts[1] ?? "solde").toLowerCase();
      if (action === "solde" || action === "balance") {
        const w = wallet(gid, uid);
        await safeReply(message, `🏦 Portefeuille : **${format(w.balance)}** · Banque : **${format(w.bank)}** · Total : **${format(w.balance + w.bank)}**.`);
      } else if (["deposit", "deposer", "déposer"].includes(action)) {
        const amount = parseAmount(parts[2]);
        const w = transaction(() => {
          const current = wallet(gid, uid);
          if (current.balance < amount) throw new Error("Solde PND insuffisant pour ce dépôt.");
          changeBalance(gid, uid, -amount, "bank_deposit");
          changeBank(gid, uid, amount);
          return wallet(gid, uid);
        });
        await safeReply(message, `🏦 **${format(amount)}** déposés en banque. Banque : **${format(w.bank)}**.`);
      } else if (["withdraw", "retirer", "retrait"].includes(action)) {
        const amount = parseAmount(parts[2]);
        const w = transaction(() => {
          changeBank(gid, uid, -amount);
          changeBalance(gid, uid, amount, "bank_withdraw");
          return wallet(gid, uid);
        });
        await safeReply(message, `🏦 **${format(amount)}** retirés de la banque. Portefeuille : **${format(w.balance)}**.`);
      } else {
        throw new Error("Utilisation : `=bank solde|deposit montant|withdraw montant`.");
      }
    } else if (command === "=history") {
      const rows = db.prepare("SELECT delta,reason,created_at FROM economy_ledger WHERE guild_id=? AND user_id=? ORDER BY id DESC LIMIT 10").all(gid, uid);
      const labels = {
        daily_reward: "Bonus quotidien", work_reward: "Travail", transfer_sent: "Transfert envoyé",
        transfer_received: "Transfert reçu", bank_deposit: "Dépôt banque", bank_withdraw: "Retrait banque",
        roulette_bet: "Mise roulette", roulette_payout: "Gain roulette", blackjack_bet: "Mise blackjack",
        blackjack_win: "Gain blackjack", blackjack_natural: "Blackjack", blackjack_push: "Égalité blackjack",
        shop_purchase: "Achat boutique", shop_refund: "Remboursement boutique", rob_success: "Vol réussi",
        rob_failed: "Vol raté", lottery_ticket: "Ticket loterie", lottery_win: "Gain loterie",
      };
      const lines = rows.map((row) => {
        const sign = Number(row.delta) >= 0 ? "+" : "";
        const date = new Date(Number(row.created_at)).toLocaleDateString("fr-FR");
        return `• ${date} — **${sign}${format(row.delta)}** — ${labels[row.reason] ?? row.reason}`;
      });
      await message.reply({ embeds: [new EmbedBuilder().setTitle("📜 Historique PND").setDescription(lines.length ? lines.join("\n") : "Aucun mouvement pour le moment.")], allowedMentions: { parse: [] } });
    } else if (command === "=rob") {
      const target = message.mentions.users.first();
      if (!target || target.bot || target.id === uid) throw new Error("Utilisation : `=rob @membre`.");
      const remaining = cooldownRemaining(gid, uid, "rob");
      if (remaining) throw new Error(`⏳ Tu pourras retenter un vol dans **${Math.ceil(remaining / 60_000)} min**.`);
      const victim = wallet(gid, target.id).balance;
      const plan = robPlan({ victimBalance: victim, ownBalance: wallet(gid, uid).balance, roll: randomInt(1_000_000) / 1_000_000 });
      if (!plan.allowed) throw new Error("Cette personne n’a pas assez de PND à voler.");
      const outcome = transaction(() => {
        setCooldown(gid, uid, "rob", Date.now() + 2 * 60 * 60_000);
        if (plan.success) {
          changeBalance(gid, target.id, -plan.amount, "rob_victim");
          return { total: changeBalance(gid, uid, plan.amount, "rob_success"), fine: 0 };
        }
        if (plan.fine > 0) {
          changeBalance(gid, uid, -plan.fine, "rob_failed");
          changeBalance(gid, target.id, plan.fine, "rob_restitution");
        }
        return { total: wallet(gid, uid).balance, fine: plan.fine };
      });
      await safeReply(message, plan.success
        ? `🕵️ Tu as volé **${format(plan.amount)}** à ${mention(target.id)}. Solde : **${format(outcome.total)}**.`
        : `🚨 Vol raté ! Tu as dû rendre **${format(outcome.fine)}** à ${mention(target.id)}. Solde : **${format(outcome.total)}**.`);
    } else if (command === "=lottery") {
      const action = (parts[1] ?? "info").toLowerCase();
      const openDraw = () => db.prepare("SELECT * FROM lottery_draws WHERE guild_id=? AND winner_id IS NULL ORDER BY id DESC LIMIT 1").get(gid);
      if (action === "buy" || action === "acheter") {
        const { tickets: count, cost } = ticketCost(Number.parseInt(parts[2] ?? "1", 10) || 1);
        const result = transaction(() => {
          let draw = openDraw();
          if (!draw) {
            const info = db.prepare("INSERT INTO lottery_draws(guild_id,pot,winner_id,created_at) VALUES(?,?,NULL,?)").run(gid, 0, Date.now());
            draw = { id: Number(info.lastInsertRowid), pot: 0 };
          }
          const mine = db.prepare("SELECT COUNT(*) AS count FROM lottery_tickets WHERE guild_id=? AND draw_id=? AND user_id=?").get(gid, draw.id, uid).count;
          if (Number(mine) + count > LOTTERY_MAX_TICKETS) throw new Error(`Maximum ${LOTTERY_MAX_TICKETS} tickets par personne et par tirage.`);
          changeBalance(gid, uid, -cost, "lottery_ticket");
          for (let i = 0; i < count; i++) db.prepare("INSERT INTO lottery_tickets(guild_id,user_id,draw_id,created_at) VALUES(?,?,?,?)").run(gid, uid, draw.id, Date.now());
          db.prepare("UPDATE lottery_draws SET pot=pot+? WHERE id=?").run(cost, draw.id);
          return { tickets: Number(mine) + count, pot: Number(draw.pot) + cost };
        });
        await safeReply(message, `🎟️ **${count}** ticket(s) acheté(s) pour **${format(cost)}**. Tu as **${result.tickets}/${LOTTERY_MAX_TICKETS}** tickets. Cagnotte : **${format(result.pot)}**.`);
      } else if (action === "draw" || action === "tirage") {
        if (!admin(message.member)) throw new Error("Seuls les administrateurs peuvent lancer le tirage.");
        const draw = openDraw();
        if (!draw) throw new Error("Aucun tirage en cours.");
        const tickets = db.prepare("SELECT user_id FROM lottery_tickets WHERE draw_id=?").all(draw.id);
        if (!tickets.length) throw new Error("Aucun ticket vendu pour ce tirage.");
        const winner = tickets[randomInt(tickets.length)].user_id;
        const payout = lotteryPayout(draw.pot);
        transaction(() => {
          db.prepare("UPDATE lottery_draws SET winner_id=? WHERE id=? AND winner_id IS NULL").run(winner, draw.id);
          changeBalance(gid, winner, payout, "lottery_win");
        });
        await safeReply(message, `🎉 Le tirage est terminé ! ${mention(winner)} remporte **${format(payout)}** sur une cagnotte de **${format(draw.pot)}**.`);
      } else {
        const draw = openDraw();
        const count = draw ? db.prepare("SELECT COUNT(*) AS count FROM lottery_tickets WHERE draw_id=?").get(draw.id).count : 0;
        await message.reply({ embeds: [new EmbedBuilder().setTitle("🎟️ Loterie PND").setDescription(draw
          ? `Cagnotte : **${format(draw.pot)}**\nTickets vendus : **${count}**\nPrix du ticket : **100 PND**\n\nAchète avec \`=lottery buy [1-10]\`.`
          : "Aucun tirage en cours. Achète un ticket avec `=lottery buy` pour lancer la cagnotte.")], allowedMentions: { parse: [] } });
      }
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
