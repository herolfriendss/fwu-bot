// FWU V2 — guide des permissions publié par le bot (SUCK ME : /guide, /pourquoi, =guide, =pourquoi).
//
// Les embeds sont générés depuis la configuration réelle : matrice des droits
// (permission-matrix.js, calculée avec les vraies règles), paliers (TIER_LABELS), quotas
// (base partagée), types de tempmute, rôles SYS+/ADMIN+/WHITELIST. Ils sont édités sur place
// quand le contenu change (contrôle périodique), avec « mis à jour le … ».
// Salon public : rangs, paliers et quotas exacts, sanctions, vocal privé, rôle perso.
// Salon staff (rôles choisis) : détail SYS+ et rangs staff.
import { createHash } from "node:crypto";
import { PermissionFlagsBits as P } from "discord.js";
import { db } from "./database.js";
import { parsePndOwnerId } from "./pnd-owner-policy.js";
import { MATRIX_TIERS, buildPermissionMatrix } from "./permission-matrix.js";
import { TIER_LABELS, MODERATION_TIERS } from "./shared/tiers.js";
import { QUOTA_COMMANDS, formatDurationFr } from "./shared/quotas.js";
import { DEFAULT_SANCTION_TYPES, MAX_SANCTION_SECONDS } from "./shared/sanctions.js";

db.exec(`CREATE TABLE IF NOT EXISTS guide_config (
  guild_id TEXT PRIMARY KEY,
  public_channel_id TEXT,
  staff_channel_id TEXT,
  staff_role_ids TEXT NOT NULL DEFAULT '[]',
  public_message_ids TEXT NOT NULL DEFAULT '[]',
  staff_message_ids TEXT NOT NULL DEFAULT '[]',
  public_hash TEXT,
  staff_hash TEXT
)`);

/** Sanctions présentes dans le code, toutes expliquées par le guide. */
export const GUIDE_SANCTIONS = Object.freeze([
  { key: "warn", name: "Avertissement (warn)", text: "Note officielle dans ton casier. Plusieurs avertissements peuvent mener à une sanction plus lourde." },
  { key: "tempmute", name: "Tempmute (silence temporaire)", text: "Tu ne peux plus écrire ni parler pendant la durée choisie. Fin automatique à l'expiration ; recours : ouvre un ticket ou utilise le bouton d'appel." },
  { key: "kick", name: "Expulsion (kick)", text: "Tu quittes le serveur ; tu peux revenir avec une invitation." },
  { key: "ban", name: "Bannissement (ban)", text: "Tu ne peux plus revenir. Tu reçois en MP le motif et un bouton « Faire appel » (7 jours) ; un appel accepté te débannit tout de suite." },
  { key: "tempban", name: "Ban temporaire (tempban)", text: "Tu ne peux plus revenir pendant la durée choisie, puis tu es débanni automatiquement. Même bouton d'appel en MP que pour un ban." },
  { key: "blacklist", name: "Blacklist", text: "Bannissement maintenu : un compte blacklisté est re-banni s'il revient." },
  { key: "blr", name: "BLR (blacklist rank)", text: "Punition ultime : tous tes rôles sont retirés sauf le rôle membre, et plus aucun rôle ne peut t'être donné, par aucun moyen. Posé et levé uniquement par l'OWNER et les paliers 0 % et 1 %." },
  { key: "dog", name: "DOG (laisse)", text: "Tu portes le rôle « En laisse » de ton maître et tu le suis en vocal." },
  { key: "menotte", name: "Menottes", text: "Tu es immobilisé dans ton salon vocal pendant la durée choisie." },
  { key: "quarantaine", name: "Quarantaine", text: "Accès réduit au serveur le temps que le staff vérifie ; tes rôles te sont rendus à la fin (sauf si tu es BLR)." },
]);

const SECTIONS = Object.freeze([
  { value: "rangs", label: "Rangs et accès" },
  { value: "paliers", label: "Paliers et quotas" },
  { value: "sanctions", label: "Sanctions" },
  { value: "vocal", label: "Vocal privé et rôle perso" },
]);

const fmtDate = (now) => `<t:${Math.floor(now / 1000)}:f>`;

