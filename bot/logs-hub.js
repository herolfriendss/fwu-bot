// FWU — read-only central log verification and routing.
// V2 : le hub et les serveurs sources viennent de logs-config.js (base, réglés par /logs).
// Les constantes ci-dessous ne sont plus que les valeurs historiques de repli.
import { buildLogAllowedMentions } from "./logs.js";
import { LEGACY_LOGS_DEFAULTS, activeSourceGuildIds, logSources, logsHubGuildId, sourceForGuild } from "./logs-config.js";
export const LOGS_HUB_GUILD_ID = LEGACY_LOGS_DEFAULTS.hubGuildId;
export const ACTIVE_SOURCE_GUILD_IDS = Object.freeze(LEGACY_LOGS_DEFAULTS.sources.filter((s) => s.enabled).map((s) => s.guildId));
// Deliberately not activated yet: second source server is kept out of the allowlist.
export const RESERVED_SOURCE_GUILD_ID = LEGACY_LOGS_DEFAULTS.sources.find((s) => s.slug === "mz").guildId;

export const LOG_CHANNELS = Object.freeze([
  { category: "ADMINISTRATION", name: "logs-staff", key: "staff" },
  { category: "ADMINISTRATION", name: "logs-permissions", key: "permissions" },
  { category: "MODERATION", name: "logs-sanctions", key: "moderation" },
  { category: "MODERATION", name: "logs-membres", key: "members" },
  { category: "VOCAL", name: "logs-vocaux", key: "voice" },
  { category: "VOCAL", name: "logs-dog-menotte", key: "dog" },
  { category: "ECONOMIE", name: "logs-pnd", key: "economy" },
  { category: "ECONOMIE", name: "logs-jeux", key: "games" },
  { category: "ECONOMIE", name: "logs-casino", key: "casino" },
  { category: "SÉCURITÉ", name: "logs-securite", key: "security" },
  { category: "STAFF", name: "logs-hierarchie", key: "supervisors" },
  { category: "AUTOMATISATIONS", name: "logs-automatisations", key: "automation" },
  { category: "RECRUTEMENT", name: "logs-recrutement", key: "recruitment" },
  { category: "SUPPORT", name: "logs-tickets", key: "tickets" },
  { category: "SÉCURITÉ", name: "logs-verification", key: "verification" },
  { category: "SYSTÈMES", name: "logs-webhooks", key: "webhooks" },
  { category: "INTELLIGENCE", name: "logs-intelligence", key: "ai" },
  { category: "SYSTÈMES", name: "logs-bot", key: "system" },
  { category: "SYSTÈMES", name: "logs-erreurs", key: "errors" },
  // V2 : alertes graves (raid, BLR, anti-nuke, dérive de permissions). Facultatif : tant
  // qu'il n'existe pas, les alertes vont dans logs-securite.
  { category: "SÉCURITÉ", name: "logs-alertes", key: "alerts", optional: true },
]);

/** Catégories de logs valides (routage typé). */
export const LOG_CATEGORY_KEYS = Object.freeze(LOG_CHANNELS.map((item) => item.key));

/**
 * Un jeu de salons par serveur source (plus de jeu « MZ » recopié à la main) :
 * la source principale garde les noms historiques, les autres sont préfixées.
 */
export function logChannelSetFor(slug, primary = slug === "pnd") {
  return LOG_CHANNELS.map((item) => (primary
    ? { ...item, source: slug }
    : { ...item, category: `${slug.toUpperCase()} — ${item.category}`, key: `${slug}_${item.key}`, name: `${slug}-${item.name}`, source: slug }));
}

/** Salons de toutes les sources configurées. */
export function allLogChannels() {
  return logSources().flatMap((source) => logChannelSetFor(source.slug, source.primary));
}

export const ALL_LOG_CHANNELS = Object.freeze(
  LEGACY_LOGS_DEFAULTS.sources.flatMap((source) => logChannelSetFor(source.slug, source.primary)),
);

