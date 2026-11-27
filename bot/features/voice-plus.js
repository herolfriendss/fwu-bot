// FDPDLAVOC — /vocal-plus : préréglages nommés de ton vocal temporaire (nom + limite) et classement du temps en vocal.
import { db } from "../database.js";

export const VOICE_PLUS_COMMANDS = new Set(["vocal-plus"]);
export const MAX_PRESETS = 10;
db.exec("CREATE TABLE IF NOT EXISTS voice_presets (guild_id TEXT NOT NULL, owner_id TEXT NOT NULL, name TEXT NOT NULL, channel_name TEXT NOT NULL, user_limit INTEGER NOT NULL, PRIMARY KEY (guild_id, owner_id, name))");

class UserError extends Error {}
const PERIODS = { semaine: 7 * 86_400_000, mois: 30 * 86_400_000, total: null };
export const presetKey = (name) => String(name ?? "").trim().toLowerCase().replace(/[^a-z0-9àâçéèêëîïôûùüÿñæœ -]/g, "").slice(0, 30);

export function voiceLeaderboard(guildId, period = "semaine", now = Date.now()) {
  const span = Object.hasOwn(PERIODS, period) ? PERIODS[period] : PERIODS.semaine;
  const since = span ? now - span : 0;
  return db.prepare(`SELECT user_id, SUM(COALESCE(duration_ms, 0)) AS ms FROM voice_sessions
    WHERE guild_id=? AND joined_at>=? GROUP BY user_id HAVING ms > 0 ORDER BY ms DESC LIMIT 10`).all(guildId, since);
}
export const hours = (ms) => `${Math.floor(ms / 3_600_000)} h ${String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, "0")}`;

function ownedTempChannel(member) {
  const channel = member?.voice?.channel;
  if (!channel) throw new UserError("🎧 Rejoins ton salon vocal temporaire d'abord.");
  const row = db.prepare("SELECT owner_id FROM temp_voice WHERE channel_id=?").get(channel.id);
  if (!row) throw new UserError("Ce salon n'est pas un vocal temporaire.");
  if (row.owner_id !== member.id) throw new UserError("⛔ Seul le propriétaire du vocal peut faire ça.");
  return channel;
}

async function execute(interaction) {
  const guild = interaction.guild;
  const o = interaction.options;
  const sub = o.getSubcommand();
  if (sub === "classement") {
    const period = o.getString("periode") ?? "semaine";
    const rows = voiceLeaderboard(guild.id, period);
    if (!rows.length) return "Personne en vocal sur cette période.";
    const medals = ["🥇", "🥈", "🥉"];
    return `🎙️ **Classement vocal (${period})**\n${rows.map((r, i) => `${medals[i] ?? `${i + 1}.`} <@${r.user_id}> — ${hours(r.ms)}`).join("\n")}`;
  }
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (sub === "preset-liste") {
    const rows = db.prepare("SELECT name, channel_name, user_limit FROM voice_presets WHERE guild_id=? AND owner_id=? ORDER BY name").all(guild.id, interaction.user.id);
    return rows.length ? `🎛️ Tes préréglages :\n${rows.map((r) => `• **${r.name}** : « ${r.channel_name} », ${r.user_limit || "sans"} limite`).join("\n")}` : "Aucun préréglage. `/vocal-plus preset-sauver` enregistre ton vocal actuel.";
  }
  const name = presetKey(o.getString("nom", true));
  if (!name) throw new UserError("Nom de préréglage invalide.");
  if (sub === "preset-supprimer") {
    const done = db.prepare("DELETE FROM voice_presets WHERE guild_id=? AND owner_id=? AND name=?").run(guild.id, interaction.user.id, name).changes;
    return done ? `🗑️ Préréglage **${name}** supprimé.` : "Préréglage introuvable.";
  }
  const channel = ownedTempChannel(member);
  if (sub === "preset-sauver") {
    const count = db.prepare("SELECT COUNT(*) AS n FROM voice_presets WHERE guild_id=? AND owner_id=?").get(guild.id, interaction.user.id).n;
    const exists = db.prepare("SELECT 1 FROM voice_presets WHERE guild_id=? AND owner_id=? AND name=?").get(guild.id, interaction.user.id, name);
    if (!exists && count >= MAX_PRESETS) throw new UserError(`${MAX_PRESETS} préréglages au plus : supprimes-en un.`);
    db.prepare("INSERT OR REPLACE INTO voice_presets VALUES (?,?,?,?,?)").run(guild.id, interaction.user.id, name, String(channel.name).slice(0, 90), Number(channel.userLimit ?? 0));
    return `💾 Préréglage **${name}** enregistré : « ${channel.name} », ${channel.userLimit || "sans"} limite.`;
  }
  if (sub === "preset-charger") {
    const preset = db.prepare("SELECT channel_name, user_limit FROM voice_presets WHERE guild_id=? AND owner_id=? AND name=?").get(guild.id, interaction.user.id, name);
    if (!preset) throw new UserError("Préréglage introuvable (`/vocal-plus preset-liste`).");
    await channel.edit({ name: preset.channel_name, userLimit: preset.user_limit }, "Préréglage vocal");
    return `🎛️ Préréglage **${name}** appliqué.`;
  }
  throw new UserError("Sous-commande inconnue.");
}

export async function handleVoicePlusInteraction(interaction, record = () => {}) {
  if (!interaction.isChatInputCommand?.() || !VOICE_PLUS_COMMANDS.has(interaction.commandName)) return false;
  if (!interaction.inGuild()) { await interaction.reply({ content: "Seulement dans un serveur.", ephemeral: true }); return true; }
  await interaction.deferReply({ ephemeral: interaction.options.getSubcommand() !== "classement" });
  try { await interaction.editReply({ content: await execute(interaction), allowedMentions: { parse: [] } }); }
  catch (error) {
    if (!(error instanceof UserError)) record("voice_plus_error");
    await interaction.editReply({ content: error instanceof UserError ? error.message : "❌ Action impossible (permission « Gérer les salons » ?).", allowedMentions: { parse: [] } }).catch(() => {});
  }
  return true;
}