function quotaLines(quotas) {
  if (!quotas?.length) return ["Quotas : valeurs par défaut (base partagée indisponible pour le détail)."];
  const byCommand = new Map();
  for (const q of quotas) {
    const list = byCommand.get(q.command) ?? [];
    list.push(`${q.tier} % : ${q.maxUses === null || q.maxUses === undefined ? "illimité" : `${q.maxUses} / ${formatDurationFr(q.windowSeconds)}`}`);
    byCommand.set(q.command, list);
  }
  return [...byCommand.entries()].map(([command, list]) => `**/${command}** — ${list.join(" · ")}`);
}

/**
 * Embeds publics. `ctx` = { matrix, quotas, sanctionTypes, roles: { sysPlus, adminPlus, whitelist }, now }.
 */
export function buildPublicGuide({ matrix, quotas = [], sanctionTypes = DEFAULT_SANCTION_TYPES, roles = {}, now = Date.now() }) {
  const role = (id, fallback) => (id ? `<@&${id}>` : fallback);
  const footer = { text: "Mis à jour automatiquement" };
  const rangs = {
    title: "📘 Guide — rangs et accès",
    description: [
      `Mis à jour le ${fmtDate(now)}.`,
      "",
      ...MATRIX_TIERS.map((tier) => {
        const allowed = matrix?.rows?.filter((row) => row.cells?.[tier.key]).map((row) => row.label) ?? [];
        return `**${tier.label}** — ${allowed.length ? allowed.slice(0, 6).join(", ") + (allowed.length > 6 ? `, +${allowed.length - 6}` : "") : "commandes membres"}`;
      }),
      "",
      `**SYS+** (${role(roles.sysPlus, "non configuré")}) : modération quotidienne avec quotas. Ne contourne jamais la hiérarchie des rôles ni les permissions Discord.`,
      `**ADMIN+** (${role(roles.adminPlus, "non configuré")}) : administration selon les portées activées par l'OWNER.`,
      `**WHITELIST** (${role(roles.whitelist, "non configuré")}) : exemption des limites internes uniquement ; ne donne aucun pouvoir sur les rôles, la hiérarchie ou les actions privilégiées.`,
      "Comment obtenir un rang : promotion par le staff (SYS+, ADMIN+) ou par l'OWNER (WHITELIST, paliers).",
    ].join("\n").slice(0, 4096),
    footer,
  };
  const paliers = {
    title: "📊 Guide — paliers et quotas exacts",
    description: [
      ...Object.entries(TIER_LABELS).map(([tier, label]) => `• **${label}**${MODERATION_TIERS.includes(Number(tier)) ? " — modération" : Number(tier) === 0 ? " — accès total, intouchable" : ""}`),
      "",
      `Commandes soumises aux quotas : ${QUOTA_COMMANDS.map((c) => `/${c}`).join(", ")}.`,
      ...quotaLines(quotas),
    ].join("\n").slice(0, 4096),
    footer,
  };
  const sanctions = {
    title: "⚖️ Guide — sanctions",
    description: GUIDE_SANCTIONS.map((s) => `**${s.name}** — ${s.text}`).join("\n").slice(0, 3500),
    fields: [{
      name: "Durées de tempmute",
      value: (sanctionTypes.length ? sanctionTypes.map((t) => `${t.name} : ${formatDurationFr(t.durationSeconds ?? t.duration_seconds)}`).join(" · ") : "—").slice(0, 1000) + `\nMaximum : ${formatDurationFr(MAX_SANCTION_SECONDS)}.`,
    }],
    footer,
  };
  const vocal = {
    title: "🎧 Guide — ton vocal privé et ton rôle perso",
    description: [
      "**Vocal privé** : tu peux le rendre privé, donner ou retirer l'accès, et le rouvrir. Quand tu le quittes, il retrouve ses permissions d'avant.",
      "**Rôle perso** : créé sans aucune permission ; tu choisis son nom et sa couleur, dans la limite de ton quota. Le signe % est refusé dans le nom.",
    ].join("\n"),
    footer,
  };
  return [rangs, paliers, sanctions, vocal];
}