export const LOG_ROLES = Object.freeze([
  { name: "Logs Owner", color: 0x8b5cf6 },
  { name: "Logs Admin", color: 0x7c3aed },
  { name: "Logs Modération", color: 0xef4444 },
  { name: "Logs Économie", color: 0x22c55e },
  { name: "Logs Recrutement", color: 0x0ea5e9 },
  { name: "Logs Viewer", color: 0x64748b },
]);

export const MZ_LOG_ROLES = Object.freeze(
  LOG_ROLES.map((role) => ({
    ...role,
    name: `MZ ${role.name}`,
  })),
);

function isPrimarySource(source) {
  if (source === "pnd") return true;
  return Boolean(logSources().find((item) => item.slug === source)?.primary);
}

/** Rôles de lecture d'une source : noms historiques pour la principale, préfixés sinon. */
export function logRolesForSource(source) {
  if (isPrimarySource(source)) return LOG_ROLES;
  if (source === "mz") return MZ_LOG_ROLES;
  const prefix = String(source).toUpperCase();
  return LOG_ROLES.map((role) => ({ ...role, name: `${prefix} ${role.name}` }));
}

export function logRolesForCategory(categoryName, source = "pnd") {
  const primary = isPrimarySource(source);
  const prefix = String(source).toUpperCase();
  const plainName = primary ? String(categoryName) : String(categoryName).replace(new RegExp(`^${prefix} — `), "");
  const allRoles = logRolesForSource(source);
  const names = ["Logs Owner", "Logs Admin"];
  if (["MODERATION", "VOCAL", "SÉCURITÉ", "SUPPORT"].includes(plainName)) names.push("Logs Modération");
  if (plainName === "ECONOMIE") names.push("Logs Économie");
  if (plainName === "RECRUTEMENT") names.push("Logs Recrutement");
  return allRoles.filter((role) => names.includes(primary ? role.name : role.name.replace(new RegExp(`^${prefix} `), "")));
}

// Explicit routes are checked first: keyword heuristics below misrouted
// several real titles (ANTI-MOVE/WAKEUP → staff, Guardian → IA, rankall →
// membres). Covered by logs-coverage.test.js.
const EXPLICIT_ROUTES = [
  [/anti-move|wakeup|salon privatisé|\bpv\b/, "voice"],
  [/guardian|acl risquée|permission dangereuse|raid/, "security"],
  [/attribution générale|rankall/, "permissions"],
  [/rôle créé|rôle supprimé|rôle modifié|permissions d.un salon/, "permissions"],
  [/salon créé|salon supprimé|salon renommé|serveur modifié|fil créé|fil supprimé/, "staff"],
  [/invitation/, "security"],
  [/exclusion temporaire|suppression groupée/, "moderation"],
  [/pseudonyme|message modifié/, "members"],
  [/santé du bot/, "system"],
];

export function logChannelKey(title = "") {
  const value = String(title).toLowerCase();
  for (const [pattern, key] of EXPLICIT_ROUTES) if (pattern.test(value)) return key;
  if (/erreur|error|échec|exception/.test(value)) return "errors";
  if (/ticket|support|transcript/.test(value)) return "tickets";
  if (/vérification|verification|captcha|verify|admission/.test(value)) return "verification";
  if (/webhook|publication webhook/.test(value)) return "webhooks";
  if (/recrutement|candidature|entretien|convocation/.test(value)) return "recruitment";
  if (/automatisation|automation|workflow/.test(value)) return "automation";
  if (/sécurité|securite|anti-raid|anti-spam|guildguard|incident/.test(value)) return "security";
  if (/casino|jackpot|machine à sous|slots/.test(value)) return "casino";
  if (/superviseur|responsable|hiérarchie|hierarchie|staff/.test(value)) return "supervisors";

  if (/dog|menotte|laisse/.test(value)) return "dog";
  if (/vocal|voice|salon temporaire|join-to-create/.test(value)) return "voice";
  if (/pnd|économie|economie|solde|achat|vente/.test(value)) return "economy";
  if (/jeu|carte|blackjack|roulette/.test(value)) return "games";
  if (/sanction|ban|kick|timeout|modération/.test(value)) return "moderation";
  if (/membre|arrivée|départ|message supprimé|rôle/.test(value)) return "members";
  if (/permission|accès|sys\+|admin\+/.test(value)) return "permissions";
  if (/ia|assistant|intelligence/.test(value)) return "ai";
  if (/bot|système|live|radio|musique/.test(value)) return "system";
  return "staff";
}

