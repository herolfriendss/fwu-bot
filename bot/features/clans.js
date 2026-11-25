// Clans and seasons — the long game.
//
// A clan is a group with a shared vault and a points total that its members
// feed by being active. A season closes every few months: the standings reset,
// the winners are written into a hall of fame that is never cleared.
import { db, transaction, tableExists } from "../database.js";
import { publishEventSafe } from "../event-bus.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS fwu_clans (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL,
    name TEXT NOT NULL, tag TEXT NOT NULL, leader_id TEXT NOT NULL,
    description TEXT, vault INTEGER NOT NULL DEFAULT 0,
    points INTEGER NOT NULL DEFAULT 0, season_points INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS fwu_clans_tag ON fwu_clans(guild_id, tag);
  CREATE UNIQUE INDEX IF NOT EXISTS fwu_clans_name ON fwu_clans(guild_id, name);
  CREATE TABLE IF NOT EXISTS fwu_clan_members (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, clan_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'membre', contributed INTEGER NOT NULL DEFAULT 0,
    joined_at INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS fwu_clan_members_clan ON fwu_clan_members(clan_id);
  CREATE TABLE IF NOT EXISTS fwu_clan_invites (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, clan_id INTEGER NOT NULL,
    invited_by TEXT NOT NULL, expires_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, clan_id)
  );
  CREATE TABLE IF NOT EXISTS fwu_seasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, number INTEGER NOT NULL,
    name TEXT, started_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', closed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS fwu_seasons_guild ON fwu_seasons(guild_id, status);
  CREATE TABLE IF NOT EXISTS fwu_season_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, season_id INTEGER NOT NULL,
    board TEXT NOT NULL, rank INTEGER NOT NULL, subject_id TEXT NOT NULL,
    label TEXT, score INTEGER NOT NULL, recorded_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS fwu_season_results_board ON fwu_season_results(guild_id, board, rank);
