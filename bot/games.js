// Her? V4 — jeux et événements : dés, pile ou face, trivia, giveaways, events.
//
// Les parties sont isolées par serveur : chaque sélection SQLite filtre
// `guild_id`, et les boutons vérifient le serveur avant toute récompense.
import { randomInt, randomUUID } from "node:crypto";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits,
} from "discord.js";
import { db, transaction } from "./database.js";
import { parseDuration } from "./moderation-policy.js";
import { grantPnd, pndBalance } from "./economy.js";
import {
  COINFLIP_MAX_BET, COINFLIP_MIN_BET, GIVEAWAY_MAX_WINNERS, TRIVIA_REWARD,
  checkTriviaAnswer, clampInt, coinflipPlan, drawGiveawayWinners, parseEventDate,
  pickTriviaQuestion, rollDice,
} from "./games-policy.js";

const P = PermissionFlagsBits;
const triviaSessions = new Map();
const GAME_COMMANDS = new Set(["dice", "coinflip", "trivia", "giveaway", "event"]);

function mention(id) { return `<@${id}>`; }
function format(value) { return `${Number(value).toLocaleString("fr-FR")} PND`; }
function random() { return randomInt(1_000_000) / 1_000_000; }

function canManageGuild(guild, member) {
  return guild.ownerId === member.id || member.permissions.has(P.ManageGuild) || member.permissions.has(P.Administrator);
}

function diceEmbed(result) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🎲 Lancer de dés")
    .setDescription(result.values.map((value) => `**${value}**`).join(" · "))
    .addFields(
      { name: "Dés", value: String(result.values.length), inline: true },
      { name: "Faces", value: String(result.faces), inline: true },
      { name: "Total", value: String(result.total), inline: true },
    );
}

function giveawayEmbed(row, entryCount = 0) {
  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle("🎉 Giveaway")
    .setDescription(`**${row.prize}**\n\nClique sur **Participer** pour tenter ta chance !`)
    .addFields(
      { name: "Gagnants", value: String(row.winner_count), inline: true },
      { name: "Participants", value: String(entryCount), inline: true },
      { name: "Fin", value: `<t:${Math.floor(Number(row.ends_at) / 1000)}:R>`, inline: true },
      { name: "Hôte", value: mention(row.host_id), inline: true },
    )
    .setFooter({ text: `Giveaway ${row.giveaway_id}` })
    .setTimestamp(new Date());
}

function giveawayButton(giveawayId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`giveaway:enter:${giveawayId}`).setLabel("Participer").setEmoji("🎉").setStyle(ButtonStyle.Success),
  );
}

function entryCount(giveawayId) {
  return Number(db.prepare("SELECT COUNT(*) AS count FROM giveaway_entries WHERE giveaway_id=?").get(giveawayId).count);
}

function createGiveaway({ guildId, channelId, messageId, prize, hostId, durationMinutes, winnerCount }) {
  const id = randomUUID().slice(0, 8);
  const now = Date.now();
  const row = {
    giveaway_id: id,
    guild_id: guildId,
    channel_id: channelId,
    message_id: messageId ?? null,
    prize,
    host_id: hostId,
    ends_at: now + Math.min(10_080, Math.max(1, durationMinutes)) * 60_000,
    winner_count: clampInt(winnerCount, 1, GIVEAWAY_MAX_WINNERS, 1),
  };
  db.prepare(`INSERT INTO giveaways(giveaway_id,guild_id,channel_id,message_id,prize,host_id,ends_at,winner_count,status,created_at)
    VALUES(?,?,?,?,?,?,?,?, 'open', ?)`)
    .run(row.giveaway_id, guildId, channelId, row.message_id, prize, hostId, row.ends_at, row.winner_count, now);
  return row;
}

function closeGiveaway(giveawayId, guildId) {
  return transaction(() => {
    const row = db.prepare("SELECT * FROM giveaways WHERE giveaway_id=? AND guild_id=?").get(giveawayId, guildId);
    if (!row || row.status !== "open") return null;
    const entries = db.prepare("SELECT user_id FROM giveaway_entries WHERE giveaway_id=?").all(giveawayId);
    const winners = drawGiveawayWinners(entries, Number(row.winner_count), random);
    db.prepare("UPDATE giveaways SET status='finished' WHERE giveaway_id=? AND status='open'").run(giveawayId);
    return { row, winners };
  });
}

