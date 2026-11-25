// Invest + — la partie Discord : /abonnement (membres), /investadmin (administration),
// l'espace privé de chaque membre (salon + panneau à boutons), les demandes envoyées
// à l'administration et la tâche planifiée (rappels, échéances, retrait des rôles).
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, ModalBuilder,
  PermissionFlagsBits as P, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} from "discord.js";
import { parsePndOwnerId } from "../pnd-owner-policy.js";
import { roleGrantRefusal } from "../role-grant-guard.js";
import {
  DAY, LIMITS, REQUEST_KINDS, STATUS_LABELS, benefitLines, cancelSubscription, closeRequest, createPlan, createRequest,
  deleteSpace, deleteSpaceByChannel, expireDueSubscriptions, findPlan, formatPeriod, formatPrice, grantSubscription,
  historyOf, investConfig, investStats, listOpenRequests, listPlans, listSpaces, listSubscriptions, pauseSubscription,
  payWithPnd, planById, requestById, resumeSubscription, saveInvestConfig, saveSpace, setPlanActive, setSpacePanel,
  setSubscriptionNote, spaceByChannel, spaceChannelName, spaceOf, subscriptionOf, takeDueReminders, updatePlan,
} from "./investplus.js";

export const INVESTPLUS_COMMANDS = new Set(["abonnement", "investadmin"]);
export const INVESTPLUS_COLOR = 0x10b981;
const PREFIX = "ip:";
const ephemeral = (payload) => ({ ...(typeof payload === "string" ? { content: payload } : payload), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const ts = (ms, style = "D") => `<t:${Math.floor(ms / 1000)}:${style}>`;

export function isInvestAdmin(member, env = process.env) {
  if (!member) return false;
  return member.id === parsePndOwnerId(env.PND_OWNER_DISCORD_ID)
    || member.id === member.guild?.ownerId
    || Boolean(member.permissions?.has?.(P.Administrator) || member.permissions?.has?.(P.ManageGuild));
}

const HISTORY_LABELS = Object.freeze({
  attribution: "🎁 Formule attribuée", prolongation: "➕ Prolongation", changement: "🔁 Changement de formule",
  paiement: "💳 Paiement", pause: "⏸️ Pause", reprise: "▶️ Reprise", resiliation: "🛑 Résiliation", expiration: "⌛ Expiration",
});

// --- Affichage ---------------------------------------------------------------

function planLine(plan) {
  return `**${plan.name}** (#${plan.id}) — ${formatPrice(plan)} ${formatPeriod(plan.periodDays)}${plan.roleId ? ` · rôle <@&${plan.roleId}>` : ""}${plan.active ? "" : " · *archivée*"}`;
}

export function plansEmbed(guildId, { admin = false } = {}) {
  const plans = listPlans(guildId, { includeArchived: admin });
  const embed = new EmbedBuilder().setColor(INVESTPLUS_COLOR).setTitle("💼 Invest + — les formules");
  if (!plans.length) return embed.setDescription(admin ? "Aucune formule. Crée la première avec `/investadmin formule-creer`." : "Aucune formule n'est proposée pour le moment.");
  for (const plan of plans.slice(0, 25)) {
    const perks = benefitLines(plan).map((line) => `• ${line}`).join("\n");
    embed.addFields({
      name: `${plan.active ? "" : "🗄️ "}${plan.name} — ${formatPrice(plan)} ${formatPeriod(plan.periodDays)}`.slice(0, 256),
      value: [plan.description, perks, admin ? `\`#${plan.id}\` · paiement ${plan.payMode}${plan.roleId ? ` · rôle <@&${plan.roleId}>` : ""}` : ""].filter(Boolean).join("\n").slice(0, 1024) || "—",
    });
  }
  return embed;
}

/** La fiche d'un abonné, vue par lui-même (admin = false) ou par l'administration. */
export function subscriptionEmbed(guildId, userId, { admin = false, welcome = null, now = Date.now() } = {}) {
  const sub = subscriptionOf(guildId, userId);
  const plan = sub ? planById(guildId, sub.planId) : null;
  const embed = new EmbedBuilder().setColor(sub?.status === "active" ? INVESTPLUS_COLOR : 0x6b7280)
    .setTitle(admin ? "💼 Fiche abonné Invest +" : "💼 Invest + — ton abonnement");
  const intro = welcome || "Ici tu retrouves ton abonnement Invest + : ta formule, ce qu'elle t'apporte et sa date d'échéance. Les boutons ci-dessous te permettent de voir les formules, ton historique ou d'écrire à l'administration.";
  embed.setDescription(`${admin ? `Membre : <@${userId}> \`${userId}\`` : intro}`.slice(0, 4000));
  if (!sub || !plan) {
    embed.addFields({ name: "Abonnement", value: "Aucun pour le moment. Regarde les formules disponibles et fais une demande, ou paie directement si la formule le permet." });
    return embed;
  }
  const due = sub.status === "paused"
    ? (sub.pausedRemaining == null ? "Sans échéance (en pause)" : `En pause — ${Math.ceil(sub.pausedRemaining / DAY)} jour(s) restant(s) à la reprise`)
    : sub.expiresAt == null ? "Sans échéance" : `${ts(sub.expiresAt)} (${ts(sub.expiresAt, "R")})`;
  embed.addFields(
    { name: "Formule", value: `**${plan.name}**`, inline: true },
    { name: "Statut", value: STATUS_LABELS[sub.status] ?? sub.status, inline: true },
    { name: "Tarif", value: `${formatPrice(plan)} ${formatPeriod(plan.periodDays)}`, inline: true },
    { name: sub.status === "active" ? "Échéance" : "Fin", value: sub.status === "expired" || sub.status === "cancelled" ? (sub.expiresAt ? ts(sub.expiresAt) : "—") : due, inline: true },
    { name: "Membre depuis", value: ts(sub.startedAt), inline: true },
  );
  if (plan.description) embed.addFields({ name: "À quoi ça sert", value: plan.description.slice(0, 1024) });
  const perks = benefitLines(plan);
  if (perks.length) embed.addFields({ name: "Tes avantages", value: perks.map((line) => `✅ ${line}`).join("\n").slice(0, 1024) });
  if (plan.roleId) embed.addFields({ name: "Rôle inclus", value: `<@&${plan.roleId}>`, inline: true });
  if (admin && sub.note) embed.addFields({ name: "Note interne", value: sub.note.slice(0, 1024) });
  if (sub.status === "active" && sub.expiresAt && sub.expiresAt - now < 7 * DAY) embed.setFooter({ text: "⚠️ Ton abonnement arrive bientôt à échéance : pense à le renouveler." });
  return embed;
}

function historyEmbed(guildId, userId) {
  const rows = historyOf(guildId, userId, 15);
  const lines = rows.map((row) => {
    const plan = row.planId ? planById(guildId, row.planId) : null;
    return `${ts(row.createdAt, "d")} ${HISTORY_LABELS[row.kind] ?? row.kind}${plan ? ` — ${plan.name}` : ""}${row.amount ? ` · ${row.amount.toLocaleString("fr-FR")}${plan?.payMode === "pnd" ? " PND" : ""}` : ""}${row.detail ? ` · ${row.detail}` : ""}`;
  });
  return new EmbedBuilder().setColor(INVESTPLUS_COLOR).setTitle("🧾 Historique Invest +").setDescription(lines.join("\n").slice(0, 4000) || "Rien pour le moment.");
}

function panelComponents(userId) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}refresh:${userId}`).setLabel("Actualiser").setStyle(ButtonStyle.Secondary).setEmoji("🔄"),
    new ButtonBuilder().setCustomId(`${PREFIX}plans:${userId}`).setLabel("Formules").setStyle(ButtonStyle.Primary).setEmoji("📋"),
    new ButtonBuilder().setCustomId(`${PREFIX}history:${userId}`).setLabel("Historique").setStyle(ButtonStyle.Secondary).setEmoji("🧾"),
    new ButtonBuilder().setCustomId(`${PREFIX}ask:${userId}`).setLabel("Écrire à l'administration").setStyle(ButtonStyle.Success).setEmoji("✉️"),
  )];
}

