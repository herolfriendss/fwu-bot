// /clan and /saison — the member-facing side of clans and seasons.
import { EmbedBuilder, MessageFlags, PermissionFlagsBits as P } from "discord.js";
import { applyBanner } from "../banners.js";
import { parsePndOwnerId } from "../pnd-owner-policy.js";
import * as C from "./clans.js";

export const CLAN_COMMANDS = new Set(["clan", "saison"]);
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });
const pnd = (value) => `${Number(value ?? 0).toLocaleString("fr-FR")} PND`;
const medal = (index) => ["🥇", "🥈", "🥉"][index] ?? `**${index + 1}.**`;
const ROLE_MARK = { chef: "👑", officier: "⭐", membre: "•" };

const isOwner = (member) =>
  member?.id === parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID) || member?.id === member?.guild?.ownerId;
const isStaff = (member) => isOwner(member) || Boolean(member?.permissions?.has?.(P.Administrator) || member?.permissions?.has?.(P.ManageGuild));

const embed = (title, category = "communaute") =>
  applyBanner(new EmbedBuilder().setColor(0xe21d2f).setTitle(title), category);

function clanCard(clan) {
  const members = C.clanMembers(clan.id);
  const roster = members.slice(0, 15)
    .map((m) => `${ROLE_MARK[m.role] ?? "•"} <@${m.user_id}>${m.contributed ? ` — ${pnd(m.contributed)} versés` : ""}`)
    .join("\n");
  return embed(`[${clan.tag}] ${clan.name}`)
    .setDescription(clan.description || "*Pas encore de description.*")
    .addFields(
      { name: "Chef", value: `<@${clan.leader_id}>`, inline: true },
      { name: "Membres", value: `${members.length} / ${C.MAX_MEMBERS}`, inline: true },
      { name: "Coffre", value: pnd(clan.vault), inline: true },
      { name: "Points de saison", value: Number(clan.season_points).toLocaleString("fr-FR"), inline: true },
      { name: "Points à vie", value: Number(clan.points).toLocaleString("fr-FR"), inline: true },
      { name: "Fondé", value: `<t:${Math.floor(Number(clan.created_at) / 1000)}:D>`, inline: true },
      { name: "Effectif", value: roster || "—" },
    );
}

function seasonCard(guildId) {
  const season = C.currentSeason(guildId);
  if (!season) {
    return embed("🏆 Saison").setDescription("Aucune saison en cours. Le staff peut en lancer une avec `/saison demarrer`.");
  }
  const board = C.clanLeaderboard(guildId, { board: "season", limit: 5 }).filter((clan) => clan.season_points > 0);
  return embed(`🏆 Saison ${season.number}${season.name ? ` — ${season.name}` : ""}`)
    .setDescription(`Commencée <t:${Math.floor(Number(season.started_at) / 1000)}:D> · se termine <t:${Math.floor(Number(season.ends_at) / 1000)}:R>`)
    .addFields({
      name: "Classement des clans",
      value: board.length
        ? board.map((clan, i) => `${medal(i)} **[${clan.tag}] ${clan.name}** — ${Number(clan.season_points).toLocaleString("fr-FR")} pts`).join("\n")
        : "Aucun clan n'a encore marqué.",
    });
}