async function announceGiveaway({ channel, row, winners }) {
  const result = winners.length
    ? `🎉 Félicitations ${winners.map(mention).join(", ")} ! Vous remportez **${row.prize}**.`
    : "😢 Aucun participant : le giveaway est terminé sans gagnant.";
  if (channel?.isTextBased()) {
    await channel.send({ content: result, allowedMentions: { parse: ["users"] } }).catch(() => {});
    const message = row.message_id ? await channel.messages.fetch(row.message_id).catch(() => null) : null;
    if (message) {
      await message.edit({
        embeds: [new EmbedBuilder()
          .setColor(0x6b7280)
          .setTitle("🎉 Giveaway terminé")
          .setDescription(`**${row.prize}**\n\n${winners.length ? `Gagnant(s) : ${winners.map(mention).join(", ")}` : "Aucun participant."}`)
          .setTimestamp(new Date())],
        components: [],
      }).catch(() => {});
    }
  }
}

async function finishDueGiveaways(client, record = () => {}) {
  const due = db.prepare("SELECT * FROM giveaways WHERE status='open' AND ends_at<=? ORDER BY ends_at ASC LIMIT 10").all(Date.now());
  for (const giveaway of due) {
    const closed = closeGiveaway(giveaway.giveaway_id, giveaway.guild_id);
    if (!closed) continue;
    try {
      const channel = await client.channels.fetch(closed.row.channel_id).catch(() => null);
      await announceGiveaway({ channel, row: closed.row, winners: closed.winners });
      record("giveaway_finished");
    } catch {
      record("giveaway_error");
    }
  }
}

async function announceDueEvents(client, record = () => {}) {
  const due = db.prepare("SELECT * FROM events WHERE notified=0 AND starts_at<=? ORDER BY starts_at ASC LIMIT 10").all(Date.now());
  for (const event of due) {
    db.prepare("UPDATE events SET notified=1 WHERE id=?").run(event.id);
    const channelId = event.channel_id;
    if (!channelId) continue;
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel?.isTextBased()) {
        await channel.send({
          content: `📅 **${event.title}** commence maintenant !\n${event.description || ""}\nOrganisé par ${mention(event.host_id)}.`,
          allowedMentions: { parse: [] },
        }).catch(() => {});
      }
      record("event_started");
    } catch {
      record("event_error");
    }
  }
}

export function startGamesScheduler(client, record = () => {}) {
  const timer = setInterval(() => {
    void finishDueGiveaways(client, record);
    void announceDueEvents(client, record);
  }, 30_000);
  timer.unref?.();
  return timer;
}

async function publishTrivia({ guildId, send, record = () => {} }) {
  const question = pickTriviaQuestion(random);
  const id = randomUUID().slice(0, 8);
  const session = { guildId, answer: question.answer, expiresAt: Date.now() + 60_000, solved: false };
  triviaSessions.set(id, session);
  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle("🧠 Trivia")
    .setDescription(`**${question.question}**\n\nRéponds avec un bouton. Première bonne réponse : **${format(TRIVIA_REWARD)}**.`)
    .setFooter({ text: "Tu as 60 secondes." });
  const row = new ActionRowBuilder().addComponents(
    ...question.choices.map((choice, index) => new ButtonBuilder()
      .setCustomId(`trivia:${id}:${index}`)
      .setLabel(choice.slice(0, 80))
      .setStyle(ButtonStyle.Secondary)),
  );
  const message = await send({ embeds: [embed], components: [row] });
  session.messageId = message?.id ?? null;
  const timer = setTimeout(() => triviaSessions.delete(id), 5 * 60_000);
  timer.unref?.();
  record("trivia_started");
  return { id, question };
}

