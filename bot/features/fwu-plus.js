// Bot principal — ajouts du 27/11 :
//  /heure (fuseau des membres), /citation, /archive, /resume (IA), /salon-temp, /sante (état des 6 bots),
//  /defi (défi collectif de la semaine), /export-config (owner), remerciement des boosters,
//  résumé du dimanche (arrivées, classement vocal récompensé).
import Anthropic from "@anthropic-ai/sdk";
import { AttachmentBuilder, ChannelType, PermissionFlagsBits as P } from "discord.js";
import { db } from "../database.js";
import { recordAiUsage } from "../ai-usage.js";
import { BOT_PROFILE_IDS, listDomainLeases } from "../bot-runtime.js";
import { parsePndOwnerId } from "../pnd-owner-policy.js";
import { isSysPlus } from "../systems/sysplus/permissions.js";

export const FWU_PLUS_COMMANDS = new Set(["heure", "citation", "archive", "resume-salon", "salon-temp", "sante", "defi", "export-config"]);
export const RESUME_MODEL = "claude-haiku-5-5";
export const BOOST_REWARD = 500;
export const VOICE_PODIUM_REWARDS = Object.freeze([300, 200, 100]);

db.exec(`CREATE TABLE IF NOT EXISTS member_timezones (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, tz TEXT NOT NULL, PRIMARY KEY (guild_id, user_id));
  CREATE TABLE IF NOT EXISTS temp_text_channels (channel_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, delete_at INTEGER NOT NULL, created_by TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS weekly_challenge (guild_id TEXT NOT NULL, week INTEGER NOT NULL, goal INTEGER NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
    reward INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0, channel_id TEXT, PRIMARY KEY (guild_id, week));
  CREATE TABLE IF NOT EXISTS weekly_challenge_members (guild_id TEXT NOT NULL, week INTEGER NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (guild_id, week, user_id));
  CREATE TABLE IF NOT EXISTS weekly_summary_sent (guild_id TEXT NOT NULL, week INTEGER NOT NULL, PRIMARY KEY (guild_id, week));`);