async function handleClan(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const sub = interaction.options.getSubcommand();

  switch (sub) {
    case "creer": {
      const clan = C.createClan({ guildId, userId, name: interaction.options.getString("nom"), tag: interaction.options.getString("tag") });
      await interaction.reply({ content: `🎉 Clan **[${clan.tag}] ${clan.name}** fondé pour ${pnd(C.CLAN_COST)}.`, embeds: [clanCard(clan)] });
      return true;
    }
    case "inviter": {
      const membership = C.membershipOf(guildId, userId);
      if (!membership) throw new Error("Tu n'es dans aucun clan.");
      const target = interaction.options.getUser("membre");
      if (target.bot) throw new Error("Les bots ne rejoignent pas de clan.");
      C.inviteToClan({ guildId, clanId: membership.clan_id, userId: target.id, invitedBy: userId });
      const clan = C.clanById(membership.clan_id);
      await interaction.reply({
        content: `📨 <@${target.id}>, tu es invité dans **[${clan.tag}] ${clan.name}**. Réponds avec \`/clan rejoindre tag:${clan.tag}\` sous 48 h.`,
        allowedMentions: { users: [target.id] },
      });
      return true;
    }
    case "rejoindre": {
      const clan = C.clanByTag(guildId, interaction.options.getString("tag"));
      if (!clan) throw new Error("Aucun clan ne porte ce tag.");
      C.joinClan({ guildId, userId, clanId: clan.id });
      await interaction.reply({ content: `✅ Tu rejoins **[${clan.tag}] ${clan.name}**.`, embeds: [clanCard(C.clanById(clan.id))] });
      return true;
    }
    case "quitter": {
      const result = C.leaveClan({ guildId, userId });
      await interaction.reply(ephemeral(result.dissolved ? "Tu quittes le clan, qui est dissous puisqu'il était vide." : "Tu as quitté ton clan."));
      return true;
    }
    case "info": {
      const tag = interaction.options.getString("tag");
      const clan = tag ? C.clanByTag(guildId, tag) : C.clanOf(guildId, userId);
      if (!clan) throw new Error(tag ? "Aucun clan ne porte ce tag." : "Tu n'es dans aucun clan. Donne un tag ou fonde le tien.");
      await interaction.reply({ embeds: [clanCard(clan)] });
      return true;
    }
    case "liste": {
      const board = C.clanLeaderboard(guildId, { board: interaction.options.getString("classement") ?? "season", limit: 10 });
      await interaction.reply({
        embeds: [embed("⚔️ Clans du serveur", "classement").setDescription(board.length
          ? board.map((clan, i) => `${medal(i)} **[${clan.tag}] ${clan.name}** — ${Number(clan.season_points).toLocaleString("fr-FR")} pts · ${clan.members} membre(s) · coffre ${pnd(clan.vault)}`).join("\n")
          : "Aucun clan pour l'instant. Fonde le premier avec `/clan creer`.")],
      });
      return true;
    }
    case "depot": {
      const clan = C.depositToVault({ guildId, userId, amount: interaction.options.getInteger("montant") });
      await interaction.reply(`💰 Versé au coffre de **[${clan.tag}] ${clan.name}**, qui contient maintenant ${pnd(clan.vault)}.`);
      return true;
    }
    case "retrait": {
      const clan = C.withdrawFromVault({ guildId, userId, amount: interaction.options.getInteger("montant") });
      await interaction.reply(ephemeral(`💸 Retiré du coffre. Il reste ${pnd(clan.vault)}.`));
      return true;
    }
    case "promouvoir": {
      const target = interaction.options.getUser("membre");
      const role = interaction.options.getString("rang");
      const clan = C.setClanRole({ guildId, actorId: userId, targetId: target.id, role });
      await interaction.reply(`${ROLE_MARK[role]} <@${target.id}> est désormais **${role}** de **[${clan.tag}] ${clan.name}**.`);
      return true;
    }
    case "exclure": {
      const target = interaction.options.getUser("membre");
      C.kickFromClan({ guildId, actorId: userId, targetId: target.id });
      await interaction.reply(`👋 <@${target.id}> ne fait plus partie du clan.`);
      return true;
    }
    case "dissoudre": {
      const result = C.dissolveClan({ guildId, userId });
      await interaction.reply(ephemeral(`Le clan est dissous.${result.refunded ? ` Le coffre, ${pnd(result.refunded)}, t'a été rendu.` : ""}`));
      return true;
    }
    default:
      return false;
  }
}

async function handleSeason(interaction) {
  const guildId = interaction.guildId;
  const sub = interaction.options.getSubcommand();

  if (sub === "etat") {
    await interaction.reply({ embeds: [seasonCard(guildId)] });
    return true;
  }
  if (sub === "palmares") {
    const rows = C.hallOfFame(guildId, { board: interaction.options.getString("tableau") ?? null, limit: 30 });
    const byseason = new Map();
    for (const row of rows) {
      const key = `Saison ${row.season_number}${row.season_name ? ` — ${row.season_name}` : ""}`;
      if (!byseason.has(key)) byseason.set(key, []);
      byseason.get(key).push(`${medal(row.rank - 1)} ${row.board} · ${row.label ?? `<@${row.subject_id}>`} — ${Number(row.score).toLocaleString("fr-FR")}`);
    }
    const card = embed("👑 Palmarès", "classement");
    if (!byseason.size) card.setDescription("Aucune saison n'est encore terminée.");
    for (const [title, lines] of [...byseason].slice(0, 8)) card.addFields({ name: title, value: lines.join("\n") });
    await interaction.reply({ embeds: [card] });
    return true;
  }
  if (!isStaff(interaction.member)) {
    await interaction.reply(ephemeral("⛔ Réservé au staff."));
    return true;
  }
  if (sub === "demarrer") {
    const weeks = interaction.options.getInteger("semaines") ?? 13;
    const season = C.startSeason({ guildId, name: interaction.options.getString("nom"), lengthMs: weeks * 7 * 24 * 60 * 60_000 });
    await interaction.reply({ content: `🏁 **Saison ${season.number}** lancée pour ${weeks} semaines. Les points de saison repartent de zéro.`, embeds: [seasonCard(guildId)] });
    return true;
  }
  if (sub === "cloturer") {
    const { season, boards } = C.closeSeason({ guildId });
    const card = embed(`🏆 Saison ${season.number} terminée`, "classement");
    for (const [name, rows] of Object.entries(boards)) {
      if (!rows.length) continue;
      card.addFields({
        name: name === "clans" ? "Clans" : name === "membres" ? "Membres" : "Casino",
        value: rows.map((row, i) => `${medal(i)} ${row.label ?? `<@${row.subjectId}>`} — ${row.score.toLocaleString("fr-FR")}`).join("\n"),
      });
    }
    card.setDescription("Les podiums sont inscrits au palmarès pour toujours. Les compteurs de saison repartent de zéro.");
    await interaction.reply({ embeds: [card] });
    return true;
  }
  return false;
}

export async function handleClanInteraction(interaction) {
  try {
    if (!interaction.isChatInputCommand?.() || !CLAN_COMMANDS.has(interaction.commandName)) return false;
    if (!interaction.guildId) return false;
    return interaction.commandName === "clan" ? await handleClan(interaction) : await handleSeason(interaction);
  } catch (error) {
    const content = `❌ ${error instanceof Error ? error.message : "Action impossible."}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content, embeds: [], components: [] }).catch(() => {});
    else await interaction.reply(ephemeral(content)).catch(() => {});
    return true;
  }
}
