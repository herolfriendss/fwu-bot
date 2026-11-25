// FWU — read-only central log verification and routing.
import { buildLogAllowedMentions } from "./logs.js";
export const LOGS_HUB_GUILD_ID = "1570484435239833701";
export const ACTIVE_SOURCE_GUILD_IDS = Object.freeze(["1562643485981544559"]);
// Deliberately not activated yet: second source server is kept out of the allowlist.
export const RESERVED_SOURCE_GUILD_ID = "1505904703563894814";

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
]);

const MZ_LOG_CHANNELS = Object.freeze(
  LOG_CHANNELS.map((item) => ({
    ...item,
    category: `MZ — ${item.category}`,
    key: `mz_${item.key}`,
    name: `mz-${item.name}`,
    source: "mz",
  })),
);

export const ALL_LOG_CHANNELS = Object.freeze([
  ...LOG_CHANNELS.map((item) => ({ ...item, source: "pnd" })),
  ...MZ_LOG_CHANNELS,
]);

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

export function logRolesForCategory(categoryName, source = "pnd") {
  const plainName = source === "mz" ? String(categoryName).replace(/^MZ — /, "") : String(categoryName);
  const allRoles = source === "mz" ? MZ_LOG_ROLES : LOG_ROLES;
  const names = ["Logs Owner", "Logs Admin"];
  if (["MODERATION", "VOCAL", "SÉCURITÉ", "SUPPORT"].includes(plainName)) names.push("Logs Modération");
  if (plainName === "ECONOMIE") names.push("Logs Économie");
  if (plainName === "RECRUTEMENT") names.push("Logs Recrutement");
  return allRoles.filter((role) => names.includes(source === "mz" ? role.name.replace(/^MZ /, "") : role.name));
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
  return guildId === LOGS_HUB_GUILD_ID;
}
export function isActiveSourceGuild(guildId) {
  return ACTIVE_SOURCE_GUILD_IDS.includes(guildId);
}
export function allowedRuntimeGuild(guildId) {
  return isLogsHub(guildId) || isActiveSourceGuild(guildId);
}

/** Prevent an allowlist entry from activating MZ until its separate opt-in is explicit. */
export function filterInactiveSourceGuilds(guildIds, mzEnabled = false) {
  return [...new Set(guildIds)].filter(
    (guildId) => guildId !== RESERVED_SOURCE_GUILD_ID || mzEnabled === true,
  );
}

export function logSourceForGuild(guildId) {
  if (isActiveSourceGuild(guildId)) return "pnd";
  if (guildId === RESERVED_SOURCE_GUILD_ID) return "mz";
  return null;
}

export function logChannelForGuild(guildId, title = "") {
  const source = logSourceForGuild(guildId);
  if (!source) return null;
  const key = logChannelKey(title);
  return (
    ALL_LOG_CHANNELS.find(
      (item) => item.source === source && item.key === (source === "mz" ? `mz_${key}` : key),
    ) ?? null
  );
}

export function hasIsolatedLogPermissions(category, source) {
  if (!category?.guild || !["pnd", "mz"].includes(source)) return false;
  const everyone = category.guild.roles.everyone;
  if (!everyone || category.permissionsFor(everyone)?.has("ViewChannel") !== false) return false;
  const sourceRoles = source === "mz" ? MZ_LOG_ROLES : LOG_ROLES;
  const otherSourceRoles = source === "mz" ? LOG_ROLES : MZ_LOG_ROLES;
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
  if (!guild || guild.id !== LOGS_HUB_GUILD_ID)
    throw new Error("Serveur central de logs incorrect.");

  const activeSources = new Set(ACTIVE_SOURCE_GUILD_IDS.map(logSourceForGuild).filter(Boolean));
  const requiredChannels = ALL_LOG_CHANNELS.filter((spec) => activeSources.has(spec.source));
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
  return { ready: missing.length === 0, channels, missing };
}

export async function sendToLogsHub(client, sourceGuild, embed, title = "", components = [], allowedUserIds = []) {
  if (!client || !sourceGuild || sourceGuild.id === LOGS_HUB_GUILD_ID) return false;
  const spec = logChannelForGuild(sourceGuild.id, title || embed?.title || "");
  if (!spec) return false;
  const hub = client.guilds.cache.get(LOGS_HUB_GUILD_ID);
  if (!hub) return false;
  const channel = hub.channels.cache.find((c) => c.name === spec.name && c.isTextBased());
  if (
    !channel?.parent ||
    channel.parent.name !== spec.category ||
    channel.permissionsLocked !== true ||
    !hasIsolatedLogPermissions(channel.parent, spec.source)
  )
    return false;
  const payload = structuredClone(embed);
  payload.footer = {
    text: `FWU • ${spec.source.toUpperCase()} • ${sourceGuild.name} (${sourceGuild.id})`,
  };
  payload.timestamp ??= new Date().toISOString();
  await channel.send({
    embeds: [payload],
    components,
    allowedMentions: buildLogAllowedMentions(allowedUserIds),
  });
  return true;
}