/** Embed staff : détail SYS+ et rangs staff (limites, quotas, procédures). */
export function buildStaffGuide({ matrix, quotas = [], roles = {}, now = Date.now() }) {
  return [{
    title: "🛡️ Guide staff — SYS+ et rangs staff",
    description: [
      `Mis à jour le ${fmtDate(now)}.`,
      "",
      "**Matrice complète (calculée depuis le code)**",
      ...(matrix?.rows ?? []).map((row) => `${MATRIX_TIERS.map((tier) => (row.cells?.[tier.key] ? "✅" : "▫️")).join("")} ${row.label}`),
      "",
      "**Quotas par palier**",
      ...quotaLines(quotas),
      "",
      "**Procédures**",
      "• Toujours agir sur un membre en dessous de soi (hiérarchie vérifiée par le bot, slash et préfixe).",
      "• Les actions sensibles n'affichent qu'une ligne publique ; détails dans les journaux et `/dossier <numéro>`.",
      "• BLR : `/blr poser|lever` (OWNER, paliers 0 % et 1 %).",
      "• Raid : `/raid on`, `/panic` en dernier recours ; `/scan` pour l'audit.",
      roles.whitelist ? `• WHITELIST (<@&${roles.whitelist}>) n'ouvre aucune action privilégiée.` : null,
    ].filter((line) => line !== null).join("\n").slice(0, 4096),
    footer: { text: "Réservé au staff" },
  }];
}

export function guideConfig(guildId) {
  const row = db.prepare("SELECT * FROM guide_config WHERE guild_id = ?").get(String(guildId));
  return {
    publicChannelId: row?.public_channel_id ?? null, staffChannelId: row?.staff_channel_id ?? null,
    staffRoleIds: JSON.parse(row?.staff_role_ids ?? "[]"), publicMessageIds: JSON.parse(row?.public_message_ids ?? "[]"),
    staffMessageIds: JSON.parse(row?.staff_message_ids ?? "[]"), publicHash: row?.public_hash ?? null, staffHash: row?.staff_hash ?? null,
  };
}

function saveGuideConfig(guildId, patch) {
  const c = { ...guideConfig(guildId), ...patch };
  db.prepare(`INSERT INTO guide_config(guild_id, public_channel_id, staff_channel_id, staff_role_ids, public_message_ids, staff_message_ids, public_hash, staff_hash)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET public_channel_id = excluded.public_channel_id, staff_channel_id = excluded.staff_channel_id,
    staff_role_ids = excluded.staff_role_ids, public_message_ids = excluded.public_message_ids, staff_message_ids = excluded.staff_message_ids,
    public_hash = excluded.public_hash, staff_hash = excluded.staff_hash`)
    .run(String(guildId), c.publicChannelId, c.staffChannelId, JSON.stringify(c.staffRoleIds), JSON.stringify(c.publicMessageIds), JSON.stringify(c.staffMessageIds), c.publicHash, c.staffHash);
}

const hashOf = (embeds) => createHash("sha256").update(JSON.stringify(embeds.map((e) => ({ ...e, description: String(e.description ?? "").replace(/Mis à jour le <t:\d+:f>\./, "") })))).digest("hex");

async function gatherContext(guild, settings) {
  const roles = { sysPlus: settings?.sysPlus?.roleId ?? null, adminPlus: settings?.adminPlus?.roleId ?? null, whitelist: settings?.sysPlus?.whitelistRoleId ?? null };
  const matrix = buildPermissionMatrix({ guildId: guild.id, guildOwnerId: guild.ownerId, sysPlusRoleId: roles.sysPlus, adminPlusRoleId: roles.adminPlus, whitelistRoleId: roles.whitelist });
  let quotas = [];
  try { quotas = await (await import("./shared/quotas.js")).listQuotas(guild.id); } catch { quotas = []; }
  let sanctionTypes = DEFAULT_SANCTION_TYPES;
  try { sanctionTypes = await (await import("./shared/sanctions.js")).listSanctionTypes(guild.id); } catch { /* valeurs par défaut */ }
  return { roles, matrix, quotas, sanctionTypes };
}

async function upsertMessages(channel, embeds, previousIds) {
  const ids = [];
  for (let i = 0; i < embeds.length; i += 1) {
    const existing = previousIds[i] ? await channel.messages.fetch(previousIds[i]).catch(() => null) : null;
    if (existing) { await existing.edit({ embeds: [embeds[i]], allowedMentions: { parse: [] } }); ids.push(existing.id); }
    else { const sent = await channel.send({ embeds: [embeds[i]], allowedMentions: { parse: [] } }); ids.push(sent.id); }
  }
  return ids;
}

