import { runAsActor } from "./owner-shield.js";
import { randomBytes } from "node:crypto";
import { db } from "./database.js";
import { roleAssignmentDecision } from "./role-policy.js";
import { planRankAll, dangerousRolePermissions } from "./rankall-policy.js";

export { planRankAll, dangerousRolePermissions };

/**
 * RANKALL job engine: preview → confirmation → run (stoppable) → undo.
 *
 * - One open job (preview or running) per guild; a second preview is refused
 *   while a run is in progress, an expired preview is replaced.
 * - Jobs and the exact list of members that received the role are stored in
 *   SQLite, so an undo stays possible after a restart. Runs interrupted by a
 *   restart are marked "interrupted" at startup (never resumed silently).
 * - Roles carrying dangerous permissions are never mass-assigned.
 */
export const RANKALL_PREVIEW_TTL_MS = 60_000;
export const RANKALL_UNDO_TTL_MS = 15 * 60_000;
export const RANKALL_MAX_MEMBERS =
  Number(process.env.PND_RANKALL_MAX_MEMBERS) > 0
    ? Number(process.env.PND_RANKALL_MAX_MEMBERS)
    : 5_000;
export const RANKALL_STEP_DELAY_MS = Number.isFinite(
  Number(process.env.PND_RANKALL_STEP_DELAY_MS),
)
  ? Math.max(0, Number(process.env.PND_RANKALL_STEP_DELAY_MS))
  : 250;

db.exec(`CREATE TABLE IF NOT EXISTS rankall_jobs (
  job_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, actor_id TEXT NOT NULL, role_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('preview','running','completed','stopped','interrupted','cancelled','expired','undone')),
  eligible_count INTEGER NOT NULL DEFAULT 0, skipped_count INTEGER NOT NULL DEFAULT 0,
  assigned_json TEXT NOT NULL DEFAULT '[]', failed_count INTEGER NOT NULL DEFAULT 0,
  stop_requested INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS rankall_jobs_guild_idx ON rankall_jobs(guild_id,status,created_at DESC);`);

function rowToJob(row) {
  if (!row) return null;
  let assigned = [];
  try {
    assigned = JSON.parse(row.assigned_json);
  } catch {
    assigned = [];
  }
  return {
    id: row.job_id,
    guildId: row.guild_id,
    actorId: row.actor_id,
    roleId: row.role_id,
    status: row.status,
    eligibleCount: row.eligible_count,
    skippedCount: row.skipped_count,
    assigned,
    failedCount: row.failed_count,
    stopRequested: row.stop_requested === 1,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    finishedAt: row.finished_at,
  };
}

export function getRankAllJob(jobId) {
  if (typeof jobId !== "string" || !/^[a-f0-9]{12}$/.test(jobId)) return null;
  return rowToJob(
    db.prepare("SELECT * FROM rankall_jobs WHERE job_id=?").get(jobId),
  );
}

function openJob(guildId, now) {
  const row = db
    .prepare(
      "SELECT * FROM rankall_jobs WHERE guild_id=? AND status IN ('preview','running') ORDER BY created_at DESC LIMIT 1",
    )
    .get(guildId);
  const job = rowToJob(row);
  if (job?.status === "preview" && job.expiresAt <= now) {
    db.prepare(
      "UPDATE rankall_jobs SET status='expired',finished_at=? WHERE job_id=?",
    ).run(now, job.id);
    return null;
  }
  return job;
}

export function createRankAllPreview({
  guildId,
  actorId,
  roleId,
  eligibleCount,
  skippedCount,
  now = Date.now(),
}) {
  const existing = openJob(guildId, now);
  if (existing?.status === "running")
    throw new Error(
      "Une attribution générale est déjà en cours sur ce serveur. Arrête-la ou attends la fin.",
    );
  if (existing?.status === "preview")
    db.prepare(
      "UPDATE rankall_jobs SET status='cancelled',finished_at=? WHERE job_id=?",
    ).run(now, existing.id);
  const id = randomBytes(6).toString("hex");
  db.prepare(
    `INSERT INTO rankall_jobs(job_id,guild_id,actor_id,role_id,status,eligible_count,skipped_count,created_at,expires_at)
    VALUES(?,?,?,?, 'preview',?,?,?,?)`,
  ).run(
    id,
    guildId,
    actorId,
    roleId,
    eligibleCount,
    skippedCount,
    now,
    now + RANKALL_PREVIEW_TTL_MS,
  );
  return getRankAllJob(id);
}

