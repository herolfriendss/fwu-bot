// Her? V5 — notifications de démarrage de LIVE depuis des flux RSS/Atom HTTPS.
// Les flux sont fournis par l'administrateur du serveur. Aucun scraping de page privée.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { db } from "./database.js";
import { sendCentralLog, systemLogEmbed } from "./logs.js";
import { HER_THEME_COLOR, HER_THEME_FOOTER, herLiveAlertImageUrl } from "./theme.js";

const LIVE_WORDS = /\b(live|en direct|direct|is live|went live|started streaming|streaming now|lanc[eé] un live|est en live|est en direct)\b/i;
const MAX_FEED_BYTES = 1_000_000;
const FETCH_TIMEOUT_MS = 10_000;
let checking = false;

const decode = (value = "") => value
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
function tag(xml, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i");
  return decode(xml.match(re)?.[1] ?? "");
}

function isPublicIp(address) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    return normalized !== "::" && normalized !== "::1" && !normalized.startsWith("fc")
      && !normalized.startsWith("fd") && !normalized.startsWith("fe8")
      && !normalized.startsWith("fe9") && !normalized.startsWith("fea")
      && !normalized.startsWith("feb") && !normalized.startsWith("ff")
      && !normalized.startsWith("::ffff:127.") && !normalized.startsWith("::ffff:10.")
      && !normalized.startsWith("::ffff:192.168.");
  }
  return false;
}

export async function validatePublicFeedUrl(value, resolveHost = lookup) {
  let url;
  try { url = new URL(value); } catch { throw new Error("invalid_url"); }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) throw new Error("https_required");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("private_host");
  }
  if (isIP(hostname)) {
    if (!isPublicIp(hostname)) throw new Error("private_ip");
  } else {
    let addresses;
    try { addresses = await resolveHost(hostname, { all: true, verbatim: true }); }
    catch { throw new Error("dns_resolution_failed"); }
    if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) throw new Error("private_host");
  }
  url.hash = "";
  return url;
}

async function readLimited(response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_FEED_BYTES) throw new Error("feed_too_large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FEED_BYTES) {
        await reader.cancel();
        throw new Error("feed_too_large");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export function parseFeed(xml) {
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
  return blocks.map((block) => {
    const title = tag(block, "title");
    const linkTag = block.match(/<link\b([^>]*)\/?\s*>/i);
    const link = linkTag?.[1]?.match(/href=["']([^"']+)["']/i)?.[1] || tag(block, "link");
    const id = tag(block, "yt:videoId") || tag(block, "guid") || tag(block, "id") || link || title;
    const date = tag(block, "published") || tag(block, "pubDate") || tag(block, "updated");
    return { id: decode(id), title, link: decode(link), date };
  }).filter((item) => item.id && item.title && /^https:\/\//i.test(item.link));
}

const wasSeen = db.prepare("SELECT 1 FROM live_alert_seen WHERE guild_id=? AND creator_id=? AND item_id=?");
const markSeen = db.prepare("INSERT OR IGNORE INTO live_alert_seen(guild_id,creator_id,item_id,seen_at) VALUES(?,?,?,?)");
const trimSeen = db.prepare("DELETE FROM live_alert_seen WHERE seen_at < ?");

export function buildLiveAlertEmbed(creator, item, animated = true) {
  const imageUrl = animated ? herLiveAlertImageUrl(creator.platform) : null;
  return {
    color: HER_THEME_COLOR,
    title: `🔴 ${String(creator.displayName || "Créateur").slice(0, 240)} est en LIVE !`,
    description: `${String(item.title || "Nouveau direct").slice(0, 1_500)}\n\n[Regarder le direct](${item.link})`.slice(0, 4_096),
    url: item.link,
    ...(HER_THEME_FOOTER ? { footer: { text: HER_THEME_FOOTER } } : {}),
    timestamp: new Date().toISOString(),
    ...(imageUrl ? { image: { url: imageUrl } } : {}),
  };
}

async function fetchFeed(feedUrl) {
  const url = await validatePublicFeedUrl(feedUrl);
  const response = await fetch(url, {
    redirect: "manual",
    headers: { "User-Agent": "PNDAssistPlus/1.0 live-alerts", Accept: "application/atom+xml, application/rss+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  // Do not follow redirects: a trusted public feed must not redirect the bot to
  // an internal host or an unexpected protocol.
  if (response.status >= 300 && response.status < 400) throw new Error("feed_redirect_rejected");
  if (!response.ok) throw new Error(`feed_http_${response.status}`);
  return readLimited(response);
}

export async function checkLiveAlerts(client, settings, record = () => {}) {
  if (checking || !client.isReady()) return;
  checking = true;
  try {
    const cutoff = Date.now() - 30 * 24 * 60 * 60_000;
    trimSeen.run(cutoff);
    for (const guild of client.guilds.cache.values()) {
      const cfg = settings[guild.id]?.liveAlerts;
      if (!cfg?.enabled || !cfg.channelId || !Array.isArray(cfg.creators) || !cfg.creators.length) continue;
      const channel = await guild.channels.fetch(cfg.channelId).catch(() => null);
      if (!channel?.isTextBased() || typeof channel.send !== "function") continue;
      for (const creator of cfg.creators.slice(0, 30)) {
        try {
          const xml = await fetchFeed(creator.feedUrl);
          const items = parseFeed(xml).slice(0, 15).reverse();
          for (const item of items) {
            if (wasSeen.get(guild.id, creator.id, item.id)) continue;
            // A feed must explicitly identify a live item; ordinary uploads are ignored.
            if (!LIVE_WORDS.test(item.title)) continue;
            const embed = buildLiveAlertEmbed(creator, item, cfg.animated !== false);
            // Optional role ping, restricted to that single role (never @everyone).
            const mentionRoleId = /^\d{5,25}$/.test(String(cfg.mentionRoleId ?? "")) && cfg.mentionRoleId !== guild.id ? cfg.mentionRoleId : null;
            await channel.send({
              ...(mentionRoleId ? { content: `<@&${mentionRoleId}>` } : {}),
              embeds: [embed],
              allowedMentions: { parse: [], roles: mentionRoleId ? [mentionRoleId] : [] },
            });
            // Mark only after successful publication so transient Discord errors retry next cycle.
            markSeen.run(guild.id, creator.id, item.id, Date.now());
            await sendCentralLog(guild, settings[guild.id], systemLogEmbed({
              title: "🔴 Alerte LIVE publiée",
              description: `Créateur : **${creator.displayName}** (${creator.platform})\nSalon : <#${channel.id}>\nDirect : ${item.link}`,
            })).catch(() => {});
            record("live_alert_sent");
          }
        } catch {
          record("live_alert_feed_error");
        }
      }
    }
  } finally { checking = false; }
}
