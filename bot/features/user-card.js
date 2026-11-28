// Bot principal — /ui [membre] : fiche d'un membre sur ce serveur (demande de l'OWNER du 28/11).
//
// Abonnement (Invest +), pseudo, boost, salon vocal, dates, rôles, et boutons-liens Profil,
// Avatar, Bannière. Lecture seule, visible de tous (informations publiques sur Discord) ; aucune
// donnée privée : ni notes du staff, ni sanctions, ni historique. Le bot principal ne signe pas.
// « En train de » n'est pas affiché : il faudrait l'intent Presence, désactivé volontairement
// (l'activer sans le cocher dans le portail Discord empêcherait le bot de se connecter).
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { planById, subscriptionOf } from "./investplus.js";

const ts = (ms) => `<t:${Math.floor(ms / 1000)}:D> (<t:${Math.floor(ms / 1000)}:R>)`;

/** Active Invest + plan name, or null (no subscription, expired, paused, missing table). */
export function subscriptionLabel(guildId, userId, now = Date.now()) {
  try {
    const sub = subscriptionOf(guildId, userId);
    if (!sub || sub.status !== "active" || (sub.expiresAt !== null && sub.expiresAt <= now)) return null;
    return planById(guildId, sub.planId)?.name ?? null;
  } catch {
    return null;
  }
}

/** Role mentions, highest first, without @everyone, bounded to what an embed field can hold. */
export function roleList(member, max = 1000) {
  const roles = [...(member.roles?.cache?.values?.() ?? [])]
    .filter((role) => role.id !== member.guild?.id)
    .sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
  let text = "";
  let shown = 0;
  for (const role of roles) {
    const next = `${text ? " " : ""}<@&${role.id}>`;
    if (text.length + next.length > max - 12) break;
    text += next; shown += 1;
  }
  if (shown < roles.length) text += ` +${roles.length - shown}`;
  return { count: roles.length, text: text || "Aucun" };
}

export function buildUserCard(member, { user = member.user, now = Date.now() } = {}) {
  const guild = member.guild;
  const sub = subscriptionLabel(guild.id, member.id, now);
  const voice = member.voice?.channel ?? null;
  const others = voice ? Math.max(0, (voice.members?.size ?? 1) - 1) : 0;
  const roles = roleList(member);
  const avatar = member.displayAvatarURL?.({ size: 4096 }) ?? user.displayAvatarURL?.({ size: 4096 }) ?? null;
  const banner = user.bannerURL?.({ size: 4096 }) ?? null;

  const embed = new EmbedBuilder()
    .setTitle(String(member.displayName ?? user.username).slice(0, 256))
    .setDescription(`<@${member.id}>\n\`${member.id}\``)
    .addFields(
      { name: "Abonnement", value: sub ? `**${sub}**` : "Aucun" },
      { name: "Informations", value: [`**Pseudo** : ${user.username}`, `**Boost** : ${member.premiumSinceTimestamp ? `depuis ${ts(member.premiumSinceTimestamp)}` : "non"}`].join("\n") },
      { name: "Vocal", value: voice ? `**Salon** : <#${voice.id}>${others ? ` · avec ${others} autre${others > 1 ? "s" : ""}` : " · seul"}` : "Pas en vocal" },
      { name: "Dates", value: [`**Créé** : ${ts(user.createdTimestamp)}`, member.joinedTimestamp ? `**Rejoint** : ${ts(member.joinedTimestamp)}` : null].filter(Boolean).join("\n") },
      { name: `Rôles · ${roles.count}`, value: roles.text },
    );
  if (avatar) embed.setThumbnail(avatar);

  const buttons = [new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Profil").setURL(`https://discord.com/users/${member.id}`)];
  if (avatar) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Avatar").setURL(avatar));
  if (banner) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Bannière").setURL(banner));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(buttons)] };
}

export async function handleUserCardInteraction(interaction) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== "ui") return false;
  if (!interaction.guild) { await interaction.reply({ content: "Cette commande s'utilise sur un serveur.", ephemeral: true }); return true; }
  const target = interaction.options.getUser("membre") ?? interaction.user;
  await interaction.deferReply();
  const member = await interaction.guild.members.fetch({ user: target.id }).catch(() => null);
  if (!member) { await interaction.editReply({ content: "Ce membre n'est pas sur le serveur." }); return true; }
  // A forced fetch is the only way to get the banner.
  const user = await interaction.client?.users?.fetch?.(target.id, { force: true }).catch(() => null) ?? member.user;
  await interaction.editReply({ ...buildUserCard(member, { user }), allowedMentions: { parse: [] } });
  return true;
}
