import { db, transaction } from "./database.js";

const VANITY_KEY = "__vanity__";

function validGuild(guild) {
  return guild && typeof guild.id === "string" && /^\d{5,25}$/.test(guild.id);
}

function inviteRows(invites) {
  return [...(invites?.values?.() ?? [])].filter((invite) => typeof invite.code === "string" && Number.isSafeInteger(invite.uses) && invite.uses >= 0).map((invite) => ({
    code: invite.code,
    uses: invite.uses,
    inviterId: /^\d{5,25}$/.test(invite.inviter?.id ?? "") ? invite.inviter.id : null,
  }));
}

function saveSnapshot(guildId, rows, now) {
  transaction(() => {
    const keep = new Set(rows.map((row) => row.code));
    const existing = db.prepare("SELECT code FROM guild_invite_snapshots WHERE guild_id=?").all(guildId);
    const remove = db.prepare("DELETE FROM guild_invite_snapshots WHERE guild_id=? AND code=?");
    for (const row of existing) if (!keep.has(row.code)) remove.run(guildId, row.code);
    const upsert = db.prepare(`INSERT INTO guild_invite_snapshots(guild_id,code,uses,inviter_id,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(guild_id,code) DO UPDATE SET uses=excluded.uses,inviter_id=excluded.inviter_id,updated_at=excluded.updated_at`);
    for (const row of rows) upsert.run(guildId, row.code, row.uses, row.inviterId, now);
  });
}

export async function captureGuildInviteSnapshot(guild, now = Date.now()) {
  if (!validGuild(guild)) return { captured: false, reason: "invalid_guild" };
  try {
    const invites = await guild.invites.fetch();
    const rawInvites = [...(invites?.values?.() ?? [])];
    if (rawInvites.some((invite) => !Number.isSafeInteger(invite.uses) || invite.uses < 0)) return { captured: false, reason: "usage_unavailable" };
    const rows = inviteRows(invites);
    try {
      const vanity = await guild.fetchVanityData();
      if (Number.isSafeInteger(vanity?.uses) && vanity.uses >= 0) rows.push({ code: VANITY_KEY, uses: vanity.uses, inviterId: null });
    } catch { /* No vanity URL or insufficient permissions. */ }
    saveSnapshot(guild.id, rows, now);
    return { captured: true, count: rows.length };
  } catch {
    return { captured: false, reason: "permission_or_api_unavailable" };
  }
}

export async function resolveMemberInvite(guild, now = Date.now()) {
  if (!validGuild(guild)) return { source: "unknown", inviterId: null, code: null, reason: "invalid_guild" };
  try {
    const invites = await guild.invites.fetch();
    const rawInvites = [...(invites?.values?.() ?? [])];
    if (rawInvites.some((invite) => !Number.isSafeInteger(invite.uses) || invite.uses < 0)) return { source: "unknown", inviterId: null, code: null, reason: "usage_unavailable" };
    const current = inviteRows(invites);
    const previous = new Map(db.prepare("SELECT code,uses,inviter_id FROM guild_invite_snapshots WHERE guild_id=?").all(guild.id).map((row) => [row.code, row]));
    const increases = current.map((invite) => ({ ...invite, delta: invite.uses - Number(previous.get(invite.code)?.uses ?? 0) }))
      .filter((invite) => invite.delta > 0);
    let vanityUses = null;
    try { vanityUses = (await guild.fetchVanityData())?.uses; } catch { /* No vanity URL or insufficient permissions. */ }
    const oldVanity = previous.get(VANITY_KEY);
    const vanityDelta = Number.isSafeInteger(vanityUses) ? vanityUses - Number(oldVanity?.uses ?? 0) : 0;
    current.push(...(Number.isSafeInteger(vanityUses) ? [{ code: VANITY_KEY, uses: vanityUses, inviterId: null }] : []));
    saveSnapshot(guild.id, current, now);
    if (increases.length === 1 && increases[0].delta === 1 && vanityDelta <= 0) {
      return { source: "invite", inviterId: increases[0].inviterId, code: increases[0].code, reason: null };
    }
    if (increases.length === 0 && vanityDelta === 1) return { source: "vanity", inviterId: null, code: null, reason: null };
    if (increases.length > 0 || vanityDelta > 0) return { source: "unknown", inviterId: null, code: null, reason: "ambiguous_usage_delta" };
    return { source: "unknown", inviterId: null, code: null, reason: "no_matching_usage_delta" };
  } catch {
    return { source: "unknown", inviterId: null, code: null, reason: "permission_or_api_unavailable" };
  }
}

export function recordInviteLifecycle(invite, action, now = Date.now()) {
  const guildId = invite?.guild?.id;
  if (!/^\d{5,25}$/.test(guildId ?? "") || typeof invite.code !== "string") return false;
  if (action === "delete") {
    db.prepare("DELETE FROM guild_invite_snapshots WHERE guild_id=? AND code=?").run(guildId, invite.code);
    return true;
  }
  if (action !== "create") return false;
  if (!Number.isSafeInteger(invite.uses) || invite.uses < 0) return false;
  const uses = invite.uses;
  const inviterId = /^\d{5,25}$/.test(invite.inviter?.id ?? "") ? invite.inviter.id : null;
  db.prepare(`INSERT INTO guild_invite_snapshots(guild_id,code,uses,inviter_id,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(guild_id,code) DO UPDATE SET uses=excluded.uses,inviter_id=excluded.inviter_id,updated_at=excluded.updated_at`)
    .run(guildId, invite.code, uses, inviterId, now);
  return true;
}

// Fiche membre (SYS+ n°7) : on garde qui a invité chaque membre, au moment de son arrivée.
db.exec(`CREATE TABLE IF NOT EXISTS member_invite_attribution (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, source TEXT NOT NULL, inviter_id TEXT, code TEXT,
  joined_at INTEGER NOT NULL, PRIMARY KEY(guild_id, user_id)
)`);

export function recordMemberInvite(guildId, userId, invite, now = Date.now()) {
  if (!guildId || !userId || !invite) return;
  db.prepare(`INSERT INTO member_invite_attribution(guild_id,user_id,source,inviter_id,code,joined_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET source=excluded.source, inviter_id=excluded.inviter_id, code=excluded.code, joined_at=excluded.joined_at`)
    .run(guildId, userId, String(invite.source ?? "unknown"), invite.inviterId ?? null, invite.code ?? null, now);
}

export function getMemberInvite(guildId, userId) {
  const row = db.prepare("SELECT source, inviter_id, code, joined_at FROM member_invite_attribution WHERE guild_id=? AND user_id=?").get(guildId, userId);
  return row ? { source: row.source, inviterId: row.inviter_id, code: row.code, joinedAt: Number(row.joined_at) } : null;
}
