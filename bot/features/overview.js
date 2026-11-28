// /moi and /fwu — the two commands that make five bots feel like one.
//
// Everything is read from the shared database, so the answer is complete even
// when four of the five processes are offline. A table that the running bot
// never creates simply contributes nothing.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { db, tableExists } from "../database.js";
import { applyBanner } from "../banners.js";
import { trustFor, activeSanctions } from "../trust.js";
// Via bot-runtime.js, which finds bot-profiles.ts both in the repository
// (src/lib) and in a packaged bot folder (copied next to bot-runtime.js).
import { BOT_PROFILES, BOT_PROFILE_IDS } from "../bot-runtime.js";

const DAY = 86_400_000;
const PRESENCE_GRACE_MS = 3 * 60_000;
const one = (sql, ...args) => db.prepare(sql).get(...args);
const pnd = (value) => `${Number(value ?? 0).toLocaleString("fr-FR")} PND`;

/** Level, messages and voice time, plus the member's rank in the guild. */
function levelSection(guildId, userId) {
  if (!tableExists("community_levels")) return null;
  const row = one("SELECT xp, level, messages, voice_minutes FROM community_levels WHERE guild_id=? AND user_id=?", guildId, userId);
  if (!row) return null;
  const rank = Number(one("SELECT COUNT(*) + 1 AS r FROM community_levels WHERE guild_id=? AND xp>?", guildId, row.xp).r);
  const total = Number(one("SELECT COUNT(*) AS n FROM community_levels WHERE guild_id=?", guildId).n);
  const achievements = tableExists("community_achievements")
    ? Number(one("SELECT COUNT(*) AS n FROM community_achievements WHERE guild_id=? AND user_id=?", guildId, userId).n)
    : 0;
  return {
    level: Number(row.level), xp: Number(row.xp), messages: Number(row.messages),
    voiceMinutes: Number(row.voice_minutes), rank, total, achievements,
  };
}

function economySection(guildId, userId) {
  if (!tableExists("wallets")) return null;
  const wallet = one("SELECT balance, bank FROM wallets WHERE guild_id=? AND user_id=?", guildId, userId);
  if (!wallet) return null;
  const casino = tableExists("casino_rounds")
    ? one("SELECT COUNT(*) AS rounds, COALESCE(SUM(bet),0) AS wagered, COALESCE(SUM(payout-bet),0) AS net FROM casino_rounds WHERE guild_id=? AND user_id=?", guildId, userId)
    : null;
  const businesses = tableExists("business_members")
    ? Number(one("SELECT COUNT(*) AS n FROM business_members WHERE guild_id=? AND user_id=?", guildId, userId)?.n ?? 0)
    : 0;
  return {
    balance: Number(wallet.balance ?? 0), bank: Number(wallet.bank ?? 0),
    casinoRounds: Number(casino?.rounds ?? 0), casinoWagered: Number(casino?.wagered ?? 0), casinoNet: Number(casino?.net ?? 0),
    businesses,
  };
}

function recordSection(guildId, userId, now) {
  const warnings = tableExists("moderation_warnings")
    ? Number(one("SELECT COUNT(*) AS n FROM moderation_warnings WHERE guild_id=? AND user_id=? AND (expires_at IS NULL OR expires_at>?)", guildId, userId, now).n)
    : 0;
  const cases = tableExists("moderation_cases")
    ? Number(one("SELECT COUNT(*) AS n FROM moderation_cases WHERE guild_id=? AND user_id=?", guildId, userId).n)
    : 0;
  const recent = tableExists("moderation_cases")
    ? Number(one("SELECT COUNT(*) AS n FROM moderation_cases WHERE guild_id=? AND user_id=? AND created_at>?", guildId, userId, now - 30 * DAY).n)
    : 0;
  return { warnings, cases, recent };
}

function extrasSection(guildId, userId) {
  const birthday = tableExists("community_birthdays")
    ? one("SELECT day, month FROM community_birthdays WHERE guild_id=? AND user_id=?", guildId, userId)
    : null;
  const reputation = tableExists("reputation")
    ? Number(one("SELECT COUNT(*) AS n FROM reputation WHERE guild_id=? AND receiver_id=?", guildId, userId)?.n ?? 0)
    : 0;
  const confessions = tableExists("community_confessions")
    ? Number(one("SELECT COUNT(*) AS n FROM community_confessions WHERE guild_id=? AND author_id=? AND status='published'", guildId, userId).n)
    : 0;
  return {
    birthday: birthday ? `${String(birthday.day).padStart(2, "0")}/${String(birthday.month).padStart(2, "0")}` : null,
    reputation, confessions,
  };
}

