// Her? visual identity — night city, deep violet and subtle atmospheric motion.
// The GIF is served by the dashboard's public/media directory, so Discord embeds
// can display it without storing or exposing any Discord webhook token.
// FWU ecosystem: one identity, each bot signs its own messages ("FWU • GUARD").
// PND_<BOT>_COLOR (#rrggbb) and PND_<BOT>_FOOTER (e.g. PND_GUARD_COLOR) in the
// shared bot/.env let the owner restyle one bot without code.
// Decision 2026-11-26 (FWU V2): no product name in Discord. Dedicated bots sign with their own
// name, the main bot signs nothing (an empty footer is omitted).
const PROFILE_SIGNATURES = Object.freeze({ fwu: "", guard: "GUARD", fdpdlavoc: "FDPDLAVOC", suckme: "SUCK ME", fisc: "LE FISC", investplus: "Invest +" });

export function themeColorFrom(value, fallback = 0xe21d2f) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value ?? "").trim());
  return match ? Number.parseInt(match[1], 16) : fallback;
}

const profileOf = (env) => String(env.PND_BOT_PROFILE ?? "").trim().toLowerCase() || "fwu";

export function themeFooterFrom(env = process.env) {
  const profile = profileOf(env);
  const custom = String(env[`PND_${profile.toUpperCase()}_FOOTER`] ?? "").trim().slice(0, 60);
  if (custom) return custom;
  return PROFILE_SIGNATURES[profile] ?? "";
}

export function themeColorForProfile(env = process.env) {
  return themeColorFrom(env[`PND_${profileOf(env).toUpperCase()}_COLOR`]);
}

export const HER_THEME_COLOR = themeColorForProfile();
export const HER_THEME_FOOTER = themeFooterFrom();

export function herThemeImageUrl() {
  const explicit = process.env.HER_THEME_IMAGE_URL?.trim();
  if (explicit) {
    try {
      const url = new URL(explicit);
      return url.protocol === "https:" ? url.toString() : null;
    } catch {
      return null;
    }
  }
  const base = process.env.SITE_URL?.trim();
  if (!base) return null;
  try {
    const site = new URL(base);
    if (site.protocol !== "https:" && site.hostname !== "localhost" && site.hostname !== "127.0.0.1") return null;
    return new URL("/media/her-v5-city-loop.gif", site).toString();
  } catch {
    return null;
  }
}

/**
 * LIVE announcements use the animated artwork supplied for Her? V5.
 * TikTok gets the alternate grid artwork; the other platforms use the main card.
 * The image is served by the same public HTTPS dashboard host.
 */
export function herLiveAlertImageUrl(platform = "youtube") {
  const base = process.env.SITE_URL?.trim();
  if (!base) return null;
  try {
    const site = new URL(base);
    if (site.protocol !== "https:" && site.hostname !== "localhost" && site.hostname !== "127.0.0.1") return null;
    const file = String(platform).toLowerCase() === "tiktok"
      ? "her-v5-live-alert-grid.gif"
      : "her-v5-live-alert-main.gif";
    return new URL(`/media/${file}`, site).toString();
  } catch {
    return null;
  }
}

export function themePanelEmbed(embed, { animated = true, footer = HER_THEME_FOOTER, thumbnailUrl = null } = {}) {
  embed.setColor(HER_THEME_COLOR);
  const imageUrl = animated ? herThemeImageUrl() : null;
  if (imageUrl) embed.setImage(imageUrl);
  if (thumbnailUrl && /^https:\/\//i.test(thumbnailUrl)) embed.setThumbnail(thumbnailUrl);
  if (footer) embed.setFooter({ text: footer });
  return embed;
}

export function herBotAvatar(guild) {
  try {
    const avatar = guild?.client?.user?.displayAvatarURL?.({ extension: "png", size: 128 });
    return typeof avatar === "string" && avatar.startsWith("https://") ? avatar : null;
  } catch {
    return null;
  }
}

/** Compact Her? branding for result cards and menus that should not carry the large GIF. */
export function brandEmbed(embed) {
  if (!embed.data?.color) embed.setColor(HER_THEME_COLOR);
  const previousFooter = embed.data?.footer?.text;
  const footer = [previousFooter, HER_THEME_FOOTER].filter(Boolean).join(" · ");
  if (footer) embed.setFooter({ text: footer.slice(0, 2048) });
  return embed;
}