/** Publie ou met à jour le guide (seulement si le contenu a changé, sauf `force`). */
export async function publishGuide(guild, settings, { force = false, now = Date.now() } = {}) {
  const config = guideConfig(guild.id);
  const ctx = await gatherContext(guild, settings);
  const out = { public: false, staff: false };
  if (config.publicChannelId) {
    const embeds = buildPublicGuide({ ...ctx, now });
    const hash = hashOf(embeds);
    if (force || hash !== config.publicHash) {
      const channel = await guild.channels.fetch(config.publicChannelId).catch(() => null);
      if (channel?.send) { saveGuideConfig(guild.id, { publicMessageIds: await upsertMessages(channel, embeds, config.publicMessageIds), publicHash: hash }); out.public = true; }
    }
  }
  if (config.staffChannelId) {
    const embeds = buildStaffGuide({ ...ctx, now });
    const hash = hashOf(embeds);
    if (force || hash !== config.staffHash) {
      const channel = await guild.channels.fetch(config.staffChannelId).catch(() => null);
      if (channel?.send) { saveGuideConfig(guild.id, { staffMessageIds: await upsertMessages(channel, embeds, config.staffMessageIds), staffHash: hash }); out.staff = true; }
    }
  }
  return out;
}

/** Configure les salons ; le salon staff n'est visible que des rôles choisis. */
export async function configureGuide(guild, { publicChannel, staffChannel = null, staffRoleIds = [] }) {
  saveGuideConfig(guild.id, { publicChannelId: publicChannel?.id ?? null, staffChannelId: staffChannel?.id ?? null, staffRoleIds });
  if (staffChannel?.permissionOverwrites && staffRoleIds.length) {
    await staffChannel.permissionOverwrites.edit(guild.id, { ViewChannel: false }, { reason: "Guide staff : salon réservé" }).catch(() => {});
    for (const roleId of staffRoleIds) await staffChannel.permissionOverwrites.edit(roleId, { ViewChannel: true }, { reason: "Guide staff : rôle autorisé" }).catch(() => {});
  }
}

/** /pourquoi : explique, pour la personne qui demande, qui peut utiliser une commande. */
export function explainCommand({ matrix, commandPath, member, roles = {}, env = process.env }) {
  const path = String(commandPath ?? "").replace(/^[/=+;$-]/, "").trim().toLowerCase();
  const rows = (matrix?.rows ?? []).filter((row) => String(row.label).toLowerCase().includes(path.split(" ")[0]));
  const yours = [];
  if (member?.id && member.id === parsePndOwnerId(env.PND_OWNER_DISCORD_ID)) yours.push("OWNER");
  if (member?.id && member.id === member.guild?.ownerId) yours.push("Propriétaire Discord");
  if (roles.sysPlus && member?.roles?.cache?.has?.(roles.sysPlus)) yours.push("SYS+");
  if (roles.adminPlus && member?.roles?.cache?.has?.(roles.adminPlus)) yours.push("ADMIN+");
  if (roles.whitelist && member?.roles?.cache?.has?.(roles.whitelist)) yours.push("WHITELIST");
  if (member?.permissions?.has?.(P.Administrator)) yours.push("Admin Discord");
  if (!yours.length) yours.push("Membre");
  const lines = [`**/${path || "?"}**`, `Ton rang : ${yours.join(", ")}.`];
  if (rows.length) {
    for (const row of rows.slice(0, 5)) lines.push(`• ${row.label} : ${MATRIX_TIERS.filter((t) => row.cells?.[t.key]).map((t) => t.label).join(", ") || "personne"}`);
  } else {
    lines.push("Cette commande n'a pas de règle de rang particulière : les refus viennent alors de la hiérarchie (cible au-dessus de toi), d'un quota atteint, du gel du staff ou d'une permission Discord manquante.");
  }
  if (QUOTA_COMMANDS.includes(path.split(" ")[0])) lines.push(`Commande soumise aux quotas : \`/quota moi\` montre ce qu'il te reste.`);
  return lines.join("\n");
}

/** Bouton « En savoir plus » des refus : `guide:why:<chemin>`. */
export const LEARN_MORE_PREFIX = "guide:why:";

