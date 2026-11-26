// 1942 — journal centralisé par serveur.
// Utilise des objets APIEmbed simples pour rester testable sans charger le client Discord.
const MAX_FIELD_VALUE = 1024;
const clean = (value, max = 4000) => String(value ?? "").slice(0, max);

export function buildLogAllowedMentions(userIds = []) {
  const users = Array.isArray(userIds)
    ? [...new Set(userIds.filter((id) => typeof id === "string" && /^\d{5,25}$/.test(id)))].slice(0, 10)
    : [];
  return { parse: [], users, roles: [], repliedUser: false };
}

// FWU multi-bot: a dedicated bot installs a relay so its logs are posted by FWU
// (which owns the Logs Hub). Observers (RESUME) see every log once, in the
// process that actually delivers it.
import { slashifyPayload as slashifyPayloadForLog } from "./prefix-to-slash.js";

let centralLogRelay = null;
const centralLogObservers = new Set();

export function setCentralLogRelay(relay) {
  centralLogRelay = typeof relay === "function" ? relay : null;
}

function slashifyEmbedForLog(embed) {
  try {
    return slashifyPayloadForLog({ embeds: [embed] }).embeds[0];
  } catch {
    return embed;
  }
}

export function addCentralLogObserver(observer) {
  if (typeof observer === "function") centralLogObservers.add(observer);
  return () => centralLogObservers.delete(observer);
}

/**
 * Options V2 : `category` (routage typé ; à défaut, déduite du titre une fois, à la source),
 * `archived` (copie en base déjà faite), `noQueue` (pas de remise en file : nouvel essai du
 * relais), `mentionRoleIds` (staff de garde prévenu pour une alerte grave).
 */
export async function sendCentralLog(guild, settings, embed, fallbackChannelIds = [], components = [], allowedUserIds = [], { skipObservers = false, category = null, archived = false, noQueue = false, mentionRoleIds = [] } = {}) {
  if (!guild || !embed) return false;
  const hubModule = await import("./logs-hub.js").catch(() => null);
  const explicit = category ?? embed?.logCategory ?? null;
  const resolvedCategory = hubModule?.LOG_CATEGORY_KEYS?.includes(explicit)
    ? explicit
    : hubModule?.logChannelKey?.(embed?.title ?? embed?.data?.title ?? "") ?? null;
  if (!archived) {
    try {
      const { archiveRawLog } = await import("./log-events.js");
      archiveRawLog(guild.id, resolvedCategory, embed);
    } catch { /* la copie en base ne bloque jamais un log */ }
  }
  if (centralLogRelay) {
    try {
      return Boolean(centralLogRelay({ guild, embed, fallbackChannelIds, components, allowedUserIds, category: resolvedCategory, mentionRoleIds }));
    } catch {
      return false;
    }
  }
  // Log texts point to slash commands (the "=" commands were abandoned).
  embed = slashifyEmbedForLog(embed);
  for (const observer of skipObservers ? [] : centralLogObservers) {
    try { observer(guild, typeof embed?.toJSON === "function" ? embed.toJSON() : embed); } catch { /* never block a log */ }
  }
  let delivered = false;
  let hubDelivered = false;

  // All module logs also try the isolated central Logs Hub. This closes the gap
  // where direct module calls only reached a legacy local channel.
  if (guild.client && hubModule) {
    try {
      hubDelivered = await hubModule.sendToLogsHub(
        guild.client,
        guild,
        embed,
        embed.title ?? "",
        components,
        allowedUserIds,
        { category: resolvedCategory, mentionRoleIds },
      );
      delivered = hubDelivered || delivered;
    } catch {
      // Keep local logging available when the hub is not provisioned/reachable.
    }
    // File durable : hub injoignable pour un serveur source → nouvel essai (3 au plus,
    // puis compté comme perdu, visible dans /status et /logs statut).
    if (!hubDelivered && !noQueue && hubModule.isActiveSourceGuild?.(guild.id)) {
      try {
        const { enqueueRelayedLog } = await import("./bot-runtime.js");
        enqueueRelayedLog({ guildId: guild.id, sourceProfile: "fwu", embed, fallbackChannelIds: [], components, allowedUserIds, category: resolvedCategory, mentionRoleIds, hubOnly: true });
      } catch { /* jamais bloquant */ }
    }
  }

  const channelId = settings?.logs?.channelId || fallbackChannelIds.find(Boolean) || null;
  if (!channelId) return delivered;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || typeof channel.send !== "function") return delivered;
  const botMember = guild.members?.me;
  const permissions = botMember && channel.permissionsFor?.(botMember);
  if (permissions && (!permissions.has("SendMessages") || !permissions.has("EmbedLinks"))) return delivered;
  await channel.send({
    embeds: [embed],
    components,
    allowedMentions: buildLogAllowedMentions(allowedUserIds),
  });
  return true;
}

/** Catégorie typée portée par un embed (non sérialisée vers Discord). */
export function withLogCategory(embed, category) {
  if (embed && typeof embed === "object" && category) Object.defineProperty(embed, "logCategory", { value: category, enumerable: false, configurable: true });
  return embed;
}

export function systemLogEmbed({ title, description, color = 0xe21d2f, fields = [], category = null }) {
  const normalizedFields = Array.isArray(fields) ? fields.slice(0, 25).map((field) => ({
    name: clean(field?.name || "Détail", 256),
    value: clean(field?.value || "—", MAX_FIELD_VALUE),
    inline: field?.inline === true,
  })) : [];
  return withLogCategory({
    color,
    title: clean(title || "Événement", 256),
    ...(description ? { description: clean(description, 4000) } : {}),
    ...(normalizedFields.length ? { fields: normalizedFields } : {}),
    timestamp: new Date().toISOString(),
    footer: { text: "Journal centralisé" },
  }, category);
}