function panelPayload(guildId, userId) {
  return { embeds: [subscriptionEmbed(guildId, userId, { welcome: investConfig(guildId).welcome || null })], components: panelComponents(userId), allowedMentions: { parse: [] } };
}

/** Menu « payer en PND » : seulement les formules actives payables dans le bot. */
function payMenu(guildId, userId) {
  const plans = listPlans(guildId).filter((plan) => plan.payMode === "pnd").slice(0, 25);
  if (!plans.length) return [];
  return [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`${PREFIX}pay:${userId}`)
    .setPlaceholder("Payer une formule en PND…")
    .addOptions(plans.map((plan) => ({ label: plan.name.slice(0, 100), value: String(plan.id), description: `${formatPrice(plan)} ${formatPeriod(plan.periodDays)}`.slice(0, 100) }))))];
}

// --- Espaces privés --------------------------------------------------------

async function fetchChannel(guild, channelId) {
  if (!channelId) return null;
  return guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);
}

/** Crée (ou retrouve) le salon privé du membre et y place le panneau à jour. */
export async function ensureSpace(guild, member, { now = Date.now() } = {}) {
  const config = investConfig(guild.id);
  if (!config.enabled) throw new Error("Invest + est désactivé sur ce serveur.");
  const existing = spaceOf(guild.id, member.id);
  let channel = existing ? await fetchChannel(guild, existing.channelId) : null;
  if (!channel) {
    const category = await fetchChannel(guild, config.categoryId);
    if (!category || category.type !== ChannelType.GuildCategory) throw new Error("Aucune catégorie Invest + configurée : l'administration doit lancer `/investadmin installer`.");
    const me = guild.members.me;
    const overwrites = [
      { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
      { id: member.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks] },
      ...(me ? [{ id: me.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks, P.ManageChannels, P.ManageMessages] }] : []),
      ...(config.staffRoleId ? [{ id: config.staffRoleId, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] }] : []),
    ];
    channel = await guild.channels.create({
      name: spaceChannelName(member.displayName ?? member.user?.username, member.id),
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `Espace Invest + de ${member.user?.username ?? member.id} — abonnement, avantages et échanges avec l'administration.`,
      permissionOverwrites: overwrites,
      reason: "Invest + : espace privé d'un membre",
    });
    saveSpace(guild.id, member.id, channel.id, null, now);
  }
  await refreshPanel(guild, member.id);
  return channel;
}