export function isLogsHub(guildId) {
  return guildId === logsHubGuildId();
}
export function isActiveSourceGuild(guildId) {
  return activeSourceGuildIds().includes(guildId);
}
export function allowedRuntimeGuild(guildId) {
  return isLogsHub(guildId) || isActiveSourceGuild(guildId);
}

/** Prevent an allowlist entry from activating MZ until its separate opt-in is explicit. */
export function filterInactiveSourceGuilds(guildIds, mzEnabled = false) {
  const reserved = new Set(logSources().filter((source) => source.slug === "mz").map((source) => source.guildId));
  return [...new Set(guildIds)].filter(
    (guildId) => !reserved.has(guildId) || mzEnabled === true,
  );
}

export function logSourceForGuild(guildId) {
  const source = sourceForGuild(guildId);
  if (!source) return null;
  return source.enabled || source.slug === "mz" ? source.slug : null;
}

/**
 * Salon du hub pour un log. `category` (routage typé, V2) est prioritaire ; le titre
 * (`logChannelKey`) ne sert plus que de secours pour les anciens appels.
 */
export function logChannelForGuild(guildId, title = "", category = null) {
  const source = logSourceForGuild(guildId);
  if (!source) return null;
  const key = LOG_CATEGORY_KEYS.includes(category) ? category : logChannelKey(title);
  const primary = isPrimarySource(source);
  return logChannelSetFor(source, primary).find((item) => item.key === (primary ? key : `${source}_${key}`)) ?? null;
}

export function hasIsolatedLogPermissions(category, source) {
  const known = new Set(["pnd", "mz", ...logSources().map((item) => item.slug)]);
  if (!category?.guild || !known.has(source)) return false;
  const everyone = category.guild.roles.everyone;
  if (!everyone || category.permissionsFor(everyone)?.has("ViewChannel") !== false) return false;
  const sourceRoles = logRolesForSource(source);
  const otherSourceRoles = [...known].filter((slug) => slug !== source).flatMap((slug) => logRolesForSource(slug))
    .filter((role) => !sourceRoles.some((own) => own.name === role.name));
  const ownRoles = logRolesForCategory(category.name, source);
  const bot = category.guild.members.me;
  const ownRoleIds = new Set(
    ownRoles
      .map((spec) => category.guild.roles.cache.find((item) => item.name === spec.name)?.id)
      .filter(Boolean),
  );
  const allowedRoleIds = new Set([...ownRoleIds, everyone.id, bot?.id].filter(Boolean));
  for (const overwrite of category.permissionOverwrites?.cache?.values?.() ?? []) {
    if (!overwrite.allow.has("ViewChannel")) continue;
    if (overwrite.type === 0 && !allowedRoleIds.has(overwrite.id)) return false;
    if (overwrite.type === 1 && overwrite.id !== bot?.id) return false;
  }
  for (const spec of sourceRoles) {
    const role = category.guild.roles.cache.find((item) => item.name === spec.name);
    if (!role) {
      if (ownRoles.includes(spec)) return false;
      continue;
    }
    if (ownRoles.includes(spec)) {
      if (category.permissionsFor(role)?.has("ViewChannel") !== true) return false;
    } else if (category.permissionsFor(role)?.has("ViewChannel") === true) return false;
    if (role.permissions?.has?.("Administrator") === true) return false;
  }
  for (const spec of otherSourceRoles) {
    const role = category.guild.roles.cache.find((item) => item.name === spec.name);
    if (role && category.permissionsFor(role)?.has("ViewChannel") === true) return false;
  }
  const botPermissions = bot && category.permissionsFor(bot);
  return Boolean(
    botPermissions?.has("ViewChannel") &&
    botPermissions.has("SendMessages") &&
    botPermissions.has("EmbedLinks"),
  );
}