/** Atomically moves a valid preview to "running" (double-click safe). */
export function claimRankAllJob(jobId, actorId, now = Date.now()) {
  const job = getRankAllJob(jobId);
  if (!job) return { ok: false, reason: "Cette attribution est introuvable." };
  if (job.actorId !== actorId)
    return {
      ok: false,
      reason: "Cette confirmation appartient à un autre utilisateur.",
    };
  if (job.status !== "preview")
    return {
      ok: false,
      reason:
        job.status === "running"
          ? "Cette attribution est déjà en cours."
          : "Cette attribution n'est plus en attente de confirmation.",
    };
  if (job.expiresAt <= now) {
    db.prepare(
      "UPDATE rankall_jobs SET status='expired',finished_at=? WHERE job_id=?",
    ).run(now, jobId);
    return {
      ok: false,
      reason:
        "Cette confirmation a expiré. Relance /rankall pour préparer une nouvelle attribution.",
    };
  }
  const changed = Number(
    db
      .prepare(
        "UPDATE rankall_jobs SET status='running' WHERE job_id=? AND status='preview'",
      )
      .run(jobId).changes,
  );
  return changed
    ? { ok: true, job: getRankAllJob(jobId) }
    : { ok: false, reason: "Cette attribution est déjà en cours." };
}

export function cancelRankAllPreview(jobId, actorId, now = Date.now()) {
  const job = getRankAllJob(jobId);
  if (!job || job.actorId !== actorId) return false;
  return (
    Number(
      db
        .prepare(
          "UPDATE rankall_jobs SET status='cancelled',finished_at=? WHERE job_id=? AND status='preview'",
        )
        .run(now, jobId).changes,
    ) > 0
  );
}

export function requestRankAllStop(jobId, actorId) {
  const job = getRankAllJob(jobId);
  if (!job || job.actorId !== actorId || job.status !== "running") return false;
  db.prepare("UPDATE rankall_jobs SET stop_requested=1 WHERE job_id=?").run(
    jobId,
  );
  return true;
}

function saveProgress(jobId, assigned, failed) {
  db.prepare(
    "UPDATE rankall_jobs SET assigned_json=?,failed_count=? WHERE job_id=?",
  ).run(JSON.stringify(assigned), failed, jobId);
}

function stopRequested(jobId) {
  return (
    db
      .prepare("SELECT stop_requested FROM rankall_jobs WHERE job_id=?")
      .get(jobId)?.stop_requested === 1
  );
}