`);

export const CLAN_COST = 50_000;
export const MAX_MEMBERS = 20;
export const INVITE_TTL_MS = 48 * 60 * 60_000;
export const SEASON_LENGTH_MS = 90 * 24 * 60 * 60_000;
export const CLAN_ROLES = Object.freeze(["membre", "officier", "chef"]);
const MAX_BALANCE = 1_000_000_000_000;

/** Pure: a clan name must be readable, a tag short and unambiguous. */
export function validateClanIdentity(name, tag) {
  const cleanName = String(name ?? "").trim().replace(/\s+/g, " ");
  const cleanTag = String(tag ?? "").trim().toUpperCase();
  if (cleanName.length < 3 || cleanName.length > 32) throw new Error("Le nom doit faire entre 3 et 32 caractères.");
  if (/[\p{C}]/u.test(cleanName)) throw new Error("Le nom contient des caractères invisibles.");
  if (!/^[A-Z0-9]{2,5}$/.test(cleanTag)) throw new Error("Le tag doit faire 2 à 5 lettres ou chiffres, sans espace.");
  return { name: cleanName, tag: cleanTag };
}

export const clanById = (id) => db.prepare("SELECT * FROM fwu_clans WHERE id=?").get(id) ?? null;
export const clanByTag = (guildId, tag) =>
  db.prepare("SELECT * FROM fwu_clans WHERE guild_id=? AND tag=?").get(guildId, String(tag ?? "").trim().toUpperCase()) ?? null;
export const membershipOf = (guildId, userId) =>
  db.prepare("SELECT * FROM fwu_clan_members WHERE guild_id=? AND user_id=?").get(guildId, userId) ?? null;
export const clanOf = (guildId, userId) => {
  const row = membershipOf(guildId, userId);
  return row ? clanById(row.clan_id) : null;
};
export const clanMembers = (clanId) =>
  db.prepare("SELECT user_id, role, contributed, joined_at FROM fwu_clan_members WHERE clan_id=? ORDER BY contributed DESC").all(clanId);
export const clanSize = (clanId) =>
  Number(db.prepare("SELECT COUNT(*) AS n FROM fwu_clan_members WHERE clan_id=?").get(clanId).n);

const spend = (guildId, userId, amount, reason, now) => {
  db.prepare("INSERT OR IGNORE INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,0,0)").run(guildId, userId);
  const taken = db.prepare("UPDATE wallets SET balance=balance-? WHERE guild_id=? AND user_id=? AND balance>=?")
    .run(amount, guildId, userId, amount);
  if (!Number(taken.changes)) throw new Error(`Il te faut ${amount.toLocaleString("fr-FR")} PND pour cela.`);
  db.prepare("INSERT INTO economy_ledger(guild_id,user_id,delta,reason,created_at) VALUES(?,?,?,?,?)")
    .run(guildId, userId, -amount, reason, now);
};

const receive = (guildId, userId, amount, reason, now) => {
  db.prepare("INSERT OR IGNORE INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,0,0)").run(guildId, userId);
  const given = db.prepare("UPDATE wallets SET balance=balance+? WHERE guild_id=? AND user_id=? AND balance<=?")
    .run(amount, guildId, userId, MAX_BALANCE - amount);
  if (!Number(given.changes)) throw new Error("Le paiement dépasserait le solde maximal autorisé.");
  db.prepare("INSERT INTO economy_ledger(guild_id,user_id,delta,reason,created_at) VALUES(?,?,?,?,?)")
    .run(guildId, userId, amount, reason, now);
};

export function createClan({ guildId, userId, name, tag, now = Date.now() }) {
  const identity = validateClanIdentity(name, tag);
  return transaction(() => {
    if (membershipOf(guildId, userId)) throw new Error("Tu es déjà dans un clan. Quitte-le avant d'en fonder un.");
    if (clanByTag(guildId, identity.tag)) throw new Error(`Le tag ${identity.tag} est déjà pris.`);
    if (db.prepare("SELECT 1 FROM fwu_clans WHERE guild_id=? AND name=?").get(guildId, identity.name)) {
      throw new Error("Un clan porte déjà ce nom.");
    }
    spend(guildId, userId, CLAN_COST, "clan_creation", now);
    const info = db.prepare("INSERT INTO fwu_clans(guild_id,name,tag,leader_id,created_at) VALUES(?,?,?,?,?)")
      .run(guildId, identity.name, identity.tag, userId, now);
    const clanId = Number(info.lastInsertRowid);
    db.prepare("INSERT INTO fwu_clan_members(guild_id,user_id,clan_id,role,joined_at) VALUES(?,?,?,'chef',?)")
      .run(guildId, userId, clanId, now);
    publishEventSafe({ guildId, kind: "clan.created", actorId: userId, source: "fwu", payload: { clanId, name: identity.name, tag: identity.tag } });
    return clanById(clanId);
  });
}

export function inviteToClan({ guildId, clanId, userId, invitedBy, now = Date.now() }) {
  const membership = membershipOf(guildId, invitedBy);
  if (!membership || membership.clan_id !== clanId) throw new Error("Tu n'es pas dans ce clan.");
  if (membership.role === "membre") throw new Error("Seuls le chef et les officiers peuvent inviter.");
  if (membershipOf(guildId, userId)) throw new Error("Ce membre appartient déjà à un clan.");
  if (clanSize(clanId) >= MAX_MEMBERS) throw new Error(`Le clan est complet (${MAX_MEMBERS} membres).`);
  db.prepare(`INSERT INTO fwu_clan_invites(guild_id,user_id,clan_id,invited_by,expires_at) VALUES(?,?,?,?,?)
    ON CONFLICT(guild_id,user_id,clan_id) DO UPDATE SET invited_by=excluded.invited_by, expires_at=excluded.expires_at`)
    .run(guildId, userId, clanId, invitedBy, now + INVITE_TTL_MS);
  return now + INVITE_TTL_MS;
}

export const pendingInvites = (guildId, userId, now = Date.now()) =>
  db.prepare("SELECT clan_id, invited_by, expires_at FROM fwu_clan_invites WHERE guild_id=? AND user_id=? AND expires_at>?")
    .all(guildId, userId, now);

export function joinClan({ guildId, userId, clanId, now = Date.now() }) {
  return transaction(() => {
    if (membershipOf(guildId, userId)) throw new Error("Tu es déjà dans un clan.");
    const invite = db.prepare("SELECT 1 FROM fwu_clan_invites WHERE guild_id=? AND user_id=? AND clan_id=? AND expires_at>?")
      .get(guildId, userId, clanId, now);
    if (!invite) throw new Error("Tu n'as pas d'invitation valable pour ce clan.");
    if (clanSize(clanId) >= MAX_MEMBERS) throw new Error(`Le clan est complet (${MAX_MEMBERS} membres).`);
    db.prepare("INSERT INTO fwu_clan_members(guild_id,user_id,clan_id,role,joined_at) VALUES(?,?,?,'membre',?)")
      .run(guildId, userId, clanId, now);
    db.prepare("DELETE FROM fwu_clan_invites WHERE guild_id=? AND user_id=?").run(guildId, userId);
    publishEventSafe({ guildId, kind: "clan.joined", actorId: userId, source: "fwu", payload: { clanId } });
    return clanById(clanId);
  });
}

/** The leader cannot simply walk out: the clan is handed over or dissolved. */
export function leaveClan({ guildId, userId, now = Date.now() }) {
  return transaction(() => {
    const membership = membershipOf(guildId, userId);
    if (!membership) throw new Error("Tu n'es dans aucun clan.");
    if (membership.role === "chef" && clanSize(membership.clan_id) > 1) {
      throw new Error("Transmets d'abord la direction avec `/clan promouvoir`, ou dissous le clan.");
    }
    db.prepare("DELETE FROM fwu_clan_members WHERE guild_id=? AND user_id=?").run(guildId, userId);
    const remaining = clanSize(membership.clan_id);
    if (!remaining) dissolveRows(membership.clan_id);
    publishEventSafe({ guildId, kind: "clan.left", actorId: userId, source: "fwu", payload: { clanId: membership.clan_id, dissolved: !remaining } });
    return { dissolved: !remaining };
  });
}

const dissolveRows = (clanId) => {
  db.prepare("DELETE FROM fwu_clan_members WHERE clan_id=?").run(clanId);
  db.prepare("DELETE FROM fwu_clan_invites WHERE clan_id=?").run(clanId);
  db.prepare("DELETE FROM fwu_clans WHERE id=?").run(clanId);
};

/** Dissolving pays the vault back to the leader, so nothing is silently burned. */
export function dissolveClan({ guildId, userId, now = Date.now() }) {
  return transaction(() => {
    const membership = membershipOf(guildId, userId);
    if (!membership || membership.role !== "chef") throw new Error("Seul le chef peut dissoudre le clan.");
    const clan = clanById(membership.clan_id);
    if (clan.vault > 0) receive(guildId, userId, Number(clan.vault), "clan_dissolution", now);
    dissolveRows(clan.id);
    return { refunded: Number(clan.vault) };
  });
}

export function setClanRole({ guildId, actorId, targetId, role, now = Date.now() }) {
  if (!CLAN_ROLES.includes(role)) throw new Error("Rang inconnu.");
  return transaction(() => {
    const actor = membershipOf(guildId, actorId);
    if (!actor || actor.role !== "chef") throw new Error("Seul le chef peut changer les rangs.");
    const target = membershipOf(guildId, targetId);
    if (!target || target.clan_id !== actor.clan_id) throw new Error("Ce membre n'est pas dans ton clan.");
    if (targetId === actorId) throw new Error("Tu ne peux pas changer ton propre rang.");
    db.prepare("UPDATE fwu_clan_members SET role=? WHERE guild_id=? AND user_id=?").run(role, guildId, targetId);
    // Handing over the lead steps the old leader down in the same move.
    if (role === "chef") {
      db.prepare("UPDATE fwu_clan_members SET role='officier' WHERE guild_id=? AND user_id=?").run(guildId, actorId);
      db.prepare("UPDATE fwu_clans SET leader_id=? WHERE id=?").run(targetId, actor.clan_id);
    }
    return clanById(actor.clan_id);
  });
}

export function kickFromClan({ guildId, actorId, targetId }) {
  return transaction(() => {
    const actor = membershipOf(guildId, actorId);
    const target = membershipOf(guildId, targetId);
    if (!actor || !target || actor.clan_id !== target.clan_id) throw new Error("Ce membre n'est pas dans ton clan.");
    if (actor.role === "membre") throw new Error("Seuls le chef et les officiers peuvent exclure.");
    if (target.role === "chef") throw new Error("Le chef ne peut pas être exclu.");
    if (actor.role === "officier" && target.role === "officier") throw new Error("Un officier ne peut pas en exclure un autre.");
    db.prepare("DELETE FROM fwu_clan_members WHERE guild_id=? AND user_id=?").run(guildId, targetId);
    return true;
  });
}

export function depositToVault({ guildId, userId, amount, now = Date.now() }) {
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error("Montant invalide.");
  return transaction(() => {
    const membership = membershipOf(guildId, userId);
    if (!membership) throw new Error("Tu n'es dans aucun clan.");
    spend(guildId, userId, amount, "clan_depot", now);
    db.prepare("UPDATE fwu_clans SET vault=vault+? WHERE id=?").run(amount, membership.clan_id);
    db.prepare("UPDATE fwu_clan_members SET contributed=contributed+? WHERE guild_id=? AND user_id=?").run(amount, guildId, userId);
    return clanById(membership.clan_id);
  });
}

/** Only the leader withdraws: a shared vault anyone can empty is not shared. */
export function withdrawFromVault({ guildId, userId, amount, now = Date.now() }) {
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error("Montant invalide.");
  return transaction(() => {
    const membership = membershipOf(guildId, userId);
    if (!membership || membership.role !== "chef") throw new Error("Seul le chef peut retirer du coffre.");
    const taken = db.prepare("UPDATE fwu_clans SET vault=vault-? WHERE id=? AND vault>=?").run(amount, membership.clan_id, amount);
    if (!Number(taken.changes)) throw new Error("Le coffre ne contient pas assez de PND.");
    receive(guildId, userId, amount, "clan_retrait", now);
    return clanById(membership.clan_id);
  });
}

/** Activity feeds the clan: called by the cascade when a member earns something. */
export function addClanPoints(guildId, userId, points) {
  if (!Number.isFinite(points) || points <= 0) return 0;
  const membership = membershipOf(guildId, userId);
  if (!membership) return 0;
  const amount = Math.floor(points);
  db.prepare("UPDATE fwu_clans SET points=points+?, season_points=season_points+? WHERE id=?")
    .run(amount, amount, membership.clan_id);
  return amount;
}

export const clanLeaderboard = (guildId, { board = "season", limit = 10 } = {}) => {
  const column = board === "season" ? "season_points" : "points";
  const bounded = Math.min(25, Math.max(1, Number(limit) || 10));
  return db.prepare(`SELECT id, name, tag, leader_id, vault, points, season_points,
    (SELECT COUNT(*) FROM fwu_clan_members m WHERE m.clan_id=fwu_clans.id) AS members
    FROM fwu_clans WHERE guild_id=? ORDER BY ${column} DESC, members DESC LIMIT ?`).all(guildId, bounded);
};

// ----------------------------------------------------------------- seasons ----

export const currentSeason = (guildId) =>
  db.prepare("SELECT * FROM fwu_seasons WHERE guild_id=? AND status='active' ORDER BY id DESC").get(guildId) ?? null;

export function startSeason({ guildId, name = null, lengthMs = SEASON_LENGTH_MS, now = Date.now() }) {
  return transaction(() => {
    if (currentSeason(guildId)) throw new Error("Une saison est déjà en cours. Clôture-la d'abord.");
    const number = Number(db.prepare("SELECT COALESCE(MAX(number),0) + 1 AS n FROM fwu_seasons WHERE guild_id=?").get(guildId).n);
    const info = db.prepare("INSERT INTO fwu_seasons(guild_id,number,name,started_at,ends_at) VALUES(?,?,?,?,?)")
      .run(guildId, number, name, now, now + lengthMs);
    db.prepare("UPDATE fwu_clans SET season_points=0 WHERE guild_id=?").run(guildId);
    publishEventSafe({ guildId, kind: "season.started", source: "fwu", payload: { number, name } });
    return db.prepare("SELECT * FROM fwu_seasons WHERE id=?").get(Number(info.lastInsertRowid));
  });
}

/** Records the podiums for good, then clears the season standings. */
export function closeSeason({ guildId, now = Date.now() }) {
  return transaction(() => {
    const season = currentSeason(guildId);
    if (!season) throw new Error("Aucune saison en cours.");
    const boards = {
      clans: clanLeaderboard(guildId, { board: "season", limit: 3 })
        .filter((clan) => clan.season_points > 0)
        .map((clan) => ({ subjectId: String(clan.id), label: `[${clan.tag}] ${clan.name}`, score: Number(clan.season_points) })),
      membres: tableExists("community_levels")
        ? db.prepare("SELECT user_id, xp FROM community_levels WHERE guild_id=? ORDER BY xp DESC LIMIT 3").all(guildId)
          .map((row) => ({ subjectId: row.user_id, label: null, score: Number(row.xp) }))
        : [],
      casino: tableExists("casino_rounds")
        ? db.prepare(`SELECT user_id, SUM(payout-bet) AS net FROM casino_rounds WHERE guild_id=?
            GROUP BY user_id ORDER BY net DESC LIMIT 3`).all(guildId)
          .filter((row) => Number(row.net) > 0)
          .map((row) => ({ subjectId: row.user_id, label: null, score: Number(row.net) }))
        : [],
    };
    const insert = db.prepare(`INSERT INTO fwu_season_results(guild_id,season_id,board,rank,subject_id,label,score,recorded_at)
      VALUES(?,?,?,?,?,?,?,?)`);
    for (const [board, rows] of Object.entries(boards)) {
      rows.forEach((row, index) => insert.run(guildId, season.id, board, index + 1, row.subjectId, row.label, row.score, now));
    }
    db.prepare("UPDATE fwu_seasons SET status='closed', closed_at=? WHERE id=?").run(now, season.id);
    db.prepare("UPDATE fwu_clans SET season_points=0 WHERE guild_id=?").run(guildId);
    publishEventSafe({ guildId, kind: "season.ended", source: "fwu", payload: { number: season.number } });
    return { season, boards };
  });
}

export const hallOfFame = (guildId, { board = null, limit = 30 } = {}) => {
  const bounded = Math.min(60, Math.max(1, Number(limit) || 30));
  const sql = `SELECT r.*, s.number AS season_number, s.name AS season_name FROM fwu_season_results r
    JOIN fwu_seasons s ON s.id=r.season_id WHERE r.guild_id=?${board ? " AND r.board=?" : ""}
    ORDER BY s.number DESC, r.board, r.rank LIMIT ?`;
  return board ? db.prepare(sql).all(guildId, board, bounded) : db.prepare(sql).all(guildId, bounded);
};

/** Seasons that ran past their end date, so a scheduler can close them. */
export const dueSeasons = (now = Date.now()) =>
  db.prepare("SELECT * FROM fwu_seasons WHERE status='active' AND ends_at<=?").all(now);
