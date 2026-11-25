import { EmbedBuilder } from "discord.js";

export const FWU_WELCOME_COLOR = 0xe21d2f;

function safeText(value, max = 1800) {
  return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, "").slice(0, max);
}

export function renderWelcomeMessage(template, { user, server, memberCount, accountCreatedAt }) {
  const values = {
    user,
    server: safeText(server, 100),
    memberCount: String(Math.max(0, Number(memberCount) || 0)),
    accountCreatedAt: accountCreatedAt ? `<t:${Math.floor(accountCreatedAt / 1000)}:D>` : "inconnue",
  };
  return safeText(template || "Bienvenue {user} sur **{server}** !", 1800)
    .replace(/\{(user|server|memberCount|accountCreatedAt)\}/g, (_match, key) => values[key] ?? "");
}

/** Build a welcome embed only; the caller must supply an explicitly configured channel. */
export function buildWelcomePayload(member, settings, now = Date.now()) {
  if (!member?.guild || !member?.user || settings?.enabled !== true || !settings?.channelId) return null;
  const guild = member.guild;
  const createdAt = Number(member.user.createdTimestamp) || null;
  const description = renderWelcomeMessage(settings.message, {
    user: `<@${member.id}>`,
    server: guild.name,
    memberCount: guild.memberCount,
    accountCreatedAt: createdAt,
  });
  const embed = new EmbedBuilder()
    .setColor(FWU_WELCOME_COLOR)
    .setTitle("Bienvenue dans la communauté")
    .setDescription(description)
    .setThumbnail(member.user.displayAvatarURL?.({ size: 256 }) ?? null)
    .addFields(
      { name: "Membre", value: `#${Math.max(1, Number(guild.memberCount) || 1)}`, inline: true },
      { name: "Compte créé", value: createdAt ? `<t:${Math.floor(createdAt / 1000)}:R>` : "Date indisponible", inline: true },
    )
    .setFooter({ text: "FWU • Bienvenue" })
    .setTimestamp(new Date(now));
  return { embeds: [embed], allowedMentions: { parse: [], users: [member.id] } };
}


/** Build a departure embed only; reuses an explicitly configured existing channel. */
export function buildDeparturePayload(member, settings, now = Date.now()) {
  if (!member?.guild || !member?.user || settings?.leaveEnabled !== true) return null;
  const channelId = settings.leaveChannelId || settings.channelId;
  if (!channelId) return null;
  const guild = member.guild;
  const createdAt = Number(member.user.createdTimestamp) || null;
  const joinedAt = Number(member.joinedTimestamp) || null;
  const description = renderWelcomeMessage(settings.leaveMessage || "{user} a quitté **{server}**.", {
    user: `<@${member.id}>`, server: guild.name, memberCount: guild.memberCount, accountCreatedAt: createdAt,
  });
  const embed = new EmbedBuilder().setColor(0x6b7280).setTitle("Départ d’un membre").setDescription(description)
    .setThumbnail(member.user.displayAvatarURL?.({ size: 256 }) ?? null)
    .addFields(
      { name: "Membre", value: `#${Math.max(0, Number(guild.memberCount) || 0)}`, inline: true },
      { name: "A rejoint", value: joinedAt ? `<t:${Math.floor(joinedAt / 1000)}:R>` : "Date indisponible", inline: true },
    ).setFooter({ text: "FWU • Départ" }).setTimestamp(new Date(now));
  return { channelId, payload: { embeds: [embed], allowedMentions: { parse: [], users: [member.id] } } };
}
