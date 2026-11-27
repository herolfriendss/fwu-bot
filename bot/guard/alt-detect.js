// GUARD — repérage des doubles comptes (contournement de bannissement).
// Un bot Discord ne voit ni IP ni appareil : on compare seulement ce qui est public
// (nom, pseudo affiché, photo de profil, âge du compte) avec la liste des bannis du serveur.
// Jamais de sanction automatique : une alerte au staff, qui décide (=casier, =ban…).
//   À l'arrivée : alerte dans les logs de modération si le score atteint le seuil.
//   /doublecompte membre (ou +doublecompte @membre) : vérification à la demande (staff).
import { EmbedBuilder, PermissionFlagsBits as P } from "discord.js";
import { memberTier } from "../shared/tiers.js";

export const ALT_COMMANDS = new Set(["doublecompte"]);
export const ALT = Object.freeze({ threshold: 50, sameAvatar: 60, similarName: 40, closeName: 25, youngAccountDays: 7, youngAccount: 15, defaultAvatar: 5, banCacheMs: 10 * 60_000, maxMatches: 3 });

const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b", "@": "a", $: "s", "!": "i" };

/** "xX_D4rk.V4d0r_99Xx" → "darkvador" : minuscules, sans accents, leet, sans chiffres finaux ni répétitions. */
export function normalizeName(name) {
  let text = String(name ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  text = text.replace(/[0-9@$!]/g, (c, i, all) => {
    // Les chiffres en fin de nom (« dark99 ») sont du bruit ; au milieu, souvent du leet.
    if (/[0-9]/.test(c) && /^[0-9]*$/.test(all.slice(i))) return "";
    return LEET[c] ?? "";
  });
  // Décorations « xX_…_Xx » (au moins deux x), puis tout ce qui n'est pas une lettre.
  text = text.replace(/^x{2,}(?=[^x])|(?<=[^x])x{2,}$/g, "").replace(/[^a-z]/g, "").replace(/(.)\1+/g, "$1");
  return text;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/** Ressemblance de deux noms normalisés, de 0 à 1 (noms de moins de 4 lettres : identiques ou rien). */
export function nameSimilarity(a, b) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (Math.min(x.length, y.length) < 4) return 0;
  if (x.includes(y) || y.includes(x)) return Math.min(x.length, y.length) / Math.max(x.length, y.length) >= 0.6 ? 0.9 : 0.7;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

const namesOf = (user) => [user?.username, user?.globalName, user?.displayName].filter((n) => typeof n === "string" && n.trim());

/**
 * Score d'un compte face à un banni. `user` et `banned` : { id, username, globalName, avatar, createdTimestamp }.
 * Rend { score, reasons } (raisons en français, pour le staff).
 */
export function scoreAgainst(user, banned, now = Date.now()) {
  if (!user || !banned || user.id === banned.id) return { score: 0, reasons: [] };
  let score = 0;
  const reasons = [];
  if (user.avatar && banned.avatar && user.avatar === banned.avatar) { score += ALT.sameAvatar; reasons.push("même photo de profil"); }
  let best = 0;
  for (const a of namesOf(user)) for (const b of namesOf(banned)) best = Math.max(best, nameSimilarity(a, b));
  if (best >= 0.85) { score += ALT.similarName; reasons.push(`nom presque identique (${Math.round(best * 100)} %)`); }
  else if (best >= 0.7) { score += ALT.closeName; reasons.push(`nom ressemblant (${Math.round(best * 100)} %)`); }
  if (score > 0) {
    const ageDays = user.createdTimestamp ? (now - user.createdTimestamp) / 86_400_000 : null;
    if (ageDays != null && ageDays < ALT.youngAccountDays) { score += ALT.youngAccount; reasons.push(`compte créé il y a ${Math.max(0, Math.floor(ageDays))} j`); }
    if (!user.avatar) { score += ALT.defaultAvatar; reasons.push("photo de profil par défaut"); }
  }
  return { score: Math.min(100, score), reasons };
}

/** Meilleures correspondances au-dessus du seuil, de la plus forte à la plus faible. */
export function findAltMatches(user, bannedUsers, { now = Date.now(), threshold = ALT.threshold } = {}) {
  return bannedUsers
    .map((banned) => ({ banned, ...scoreAgainst(user, banned, now) }))
    .filter((m) => m.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, ALT.maxMatches);
}

// ---------------------------------------------------------------- Discord
const banCache = new Map(); // guildId → { at, users }

export function forgetBanList(guildId) {
  banCache.delete(guildId);
}

async function bannedUsersOf(guild, now = Date.now()) {
  const cached = banCache.get(guild.id);
  if (cached && now - cached.at < ALT.banCacheMs) return cached.users;
  const bans = await guild.bans.fetch({ limit: 1000 }).catch(() => null);
  if (!bans) return cached?.users ?? [];
  const users = [...bans.values()].map((ban) => ({
    id: ban.user.id, username: ban.user.username, globalName: ban.user.globalName ?? null, avatar: ban.user.avatar ?? null, reason: ban.reason ?? null,
  }));
  banCache.set(guild.id, { at: now, users });
  return users;
}

const plainUser = (user) => ({ id: user.id, username: user.username, globalName: user.globalName ?? null, avatar: user.avatar ?? null, createdTimestamp: user.createdTimestamp ?? null });

function matchLines(matches) {
  return matches.map((m) => `• **${m.score}/100** · ressemble à **${m.banned.username}** (\`${m.banned.id}\`, banni${m.banned.reason ? ` : ${String(m.banned.reason).slice(0, 80)}` : ""})\n  ${m.reasons.join(", ")}`).join("\n");
}

/** À l'arrivée d'un membre : alerte le staff si le compte ressemble fortement à un banni. */
export async function checkAltOnJoin(member, { sendLog, record = () => {}, now = Date.now() } = {}) {
  if (!member?.guild || member.user?.bot) return null;
  const matches = findAltMatches(plainUser(member.user), await bannedUsersOf(member.guild, now), { now });
  if (!matches.length) return null;
  record("alt_suspect");
  const embed = new EmbedBuilder().setColor(0xf59e0b).setTitle("🕵️ Double compte possible")
    .setDescription([
      `Arrivée : <@${member.id}> (\`${member.id}\`)`,
      matchLines(matches),
      "",
      "Aucune sanction automatique : vérifie avant d'agir (`/quarantaine` pour l'isoler, `+casier`, `+ban`). Les ressemblances de nom ou de photo peuvent être des coïncidences.",
    ].join("\n").slice(0, 4000))
    .setTimestamp(new Date(now));
  await sendLog?.(embed);
  return matches;
}

async function isAltStaff(member) {
  if (!member) return false;
  if (member.id === member.guild?.ownerId || member.permissions?.has?.(P.BanMembers) || member.permissions?.has?.(P.ModerateMembers) || member.permissions?.has?.(P.Administrator)) return true;
  const tier = await memberTier(member).catch(() => null);
  return tier != null && tier <= 10;
}

async function checkReport(guild, user) {
  const matches = findAltMatches(plainUser(user), await bannedUsersOf(guild), { threshold: 25 });
  if (!matches.length) return `✅ <@${user.id}> ne ressemble à aucun compte banni du serveur (nom et photo de profil comparés).`;
  const strong = matches[0].score >= ALT.threshold;
  return `${strong ? "🕵️ **Double compte possible**" : "ℹ️ Ressemblances faibles"} pour <@${user.id}> :\n${matchLines(matches)}\n\nIndice seulement : à confirmer par le staff.`;
}

export async function handleAltInteraction(interaction) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== "doublecompte" || !interaction.guild) return false;
  if (!(await isAltStaff(interaction.member))) {
    await interaction.reply({ content: "⛔ Réservé au staff (Bannir ou Exclure des membres, ou palier 10 %).", ephemeral: true }).catch(() => {});
    return true;
  }
  const user = interaction.options.getUser("membre", true);
  await interaction.deferReply({ ephemeral: true });
  const content = await checkReport(interaction.guild, user).catch(() => "❌ Liste des bannis illisible (permission « Bannir des membres » requise pour le bot).");
  await interaction.editReply({ content, allowedMentions: { parse: [] } }).catch(() => {});
  return true;
}

/** `+doublecompte @membre|ID` (forme canonique « =doublecompte »). */
export async function handleAltMessage(message) {
  const match = /^=doublecompte(?=$|\s)\s*(?:<@!?(\d{17,20})>|(\d{17,20}))?/i.exec(String(message?.content ?? "").trim());
  if (!match || !message.guild) return false;
  const say = (content) => message.reply({ content, allowedMentions: { parse: [], repliedUser: false } }).catch(() => null);
  if (!(await isAltStaff(message.member))) { await say("⛔ Réservé au staff (Bannir ou Exclure des membres, ou palier 10 %)."); return true; }
  const id = match[1] ?? match[2];
  if (!id) { await say("Utilisation : `=doublecompte @membre|ID`"); return true; }
  const user = await message.client.users.fetch(id).catch(() => null);
  if (!user) { await say("❌ Utilisateur Discord introuvable pour cet identifiant."); return true; }
  await say(await checkReport(message.guild, user).catch(() => "❌ Liste des bannis illisible (permission « Bannir des membres » requise pour le bot)."));
  return true;
}
