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
let centralLogRelay = null;
const centralLogObservers = new Set();

export function setCentralLogRelay(relay) {
  centralLogRelay = typeof relay === "function" ? relay : null;
}

export function addCentralLogObserver(observer) {
  if (typeof observer === "function") centralLogObservers.add(observer);
  return () => centralLogObservers.delete(observer);
}

export async function sendCentralLog(guild, settings, embed, fallbackChannelIds = [], components = [], allowedUserIds = []) {
  if (!guild || !embed) return false;
  if (centralLogRelay) {
    try {
      return Boolean(centralLogRelay({ guild, embed, fallbackChannelIds, components, allowedUserIds }));
    } catch {
      return false;
    }
  }
  for (const observer of centralLogObservers) {
    try { observer(guild, typeof embed?.toJSON === "function" ? embed.toJSON() : embed); } catch { /* never block a log */ }
  }
  let delivered = false;

  // All module logs also try the isolated central Logs Hub. This closes the gap
  // where direct module calls only reached a legacy local channel.
  if (guild.client) {
    try {
      const { sendToLogsHub } = await import("./logs-hub.js");
      delivered = await sendToLogsHub(
        guild.client,
        guild,
        embed,
        embed.title ?? "",
        components,
        allowedUserIds,
      ) || delivered;
    } catch {
      // Keep local logging available when the hub is not provisioned/reachable.
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

export function systemLogEmbed({ title, description, color = 0x6d28d9, fields = [] }) {
  const normalizedFields = Array.isArray(fields) ? fields.slice(0, 25).map((field) => ({
    name: clean(field?.name || "Détail", 256),
    value: clean(field?.value || "—", MAX_FIELD_VALUE),
    inline: field?.inline === true,
  })) : [];
  return {
    color,
    title: clean(title || "Événement FWU", 256),
    ...(description ? { description: clean(description, 4000) } : {}),
    ...(normalizedFields.length ? { fields: normalizedFields } : {}),
    timestamp: new Date().toISOString(),
    footer: { text: "FWU • Journal centralisé" },
  };
}