class UserError extends Error {}
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
const clean = (text, max = 200) => String(text ?? "").replace(/[*_`~|>]/g, "").replace(/@/g, "＠").slice(0, max);
export const weekNumber = (now = Date.now()) => Math.floor((now + 3 * 86_400_000) / (7 * 86_400_000)); // semaines commençant le lundi

// ── /heure ────────────────────────────────────────────────────────────────
export function validTimeZone(tz) {
  try { new Intl.DateTimeFormat("fr-FR", { timeZone: String(tz) }); return /^[A-Za-z_]+(?:\/[A-Za-z_+-]+){0,2}$/.test(String(tz)); } catch { return false; }
}
export function localTime(tz, now = Date.now()) {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "long" }).format(new Date(now));
}

// ── /archive ──────────────────────────────────────────────────────────────
export function transcript(messages) {
  return messages.map((m) => `[${new Date(m.createdTimestamp).toISOString().replace("T", " ").slice(0, 16)}] ${m.author?.username ?? "?"}: ${String(m.content ?? "").replace(/\r?\n/g, " ")}${m.attachments?.size ? ` [${m.attachments.size} pièce(s) jointe(s)]` : ""}`).join("\n");
}

// ── /resume (IA) ──────────────────────────────────────────────────────────
let anthropic = null;
function aiClient() {
  if (!String(process.env.ANTHROPIC_API_KEY ?? "").trim()) return null;
  anthropic ??= new Anthropic({ timeout: 45_000, maxRetries: 1 });
  return anthropic;
}
/** Only public channels can be summarised: never what @everyone cannot read. */
export function isPublicChannel(channel) {
  const everyone = channel?.guild?.roles?.everyone;
  return Boolean(everyone && channel.permissionsFor?.(everyone)?.has(P.ViewChannel));
}
export async function summarise(lines, { client = aiClient() } = {}) {
  if (!client) throw new UserError("Résumé indisponible : la clé IA n'est pas configurée sur le serveur du bot.");
  const response = await client.messages.create({
    model: RESUME_MODEL,
    max_tokens: 700,
    system: "Tu résumes une conversation Discord en français, en 5 à 8 puces courtes : sujets, décisions, questions restées ouvertes. Pas de citation mot pour mot, pas de jugement sur les personnes, aucune donnée personnelle (adresses, numéros).",
    messages: [{ role: "user", content: lines.slice(-12_000) }],
  });
  const out = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  if (!out || response.stop_reason === "refusal") throw new UserError("Le résumé a été refusé.");
  recordAiUsage("resume");
  return out.slice(0, 1800);
}

// ── /sante ────────────────────────────────────────────────────────────────
const BOT_NAMES = { fwu: "Bot principal", guard: "GUARD", fdpdlavoc: "FDPDLAVOC", suckme: "SUCK ME", fisc: "LE FISC", investplus: "Invest +" };
export function healthLines(leases, failures, now = Date.now()) {
  return BOT_PROFILE_IDS.map((profile) => {
    const lease = leases.find((l) => l.domain === profile);
    const alive = lease && Number(lease.expiresAt ?? lease.expires_at) > now;
    const fail = failures.find((f) => f.profile === profile);
    const state = alive ? "🟢 en ligne" : profile === "fwu" ? "🟢 en ligne (c'est moi)" : "🔴 hors ligne (le bot principal assure ses protections)";
    return `${BOT_NAMES[profile] ?? profile} : ${state}${fail?.failures ? ` · ${fail.failures} échec(s) de connexion récents` : ""}`;
  });
}

// ── /defi ─────────────────────────────────────────────────────────────────
export function challengeProgress(row) {
  if (!row) return null;
  const pct = Math.min(100, Math.round((row.progress / row.goal) * 100));
  return { pct, bar: `${"█".repeat(Math.round(pct / 10))}${"░".repeat(10 - Math.round(pct / 10))}`, done: Boolean(row.done) };
}
/** messageCreate: counts one message towards this week's challenge. Returns the row when it just completed. */
export function countChallengeMessage(guildId, userId, now = Date.now()) {
  const week = weekNumber(now);
  const row = safe(() => db.prepare("SELECT * FROM weekly_challenge WHERE guild_id=? AND week=?").get(guildId, week), null);
  if (!row || row.done) return null;
  db.prepare("UPDATE weekly_challenge SET progress = progress + 1 WHERE guild_id=? AND week=?").run(guildId, week);
  db.prepare("INSERT OR IGNORE INTO weekly_challenge_members VALUES (?,?,?)").run(guildId, week, userId);
  if (row.progress + 1 < row.goal) return null;
  db.prepare("UPDATE weekly_challenge SET done = 1 WHERE guild_id=? AND week=? AND done=0").run(guildId, week);
  return { ...row, progress: row.progress + 1, done: 1 };
}

async function payChallenge(guild, row, grant) {
  const members = safe(() => db.prepare("SELECT user_id FROM weekly_challenge_members WHERE guild_id=? AND week=?").all(guild.id, row.week), []);
  let paid = 0;
  for (const { user_id: userId } of members) { try { grant(guild.id, userId, row.reward, "defi_collectif"); paid++; } catch { /* plafond */ } }
  const channel = row.channel_id ? await guild.channels.fetch(row.channel_id).catch(() => null) : guild.systemChannel;
  await channel?.send?.({ content: `🏆 **Défi collectif réussi !** ${row.goal.toLocaleString("fr-FR")} messages cette semaine. ${paid} participant(s) gagnent ${row.reward} PND chacun.`, allowedMentions: { parse: [] } }).catch(() => {});
}

// ── Commandes ─────────────────────────────────────────────────────────────
async function execute(interaction, settings, { grant }) {
  const guild = interaction.guild;
  const o = interaction.options;
  const name = interaction.commandName;
  const member = await guild.members.fetch(interaction.user.id).catch(() => interaction.member);
  const staff = member?.permissions?.has?.(P.ManageMessages) || isSysPlus(member, settings?.sysPlus?.roleId ?? null);

  if (name === "heure") {
    const sub = o.getSubcommand();
    if (sub === "regler") {
      const tz = String(o.getString("fuseau", true)).trim();
      if (!validTimeZone(tz)) throw new UserError("Fuseau inconnu. Exemples : `Europe/Paris`, `America/Montreal`, `Africa/Abidjan`.");
      db.prepare("INSERT OR REPLACE INTO member_timezones VALUES (?,?,?)").run(guild.id, interaction.user.id, tz);
      return { content: `🕐 Fuseau enregistré : **${tz}** (chez toi : ${localTime(tz)}).`, ephemeral: true };
    }
    const user = o.getUser("membre") ?? interaction.user;
    const row = safe(() => db.prepare("SELECT tz FROM member_timezones WHERE guild_id=? AND user_id=?").get(guild.id, user.id), null);
    if (!row) return { content: `<@${user.id}> n'a pas indiqué son fuseau (\`/heure regler\`).`, ephemeral: true };
    return { content: `🕐 Chez <@${user.id}> (${row.tz}) : **${localTime(row.tz)}**.` };
  }

  if (name === "citation") {
    const link = String(o.getString("lien", true));
    const match = link.match(/channels\/(\d+)\/(\d+)\/(\d+)/);
    if (!match || match[1] !== guild.id) throw new UserError("Colle le lien d'un message de ce serveur (clic droit → Copier le lien du message).");
    const channel = await guild.channels.fetch(match[2]).catch(() => null);
    if (!channel?.permissionsFor?.(member)?.has(P.ViewChannel)) throw new UserError("Tu n'as pas accès à ce salon.");
    const message = await channel.messages?.fetch(match[3]).catch(() => null);
    if (!message?.content) throw new UserError("Message introuvable ou sans texte.");
    return { embeds: [{ color: 0xffffff, description: `> ${clean(message.content, 900).replace(/\n/g, "\n> ")}`, footer: { text: `— ${clean(message.member?.displayName ?? message.author.username, 60)}` }, timestamp: new Date(message.createdTimestamp).toISOString() }] };
  }

  if (name === "archive") {
    if (!staff) throw new UserError("⛔ Réservé au staff.");
    const channel = o.getChannel("salon") ?? interaction.channel;
    const count = Math.min(500, Math.max(10, o.getInteger("messages") ?? 200));
    if (!channel?.messages?.fetch) throw new UserError("Choisis un salon textuel.");
    if (!channel.permissionsFor(member)?.has(P.ViewChannel) || !channel.permissionsFor(member)?.has(P.ReadMessageHistory)) throw new UserError("Tu ne peux pas lire l'historique de ce salon.");
    const all = [];
    let before;
    while (all.length < count) {
      const batch = await channel.messages.fetch({ limit: Math.min(100, count - all.length), before }).catch(() => null);
      if (!batch?.size) break;
      all.push(...batch.values());
      before = batch.last().id;
    }
    const text = transcript(all.reverse());
    const file = new AttachmentBuilder(Buffer.from(text, "utf8"), { name: `archive-${channel.name}-${new Date().toISOString().slice(0, 10)}.txt` });
    return { content: `🗄️ Archive de <#${channel.id}> : ${all.length} message(s).`, files: [file], ephemeral: true };
  }

  if (name === "resume-salon") {
    const channel = o.getChannel("salon") ?? interaction.channel;
    const hours = Math.min(24, Math.max(1, o.getInteger("heures") ?? 3));
    if (!channel?.messages?.fetch) throw new UserError("Choisis un salon textuel.");
    if (!isPublicChannel(channel)) throw new UserError("Je ne résume que les salons publics.");
    const since = Date.now() - hours * 3_600_000;
    const batch = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    const recent = [...(batch?.values() ?? [])].filter((m) => !m.author.bot && m.createdTimestamp >= since && m.content).reverse();
    if (recent.length < 5) return { content: "Pas assez de messages récents pour un résumé.", ephemeral: true };
    const summary = await summarise(transcript(recent));
    return { content: `📝 **Résumé de <#${channel.id}> (${hours} h, ${recent.length} messages)**\n${summary}`, ephemeral: true };
  }

  if (name === "salon-temp") {
    if (!member?.permissions?.has?.(P.ManageChannels)) throw new UserError("⛔ Il te faut « Gérer les salons ».");
    const hours = Math.min(168, Math.max(1, o.getInteger("heures") ?? 24));
    const channel = await guild.channels.create({ name: String(o.getString("nom", true)).toLowerCase().replace(/[^a-z0-9-éèàç]/g, "-").slice(0, 90) || "evenement", type: ChannelType.GuildText, parent: interaction.channel?.parentId ?? null, reason: `Salon temporaire (${hours} h) par ${interaction.user.id}` });
    db.prepare("INSERT INTO temp_text_channels VALUES (?,?,?,?)").run(channel.id, guild.id, Date.now() + hours * 3_600_000, interaction.user.id);
    return { content: `🗓️ <#${channel.id}> créé ; il sera supprimé <t:${Math.floor((Date.now() + hours * 3_600_000) / 1000)}:R>.` };
  }

  if (name === "sante") {
    if (!staff) throw new UserError("⛔ Réservé au staff.");
    const leases = safe(() => listDomainLeases(), []);
    const failures = safe(() => db.prepare("SELECT profile, failures FROM bot_gateway_failures WHERE last_at > ?").all(Date.now() - 30 * 60_000), []);
    return { content: `🩺 **État des bots**\n${healthLines(leases, failures).join("\n")}`, ephemeral: true };
  }

  if (name === "defi") {
    const sub = o.getSubcommand();
    const week = weekNumber();
    if (sub === "lancer") {
      if (!member?.permissions?.has?.(P.ManageGuild)) throw new UserError("⛔ Il te faut « Gérer le serveur ».");
      const goal = o.getInteger("messages", true);
      const reward = o.getInteger("recompense") ?? 100;
      db.prepare("INSERT OR REPLACE INTO weekly_challenge(guild_id, week, goal, progress, reward, done, channel_id) VALUES (?,?,?,0,?,0,?)").run(guild.id, week, goal, reward, interaction.channelId);
      db.prepare("DELETE FROM weekly_challenge_members WHERE guild_id=? AND week=?").run(guild.id, week);
      return { content: `🎯 **Défi collectif de la semaine** : ${goal.toLocaleString("fr-FR")} messages tous ensemble avant dimanche soir. Chaque participant gagnera **${reward} PND** si on y arrive !` };
    }
    const row = safe(() => db.prepare("SELECT * FROM weekly_challenge WHERE guild_id=? AND week=?").get(guild.id, week), null);
    const p = challengeProgress(row);
    if (!p) return { content: "Aucun défi cette semaine.", ephemeral: true };
    return { content: `🎯 Défi : ${row.progress.toLocaleString("fr-FR")}/${row.goal.toLocaleString("fr-FR")} messages\n${p.bar} ${p.pct} %${p.done ? " — réussi ✅" : ""}` };
  }

  if (name === "export-config") {
    const ownerId = parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);
    if (!ownerId || interaction.user.id !== ownerId) throw new UserError("⛔ Réservé à l'owner.");
    const json = JSON.stringify({ exportedAt: new Date().toISOString(), guildId: guild.id, settings: redactSecrets(settings ?? {}) }, null, 2);
    const file = new AttachmentBuilder(Buffer.from(json, "utf8"), { name: `config-${guild.id}-${new Date().toISOString().slice(0, 10)}.json` });
    const dm = await interaction.user.send({ content: `💾 Configuration de **${clean(guild.name, 80)}**. Garde ce fichier en lieu sûr.`, files: [file] }).catch(() => null);
    return { content: dm ? "💾 Configuration envoyée en message privé." : "❌ Impossible de t'écrire en privé : ouvre tes MP.", ephemeral: true };
  }
  return null;
}

