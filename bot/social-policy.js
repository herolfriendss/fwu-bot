// Her? V4 — règles sociales pures (profils, réputation).
export const REP_COOLDOWN_MS = 24 * 60 * 60_000;

export function sanitizeBio(raw, max = 280) {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function sanitizeProfileColor(raw) {
  const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(raw ?? "").trim());
  if (!match) return null;
  const hex = match[1].length === 3 ? match[1].split("").map((c) => c + c).join("") : match[1];
  return `#${hex.toLowerCase()}`;
}

export function colorToInt(color) {
  return /^#[0-9a-f]{6}$/i.test(String(color ?? "")) ? Number.parseInt(color.slice(1), 16) : null;
}

export function repCooldownRemaining(lastGivenAt, now = Date.now(), cooldownMs = REP_COOLDOWN_MS) {
  if (!lastGivenAt) return 0;
  return Math.max(0, Number(lastGivenAt) + cooldownMs - now);
}

export function canGiveRep({ giverId, targetId, targetIsBot = false }) {
  if (!giverId || !targetId) return { allowed: false, reason: "Membre introuvable." };
  if (giverId === targetId) return { allowed: false, reason: "Tu ne peux pas te donner de réputation." };
  if (targetIsBot) return { allowed: false, reason: "Tu ne peux pas donner de réputation à un bot." };
  return { allowed: true, reason: null };
}

export function repBadge(count) {
  const value = Math.max(0, Number(count) || 0);
  if (value >= 100) return "🏆 Légende";
  if (value >= 50) return "⭐ Vétéran";
  if (value >= 20) return "🌟 Confirmé";
  if (value >= 5) return "✨ Apprécié";
  return "🌱 Nouveau";
}

const DAY = 86_400_000;
const envNumber = (name, fallback) => (Number(process.env[name]) > 0 ? Number(process.env[name]) : fallback);
export const REP_LIMITS = Object.freeze({
  dailyGiven: envNumber("PND_REP_DAILY_LIMIT", 5),
  minAccountDays: envNumber("PND_REP_MIN_ACCOUNT_DAYS", 7),
  minMemberDays: envNumber("PND_REP_MIN_MEMBER_DAYS", 3),
});

/** Anti-farming for reputation: giver age and a daily cap across all targets. */
export function evaluateRepGiver({ accountCreatedAt, joinedAt, givenLast24h = 0, now = Date.now(), limits = REP_LIMITS }) {
  if (!Number.isFinite(accountCreatedAt) || now - accountCreatedAt < limits.minAccountDays * DAY) {
    return { allowed: false, reason: `Ton compte Discord doit avoir au moins ${limits.minAccountDays} jours pour donner de la réputation.` };
  }
  if (!Number.isFinite(joinedAt) || now - joinedAt < limits.minMemberDays * DAY) {
    return { allowed: false, reason: `Il faut être membre depuis au moins ${limits.minMemberDays} jours pour donner de la réputation.` };
  }
  if (givenLast24h >= limits.dailyGiven) return { allowed: false, reason: `Tu as déjà donné ${limits.dailyGiven} points de réputation en 24 h.` };
  return { allowed: true, reason: null };
}

/**
 * Badges are computed from existing data on every display (no stored table
 * that could drift). All inputs are guild-scoped.
 */
export function computeBadges({ rep = 0, joinedAt = null, totalPnd = 0, cards = 0, givenTotal = 0, now = Date.now() }) {
  const badges = [repBadge(rep)];
  if (Number.isFinite(joinedAt)) {
    const years = (now - joinedAt) / (365 * DAY);
    if (years >= 2) badges.push("🏛️ Pilier (2 ans)");
    else if (years >= 1) badges.push("🎂 Ancien (1 an)");
  }
  if (totalPnd >= 1_000_000) badges.push("💎 Millionnaire PND");
  else if (totalPnd >= 100_000) badges.push("💰 Fortuné");
  if (cards >= 100) badges.push("🃏 Grand collectionneur");
  else if (cards >= 25) badges.push("🎴 Collectionneur");
  if (givenTotal >= 50) badges.push("🤝 Bienveillant");
  return badges;
}