export async function handleGuideInteraction(interaction, settings, { env = process.env } = {}) {
  const guild = interaction?.guild;
  if (!guild) return false;
  const roles = { sysPlus: settings?.sysPlus?.roleId ?? null, adminPlus: settings?.adminPlus?.roleId ?? null, whitelist: settings?.sysPlus?.whitelistRoleId ?? null };
  if (interaction.isButton?.() && String(interaction.customId).startsWith(LEARN_MORE_PREFIX)) {
    const matrix = buildPermissionMatrix({ guildId: guild.id, guildOwnerId: guild.ownerId, sysPlusRoleId: roles.sysPlus, adminPlusRoleId: roles.adminPlus, whitelistRoleId: roles.whitelist });
    await interaction.reply({ content: explainCommand({ matrix, commandPath: interaction.customId.slice(LEARN_MORE_PREFIX.length), member: interaction.member, roles, env }), ephemeral: true, allowedMentions: { parse: [] } });
    return true;
  }
  if (interaction.isStringSelectMenu?.() && interaction.customId === "guide:section") {
    const ctx = await gatherContext(guild, settings);
    const embeds = buildPublicGuide(ctx);
    const index = Math.max(0, SECTIONS.findIndex((s) => s.value === interaction.values?.[0]));
    await interaction.update({ embeds: [embeds[index]] });
    return true;
  }
  if (!interaction.isChatInputCommand?.()) return false;
  if (interaction.commandName === "pourquoi") {
    const matrix = buildPermissionMatrix({ guildId: guild.id, guildOwnerId: guild.ownerId, sysPlusRoleId: roles.sysPlus, adminPlusRoleId: roles.adminPlus, whitelistRoleId: roles.whitelist });
    await interaction.reply({ content: explainCommand({ matrix, commandPath: interaction.options.getString("commande", true), member: interaction.member, roles, env }), ephemeral: true, allowedMentions: { parse: [] } });
    return true;
  }
  if (interaction.commandName !== "guide") return false;
  const sub = interaction.options.getSubcommand(false) ?? "voir";
  if (sub === "voir") {
    const ctx = await gatherContext(guild, settings);
    await interaction.reply({
      embeds: [buildPublicGuide(ctx)[0]],
      components: [{ type: 1, components: [{ type: 3, custom_id: "guide:section", placeholder: "Choisis une section", options: SECTIONS.map((s) => ({ label: s.label, value: s.value })) }] }],
    });
    return true;
  }
  const admin = interaction.member?.permissions?.has?.(P.Administrator) || interaction.user.id === parsePndOwnerId(env.PND_OWNER_DISCORD_ID) || interaction.user.id === guild.ownerId;
  if (!admin) { await interaction.reply({ content: "⛔ Réservé aux administrateurs.", ephemeral: true }); return true; }
  await interaction.deferReply({ ephemeral: true });
  if (sub === "configurer") {
    const staffRole = interaction.options.getRole("role_staff", false);
    await configureGuide(guild, { publicChannel: interaction.options.getChannel("public", true), staffChannel: interaction.options.getChannel("staff", false), staffRoleIds: staffRole ? [staffRole.id] : [] });
  }
  const result = await publishGuide(guild, settings, { force: true });
  await interaction.editReply({ content: `✅ Guide ${result.public ? "public publié" : "public non publié (salon manquant)"}${result.staff ? ", guide staff publié" : ""}.` });
  return true;
}

/** =guide [section] · =pourquoi <commande> */
export async function handleGuideMessage(message, settings, { env = process.env } = {}) {
  const match = String(message?.content ?? "").trim().match(/^=(guide|pourquoi)\b\s*(.*)$/i);
  if (!match || !message.guild) return false;
  const guild = message.guild;
  const roles = { sysPlus: settings?.sysPlus?.roleId ?? null, adminPlus: settings?.adminPlus?.roleId ?? null, whitelist: settings?.sysPlus?.whitelistRoleId ?? null };
  const ctx = await gatherContext(guild, settings);
  if (match[1].toLowerCase() === "pourquoi") {
    await message.reply({ content: explainCommand({ matrix: ctx.matrix, commandPath: match[2], member: message.member, roles, env }), allowedMentions: { parse: [] } });
    return true;
  }
  const index = Math.max(0, SECTIONS.findIndex((s) => s.value === match[2].trim().toLowerCase()));
  await message.reply({ embeds: [buildPublicGuide(ctx)[index]], allowedMentions: { parse: [] } });
  return true;
}

/** Contrôle périodique : le guide est réédité quand un rôle, un palier ou un réglage change. */
export function startGuideRefresh({ client, getSettings, guildIds, record = () => {}, intervalMs = 30 * 60_000 }) {
  const timer = setInterval(() => {
    for (const guildId of guildIds()) {
      const guild = client.guilds.cache.get(guildId);
      if (guild && (guideConfig(guildId).publicChannelId || guideConfig(guildId).staffChannelId)) void publishGuide(guild, getSettings(guildId)).catch(() => record("guide_error"));
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}