/** Removes anything that looks like a secret before an export. */
export function redactSecrets(value, key = "") {
  if (/secret|token|password|apikey|api_key|webhook/i.test(key)) return "[retiré]";
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactSecrets(v, k)]));
  if (typeof value === "string" && /https:\/\/(discord(app)?\.com)\/api\/webhooks\//.test(value)) return "[retiré]";
  return value;
}

export async function handleFwuPlusInteraction(interaction, settings = {}, { grant = () => {}, record = () => {} } = {}) {
  if (!interaction.isChatInputCommand?.() || !FWU_PLUS_COMMANDS.has(interaction.commandName)) return false;
  if (!interaction.inGuild()) { await interaction.reply({ content: "Seulement dans un serveur.", ephemeral: true }); return true; }
  const ephemeralFirst = ["archive", "resume-salon", "sante", "export-config"].includes(interaction.commandName) || (interaction.commandName === "heure" && interaction.options.getSubcommand() === "regler");
  await interaction.deferReply({ ephemeral: ephemeralFirst });
  try {
    const payload = await execute(interaction, settings, { grant });
    await interaction.editReply({ ...payload, ephemeral: undefined, allowedMentions: { parse: [] } });
  } catch (error) {
    if (!(error instanceof UserError)) record("fwu_plus_error");
    await interaction.editReply({ content: error instanceof UserError ? error.message : "❌ Action impossible : vérifie mes permissions.", allowedMentions: { parse: [] } }).catch(() => {});
  }
  return true;
}

