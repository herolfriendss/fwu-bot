// Her? V4 — collection de cartes et échanges entre membres.
import { randomInt, randomUUID } from "node:crypto";
import { EmbedBuilder } from "discord.js";
import { db, transaction } from "./database.js";
import { CARDS, CARDS_BY_ID, RARITIES } from "./cards-data.js";
import {
  PACK_COST, PACK_SIZE, TRADE_TTL_MS, cardForRarity, collectionValue, normalizeCardId, packValue, rarityForRoll, tradeIsValid,
} from "./cards-policy.js";
import { grantPnd } from "./economy.js";

function mention(id) { return `<@${id}>`; }
function owned(guildId, userId, cardId) {
  const row = db.prepare("SELECT quantity FROM user_cards WHERE guild_id=? AND user_id=? AND card_id=?").get(guildId, userId, cardId);
  return Number(row?.quantity ?? 0);
}
function addCard(guildId, userId, cardId, amount = 1) {
  db.prepare(`INSERT INTO user_cards(guild_id,user_id,card_id,quantity,acquired_at) VALUES(?,?,?,?,?)
    ON CONFLICT(guild_id,user_id,card_id) DO UPDATE SET quantity=quantity+excluded.quantity`)
    .run(guildId, userId, cardId, amount, Date.now());
}
function removeCard(guildId, userId, cardId, amount = 1) {
  const current = owned(guildId, userId, cardId);
  if (current < amount) throw new Error("Tu ne possèdes pas cette carte.");
  if (current === amount) db.prepare("DELETE FROM user_cards WHERE guild_id=? AND user_id=? AND card_id=?").run(guildId, userId, cardId);
  else db.prepare("UPDATE user_cards SET quantity=quantity-? WHERE guild_id=? AND user_id=? AND card_id=?").run(amount, guildId, userId, cardId);
}
function cardLine(card, quantity = 1) {
  const rarity = RARITIES[card.rarity];
  return `${card.emoji} **${card.name}** · ${rarity.label}${quantity > 1 ? ` ×${quantity}` : ""}`;
}