/** One read of everything the five bots know about a member. */
export function memberOverview(guildId, userId, { member = null, now = Date.now() } = {}) {
  return {
    level: levelSection(guildId, userId),
    economy: economySection(guildId, userId),
    record: recordSection(guildId, userId, now),
    extras: extrasSection(guildId, userId),
    trust: trustFor(guildId, userId, member, now),
    sanctions: activeSanctions(guildId, userId, now),
  };
}

const hours = (minutes) => (minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`);

export function overviewEmbed(overview, { username, avatarUrl = null, showPrivate = false }) {
  const { level, economy, record, extras, trust, sanctions } = overview;
  const embed = new EmbedBuilder()
    .setColor(0xe21d2f)
    .setTitle(`Profil de ${username}`)
    .setFooter({ text: showPrivate ? "Ton profil complet · privé" : "Profil communautaire public" });
  if (avatarUrl) embed.setThumbnail(avatarUrl);

  if (showPrivate) {
    embed.addFields({
      name: `${trust.tier.emoji} Confiance`,
      value: `**${trust.score}/100** · ${trust.tier.label}`,
      inline: true,
    });
    const reasons = trust.reasons.slice(0, 8).map((reason) => `${reason.points > 0 ? "+" : ""}${reason.points} — ${reason.label}`);
    if (reasons.length) {
      embed.addFields({ name: "Détail du score", value: reasons.join("\n").slice(0, 1000) });
    }
  }

  if (level) {
    embed.addFields(
      { name: "⭐ Niveau", value: `**${level.level}** · ${level.xp.toLocaleString("fr-FR")} XP\n${level.rank}ᵉ sur ${level.total}`, inline: true },
      { name: "🏅 Succès", value: `${level.achievements} débloqué(s)`, inline: true },
      { name: "💬 Activité", value: `${level.messages.toLocaleString("fr-FR")} messages\n${hours(level.voiceMinutes)} en vocal`, inline: true },
    );
  }
  if (showPrivate && economy) {
    embed.addFields(
      { name: "💰 Argent", value: `${pnd(economy.balance)} en poche\n${pnd(economy.bank)} en banque`, inline: true },
      {
        name: "🎰 Casino",
        value: economy.casinoRounds
          ? `${economy.casinoRounds} parties\n${economy.casinoNet >= 0 ? "+" : "−"}${pnd(Math.abs(economy.casinoNet))}`
          : "Jamais joué",
        inline: true,
      },
    );
    if (economy.businesses) embed.addFields({ name: "🏢 Entreprises", value: `${economy.businesses}`, inline: true });
  }

  if (showPrivate) {
    const marks = [];
    if (record.warnings) marks.push(`${record.warnings} avertissement(s) en cours`);
    if (record.recent) marks.push(`${record.recent} sanction(s) sur 30 jours`);
    if (!marks.length && record.cases) marks.push(`${record.cases} dossier(s) archivé(s), rien d'actif`);
    embed.addFields({ name: "🛡️ Casier", value: marks.length ? marks.join("\n") : "Vierge", inline: true });

    if (sanctions.length) {
      embed.addFields({
        name: "⛔ Accès suspendus",
        value: sanctions.map((s) => `${s.scope} — jusqu'au <t:${Math.floor(s.until / 1000)}:R>`).join("\n"),
      });
    }
  }

  const side = [];
  if (extras.birthday) side.push(`🎂 Anniversaire le ${extras.birthday}`);
  if (extras.reputation) side.push(`❤️ ${extras.reputation} point(s) de réputation`);
  if (extras.confessions) side.push(`🤫 ${extras.confessions} confession(s) publiée(s)`);
  if (side.length) embed.addFields({ name: "Divers", value: side.join("\n") });

  if (!level && (!showPrivate || !economy)) {
    embed.setDescription("Aucune activité communautaire enregistrée pour l'instant. Écris un message ou passe en vocal pour remplir ton profil.");
  }
  return applyBanner(embed, "communaute");
}

// ------------------------------------------------------------------ /fwu ----

/** Which bots are alive right now, from the domain leases they renew. */
export function botPresence(now = Date.now()) {
  const held = tableExists("bot_domain_leases")
    ? new Map(db.prepare("SELECT domain, holder, expires_at FROM bot_domain_leases").all()
      .map((row) => [row.domain, { holder: row.holder, expiresAt: Number(row.expires_at) }]))
    : new Map();
  return BOT_PROFILE_IDS.map((id) => {
    const lease = held.get(id);
    return {
      id,
      label: BOT_PROFILES[id].label,
      summary: BOT_PROFILES[id].summary,
      online: Boolean(lease && lease.expiresAt + PRESENCE_GRACE_MS > now),
    };
  });
}