/** Deletes temporary channels whose time is up (every minute). */
export async function expireTempChannels(client, now = Date.now()) {
  const rows = safe(() => db.prepare("SELECT * FROM temp_text_channels WHERE delete_at<=?").all(now), []);
  for (const row of rows) {
    db.prepare("DELETE FROM temp_text_channels WHERE channel_id=?").run(row.channel_id);
    const channel = await client.channels.fetch(row.channel_id).catch(() => null);
    await channel?.delete?.("Fin du salon temporaire").catch(() => {});
  }
  return rows.length;
}

/** guildMemberUpdate: thanks a new booster and rewards them once per boost start. */
export async function handleBoost(oldMember, newMember, { grant }) {
  if (oldMember.premiumSinceTimestamp || !newMember.premiumSinceTimestamp) return false;
  try { grant(newMember.guild.id, newMember.id, BOOST_REWARD, "boost_merci"); } catch { /* plafond */ }
  const channel = newMember.guild.systemChannel;
  await channel?.send?.({ content: `💜 Merci <@${newMember.id}> pour le boost ! +${BOOST_REWARD} PND, et le rôle Booster tant que le boost dure.`, allowedMentions: { users: [newMember.id] } }).catch(() => {});
  return true;
}

/** Sunday summary: arrivals, voice podium (rewarded), challenge result. Once per week and server. */
export async function sendWeeklySummary(guild, { grant, now = Date.now() }) {
  const week = weekNumber(now);
  if (safe(() => db.prepare("SELECT 1 FROM weekly_summary_sent WHERE guild_id=? AND week=?").get(guild.id, week), null)) return false;
  db.prepare("INSERT OR IGNORE INTO weekly_summary_sent VALUES (?,?)").run(guild.id, week);
  const since = now - 7 * 86_400_000;
  const arrivals = safe(() => db.prepare("SELECT COUNT(*) AS n FROM member_invite_attribution WHERE guild_id=? AND joined_at>?").get(guild.id, since).n, 0);
  const podium = safe(() => db.prepare("SELECT user_id, SUM(duration_ms) AS ms FROM voice_sessions WHERE guild_id=? AND joined_at>? AND duration_ms IS NOT NULL GROUP BY user_id ORDER BY ms DESC LIMIT 3").all(guild.id, since), []);
  podium.forEach((row, i) => { try { grant(guild.id, row.user_id, VOICE_PODIUM_REWARDS[i], "podium_vocal"); } catch { /* plafond */ } });
  const challenge = safe(() => db.prepare("SELECT * FROM weekly_challenge WHERE guild_id=? AND week=?").get(guild.id, week), null);
  const lines = [
    "📅 **Résumé de la semaine**",
    `Arrivées : ${arrivals}`,
    podium.length ? `🎙️ Podium vocal : ${podium.map((r, i) => `${["🥇", "🥈", "🥉"][i]} <@${r.user_id}> (${Math.round(r.ms / 3_600_000)} h, +${VOICE_PODIUM_REWARDS[i]} PND)`).join(" · ")}` : "🎙️ Pas de vocal cette semaine.",
    challenge ? `🎯 Défi collectif : ${challenge.done ? "réussi ✅" : `${challenge.progress}/${challenge.goal}, raté de peu`}` : null,
  ].filter(Boolean);
  await guild.systemChannel?.send?.({ content: lines.join("\n"), allowedMentions: { parse: [] } }).catch(() => {});
  return true;
}

export { payChallenge };