async function handleTriviaButton(interaction, record = () => {}) {
  const [, id, index] = interaction.customId.split(":");
  const session = triviaSessions.get(id);
  if (!session || session.guildId !== interaction.guildId) {
    await interaction.reply({ content: "Cette trivia n’existe plus.", ephemeral: true });
    return true;
  }
  if (session.expiresAt < Date.now()) {
    triviaSessions.delete(id);
    await interaction.reply({ content: "⏳ Le temps est écoulé.", ephemeral: true });
    return true;
  }
  if (session.solved) {
    await interaction.reply({ content: "✅ Cette trivia a déjà été résolue.", ephemeral: true });
    return true;
  }
  const question = { answer: session.answer };
  if (!checkTriviaAnswer(question, index)) {
    await interaction.reply({ content: "❌ Mauvaise réponse, réessaie !", ephemeral: true });
    return true;
  }
  session.solved = true;
  try {
    grantPnd(interaction.guildId, interaction.user.id, TRIVIA_REWARD, "trivia_reward");
    record("trivia_solved");
  } catch {
    await interaction.reply({ content: "✅ Bonne réponse, mais la récompense n’a pas pu être versée.", ephemeral: true });
    return true;
  }
  const answer = ["A", "B", "C", "D"][session.answer] ?? String(session.answer);
  await interaction.message.edit({
    embeds: [new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("🧠 Trivia résolue")
      .setDescription(`Bonne réponse : **${answer}**.\n${mention(interaction.user.id)} remporte **${format(TRIVIA_REWARD)}**.`)],
    components: [],
  }).catch(() => {});
  await interaction.reply({ content: `✅ Bonne réponse ! +${format(TRIVIA_REWARD)}.`, ephemeral: true });
  return true;
}

async function handleGiveawayButton(interaction) {
  const giveawayId = interaction.customId.split(":")[2];
  const row = db.prepare("SELECT * FROM giveaways WHERE giveaway_id=? AND guild_id=?").get(giveawayId, interaction.guildId);
  if (!row || row.status !== "open" || Number(row.ends_at) <= Date.now()) {
    await interaction.reply({ content: "Ce giveaway est terminé.", ephemeral: true });
    return true;
  }
  const result = db.prepare("INSERT OR IGNORE INTO giveaway_entries(giveaway_id,user_id,created_at) VALUES(?,?,?)")
    .run(giveawayId, interaction.user.id, Date.now());
  await interaction.reply({
    content: result.changes ? "🎉 Participation enregistrée ! Bonne chance." : "Tu participes déjà à ce giveaway.",
    ephemeral: true,
  });
  return true;
}

