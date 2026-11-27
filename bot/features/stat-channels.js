// SUCK ME — salons compteurs (/compteurs) : membres, en vocal, boosts.
//   /compteurs installer : crée une catégorie « Statistiques » avec un salon vocal verrouillé
//   par compteur (personne ne peut s'y connecter) ; /compteurs retirer ; /compteurs actualiser.
//   Mise à jour toutes les 10 minutes (Discord limite à 2 renommages par 10 min et par salon),
//   seulement quand le nombre change. Un salon supprimé à la main est oublié.
import { ChannelType, PermissionFlagsBits as P } from "discord.js";
import { db } from "../database.js";
import { respondInPlaceSafe } from "../interaction-reply.js";

export const STAT_COMMANDS = new Set(["compteurs"]);
export const STAT_KINDS = Object.freeze({
  membres: "👥 Membres : {n}",
  vocal: "🔊 En vocal : {n}",
  boosts: "🚀 Boosts : {n}",
});
export const STAT_REFRESH_MS = 10 * 60_000;

db.exec(`
  CREATE TABLE IF NOT EXISTS stat_channels (
    guild_id TEXT NOT NULL, kind TEXT NOT NULL, channel_id TEXT NOT NULL, category_id TEXT, last_name TEXT, updated_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, kind)
  );
`);

/** Valeurs des compteurs, à partir du cache Discord (aucun appel réseau). */
export function statValues(guild) {
  let inVoice = 0;
  for (const channel of guild.channels?.cache?.values?.() ?? []) {
    if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) continue;
    for (const member of channel.members?.values?.() ?? []) if (!member.user?.bot) inVoice += 1;
  }
  return { membres: Number(guild.memberCount ?? 0), vocal: inVoice, boosts: Number(guild.premiumSubscriptionCount ?? 0) };
}

export function statName(kind, value) {
  return STAT_KINDS[kind].replace("{n}", Number(value).toLocaleString("fr-FR")).slice(0, 100);
}

export function statRows(guildId = null) {
  return guildId
    ? db.prepare("SELECT * FROM stat_channels WHERE guild_id=? ORDER BY kind").all(guildId)
    : db.prepare("SELECT * FROM stat_channels ORDER BY guild_id, kind").all();
}

export function saveStatChannel(guildId, kind, channelId, categoryId = null) {
  db.prepare(`INSERT INTO stat_channels(guild_id,kind,channel_id,category_id,last_name,updated_at) VALUES(?,?,?,?,NULL,0)
    ON CONFLICT(guild_id,kind) DO UPDATE SET channel_id=excluded.channel_id, category_id=excluded.category_id, last_name=NULL, updated_at=0`).run(guildId, kind, channelId, categoryId);
}

export function forgetStatChannel(channelId) {
  return Number(db.prepare("DELETE FROM stat_channels WHERE channel_id=?").run(channelId).changes) > 0;
}

/**
 * Renomme les salons d'un serveur dont le nombre a changé. `force` ignore le délai de 10 min.
 * Rend le nombre de salons renommés.
 */
export async function refreshGuildStats(guild, { now = Date.now(), force = false } = {}) {
  const rows = statRows(guild.id);
  if (!rows.length) return 0;
  const values = statValues(guild);
  let renamed = 0;
  for (const row of rows) {
    const name = statName(row.kind, values[row.kind] ?? 0);
    if (name === row.last_name) continue;
    if (!force && now - Number(row.updated_at) < STAT_REFRESH_MS) continue;
    const channel = guild.channels.cache.get(row.channel_id) ?? await guild.channels.fetch(row.channel_id).catch(() => null);
    if (!channel) { forgetStatChannel(row.channel_id); continue; }
    try {
      if (channel.name !== name) await channel.setName(name, "Salons compteurs");
      db.prepare("UPDATE stat_channels SET last_name=?, updated_at=? WHERE guild_id=? AND kind=?").run(name, now, guild.id, row.kind);
      renamed += 1;
    } catch { /* limite Discord ou permission : nouvel essai au prochain passage */ }
  }
  return renamed;
}