const PANEL_HINTS = Object.freeze({
  fwu: "`/niveau` `/profil` `/confession` `/ticket` `/suggestion`",
  guard: "`/warn` `/casier` `/verify` `/quarantaine` `/antinuke`",
  fdpdlavoc: "`/play` `/queue` `/radio` `/pv` `/dj`",
  suckme: "`/sysp` `/rank` `/annonce` `/staff` `/maj`",
  fisc: "`/balance` `/daily` `/casino` `/shop` `/business`",
  investplus: "`/abonnement` `/investadmin tableau`",
});

export function panelView(now = Date.now()) {
  const bots = botPresence(now);
  const embed = new EmbedBuilder()
    .setColor(0xe21d2f)
    .setTitle("Les bots du serveur")
    .setDescription("Chaque bot tient son domaine. Ils partagent la même mémoire : une sanction, un niveau ou une mise comptent partout.")
    .setFooter({ text: "/moi pour ton profil complet" });
  for (const bot of bots) {
    embed.addFields({
      name: `${bot.online ? "🟢" : "🔴"} ${bot.label}`,
      value: `${bot.summary}\n${PANEL_HINTS[bot.id] ?? ""}`,
      inline: false,
    });
  }
  const offline = bots.filter((bot) => !bot.online);
  if (offline.length) {
    embed.addFields({
      name: "⚠️ Hors ligne",
      value: `${offline.map((bot) => bot.label).join(", ")} — leurs commandes ne répondront pas, mais rien n'est perdu : tout est rattrapé à leur retour.`,
    });
  }
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("fwu:moi").setLabel("Mon profil").setStyle(ButtonStyle.Primary).setEmoji("👤"),
    new ButtonBuilder().setCustomId("fwu:etat").setLabel("Rafraîchir").setStyle(ButtonStyle.Secondary).setEmoji("🔄"),
  );
  return { embeds: [applyBanner(embed, "fwu")], components: [row] };
}

// --------------------------------------------------------------- commands ----

export const OVERVIEW_COMMANDS = new Set(["moi", "fwu"]);

/**
 * Shows a member's profile: the drawn card as the embed's image, with the
 * detailed fields underneath. A card that fails to draw is not fatal — the
 * embed falls back to its banner.
 */
async function showProfile(interaction, target) {
  const member = target.id === interaction.user.id
    ? interaction.member
    : await interaction.guild.members.fetch(target.id).catch(() => null);
  const username = member?.displayName ?? target.username;
  const avatarUrl = target.displayAvatarURL?.({ extension: "png", size: 256 }) ?? null;
  const overview = memberOverview(interaction.guildId, target.id, { member });
  const showPrivate = target.id === interaction.user.id;
  const embed = overviewEmbed(overview, { username, avatarUrl, showPrivate });

  try {
    const { profileCardAttachment } = await import("./profile-card.js");
    const { attachment } = await profileCardAttachment({
      guildId: interaction.guildId, userId: target.id, username, avatarUrl, member, showPrivate,
    });
    embed.setImage("attachment://profil.png");
    return { embeds: [embed], files: [attachment] };
  } catch (error) {
    console.error("[profil] carte impossible:", error?.message ?? "erreur");
    return { embeds: [embed] };
  }
}

export async function handleOverviewInteraction(interaction) {
  try {
    if (interaction.isButton?.() && interaction.customId === "fwu:moi") {
      await interaction.deferReply({ flags: 64 });
      await interaction.editReply(await showProfile(interaction, interaction.user));
      return true;
    }
    if (interaction.isButton?.() && interaction.customId === "fwu:etat") {
      await interaction.update(panelView());
      return true;
    }
    if (!interaction.isChatInputCommand?.() || !OVERVIEW_COMMANDS.has(interaction.commandName)) return false;
    if (!interaction.guildId) return false;

    if (interaction.commandName === "fwu") {
      await interaction.reply(panelView());
      return true;
    }
    const target = interaction.options.getUser("membre") ?? interaction.user;
    // Someone else's profile is public; your own stays private by default.
    const own = target.id === interaction.user.id;
    await interaction.deferReply(own ? { flags: 64 } : {});
    await interaction.editReply(await showProfile(interaction, target));
    return true;
  } catch (error) {
    const content = `❌ ${error instanceof Error ? error.message : "Profil indisponible."}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content, embeds: [], components: [] }).catch(() => {});
    else await interaction.reply({ content, flags: 64 }).catch(() => {});
    return true;
  }
}