export async function handleGamesInteraction(interaction, guildSettings = {}, record = () => {}) {
  if (interaction.isButton() && interaction.customId.startsWith("trivia:")) return handleTriviaButton(interaction, record);
  if (interaction.isButton() && interaction.customId.startsWith("giveaway:enter:")) return handleGiveawayButton(interaction);
  if (!interaction.isChatInputCommand() || !GAME_COMMANDS.has(interaction.commandName)) return false;
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Cette commande doit être utilisée sur un serveur.", ephemeral: true });
    return true;
  }
  const member = interaction.member ?? await guild.members.fetch(interaction.user.id).catch(() => null);
  const command = interaction.commandName;

  try {
    if (command === "dice") {
      const result = rollDice(interaction.options.getInteger("faces") ?? 6, interaction.options.getInteger("nombre") ?? 1, random);
      await interaction.reply({ embeds: [diceEmbed(result)], allowedMentions: { parse: [] } });
      return true;
    }

    if (command === "coinflip") {
      const bet = interaction.options.getInteger("mise", true);
      const choice = interaction.options.getString("face") ?? "pile";
      const wallet = pndBalance(guild.id, interaction.user.id);
      if (wallet.balance < bet) throw new Error(`Solde insuffisant : tu as ${format(wallet.balance)}.`);
      const plan = coinflipPlan({ bet, choice, random: random() });
      if (!plan.allowed) throw new Error(plan.reason);
      grantPnd(guild.id, interaction.user.id, -plan.bet, "coinflip_bet");
      if (plan.won) grantPnd(guild.id, interaction.user.id, plan.payout, "coinflip_win");
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(plan.won ? 0x22c55e : 0xef4444)
          .setTitle(plan.won ? "🪙 Pile ou face — gagné !" : "🪙 Pile ou face — perdu")
          .setDescription(`Résultat : **${plan.result}** · Ton choix : **${plan.choice}**`)
          .addFields(
            { name: "Mise", value: format(plan.bet), inline: true },
            { name: plan.won ? "Gain" : "Perte", value: format(plan.won ? plan.payout : plan.bet), inline: true },
          )],
        allowedMentions: { parse: [] },
      });
      return true;
    }

    if (command === "trivia") {
      await interaction.reply({ content: "Préparation de la trivia…", ephemeral: true });
      await publishTrivia({
        guildId: guild.id,
        send: (payload) => interaction.channel.send(payload),
        record,
      });
      return true;
    }

    if (command === "giveaway") {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "start") {
        if (!canManageGuild(guild, member)) throw new Error("Permission Gérer le serveur requise.");
        const prize = interaction.options.getString("prix", true);
        const minutes = parseDuration(interaction.options.getString("duree", true), 60);
        const winners = interaction.options.getInteger("gagnants") ?? 1;
        if (!interaction.channel?.isTextBased()) throw new Error("Ce salon ne permet pas les giveaways.");
        const draft = createGiveaway({ guildId: guild.id, channelId: interaction.channel.id, prize, hostId: interaction.user.id, durationMinutes: minutes, winnerCount: winners });
        const message = await interaction.reply({
          embeds: [giveawayEmbed(draft)],
          components: [giveawayButton(draft.giveaway_id)],
          fetchReply: true,
          allowedMentions: { parse: [] },
        });
        db.prepare("UPDATE giveaways SET message_id=? WHERE giveaway_id=?").run(message.id, draft.giveaway_id);
        record("giveaway_created");
        return true;
      }
      if (subcommand === "end") {
        const giveawayId = interaction.options.getString("id", true).trim();
        const row = db.prepare("SELECT * FROM giveaways WHERE giveaway_id=? AND guild_id=?").get(giveawayId, guild.id);
        if (!row) throw new Error("Giveaway introuvable sur ce serveur.");
        if (row.host_id !== interaction.user.id && !canManageGuild(guild, member)) throw new Error("Seul l’hôte ou le staff peut terminer ce giveaway.");
        const closed = closeGiveaway(giveawayId, guild.id);
        if (!closed) throw new Error("Ce giveaway est déjà terminé.");
        await interaction.reply({ content: "Giveaway terminé.", ephemeral: true });
        await announceGiveaway({ channel: interaction.channel, row: closed.row, winners: closed.winners });
        record("giveaway_finished");
        return true;
      }
      const rows = db.prepare("SELECT * FROM giveaways WHERE guild_id=? ORDER BY created_at DESC LIMIT 10").all(guild.id);
      const lines = rows.map((row) => `• \`${row.giveaway_id}\` — **${row.prize}** · ${row.status} · fin <t:${Math.floor(Number(row.ends_at) / 1000)}:R>`);
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xf59e0b).setTitle("🎉 Giveaways du serveur").setDescription(lines.length ? lines.join("\n") : "Aucun giveaway.")],
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return true;
    }

    if (command === "event") {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "creer") {
        if (!canManageGuild(guild, member)) throw new Error("Permission Gérer le serveur requise.");
        const title = interaction.options.getString("titre", true).slice(0, 100);
        const startsAt = parseEventDate(interaction.options.getString("date", true));
        if (!startsAt) throw new Error("Date invalide. Utilise `JJ/MM/AAAA HH:mm` ou une date ISO future.");
        const description = (interaction.options.getString("description") ?? "").slice(0, 1000);
        db.prepare("INSERT INTO events(guild_id,title,description,starts_at,host_id,channel_id,notified,created_at) VALUES(?,?,?,?,?,?,0,?)")
          .run(guild.id, title, description, startsAt, interaction.user.id, interaction.channelId, Date.now());
        record("event_created");
        await interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x3b82f6)
            .setTitle("📅 Événement créé")
            .setDescription(`**${title}**\n${description || "_Sans description._"}`)
            .addFields(
              { name: "Début", value: `<t:${Math.floor(startsAt / 1000)}:F>`, inline: true },
              { name: "Organisateur", value: mention(interaction.user.id), inline: true },
            )],
          allowedMentions: { parse: [] },
        });
        return true;
      }
      if (subcommand === "supprimer") {
        const id = interaction.options.getInteger("id", true);
        const row = db.prepare("SELECT * FROM events WHERE id=? AND guild_id=?").get(id, guild.id);
        if (!row) throw new Error("Événement introuvable sur ce serveur.");
        if (row.host_id !== interaction.user.id && !canManageGuild(guild, member)) throw new Error("Seul l’organisateur ou le staff peut supprimer cet événement.");
        db.prepare("DELETE FROM events WHERE id=? AND guild_id=?").run(id, guild.id);
        await interaction.reply({ content: `🗑️ Événement **${row.title}** supprimé.`, ephemeral: true, allowedMentions: { parse: [] } });
        return true;
      }
      const rows = db.prepare("SELECT * FROM events WHERE guild_id=? AND starts_at>? ORDER BY starts_at ASC LIMIT 10").all(guild.id, Date.now() - 3_600_000);
      const lines = rows.map((row) => `• \`#${row.id}\` **${row.title}** — <t:${Math.floor(Number(row.starts_at) / 1000)}:F>`);
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x3b82f6).setTitle("📅 Prochains événements").setDescription(lines.length ? lines.join("\n") : "Aucun événement prévu.")],
        allowedMentions: { parse: [] },
      });
      return true;
    }
  } catch (error) {
    const content = `❌ ${error instanceof Error ? error.message : "Action impossible."}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {});
    else await interaction.reply({ content, ephemeral: true }).catch(() => {});
    return true;
  }
  return true;
}

export async function handleGamesMessage(message, record = () => {}) {
  if (!message.guild || !message.member) return false;
  const parts = message.content.trim().split(/\s+/);
  const command = (parts[0] ?? "").toLowerCase();
  if (!["=dice", "=coinflip", "=trivia", "=giveaway", "=event"].includes(command)) return false;
  const gid = message.guild.id;
  const uid = message.author.id;

  try {
    if (command === "=dice") {
      const result = rollDice(Number(parts[1]) || 6, Number(parts[2]) || 1, random);
      await message.reply({ embeds: [diceEmbed(result)], allowedMentions: { parse: [] } });
    } else if (command === "=coinflip") {
      const plan = coinflipPlan({ bet: Number(parts[1]) || 0, choice: (parts[2] ?? "pile").toLowerCase(), random: random() });
      if (!plan.allowed) throw new Error(plan.reason);
      const wallet = pndBalance(gid, uid);
      if (wallet.balance < plan.bet) throw new Error(`Solde insuffisant : tu as ${format(wallet.balance)}.`);
      grantPnd(gid, uid, -plan.bet, "coinflip_bet");
      if (plan.won) grantPnd(gid, uid, plan.payout, "coinflip_win");
      await message.reply({
        content: `🪙 **${plan.result}** — ${plan.won ? `gagné **${format(plan.payout)}** !` : `perdu **${format(plan.bet)}**.`}`,
        allowedMentions: { parse: [] },
      });
    } else if (command === "=trivia") {
      await publishTrivia({ guildId: gid, send: (payload) => message.reply(payload), record });
    } else if (command === "=giveaway") {
      const action = (parts[1] ?? "liste").toLowerCase();
      if (action === "start" || action === "creer" || action === "créer") {
        if (!canManageGuild(message.guild, message.member)) throw new Error("Permission Gérer le serveur requise.");
        const minutes = parseDuration(parts[2], 60);
        const winners = clampInt(parts[3], 1, GIVEAWAY_MAX_WINNERS, 1);
        const prize = parts.slice(4).join(" ").slice(0, 200);
        if (!prize) throw new Error("Utilisation : `=giveaway start durée gagnants prix`.");
        const draft = createGiveaway({ guildId: gid, channelId: message.channel.id, prize, hostId: uid, durationMinutes: minutes, winnerCount: winners });
        const sent = await message.reply({ embeds: [giveawayEmbed(draft)], components: [giveawayButton(draft.giveaway_id)], allowedMentions: { parse: [] } });
        db.prepare("UPDATE giveaways SET message_id=? WHERE giveaway_id=?").run(sent.id, draft.giveaway_id);
        record("giveaway_created");
      } else if (action === "end" || action === "fin") {
        const giveawayId = String(parts[2] ?? "").toLowerCase();
        const row = db.prepare("SELECT * FROM giveaways WHERE giveaway_id=? AND guild_id=?").get(giveawayId, gid);
        if (!row) throw new Error("Giveaway introuvable sur ce serveur.");
        if (row.host_id !== uid && !canManageGuild(message.guild, message.member)) throw new Error("Seul l’hôte ou le staff peut terminer ce giveaway.");
        const closed = closeGiveaway(giveawayId, gid);
        if (!closed) throw new Error("Ce giveaway est déjà terminé.");
        await announceGiveaway({ channel: message.channel, row: closed.row, winners: closed.winners });
        record("giveaway_finished");
      } else {
        const rows = db.prepare("SELECT * FROM giveaways WHERE guild_id=? ORDER BY created_at DESC LIMIT 10").all(gid);
        const lines = rows.map((row) => `• \`${row.giveaway_id}\` — **${row.prize}** · ${row.status} · fin <t:${Math.floor(Number(row.ends_at) / 1000)}:R>`);
        await message.reply({
          embeds: [new EmbedBuilder().setColor(0xf59e0b).setTitle("🎉 Giveaways du serveur").setDescription(lines.length ? lines.join("\n") : "Aucun giveaway.")],
          allowedMentions: { parse: [] },
        });
      }
    } else if (command === "=event") {
      const action = (parts[1] ?? "liste").toLowerCase();
      if (action === "creer" || action === "créer") {
        if (!canManageGuild(message.guild, message.member)) throw new Error("Permission Gérer le serveur requise.");
        const payload = message.content.slice(message.content.indexOf(parts[1]) + parts[1].length).trim();
        const [title, date, description = ""] = payload.split("|").map((part) => part.trim());
        const startsAt = parseEventDate(date);
        if (!title || !startsAt) throw new Error("Utilisation : `=event creer titre | JJ/MM/AAAA HH:mm | description`.");
        db.prepare("INSERT INTO events(guild_id,title,description,starts_at,host_id,channel_id,notified,created_at) VALUES(?,?,?,?,?,?,0,?)")
          .run(gid, title.slice(0, 100), description.slice(0, 1000), startsAt, uid, message.channel.id, Date.now());
        record("event_created");
        await message.reply({ content: `📅 Événement **${title}** créé pour <t:${Math.floor(startsAt / 1000)}:F>.`, allowedMentions: { parse: [] } });
      } else if (action === "supprimer") {
        const id = Number(parts[2]);
        const row = db.prepare("SELECT * FROM events WHERE id=? AND guild_id=?").get(id, gid);
        if (!row) throw new Error("Événement introuvable sur ce serveur.");
        if (row.host_id !== uid && !canManageGuild(message.guild, message.member)) throw new Error("Seul l’organisateur ou le staff peut supprimer cet événement.");
        db.prepare("DELETE FROM events WHERE id=? AND guild_id=?").run(id, gid);
        await message.reply({ content: `🗑️ Événement **${row.title}** supprimé.`, allowedMentions: { parse: [] } });
      } else {
        const rows = db.prepare("SELECT * FROM events WHERE guild_id=? AND starts_at>? ORDER BY starts_at ASC LIMIT 10").all(gid, Date.now() - 3_600_000);
        const lines = rows.map((row) => `• \`#${row.id}\` **${row.title}** — <t:${Math.floor(Number(row.starts_at) / 1000)}:F>`);
        await message.reply({
          embeds: [new EmbedBuilder().setColor(0x3b82f6).setTitle("📅 Prochains événements").setDescription(lines.length ? lines.join("\n") : "Aucun événement prévu.")],
          allowedMentions: { parse: [] },
        });
      }
    }
  } catch (error) {
    await message.reply({ content: `❌ ${error instanceof Error ? error.message : "Action impossible."}`, allowedMentions: { parse: [] } }).catch(() => {});
  }
  return true;
}

// Exporté pour les tests d’intégration sans dépendance Discord.
export { finishDueGiveaways, announceDueEvents, COINFLIP_MIN_BET, COINFLIP_MAX_BET };