export async function handleCardsMessage(message) {
  if (!message.guild || !message.member) return false;
  const parts = message.content.trim().split(/\s+/);
  const command = (parts[0] ?? "").toLowerCase();
  if (!["=cards", "=card", "=pack", "=trade", "=trades"].includes(command)) return false;
  const gid = message.guild.id;
  const uid = message.author.id;

  try {
    if (command === "=cards") {
      const user = message.mentions.users.first() ?? message.author;
      const rows = db.prepare("SELECT card_id,quantity FROM user_cards WHERE guild_id=? AND user_id=? ORDER BY card_id").all(gid, user.id);
      const total = rows.reduce((sum, row) => sum + Number(row.quantity), 0);
      const lines = rows.slice(0, 30).map((row) => {
        const card = CARDS_BY_ID.get(row.card_id);
        return card ? cardLine(card, Number(row.quantity)) : null;
      }).filter(Boolean);
      await message.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xa855f7)
          .setTitle(`🃏 Collection de ${user.username}`)
          .setDescription(lines.length ? lines.join("\n") : "_Aucune carte. Ouvre un pack avec `/pack`._")
          .setFooter({ text: `${total} carte(s) · valeur ${collectionValue(rows).toLocaleString("fr-FR")} PND` })],
        allowedMentions: { parse: [] },
      });
    } else if (command === "=card") {
      const cardId = normalizeCardId(parts[1]);
      const card = CARDS_BY_ID.get(cardId);
      if (!card) throw new Error(`Carte inconnue. IDs : ${CARDS.map((c) => c.id).join(", ")}`);
      const rarity = RARITIES[card.rarity];
      await message.reply({
        embeds: [new EmbedBuilder()
          .setColor(rarity.color)
          .setTitle(`${card.emoji} ${card.name}`)
          .addFields(
            { name: "Rareté", value: rarity.label, inline: true },
            { name: "Valeur", value: `${rarity.value.toLocaleString("fr-FR")} PND`, inline: true },
            { name: "Possédée", value: `×${owned(gid, uid, card.id)}`, inline: true },
            { name: "Identifiant", value: card.id, inline: true },
          )],
        allowedMentions: { parse: [] },
      });
    } else if (command === "=pack") {
      const pack = transaction(() => {
        grantPnd(gid, uid, -PACK_COST, "card_pack");
        const drawn = [];
        for (let i = 0; i < PACK_SIZE; i++) {
          const rarity = rarityForRoll(randomInt(1_000_000) / 1_000_000);
          const pool = CARDS.filter((card) => card.rarity === rarity);
          const card = pool[randomInt(pool.length)];
          addCard(gid, uid, card.id);
          drawn.push(card);
        }
        return drawn;
      });
      await message.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xa855f7)
          .setTitle("🎁 Pack ouvert !")
          .setDescription(pack.map((card) => cardLine(card)).join("\n"))
          .setFooter({ text: `Coût : ${PACK_COST} PND · valeur du pack : ${packValue(pack).toLocaleString("fr-FR")} PND` })],
        allowedMentions: { parse: [] },
      });
    } else if (command === "=trade") {
      const action = (parts[1] ?? "liste").toLowerCase();
      if (action === "propose" || action === "proposer") {
        const target = message.mentions.users.first();
        if (!target || target.bot || target.id === uid) throw new Error("Utilisation : `=trade propose @membre offre demande`.");
        const offerId = normalizeCardId(parts[2]);
        const requestId = normalizeCardId(parts[3]);
        const offer = CARDS_BY_ID.get(offerId);
        const request = CARDS_BY_ID.get(requestId);
        if (!offer || !request) throw new Error("Les deux identifiants de carte doivent exister (voir `/cards`).");
        if (!owned(gid, uid, offerId)) throw new Error("Tu ne possèdes pas la carte proposée.");
        const tradeId = randomUUID().slice(0, 8);
        const now = Date.now();
        db.prepare("INSERT INTO card_trades(trade_id,guild_id,from_id,to_id,offer_card_id,request_card_id,status,created_at,expires_at) VALUES(?,?,?,?,?,?, 'pending',?,?)")
          .run(tradeId, gid, uid, target.id, offerId, requestId, now, now + TRADE_TTL_MS);
        await message.reply({
          content: `🤝 **Échange ${tradeId}** : ${mention(uid)} propose ${offer.emoji} **${offer.name}** contre ${request.emoji} **${request.name}** de ${mention(target.id)}.\n${mention(target.id)}, accepte avec \`=trade accept ${tradeId}\` (10 minutes).`,
          allowedMentions: { parse: ["users"] },
        });
      } else if (action === "accept" || action === "accepter") {
        const tradeId = String(parts[2] ?? "").toLowerCase();
        const trade = db.prepare("SELECT * FROM card_trades WHERE trade_id=? AND guild_id=?").get(tradeId, gid);
        const validity = tradeIsValid({ trade, traderId: uid });
        if (!validity.allowed) throw new Error(validity.reason);
        const offer = CARDS_BY_ID.get(trade.offer_card_id);
        const request = CARDS_BY_ID.get(trade.request_card_id);
        if (!offer || !request) throw new Error("Carte introuvable.");
        transaction(() => {
          if (!owned(gid, trade.from_id, trade.offer_card_id)) throw new Error("Le proposeur ne possède plus cette carte.");
          if (!owned(gid, uid, trade.request_card_id)) throw new Error("Tu ne possèdes plus la carte demandée.");
          removeCard(gid, trade.from_id, trade.offer_card_id);
          removeCard(gid, uid, trade.request_card_id);
          addCard(gid, uid, trade.offer_card_id);
          addCard(gid, trade.from_id, trade.request_card_id);
          db.prepare("UPDATE card_trades SET status='completed' WHERE trade_id=?").run(tradeId);
        });
        await message.reply({ content: `✅ Échange ${tradeId} accepté : ${offer.emoji} **${offer.name}** ↔ ${request.emoji} **${request.name}**.`, allowedMentions: { parse: [] } });
      } else if (action === "cancel" || action === "annuler") {
        const tradeId = String(parts[2] ?? "").toLowerCase();
        const trade = db.prepare("SELECT * FROM card_trades WHERE trade_id=? AND guild_id=?").get(tradeId, gid);
        if (!trade || trade.status !== "pending" || trade.from_id !== uid) throw new Error("Tu ne peux pas annuler cet échange.");
        db.prepare("UPDATE card_trades SET status='cancelled' WHERE trade_id=?").run(tradeId);
        await message.reply({ content: `🗑️ Échange ${tradeId} annulé.`, allowedMentions: { parse: [] } });
      } else {
        throw new Error("Utilisation : `=trade propose|accept|cancel` ou `=trades`.");
      }
    } else if (command === "=trades") {
      const rows = db.prepare("SELECT * FROM card_trades WHERE guild_id=? AND status='pending' AND (from_id=? OR to_id=?) AND expires_at>? ORDER BY created_at DESC LIMIT 10")
        .all(gid, uid, uid, Date.now());
      const lines = rows.map((trade) => {
        const offer = CARDS_BY_ID.get(trade.offer_card_id);
        const request = CARDS_BY_ID.get(trade.request_card_id);
        const direction = trade.from_id === uid ? `vers ${mention(trade.to_id)}` : `de ${mention(trade.from_id)}`;
        return `• \`${trade.trade_id}\` ${direction} — ${offer?.emoji ?? "?"} ${offer?.name ?? trade.offer_card_id} ↔ ${request?.emoji ?? "?"} ${request?.name ?? trade.request_card_id}`;
      });
      await message.reply({
        embeds: [new EmbedBuilder().setColor(0xa855f7).setTitle("🤝 Échanges en attente").setDescription(lines.length ? lines.join("\n") : "Aucun échange en attente.")],
        allowedMentions: { parse: [] },
      });
    }
  } catch (error) {
    await message.reply({ content: `❌ ${error.message}`, allowedMentions: { parse: [] } }).catch(() => {});
  }
  return true;
}