export async function runStatChannels(client, { isAllowedGuild = () => true, now = Date.now() } = {}) {
  const guildIds = [...new Set(statRows().map((row) => row.guild_id))];
  for (const id of guildIds) {
    const guild = isAllowedGuild(id) ? client.guilds.cache.get(id) : null;
    if (guild) await refreshGuildStats(guild, { now }).catch(() => 0);
  }
}

const isAdmin = (member) => Boolean(member?.permissions?.has?.(P.ManageGuild) || member?.permissions?.has?.(P.ManageChannels) || member?.permissions?.has?.(P.Administrator) || member?.id === member?.guild?.ownerId);

async function install(guild) {
  const me = guild.members.me ?? await guild.members.fetchMe();
  if (!me.permissions.has(P.ManageChannels)) throw new Error("Il me faut la permission **Gérer les salons**.");
  const existing = statRows(guild.id);
  let category = existing[0]?.category_id ? guild.channels.cache.get(existing[0].category_id) : null;
  if (!category) {
    category = await guild.channels.create({ name: "📊 Statistiques", type: ChannelType.GuildCategory, position: 0, reason: "Salons compteurs" });
  }
  const values = statValues(guild);
  const created = [];
  for (const kind of Object.keys(STAT_KINDS)) {
    const row = existing.find((r) => r.kind === kind);
    if (row && guild.channels.cache.get(row.channel_id)) continue;
    const channel = await guild.channels.create({
      name: statName(kind, values[kind]),
      type: ChannelType.GuildVoice,
      parent: category.id,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, allow: [P.ViewChannel], deny: [P.Connect] },
        { id: me.id, allow: [P.ViewChannel, P.Connect, P.ManageChannels] },
      ],
      reason: "Salons compteurs",
    });
    saveStatChannel(guild.id, kind, channel.id, category.id);
    db.prepare("UPDATE stat_channels SET last_name=?, updated_at=? WHERE guild_id=? AND kind=?").run(channel.name, Date.now(), guild.id, kind);
    created.push(channel);
  }
  return { category, created };
}

async function uninstall(guild) {
  const rows = statRows(guild.id);
  if (!rows.length) throw new Error("Aucun salon compteur sur ce serveur.");
  let deleted = 0;
  for (const row of rows) {
    const channel = guild.channels.cache.get(row.channel_id);
    if (channel && await channel.delete("Salons compteurs retirés").then(() => true).catch(() => false)) deleted += 1;
  }
  const categoryId = rows[0].category_id;
  db.prepare("DELETE FROM stat_channels WHERE guild_id=?").run(guild.id);
  const category = categoryId ? guild.channels.cache.get(categoryId) : null;
  if (category && !guild.channels.cache.some((c) => c.parentId === category.id)) await category.delete("Salons compteurs retirés").catch(() => {});
  return deleted;
}

export async function handleStatChannelsInteraction(interaction) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== "compteurs" || !interaction.guild) return false;
  try {
    if (!isAdmin(interaction.member)) throw new Error("Réservé aux admins (Gérer le serveur ou Gérer les salons).");
    const sub = interaction.options.getSubcommand(false) ?? "installer";
    await interaction.deferReply({ ephemeral: true });
    let content;
    if (sub === "installer") {
      const { created } = await install(interaction.guild);
      content = created.length ? `📊 ${created.length} salon(s) compteur(s) créé(s) en haut du serveur. Mise à jour toutes les 10 minutes.` : "📊 Les salons compteurs sont déjà en place.";
    } else if (sub === "retirer") {
      content = `🗑️ ${await uninstall(interaction.guild)} salon(s) compteur(s) supprimé(s).`;
    } else {
      const renamed = await refreshGuildStats(interaction.guild, { force: true });
      content = renamed ? `🔄 ${renamed} compteur(s) mis à jour.` : "🔄 Compteurs déjà à jour (ou Discord limite les renommages : 2 par 10 minutes et par salon).";
    }
    await interaction.editReply({ content, allowedMentions: { parse: [] } });
  } catch (error) {
    await respondInPlaceSafe(interaction, { content: `❌ ${error.message}`, ephemeral: true, allowedMentions: { parse: [] } });
  }
  return true;
}