/**
 * Read-only verification of the dedicated log server.
 * This function deliberately never creates, edits, moves or deletes channels,
 * categories, roles or permission overwrites.
 */
export function inspectLogsHub(guild) {
  if (!guild || guild.id !== logsHubGuildId())
    throw new Error("Serveur central de logs incorrect.");

  // Only allowlisted source guilds and their exact existing log categories are considered healthy.
  const activeSources = new Set(activeSourceGuildIds().map(logSourceForGuild).filter(Boolean));
  const requiredChannels = allLogChannels().filter((spec) => activeSources.has(spec.source) && !spec.optional);
  const channels = new Map();
  const missing = [];
  for (const spec of requiredChannels) {
    const channel = guild.channels.cache.find(
      (item) => item.name === spec.name && item.isTextBased(),
    );
    if (!channel) {
      missing.push({ key: spec.key, channel: spec.name, reason: "missing_channel" });
      continue;
    }
    if (
      !channel.parent ||
      channel.parent.name !== spec.category ||
      channel.permissionsLocked !== true ||
      !hasIsolatedLogPermissions(channel.parent, spec.source)
    ) {
      missing.push({ key: spec.key, channel: spec.name, reason: "unsafe_or_misplaced_channel" });
      continue;
    }
    channels.set(spec.key, channel.id);
  }
  return {
    ready: missing.length === 0,
    channels,
    missing,
    required: requiredChannels.length,
    activeSources: [...activeSources],
  };
}

function findHubChannel(hub, spec) {
  const channel = hub.channels.cache.find(
    (c) => c.name === spec.name && c.isTextBased() && c.parent?.name === spec.category,
  );
  if (
    !channel?.parent ||
    channel.parent.name !== spec.category ||
    channel.permissionsLocked !== true ||
    !hasIsolatedLogPermissions(channel.parent, spec.source)
  )
    return null;
  return channel;
}

export async function sendToLogsHub(client, sourceGuild, embed, title = "", components = [], allowedUserIds = [], { category = null, mentionRoleIds = [] } = {}) {
  const hubId = logsHubGuildId();
  if (!client || !sourceGuild || sourceGuild.id === hubId) return false;
  category ??= embed?.logCategory ?? null;
  const spec = logChannelForGuild(sourceGuild.id, title || embed?.title || "", category);
  if (!spec) return false;
  const hub = client.guilds.cache.get(hubId);
  if (!hub) return false;
  let channel = findHubChannel(hub, spec);
  // Salon d'alertes absent : repli sur logs-securite (aucune alerte perdue).
  if (!channel && spec.optional) {
    const fallback = logChannelForGuild(sourceGuild.id, "", "security");
    channel = fallback ? findHubChannel(hub, fallback) : null;
    if (channel) spec.source = fallback.source;
  }
  if (!channel) return false;
  const payload = structuredClone(typeof embed?.toJSON === "function" ? embed.toJSON() : embed);
  const source = sourceForGuild(sourceGuild.id);
  payload.footer = {
    text: `${(source?.slug ?? spec.source).toUpperCase()} • ${sourceGuild.name} (${sourceGuild.id})`,
  };
  payload.timestamp ??= new Date().toISOString();
  const allowedMentions = buildLogAllowedMentions(allowedUserIds);
  const roles = mentionRoleIds.filter((id) => /^\d{17,20}$/.test(String(id)));
  if (roles.length) allowedMentions.roles = roles;
  await channel.send({
    ...(roles.length ? { content: roles.map((id) => `<@&${id}>`).join(" ") } : {}),
    embeds: [payload],
    components,
    allowedMentions,
  });
  return true;
}