/** Met à jour le panneau épinglé de l'espace (le recrée s'il a disparu). */
export async function refreshPanel(guild, userId) {
  const space = spaceOf(guild.id, userId);
  if (!space) return false;
  const channel = await fetchChannel(guild, space.channelId);
  if (!channel?.isTextBased?.()) { deleteSpace(guild.id, userId); return false; }
  const payload = panelPayload(guild.id, userId);
  const message = space.panelMessageId ? await channel.messages.fetch(space.panelMessageId).catch(() => null) : null;
  if (message) { await message.edit(payload).catch(() => null); return true; }
  const sent = await channel.send(payload).catch(() => null);
  if (!sent) return false;
  setSpacePanel(guild.id, userId, sent.id);
  await sent.pin().catch(() => null);
  return true;
}

async function closeSpace(guild, userId) {
  const space = spaceOf(guild.id, userId);
  if (!space) return false;
  const channel = await fetchChannel(guild, space.channelId);
  deleteSpace(guild.id, userId);
  if (channel) await channel.delete("Invest + : espace fermé par l'administration").catch(() => null);
  return true;
}

/** Message dans l'espace du membre (avec mention), sinon en MP. Jamais bloquant. */
async function notifyMember(guild, userId, content) {
  const space = spaceOf(guild.id, userId);
  const channel = space ? await fetchChannel(guild, space.channelId) : null;
  if (channel?.isTextBased?.()) {
    const sent = await channel.send({ content: `<@${userId}> ${content}`, allowedMentions: { users: [userId] } }).catch(() => null);
    if (sent) return true;
  }
  const member = await guild.members.fetch(userId).catch(() => null);
  return Boolean(await member?.send({ content: `**${guild.name} — Invest +** : ${content}`, allowedMentions: { parse: [] } }).catch(() => null));
}

async function adminChannel(guild) {
  const channel = await fetchChannel(guild, investConfig(guild.id).adminChannelId);
  return channel?.isTextBased?.() ? channel : null;
}

async function notifyAdmin(guild, payload) {
  const channel = await adminChannel(guild);
  return channel ? channel.send({ allowedMentions: { parse: [] }, ...payload }).catch(() => null) : null;
}

// --- Rôles des formules (toujours via role-grant-guard) ------------------------

/** Un rôle de formule est une attribution automatique : jamais un rôle protégé. */
export async function planRoleRefusal(guild, role, settings) {
  if (!role) return null;
  return roleGrantRefusal(guild, role, { automatic: true, settings });
}

async function syncPlanRoles(guild, userId, { give = null, take = null, settings = null }) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return "membre absent du serveur";
  if (take && take !== give && member.roles.cache.has(take)) await member.roles.remove(take, "Invest + : fin de formule").catch(() => null);
  if (!give || member.roles.cache.has(give)) return null;
  const role = guild.roles.cache.get(give) ?? await guild.roles.fetch(give).catch(() => null);
  if (!role) return "rôle de la formule introuvable";
  const refusal = await planRoleRefusal(guild, role, settings);
  if (refusal) return refusal;
  return (await member.roles.add(role, "Invest + : formule active").then(() => null).catch(() => "le bot ne peut pas donner ce rôle (place du rôle du bot ?)"));
}

/** Après tout changement d'abonnement : rôles, panneau, espace. */
async function afterChange(guild, userId, { previousPlanId = null, settings = null, createSpace = true } = {}) {
  const sub = subscriptionOf(guild.id, userId);
  const plan = sub ? planById(guild.id, sub.planId) : null;
  const previous = previousPlanId ? planById(guild.id, previousPlanId) : null;
  const active = sub?.status === "active";
  const roleProblem = await syncPlanRoles(guild, userId, {
    give: active ? plan?.roleId ?? null : null,
    take: active ? (previous && previous.id !== plan?.id ? previous.roleId : null) : plan?.roleId ?? previous?.roleId ?? null,
    settings,
  });
  const config = investConfig(guild.id);
  if (createSpace && active && config.categoryId && !spaceOf(guild.id, userId)) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) await ensureSpace(guild, member).catch(() => null);
  } else {
    await refreshPanel(guild, userId);
  }
  return roleProblem;
}

// --- /investadmin ------------------------------------------------------------

async function installer(interaction) {
  const guild = interaction.guild;
  const config = investConfig(guild.id);
  const me = guild.members.me;
  if (!me?.permissions?.has?.(P.ManageChannels)) throw new Error("Invest + a besoin de la permission « Gérer les salons ».");
  let category = await fetchChannel(guild, config.categoryId);
  if (!category) {
    category = await guild.channels.create({
      name: "💼 Invest +", type: ChannelType.GuildCategory, reason: "Invest + : installation",
      permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [P.ViewChannel] }, { id: me.id, allow: [P.ViewChannel, P.ManageChannels, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory, P.ManageMessages] }],
    });
  }
  let admin = await fetchChannel(guild, config.adminChannelId);
  if (!admin) {
    admin = await guild.channels.create({
      name: "invest-admin", type: ChannelType.GuildText, parent: category.id, reason: "Invest + : installation",
      topic: "Administration Invest + : demandes des membres, échéances, journal. Visible par l'administration seulement.",
      permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [P.ViewChannel] }, { id: me.id, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory] }, { id: interaction.user.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] }],
    });
  }
  saveInvestConfig(guild.id, { enabled: true, categoryId: category.id, adminChannelId: admin.id });
  return `✅ Invest + est installé.\n• Catégorie des espaces membres : ${category}\n• Salon d'administration : ${admin}\n\nÉtape suivante : crée tes formules avec \`/investadmin formule-creer\`, puis attribue-les avec \`/investadmin attribuer\`. Chaque abonné reçoit automatiquement son salon privé.`;
}

