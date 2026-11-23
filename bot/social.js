// Her? V4 — profils, biographie et réputation, par serveur.
import { EmbedBuilder } from "discord.js";
import { brandEmbed } from "./theme.js";
import { db } from "./database.js";
import { cooldownRemaining, pndBalance, setCooldown } from "./economy.js";
import { colorToInt, REP_COOLDOWN_MS, repBadge, repCooldownRemaining, sanitizeBio, sanitizeProfileColor, canGiveRep, computeBadges, evaluateRepGiver } from "./social-policy.js";
import { transaction } from "./database.js";

function mention(id) { return `<@${id}>`; }
function format(value) { return `${Number(value).toLocaleString("fr-FR")} PND`; }

function profileRow(guildId, userId) {
  return db.prepare("SELECT * FROM profiles WHERE guild_id=? AND user_id=?").get(guildId, userId) ?? null;
}

function receivedRep(guildId, userId) {
  return Number(db.prepare("SELECT COUNT(*) AS count FROM reputation WHERE guild_id=? AND receiver_id=?").get(guildId, userId).count);
}

function givenRep(guildId, userId, since = 0) {
  return Number(db.prepare("SELECT COUNT(*) AS count FROM reputation WHERE guild_id=? AND giver_id=? AND created_at>?").get(guildId, userId, since).count);
}

function cardCount(guildId, userId) {
  return Number(db.prepare("SELECT COALESCE(SUM(quantity),0) AS count FROM user_cards WHERE guild_id=? AND user_id=?").get(guildId, userId).count);
}

