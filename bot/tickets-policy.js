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

/** Parse the documented prefix surface without trusting mention text as an ID. */
export function parseTicketPrefixCommand(content, mentionedUserId = null) {
  const parts = String(content ?? "").trim().split(/\s+/);
  if (!/^=ticket$/i.test(parts[0] ?? "")) return null;
  const action = (parts[1] ?? "help").toLowerCase();
  if (!["help", "panel", "list", "close", "add", "remove", "assign", "historique", "transcript"].includes(action)) {
    return { action: "invalid" };
  }
  if ((action === "add" || action === "remove" || action === "assign") && !/^\d{5,25}$/.test(String(mentionedUserId ?? ""))) {
    return { action, error: "member_required" };
  }
  const ticketId = /^\d{1,12}$/.test(parts[2] ?? "") ? Number(parts[2]) : null;
  return {
    action,
    ticketId,
    memberId: mentionedUserId,
    reason: action === "close" ? sanitizeTicketSubject(parts.slice(2).join(" "), 300) : "",
  };
}

/** Tickets require an explicit enablement and an existing support role; no Discord setup is provisioned. */
export function ticketSetupIssue(settings) {
  if (settings?.enabled !== true) return "Les tickets ne sont pas activés sur ce serveur.";
  if (!/^\\d{5,25}$/.test(String(settings?.supportRoleId ?? ""))) return "Configure un rôle support existant dans les réglages des tickets avant de publier le panneau.";
  return null;
}