async function readRole(interaction, name) {
  const role = interaction.options.getRole(name);
  if (!role) return undefined;
  const refusal = await planRoleRefusal(interaction.guild, role, interaction.__settings);
  if (refusal) throw new Error(`Rôle refusé : ${refusal}`);
  return role.id;
}

function planOption(interaction, name = "formule", { required = true } = {}) {
  const value = interaction.options.getString(name, required);
  if (value == null) return null;
  const plan = findPlan(interaction.guildId, value);
  if (!plan) throw new Error(`Formule « ${value} » introuvable (nom ou numéro, voir \`/investadmin formules\`).`);
  return plan;
}

function dashboardEmbed(guild, now = Date.now()) {
  const stats = investStats(guild.id, now);
  const config = investConfig(guild.id);
  const soon = listSubscriptions(guild.id, { status: "active", limit: 10 }).filter((sub) => sub.expiresAt && sub.expiresAt <= now + 7 * DAY);
  const embed = new EmbedBuilder().setColor(INVESTPLUS_COLOR).setTitle("📊 Invest + — tableau de bord").setTimestamp(now)
    .setDescription([
      `${config.enabled ? "🟢 Activé" : "🔴 Désactivé"} · catégorie ${config.categoryId ? `<#${config.categoryId}>` : "**non configurée**"} · admin ${config.adminChannelId ? `<#${config.adminChannelId}>` : "**non configuré**"}`,
      `Rappel ${config.reminderDays ? `${config.reminderDays} j avant l'échéance` : "désactivé"}${config.staffRoleId ? ` · staff <@&${config.staffRoleId}>` : ""}`,
    ].join("\n"))
    .addFields(
      { name: "Abonnés actifs", value: String(stats.active), inline: true },
      { name: "En pause", value: String(stats.paused), inline: true },
      { name: "Échéance < 7 j", value: String(stats.expiringSoon), inline: true },
      { name: "Arrêts (30 j)", value: String(stats.endedLast30), inline: true },
      { name: "Demandes ouvertes", value: String(stats.openRequests), inline: true },
      { name: "Espaces privés", value: String(stats.spaces), inline: true },
      { name: "PND encaissés (30 j)", value: stats.paidLast30.toLocaleString("fr-FR"), inline: true },
      { name: "Valeur mensuelle des abonnés", value: stats.monthly.toLocaleString("fr-FR"), inline: true },
    );
  if (stats.byPlan.length) embed.addFields({ name: "Par formule", value: stats.byPlan.map((p) => `• **${p.name}** (#${p.id}) : ${p.active} abonné(s)`).join("\n").slice(0, 1024) });
  if (soon.length) embed.addFields({ name: "Échéances proches", value: soon.map((sub) => `• <@${sub.userId}> — ${planById(guild.id, sub.planId)?.name ?? "?"} — ${ts(sub.expiresAt, "R")}`).join("\n").slice(0, 1024) });
  return embed;
}

function subscribersEmbed(guild, status) {
  const rows = listSubscriptions(guild.id, { status, limit: 30 });
  return new EmbedBuilder().setColor(INVESTPLUS_COLOR).setTitle(`👥 Abonnés Invest +${status ? ` — ${STATUS_LABELS[status]}` : ""}`)
    .setDescription(rows.map((sub) => `${STATUS_LABELS[sub.status]?.split(" ")[0] ?? "•"} <@${sub.userId}> — ${planById(guild.id, sub.planId)?.name ?? "?"}${sub.expiresAt && sub.status === "active" ? ` · ${ts(sub.expiresAt, "R")}` : sub.status === "active" ? " · sans échéance" : ""}`).join("\n").slice(0, 4000) || "Aucun abonné.");
}

function requestEmbed(guild, request) {
  const plan = request.planId ? planById(guild.id, request.planId) : null;
  const sub = subscriptionOf(guild.id, request.userId);
  const current = sub ? planById(guild.id, sub.planId) : null;
  return new EmbedBuilder().setColor(request.status === "open" ? 0xf59e0b : request.status === "done" ? INVESTPLUS_COLOR : 0x7f1d1d)
    .setTitle(`✉️ Demande #${request.id} — ${REQUEST_KINDS[request.kind] ?? request.kind}${request.status === "open" ? "" : request.status === "done" ? " — traitée" : " — refusée"}`)
    .setDescription(request.body || "*(sans message)*")
    .addFields(
      { name: "Membre", value: `<@${request.userId}> \`${request.userId}\``, inline: true },
      { name: "Formule actuelle", value: current ? `${current.name} (${STATUS_LABELS[sub.status]})` : "Aucune", inline: true },
      ...(plan ? [{ name: "Formule demandée", value: plan.name, inline: true }] : []),
      ...(request.handledBy ? [{ name: "Par", value: `<@${request.handledBy}>`, inline: true }] : []),
    ).setTimestamp(request.createdAt);
}

