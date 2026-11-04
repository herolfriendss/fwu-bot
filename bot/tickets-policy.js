// Her? V4 — règles pures des tickets staff.
export function sanitizeTicketSubject(raw, max = 200) {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function ticketChannelName(username, userId) {
  const safe = String(username ?? "membre")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "membre";
  return `ticket-${safe}-${String(userId ?? "0").slice(-4)}`.slice(0, 100);
}

export function ticketOpenAllowed(openCount, maxOpenPerUser) {
  const max = Math.max(1, Number(maxOpenPerUser) || 1);
  return Number(openCount) < max;
}

/**
 * Une action sur un ticket est autorisée pour son auteur, la personne qui l’a
 * pris en charge, ou un membre du staff (permission ou rôle support).
 */
export function canActOnTicket({ actorId, ticketUserId, claimedBy = null, isStaff = false }) {
  if (!actorId) return false;
  return actorId === ticketUserId || actorId === claimedBy || Boolean(isStaff);
}

export function ticketStatusLabel(status) {
  if (status === "open") return "🟢 Ouvert";
  if (status === "closed") return "⚪ Fermé";
  return "🟡 Inconnu";
}

export function ticketDuration(createdAt, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Number(createdAt)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / 1440)} j`;
}
