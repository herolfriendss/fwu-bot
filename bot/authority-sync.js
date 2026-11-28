// AUTHORITY 3.4 — synchronisation avec la console du site.
//
// Toutes les minutes, le bot qui porte /authority (SUCK ME) :
//   1. envoie le miroir des demandes de chaque serveur servi (POST /api/public/authority-sync,
//      secret BOT_SYNC_SECRET) ;
//   2. reçoit les décisions déposées par l'OWNER dans la console ;
//   3. les applique avec bot/authority.js, exactement comme sur Discord : OWNER configuré, nonce à
//      usage unique, signature, refus à la moindre anomalie ; renvoie le résultat au tour suivant.
// La console est déjà réservée à l'OWNER (OAuth Discord + cookie) ; le bot ne fait pas confiance au
// site pour autant : chaque décision repasse par le registre.
import { decideRequest, effectiveStatus, ensureAuthorityTables, getRequest } from "./authority.js";
import { db as defaultDb } from "./database.js";
import { parsePndOwnerId } from "./pnd-owner-policy.js";

export const AUTHORITY_SYNC_LABELS = Object.freeze({
  "voice.room.extra": "Salon vocal supplémentaire",
  "moderation.quota.extra": "Quota de modération doublé",
  "economy.quota.extra": "Quota économique supplémentaire",
  "module.beta.access": "Accès à un module en test",
  "staff.mission.create": "Créer des missions du staff",
  "staff.meeting.plan": "Planifier des réunions du staff",
});

export function buildAuthoritySnapshot(guildId, { db = defaultDb, now = Date.now() } = {}) {
  ensureAuthorityTables(db);
  const rows = db.prepare("SELECT * FROM authority_requests WHERE guild_id = ? ORDER BY id DESC LIMIT 200").all(String(guildId));
  return {
    guildId: String(guildId),
    capturedAt: new Date(now).toISOString(),
    requests: rows.map((row) => {
      const status = effectiveStatus(row, now);
      return {
        number: Number(row.number), permission: row.permission, label: AUTHORITY_SYNC_LABELS[row.permission] ?? row.permission,
        requesterId: row.requester_id, beneficiaryId: row.beneficiary_id, justification: String(row.justification).slice(0, 500),
        durationMs: Number(row.duration_ms), status, createdAt: Number(row.created_at),
        expiresAt: row.expires_at == null ? null : Number(row.expires_at),
        nonce: status === "pending" ? row.nonce : null,
      };
    }),
  };
}

/** Applies console decisions for the guilds this bot serves. Returns results for the next sync. */
export function applyConsoleDecisions(decisions, { guildIds, db = defaultDb, env = process.env, now = Date.now() } = {}) {
  const ownerId = parsePndOwnerId(env.PND_OWNER_DISCORD_ID);
  const served = new Set((guildIds ?? []).map(String));
  const results = [];
  for (const d of decisions ?? []) {
    if (!d?.id) continue;
    if (!served.has(String(d.guildId))) continue; // another bot or server: never touched here
    if (!ownerId) { results.push({ id: d.id, ok: false, result: "OWNER non configuré : refusé." }); continue; }
    const r = decideRequest({ guildId: String(d.guildId), number: Number(d.number), actorId: ownerId, action: d.action, nonce: d.nonce ?? null, durationMs: d.durationMs ?? null }, { db, env, now });
    results.push({ id: d.id, ok: !r.error, result: String(r.error ?? `Fait : ${r.status}`).slice(0, 200) });
  }
  return results;
}

/** One sync round. Never throws: the site may be down, the registry keeps working on Discord. */
export async function runAuthoritySync({ apiUrl, secret, guildIds, pendingResults = [], fetchImpl = globalThis.fetch, db = defaultDb, env = process.env, now = Date.now() }) {
  if (!apiUrl || !secret || !guildIds?.length) return { results: pendingResults, applied: 0 };
  try {
    const body = { snapshots: guildIds.slice(0, 10).map((g) => buildAuthoritySnapshot(g, { db, now })), results: pendingResults.slice(0, 50) };
    const response = await fetchImpl(`${apiUrl.replace(/\/$/, "")}/api/public/authority-sync`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { results: pendingResults, applied: 0, error: `HTTP ${response.status}` };
    const data = await response.json();
    const results = applyConsoleDecisions(data?.decisions ?? [], { guildIds, db, env, now });
    return { results, applied: results.length };
  } catch {
    return { results: pendingResults, applied: 0, error: "unreachable" };
  }
}

export const requestExists = (guildId, number, options) => Boolean(getRequest(guildId, number, options));