function requestComponents(request) {
  if (request.status !== "open") return [];
  const row = new ActionRowBuilder();
  if (request.planId || request.kind === "renouveler") {
    row.addComponents(new ButtonBuilder().setCustomId(`${PREFIX}req:grant:${request.id}`).setLabel(request.kind === "renouveler" ? "Prolonger d'une période" : "Attribuer la formule").setStyle(ButtonStyle.Success).setEmoji("✅"));
  }
  row.addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}req:done:${request.id}`).setLabel("Marquer traitée").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}req:no:${request.id}`).setLabel("Refuser").setStyle(ButtonStyle.Danger),
  );
  return [row];
}

async function grantAndReport(interaction, { userId, plan, days, note, verb = "attribuée" }) {
  const result = grantSubscription({ guildId: interaction.guildId, userId, planId: plan.id, days, actorId: interaction.user.id, note });
  const problem = await afterChange(interaction.guild, userId, { previousPlanId: result.previous?.planId ?? null, settings: interaction.__settings });
  const end = result.subscription.expiresAt ? ts(result.subscription.expiresAt) : "sans échéance";
  await notifyMember(interaction.guild, userId, `ta formule **${plan.name}** est ${result.kind === "prolongation" ? "prolongée" : "active"} (échéance : ${end}).`);
  await notifyAdmin(interaction.guild, { content: `🧾 <@${interaction.user.id}> : formule **${plan.name}** ${verb} à <@${userId}> (${result.kind}, échéance ${end}).` });
  return `✅ Formule **${plan.name}** ${verb} à <@${userId}> — ${result.kind}, échéance ${end}.${problem ? `\n⚠️ Rôle non donné : ${problem}.` : ""}`;
}

