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
