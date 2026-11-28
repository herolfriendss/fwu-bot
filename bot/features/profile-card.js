// The profile card: a PNG drawn by the bot itself, in the same red-and-black
// language as the banners. No image library, no font engine, no network call
// beyond fetching the member's avatar.
import { AttachmentBuilder } from "discord.js";
import { createCanvas, drawImage, drawText, fillRect, measureText, progressBar, roundedRect, rgb } from "../image/canvas.js";
import { decodePng, encodePng } from "../image/png.js";
import { levelFromXp } from "./community.js";
import { memberOverview } from "./overview.js";

const W = 900;
const H = 320;
const BG = { r: 8, g: 8, b: 10, a: 255 };
const DOT = rgb(0x24242c);
const RED = rgb(0xe21d2f);
const RED_DIM = rgb(0x7a0f1d);
const WHITE = rgb(0xf5f5f7);
const GREY = rgb(0x9a9aa6);
const PANEL = rgb(0x15151b);

const AVATAR_BYTES = 2 * 1024 * 1024;

/** Dot grid and the diagonal stripes, so the card matches the embed banners. */
function background(canvas) {
  for (let y = 8; y < H; y += 16) for (let x = 8; x < W; x += 16) fillRect(canvas, x, y, 1, 1, DOT);
  for (let i = -H; i < W + H; i += 120) {
    for (let t = 0; t < 34; t += 1) {
      const x0 = i + t;
      for (let y = 0; y < H; y += 1) {
        const x = x0 + (H - y);
        if (x < W * 0.42) continue;
        const fade = Math.min(1, (x / W - 0.42) / 0.58);
        fillRect(canvas, x, y, 1, 1, RED_DIM, Math.round(46 * fade));
      }
    }
  }
  fillRect(canvas, 0, H - 6, W, 6, RED);
}

async function fetchAvatar(url, fetchImpl = fetch) {
  if (!url) return null;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > AVATAR_BYTES) return null;
    return decodePng(buffer);
  } catch {
    return null;
  }
}

const compact = (value) => {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)} M`;
  if (n >= 10_000) return `${Math.round(n / 1000)} k`;
  return n.toLocaleString("fr-FR");
};

const hours = (minutes) => (minutes >= 60 ? `${Math.floor(minutes / 60)} h` : `${minutes} min`);

/** One labelled figure in the stats strip. */
function stat(canvas, x, y, width, label, value, color = WHITE) {
  roundedRect(canvas, x, y, width, 74, 12, PANEL);
  drawText(canvas, label.toUpperCase(), x + 14, y + 12, 16, GREY, { maxWidth: width - 28 });
  drawText(canvas, value, x + 14, y + 34, 26, color, { maxWidth: width - 28 });
}

/**
 * Draws the card. `overview` comes from memberOverview, `avatar` is a decoded
 * PNG or null — a member with no readable avatar still gets a full card.
 */
export function renderProfileCard({ overview, username, avatar = null, showPrivate = false }) {
  const canvas = createCanvas(W, H, BG);
  background(canvas);

  const level = overview.level;
  const xp = level?.xp ?? 0;
  const { level: lvl, into, needed } = levelFromXp(xp);

  if (avatar) {
    roundedRect(canvas, 38, 38, 136, 136, 68, RED);
    drawImage(canvas, avatar, 42, 42, { width: 128, height: 128, circle: true });
  } else {
    roundedRect(canvas, 38, 38, 136, 136, 68, PANEL);
    drawText(canvas, (username[0] ?? "?").toUpperCase(), 106, 72, 38, RED, { align: "center" });
  }

  drawText(canvas, username, 200, 44, 38, WHITE, { maxWidth: 480 });
  const profileLabel = showPrivate
    ? `${overview.trust.tier.label} · confiance ${overview.trust.score}/100`
    : "Profil communautaire public";
  drawText(canvas, profileLabel, 200, 92, 20, GREY, { maxWidth: 480 });

  // Level badge, right-aligned against the stripes.
  const badge = `NIVEAU ${lvl}`;
  const badgeWidth = measureText(badge, 26).width + 36;
  roundedRect(canvas, W - 48 - badgeWidth, 44, badgeWidth, 46, 12, RED);
  drawText(canvas, badge, W - 48 - badgeWidth / 2, 54, 26, WHITE, { align: "center" });

  if (level) {
    drawText(canvas, `${compact(into)} / ${compact(needed)} XP`, 200, 128, 16, GREY);
    drawText(canvas, `${level.rank}${level.rank === 1 ? "er" : "e"} sur ${level.total}`, W - 48, 128, 16, GREY, { align: "right" });
    progressBar(canvas, 200, 152, W - 248, 12, needed ? into / needed : 0, { track: rgb(0x26262f), fill: RED });
  } else {
    drawText(canvas, "Aucune activité enregistrée pour l'instant", 200, 136, 20, GREY, { maxWidth: 520 });
  }

  const gap = 18;
  const width = Math.floor((W - 76 - gap * 3) / 4);
  const y = 196;
  stat(canvas, 38, y, width, "Messages", compact(level?.messages ?? 0));
  stat(canvas, 38 + (width + gap), y, width, "Vocal", hours(level?.voiceMinutes ?? 0));
  stat(
    canvas, 38 + (width + gap) * 2, y, width,
    showPrivate ? "PND" : "Réputation",
    compact(showPrivate ? (overview.economy?.balance ?? 0) : (overview.extras?.reputation ?? 0)),
    RED,
  );
  stat(canvas, 38 + (width + gap) * 3, y, width, "Succès", String(level?.achievements ?? 0));

  return encodePng(W, H, canvas.data);
}

/** Builds the Discord attachment for a member. */
export async function profileCardAttachment({ guildId, userId, username, avatarUrl, member = null, fetchImpl = fetch, showPrivate = false }) {
  const overview = memberOverview(guildId, userId, { member });
  const avatar = await fetchAvatar(avatarUrl, fetchImpl);
  const png = renderProfileCard({ overview, username, avatar, showPrivate });
  return { attachment: new AttachmentBuilder(png, { name: "profil.png" }), overview };
}