async function adminCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  const gid = guild.id;
  const actor = interaction.user.id;
  const user = (name = "membre") => interaction.options.getUser(name, true);
  switch (sub) {
    case "installer": return installer(interaction);
    case "tableau": return { embeds: [dashboardEmbed(guild)] };
    case "config": {
      const patch = {
        enabled: interaction.options.getBoolean("actif") ?? undefined,
        categoryId: interaction.options.getChannel("categorie")?.id,
        adminChannelId: interaction.options.getChannel("salon_admin")?.id,
        staffRoleId: interaction.options.getRole("role_staff")?.id,
        reminderDays: interaction.options.getInteger("rappel_jours") ?? undefined,
        welcome: interaction.options.getString("accueil") ?? undefined,
      };
      saveInvestConfig(gid, patch);
      return { embeds: [dashboardEmbed(guild)], content: "✅ Configuration enregistrée." };
    }
    case "formules": return { embeds: [plansEmbed(gid, { admin: true })] };
    case "formule-creer": {
      const plan = createPlan(gid, {
        name: interaction.options.getString("nom", true),
        price: interaction.options.getInteger("prix", true),
        periodDays: interaction.options.getInteger("duree", true),
        payMode: interaction.options.getString("paiement") ?? "manuel",
        roleId: (await readRole(interaction, "role")) ?? null,
        description: interaction.options.getString("description") ?? "",
        benefits: interaction.options.getString("avantages") ?? "",
      });
      return `✅ Formule créée : ${planLine(plan)}`;
    }
    case "formule-modifier": {
      const plan = planOption(interaction);
      const removeRole = interaction.options.getBoolean("retirer_role") === true;
      const updated = updatePlan(gid, plan.id, {
        name: interaction.options.getString("nom") ?? undefined,
        price: interaction.options.getInteger("prix") ?? undefined,
        periodDays: interaction.options.getInteger("duree") ?? undefined,
        payMode: interaction.options.getString("paiement") ?? undefined,
        roleId: removeRole ? null : await readRole(interaction, "role"),
        description: interaction.options.getString("description") ?? undefined,
        benefits: interaction.options.getString("avantages") ?? undefined,
      });
      for (const { userId } of listSpaces(gid)) if (subscriptionOf(gid, userId)?.planId === updated.id) void refreshPanel(guild, userId);
      return `✅ Formule modifiée : ${planLine(updated)}${plan.roleId !== updated.roleId ? "\nℹ️ Le nouveau rôle sera donné aux abonnés à leur prochain renouvellement (ou via `/investadmin attribuer`)." : ""}`;
    }
    case "formule-archiver": return `🗄️ Formule archivée : ${planLine(setPlanActive(gid, planOption(interaction).id, false))}\nLes abonnés en cours la gardent jusqu'à leur échéance.`;
    case "formule-reactiver": return `✅ Formule de nouveau proposée : ${planLine(setPlanActive(gid, planOption(interaction).id, true))}`;
    case "attribuer": {
      const target = user();
      if (target.bot) throw new Error("Un bot ne peut pas être abonné.");
      return grantAndReport(interaction, { userId: target.id, plan: planOption(interaction), days: interaction.options.getInteger("jours") ?? undefined, note: interaction.options.getString("note") ?? undefined });
    }
    case "prolonger": {
      const target = user();
      const current = subscriptionOf(gid, target.id);
      if (!current) throw new Error("Ce membre n'a pas d'abonnement : utilise `/investadmin attribuer`.");
      const plan = planById(gid, current.planId);
      return grantAndReport(interaction, { userId: target.id, plan, days: interaction.options.getInteger("jours", true), verb: "prolongée" });
    }
    case "pause": {
      const target = user();
      pauseSubscription(gid, target.id, actor);
      const problem = await afterChange(guild, target.id, { settings: interaction.__settings, createSpace: false });
      await notifyMember(guild, target.id, "ton abonnement est mis en pause : les jours restants te seront rendus à la reprise.");
      return `⏸️ Abonnement de <@${target.id}> en pause.${problem ? `\n⚠️ ${problem}.` : ""}`;
    }
    case "reprendre": {
      const target = user();
      const next = resumeSubscription(gid, target.id, actor);
      const problem = await afterChange(guild, target.id, { settings: interaction.__settings });
      await notifyMember(guild, target.id, `ton abonnement reprend (échéance : ${next.expiresAt ? ts(next.expiresAt) : "sans échéance"}).`);
      return `▶️ Abonnement de <@${target.id}> repris.${problem ? `\n⚠️ Rôle non donné : ${problem}.` : ""}`;
    }
    case "resilier": {
      const target = user();
      const reason = interaction.options.getString("raison") ?? "";
      cancelSubscription(gid, target.id, actor, reason);
      await afterChange(guild, target.id, { settings: interaction.__settings, createSpace: false });
      await notifyMember(guild, target.id, `ton abonnement Invest + est résilié.${reason ? ` Motif : ${reason}` : ""}`);
      await notifyAdmin(guild, { content: `🛑 <@${actor}> a résilié l'abonnement de <@${target.id}>.` });
      return `🛑 Abonnement de <@${target.id}> résilié.`;
    }
    case "note": {
      const target = user();
      setSubscriptionNote(gid, target.id, interaction.options.getString("texte") ?? "", actor);
      return `📝 Note interne enregistrée pour <@${target.id}>.`;
    }
    case "fiche": {
      const target = user();
      const space = spaceOf(gid, target.id);
      return { content: space ? `Espace : <#${space.channelId}>` : "Pas d'espace privé.", embeds: [subscriptionEmbed(gid, target.id, { admin: true }), historyEmbed(gid, target.id)] };
    }
    case "abonnes": return { embeds: [subscribersEmbed(guild, interaction.options.getString("statut") ?? null)] };
    case "espace": {
      const target = interaction.options.getMember("membre");
      if (!target) throw new Error("Ce membre n'est pas sur le serveur.");
      const channel = await ensureSpace(guild, target);
      return `✅ Espace de <@${target.id}> prêt : ${channel}`;
    }
    case "espace-fermer": {
      const target = user();
      return (await closeSpace(guild, target.id)) ? `🗑️ Espace de <@${target.id}> fermé (l'abonnement n'est pas touché).` : "Ce membre n'a pas d'espace.";
    }
    case "demandes": {
      const open = listOpenRequests(gid, 10);
      if (!open.length) return "📭 Aucune demande en attente.";
      return { content: `📬 ${open.length} demande(s) en attente (les plus anciennes d'abord).`, embeds: open.map((request) => requestEmbed(guild, request)), components: open.length === 1 ? requestComponents(open[0]) : [] };
    }
    case "actualiser": {
      let done = 0;
      for (const { userId } of listSpaces(gid)) if (await refreshPanel(guild, userId)) done++;
      return `🔄 ${done} panneau(x) mis à jour.`;
    }
    default: throw new Error("Sous-commande inconnue.");
  }
}

// --- /abonnement ---------------------------------------------------------------

async function memberCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  const gid = interaction.guildId;
  const uid = interaction.user.id;
  switch (sub) {
    case "voir": return { embeds: [subscriptionEmbed(gid, uid)], components: payMenu(gid, uid) };
    case "formules": return { embeds: [plansEmbed(gid)], components: payMenu(gid, uid) };
    case "historique": return { embeds: [historyEmbed(gid, uid)] };
    case "espace": {
      const channel = await ensureSpace(interaction.guild, interaction.member);
      return `✅ Ton espace Invest + : ${channel}`;
    }
    case "demande": {
      const plan = planOption(interaction, "formule", { required: false });
      const request = createRequest({ guildId: gid, userId: uid, kind: interaction.options.getString("type", true), planId: plan?.id ?? null, body: interaction.options.getString("message") ?? "" });
      const sent = await notifyAdmin(interaction.guild, { embeds: [requestEmbed(interaction.guild, request)], components: requestComponents(request) });
      return sent ? `✅ Demande #${request.id} envoyée à l'administration. Tu auras la réponse dans ton espace.` : `✅ Demande #${request.id} enregistrée. L'administration la verra avec \`/investadmin demandes\`.`;
    }
    default: throw new Error("Sous-commande inconnue.");
  }
}

// --- Boutons, menus, fenêtres --------------------------------------------------