/** Marks runs left "running" by a crash/restart. They can still be undone. */
export function recoverInterruptedRankAllJobs(now = Date.now()) {
  db.prepare(
    "UPDATE rankall_jobs SET status='expired',finished_at=? WHERE status='preview' AND expires_at<=?",
  ).run(now, now);
  return Number(
    db
      .prepare(
        "UPDATE rankall_jobs SET status='interrupted',finished_at=? WHERE status='running'",
      )
      .run(now).changes,
  );
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs a claimed job. Every mutation rechecks the fresh member, role and
 * hierarchy. `onProgress` is throttled by the caller.
 */
export async function executeRankAllJob({
  job,
  guild,
  role,
  actor,
  botMember,
  members,
  onProgress = async () => {},
  sleep = wait,
  stepDelayMs = RANKALL_STEP_DELAY_MS,
  canManageRoles = () => true,
}) {
  const assigned = [...job.assigned];
  let failed = job.failedCount;
  let processed = 0;
  let stopped = false;
  for (const member of members) {
    if (stopRequested(job.id)) {
      stopped = true;
      break;
    }
    processed += 1;
    try {
      const fresh = await guild.members.fetch({ user: member.id, force: true });
      if (!fresh || fresh.user?.bot || fresh.roles.cache.has(role.id)) continue;

      // A rankall job can run for minutes. Re-read the live role object on every
      // iteration so a permission/position change during the batch cannot turn
      // a previously harmless mass assignment into privilege escalation.
      const currentRole = guild.roles?.cache?.get?.(role.id) ?? role;
      if (
        guild.roles?.cache?.has?.(role.id) === false ||
        dangerousRolePermissions(currentRole).length ||
        currentRole.managed ||
        currentRole.id === guild.id ||
        currentRole.position >= botMember.roles.highest.position
      ) {
        stopped = true;
        break;
      }
      const decision = roleAssignmentDecision({
        actorId: actor.id,
        ownerId: guild.ownerId,
        targetId: fresh.id,
        actorPosition: actor.roles.highest.position,
        targetPosition: fresh.roles.highest.position,
        roleId: currentRole.id,
        everyoneRoleId: guild.id,
        rolePosition: currentRole.position,
        roleManaged: currentRole.managed,
        botId: botMember.id,
        botPosition: botMember.roles.highest.position,
      });
      if (!decision.allowed || !canManageRoles()) {
        failed += 1;
        continue;
      }
      await fresh.roles.add(
        currentRole,
        `FWU rankall ${job.id} confirmé par ${actor.id}`,
      );
      assigned.push(fresh.id);
    } catch {
      failed += 1;
    }
    if (processed % 10 === 0) {
      saveProgress(job.id, assigned, failed);
      await onProgress({
        processed,
        total: members.length,
        assigned: assigned.length,
        failed,
      }).catch(() => {});
    }
    if (stepDelayMs) await sleep(stepDelayMs);
  }
  const status = stopped ? "stopped" : "completed";
  saveProgress(job.id, assigned, failed);
  db.prepare(
    "UPDATE rankall_jobs SET status=?,finished_at=? WHERE job_id=?",
  ).run(status, Date.now(), job.id);
  return {
    status,
    assigned: assigned.length,
    failed,
    processed,
    total: members.length,
    assignedIds: assigned,
  };
}

export function canUndoRankAllJob(job, actorId, now = Date.now()) {
  if (!job) return { ok: false, reason: "Attribution introuvable." };
  if (job.actorId !== actorId)
    return {
      ok: false,
      reason: "Seul l'auteur de l'attribution peut l'annuler.",
    };
  if (!["completed", "stopped", "interrupted"].includes(job.status))
    return {
      ok: false,
      reason:
        job.status === "undone"
          ? "Cette attribution a déjà été annulée."
          : "Cette attribution ne peut pas être annulée.",
    };
  if (!job.finishedAt || now - job.finishedAt > RANKALL_UNDO_TTL_MS)
    return {
      ok: false,
      reason: "Le délai d'annulation (15 minutes) est dépassé.",
    };
  if (!job.assigned.length)
    return {
      ok: false,
      reason: "Aucun rôle n'a été attribué par cette opération.",
    };
  return { ok: true };
}

/** Removes the role only from members THIS job gave it to. */
export async function undoRankAllJob({
  job,
  guild,
  role,
  sleep = wait,
  stepDelayMs = RANKALL_STEP_DELAY_MS,
}) {
  if (
    !Number(
      db
        .prepare(
          "UPDATE rankall_jobs SET status='undone' WHERE job_id=? AND status IN ('completed','stopped','interrupted')",
        )
        .run(job.id).changes,
    )
  ) {
    return { removed: 0, failed: 0, skipped: 0, alreadyUndone: true };
  }
  let removed = 0;
  let failed = 0;
  let skipped = 0;
  for (const memberId of job.assigned) {
    try {
      const member = await guild.members
        .fetch({ user: memberId, force: true })
        .catch(() => null);
      if (!member || !member.roles.cache.has(role.id)) {
        skipped += 1;
        continue;
      }
      // Undo only takes back what this job added: a system step, not a rank-checked action.
      await runAsActor(null, () => member.roles.remove(role, `FWU rankall ${job.id} annulé`));
      removed += 1;
    } catch {
      failed += 1;
    }
    if (stepDelayMs) await sleep(stepDelayMs);
  }
  return { removed, failed, skipped, alreadyUndone: false };
}