function profileEmbed(guild, user, member, row, rep, cards) {
  const wallet = pndBalance(guild.id, user.id);
  const color = colorToInt(row?.color) ?? 0x6d28d9;
  return brandEmbed(new EmbedBuilder()
    .setColor(color)
    .setTitle(`Profil de ${member?.displayName ?? user.username}`)
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .setDescription(row?.bio || "_Aucune biographie. Utilise `/bio` pour en ajouter une._")
    .addFields(
      { name: "Réputation", value: `${rep} — ${repBadge(rep)}`, inline: true },
      { name: "Badges", value: computeBadges({ rep, joinedAt: member?.joinedTimestamp ?? null, totalPnd: wallet.balance + wallet.bank, cards, givenTotal: givenRep(guild.id, user.id) }).join(" · "), inline: false },
      { name: "PND", value: `${format(wallet.balance + wallet.bank)} (banque ${format(wallet.bank)})`, inline: true },
      { name: "Cartes", value: String(cards), inline: true },
      { name: "Membre depuis", value: member?.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:D>` : "Inconnu", inline: true },
      { name: "Identifiant", value: user.id, inline: true },
    )
    .setFooter({ text: `${guild.name} · données isolées par serveur` }));
}

export async function handleSocialMessage(message) {
  if (!message.guild || !message.member) return false;
  const parts = message.content.trim().split(/\s+/);
  const command = (parts[0] ?? "").toLowerCase();
  const known = new Set(["=profil", "=profile", "=bio", "=rep", "=toprep", "=color", "=couleur", "=rephistory", "=rephistorique"]);
  if (!known.has(command)) return false;
  const gid = message.guild.id;
  const uid = message.author.id;

  try {
    if (command === "=profil" || command === "=profile") {
      const user = message.mentions.users.first() ?? message.author;
      const member = await message.guild.members.fetch(user.id).catch(() => null);
      const row = profileRow(gid, user.id);
      await message.reply({
        embeds: [profileEmbed(message.guild, user, member, row, receivedRep(gid, user.id), cardCount(gid, user.id))],
        allowedMentions: { parse: [] },
      });
    } else if (command === "=bio") {
      const bio = sanitizeBio(parts.slice(1).join(" "));
      if (!bio && parts.length < 2) throw new Error("Utilisation : `=bio ton texte` (280 caractères maximum).");
      const now = Date.now();
      db.prepare(`INSERT INTO profiles(guild_id,user_id,bio,color,created_at,updated_at) VALUES(?,?,?,NULL,?,?)
        ON CONFLICT(guild_id,user_id) DO UPDATE SET bio=excluded.bio, updated_at=excluded.updated_at`).run(gid, uid, bio, now, now);
      await message.reply({ content: bio ? "✅ Biographie mise à jour." : "✅ Biographie effacée.", allowedMentions: { parse: [] } });
    } else if (command === "=color" || command === "=couleur") {
      const color = sanitizeProfileColor(parts[1]);
      if (!color) throw new Error("Utilisation : `=color #5865f2`.");
      const now = Date.now();
      db.prepare(`INSERT INTO profiles(guild_id,user_id,bio,color,created_at,updated_at) VALUES(?,?,'',?,?,?)
        ON CONFLICT(guild_id,user_id) DO UPDATE SET color=excluded.color, updated_at=excluded.updated_at`).run(gid, uid, color, now, now);
      await message.reply({ content: `🎨 Couleur de profil : **${color}**.`, allowedMentions: { parse: [] } });
    } else if (command === "=rephistory" || command === "=rephistorique" || (command === "=rep" && /^(historique|history)$/i.test(parts[1] ?? ""))) {
      const user = message.mentions.users.first() ?? message.author;
      const rows = db.prepare("SELECT giver_id,reason,created_at FROM reputation WHERE guild_id=? AND receiver_id=? ORDER BY created_at DESC LIMIT 10").all(gid, user.id);
      const lines = rows.map((row) => `• <t:${Math.floor(row.created_at / 1000)}:R> — ${mention(row.giver_id)}${row.reason ? ` : ${row.reason}` : ""}`);
      await message.reply({
        embeds: [brandEmbed(new EmbedBuilder().setTitle(`⭐ Réputation reçue — ${user.username ?? user.id}`).setDescription(lines.length ? `${lines.join("\n")}\n\nTotal : **${receivedRep(gid, user.id)}**` : "Aucune réputation reçue."))],
        allowedMentions: { parse: [] },
      });
    } else if (command === "=rep") {
      const target = message.mentions.users.first();
      const check = canGiveRep({ giverId: uid, targetId: target?.id, targetIsBot: target?.bot });
      if (!check.allowed) throw new Error(check.reason ?? "Utilisation : `=rep @membre [raison]`.");
      const remaining = cooldownRemaining(gid, uid, `rep:${target.id}`);
      if (remaining) throw new Error(`⏳ Tu pourras redonner de la réputation à ${mention(target.id)} dans **${Math.ceil(remaining / 3_600_000)} h**.`);
      const reason = sanitizeBio(parts.slice(2).join(" "), 200) || null;
      transaction(() => {
        // Checked and written atomically: anti-farming cap and per-target cooldown.
        const giver = evaluateRepGiver({
          accountCreatedAt: Number(message.author?.createdTimestamp ?? NaN),
          joinedAt: Number(message.member?.joinedTimestamp ?? NaN),
          givenLast24h: givenRep(gid, uid, Date.now() - 86_400_000),
        });
        if (!giver.allowed) throw new Error(giver.reason);
        if (cooldownRemaining(gid, uid, `rep:${target.id}`)) throw new Error("⏳ Réputation déjà donnée à ce membre récemment.");
        db.prepare("INSERT INTO reputation(guild_id,giver_id,receiver_id,reason,created_at) VALUES(?,?,?,?,?)").run(gid, uid, target.id, reason, Date.now());
        setCooldown(gid, uid, `rep:${target.id}`, Date.now() + REP_COOLDOWN_MS);
      });
      await message.reply({ content: `⭐ ${mention(uid)} a donné de la réputation à ${mention(target.id)}${reason ? ` : ${reason}` : ""}.`, allowedMentions: { parse: [] } });
    } else if (command === "=toprep") {
      const rows = db.prepare("SELECT receiver_id, COUNT(*) AS count FROM reputation WHERE guild_id=? GROUP BY receiver_id ORDER BY count DESC, receiver_id ASC LIMIT 10").all(gid);
      const lines = rows.map((row, index) => `**${index + 1}.** ${mention(row.receiver_id)} — ${row.count} point(s) · ${repBadge(row.count)}`);
      await message.reply({
        embeds: [brandEmbed(new EmbedBuilder().setTitle("⭐ Classement de réputation").setDescription(lines.length ? lines.join("\n") : "Aucune réputation donnée pour le moment."))],
        allowedMentions: { parse: [] },
      });
    }
  } catch (error) {
    await message.reply({ content: `❌ ${error.message}`, allowedMentions: { parse: [] } }).catch(() => {});
  }
  return true;
}

// Exported for future dashboard snapshots without exposing other guilds.
export function socialSnapshot(guildId) {
  const profiles = db.prepare("SELECT user_id,bio,color FROM profiles WHERE guild_id=? ORDER BY updated_at DESC LIMIT 20").all(guildId);
  const topRep = db.prepare("SELECT receiver_id, COUNT(*) AS count FROM reputation WHERE guild_id=? GROUP BY receiver_id ORDER BY count DESC LIMIT 10").all(guildId);
  return {
    profiles: profiles.map((row) => ({ userId: row.user_id, bio: row.bio, color: row.color })),
    topReputation: topRep.map((row) => ({ userId: row.receiver_id, count: Number(row.count) })),
  };
}

export { repCooldownRemaining };