function askModal(userId) {
  return new ModalBuilder().setCustomId(`${PREFIX}askform:${userId}`).setTitle("Écrire à l'administration").addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("type").setLabel("Objet : renouveler, changer ou question").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20).setValue("question")),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("formule").setLabel("Formule concernée (facultatif)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(LIMITS.name)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("message").setLabel("Ton message").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(LIMITS.request)),
  );
}

const KIND_ALIASES = { renouveler: "renouveler", renouvellement: "renouveler", renew: "renouveler", changer: "changer", changement: "changer", question: "question", autre: "question" };

async function handleComponent(interaction, settings) {
  const [action, ...rest] = interaction.customId.slice(PREFIX.length).split(":");
  const gid = interaction.guildId;
  const admin = isInvestAdmin(interaction.member);

  if (action === "req") {
    if (!admin) return interaction.reply(ephemeral("⛔ Réservé à l'administration Invest +."));
    const [verb, id] = rest;
    const request = requestById(gid, id);
    if (!request) return interaction.reply(ephemeral("Demande introuvable."));
    if (request.status !== "open") return interaction.update({ embeds: [requestEmbed(interaction.guild, request)], components: [] });
    let note = "";
    if (verb === "grant") {
      const current = subscriptionOf(gid, request.userId);
      const plan = request.planId ? planById(gid, request.planId) : current ? planById(gid, current.planId) : null;
      if (!plan) return interaction.reply(ephemeral("Aucune formule à attribuer : utilise `/investadmin attribuer`."));
      interaction.__settings = settings;
      await interaction.deferUpdate();
      note = await grantAndReport(interaction, { userId: request.userId, plan, verb: request.kind === "renouveler" ? "prolongée" : "attribuée" });
      const closed = closeRequest(gid, request.id, "done", interaction.user.id);
      await interaction.editReply({ embeds: [requestEmbed(interaction.guild, closed)], components: [] });
      return interaction.followUp(ephemeral(note));
    }
    const closed = closeRequest(gid, request.id, verb === "no" ? "refused" : "done", interaction.user.id);
    await notifyMember(interaction.guild, request.userId, verb === "no" ? `ta demande #${request.id} a été refusée par l'administration.` : `ta demande #${request.id} a été traitée par l'administration.`);
    return interaction.update({ embeds: [requestEmbed(interaction.guild, closed)], components: [] });
  }

  // Boutons et menus de l'espace : liés à leur membre (l'administration peut aussi s'en servir).
  const ownerId = rest[0];
  if (interaction.user.id !== ownerId && !admin) return interaction.reply(ephemeral("⛔ Ce panneau appartient à un autre membre."));
  switch (action) {
    case "refresh": {
      await refreshPanel(interaction.guild, ownerId);
      return interaction.reply(ephemeral("🔄 Panneau à jour."));
    }
    case "plans": return interaction.reply(ephemeral({ embeds: [plansEmbed(gid)], components: interaction.user.id === ownerId ? payMenu(gid, ownerId) : [] }));
    case "history": return interaction.reply(ephemeral({ embeds: [historyEmbed(gid, ownerId)] }));
    case "ask": {
      if (interaction.user.id !== ownerId) return interaction.reply(ephemeral("Seul le membre peut écrire depuis son espace."));
      return interaction.showModal(askModal(ownerId));
    }
    case "askform": {
      const kind = KIND_ALIASES[interaction.fields.getTextInputValue("type").trim().toLowerCase()] ?? "question";
      const planText = interaction.fields.getTextInputValue("formule")?.trim();
      const plan = planText ? findPlan(gid, planText) : null;
      const request = createRequest({ guildId: gid, userId: ownerId, kind, planId: plan?.id ?? null, body: interaction.fields.getTextInputValue("message") });
      const sent = await notifyAdmin(interaction.guild, { embeds: [requestEmbed(interaction.guild, request)], components: requestComponents(request) });
      return interaction.reply(ephemeral(`✅ Demande #${request.id} envoyée${sent ? "" : " (l'administration la verra dans `/investadmin demandes`)"}.${planText && !plan ? `\nℹ️ Formule « ${planText} » introuvable : la demande part sans formule.` : ""}`));
    }
    case "pay": {
      if (interaction.user.id !== ownerId) return interaction.reply(ephemeral("Seul le membre peut payer son abonnement."));
      const planId = Number(interaction.values?.[0]);
      const plan = planById(gid, planId);
      if (!plan) return interaction.reply(ephemeral("Formule introuvable."));
      return interaction.reply(ephemeral({
        content: `Confirmer le paiement de **${formatPrice(plan)}** pour **${plan.name}** (${formatPeriod(plan.periodDays)}) ? Ton solde PND sera débité tout de suite.`,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}payok:${ownerId}:${plan.id}`).setLabel("Payer").setStyle(ButtonStyle.Success).setEmoji("💳"),
        )],
      }));
    }
    case "payok": {
      if (interaction.user.id !== ownerId) return interaction.reply(ephemeral("Seul le membre peut payer son abonnement."));
      const result = payWithPnd({ guildId: gid, userId: ownerId, planId: Number(rest[1]) });
      await interaction.update({ content: `✅ Paiement accepté : **${result.plan.name}** jusqu'au ${result.subscription.expiresAt ? ts(result.subscription.expiresAt) : "—"}.`, components: [] });
      const problem = await afterChange(interaction.guild, ownerId, { previousPlanId: result.previous?.planId ?? null, settings });
      await notifyAdmin(interaction.guild, { content: `💳 <@${ownerId}> a payé **${result.plan.name}** (${formatPrice(result.plan)}).${problem ? ` ⚠️ Rôle : ${problem}.` : ""}` });
      return true;
    }
    default: return interaction.reply(ephemeral("Action inconnue."));
  }
}

/** Point d'entrée unique, branché dans index.js. */
export async function handleInvestPlusInteraction(interaction, guildSettings = null) {
  const isOwnComponent = (interaction.isButton?.() || interaction.isStringSelectMenu?.() || interaction.isModalSubmit?.()) && String(interaction.customId ?? "").startsWith(PREFIX);
  const isOwnCommand = interaction.isChatInputCommand?.() && INVESTPLUS_COMMANDS.has(interaction.commandName);
  if (!isOwnComponent && !isOwnCommand) return false;
  const reply = async (payload) => {
    const body = typeof payload === "string" ? { content: payload } : payload;
    if (interaction.deferred || interaction.replied) return interaction.editReply({ allowedMentions: { parse: [] }, ...body }).catch(() => {});
    return interaction.reply(ephemeral(body)).catch(() => {});
  };
  try {
    if (!interaction.guild) { await interaction.reply(ephemeral("Invest + s'utilise sur un serveur.")); return true; }
    if (isOwnComponent) { await handleComponent(interaction, guildSettings); return true; }
    interaction.__settings = guildSettings;
    if (interaction.commandName === "investadmin") {
      if (!isInvestAdmin(interaction.member)) { await reply("⛔ `/investadmin` est réservé à l'administration (OWNER, propriétaire du serveur, Administrateur ou Gérer le serveur)."); return true; }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await reply(await adminCommand(interaction));
      return true;
    }
    if (!investConfig(interaction.guildId).enabled) { await reply("Invest + est désactivé sur ce serveur."); return true; }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await reply(await memberCommand(interaction));
  } catch (error) {
    await reply(`❌ ${error instanceof Error ? error.message : "Action impossible."}`);
  }
  return true;
}

/** `$abonnement` / `$abo` : la fiche du membre et le lien vers son espace. */
export async function handleInvestPlusMessage(message) {
  const match = /^=(abonnement|abo)(?=$|\s)/i.exec(String(message.content ?? "").trim());
  if (!match) return false;
  if (!investConfig(message.guild.id).enabled) { await message.reply({ content: "Invest + est désactivé sur ce serveur.", allowedMentions: { parse: [] } }).catch(() => {}); return true; }
  const space = spaceOf(message.guild.id, message.author.id);
  await message.reply({
    content: space ? `Ton espace : <#${space.channelId}>` : "Crée ton espace privé avec `/abonnement espace`.",
    embeds: [subscriptionEmbed(message.guild.id, message.author.id)],
    allowedMentions: { parse: [] },
  }).catch(() => {});
  return true;
}

/** Un salon d'espace supprimé à la main : on oublie l'espace (il sera recréé à la demande). */
export function handleInvestPlusChannelDelete(channel) {
  if (channel?.id && spaceByChannel(channel.id)) deleteSpaceByChannel(channel.id);
}

/**
 * Tâche planifiée (toutes les 5 min, un seul processus grâce au verrou de domaine) :
 * rappels avant échéance, puis échéances (statut, rôle retiré, panneau, prévenus).
 */
export async function runInvestPlusJobs(client, { isAllowedGuild = () => true, settingsFor = () => null, now = Date.now() } = {}) {
  const guildOf = (id) => (isAllowedGuild(id) ? client.guilds.cache.get(id) : null);
  for (const sub of takeDueReminders(now)) {
    const guild = guildOf(sub.guildId);
    if (!guild || !investConfig(guild.id).enabled) continue;
    const plan = planById(guild.id, sub.planId);
    await notifyMember(guild, sub.userId, `ta formule **${plan?.name ?? "Invest +"}** arrive à échéance ${ts(sub.expiresAt, "R")}. ${plan?.payMode === "pnd" ? "Tu peux la renouveler depuis le bouton **Formules** de ton espace." : "Utilise **Écrire à l'administration** pour la renouveler."}`);
    await refreshPanel(guild, sub.userId);
  }
  for (const sub of expireDueSubscriptions(now)) {
    const guild = guildOf(sub.guildId);
    if (!guild) continue;
    const plan = planById(guild.id, sub.planId);
    if (plan?.roleId) await syncPlanRoles(guild, sub.userId, { take: plan.roleId, settings: settingsFor(guild.id) }).catch(() => null);
    await refreshPanel(guild, sub.userId);
    await notifyMember(guild, sub.userId, `ta formule **${plan?.name ?? "Invest +"}** est arrivée à échéance. Tu peux la renouveler à tout moment depuis ton espace.`);
    await notifyAdmin(guild, { content: `⌛ Abonnement de <@${sub.userId}> expiré (${plan?.name ?? "formule supprimée"}).` });
  }
}
