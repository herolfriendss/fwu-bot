import { dataPath } from "./data-dir.js";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { db } from "./database.js";
import { connectState } from "./voice-permissions.js";

/**
 * Persistent PV/UNPV snapshots. SQLite replaces the former
 * data/voice-locks.json file: writes are atomic with the rest of the bot
 * state and survive crashes between the snapshot and the overwrite edits.
 */
const LEGACY_FILE = dataPath("voice-locks.json");

function validOverwrites(value) {
  return (
    Array.isArray(value) &&
    value.every(
      (o) =>
        o &&
        typeof o.id === "string" &&
        (o.type === 0 || o.type === 1) &&
        typeof o.allow === "string" &&
        typeof o.deny === "string",
    )
  );
}

export function getVoiceLockSnapshot(channelId) {
  if (!channelId) return null;
  const row = db
    .prepare(
      "SELECT channel_id,guild_id,owner_id,overwrites_json,created_at FROM voice_lock_snapshots WHERE channel_id=?",
    )
    .get(channelId);
  if (!row) return null;
  let overwrites = [];
  try {
    overwrites = JSON.parse(row.overwrites_json);
  } catch {
    overwrites = [];
  }
  return {
    channelId: row.channel_id,
    guildId: row.guild_id,
    ownerId: row.owner_id,
    overwrites: validOverwrites(overwrites) ? overwrites : [],
    createdAt: row.created_at,
  };
}

/** Keeps the FIRST snapshot: re-locking an already private channel must not overwrite the original state. */
export function saveVoiceLockSnapshotIfAbsent({
  guildId,
  channelId,
  ownerId = null,
  overwrites,
  now = Date.now(),
}) {
  if (!guildId || !channelId || !validOverwrites(overwrites))
    throw new Error("Instantané vocal invalide.");
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO voice_lock_snapshots(channel_id,guild_id,owner_id,overwrites_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?)`,
    )
    .run(channelId, guildId, ownerId, JSON.stringify(overwrites), now, now);
  return Number(result.changes) > 0;
}

export function deleteVoiceLockSnapshot(channelId) {
  if (!channelId) return false;
  return (
    Number(
      db
        .prepare("DELETE FROM voice_lock_snapshots WHERE channel_id=?")
        .run(channelId).changes,
    ) > 0
  );
}

export function listVoiceLockSnapshots(guildId = null) {
  const rows = guildId
    ? db
        .prepare(
          "SELECT channel_id FROM voice_lock_snapshots WHERE guild_id=? ORDER BY created_at",
        )
        .all(guildId)
    : db
        .prepare(
          "SELECT channel_id FROM voice_lock_snapshots ORDER BY created_at",
        )
        .all();
  return rows
    .map((row) => getVoiceLockSnapshot(row.channel_id))
    .filter(Boolean);
}

/**
 * One-time import of the legacy JSON file. Existing SQLite rows win; the
 * file is renamed (never deleted) so the operator keeps a backup.
 */
export function importLegacyVoiceLocks(filePath = LEGACY_FILE) {
  if (!existsSync(filePath)) return { imported: 0, skipped: 0 };
  let data;
  try {
    data = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return { imported: 0, skipped: 0, error: "invalid_json" };
  }
  let imported = 0;
  let skipped = 0;
  for (const [channelId, snapshot] of Object.entries(data ?? {})) {
    if (
      !/^\d{5,25}$/.test(channelId) ||
      !snapshot?.guildId ||
      !validOverwrites(snapshot.overwrites)
    ) {
      skipped += 1;
      continue;
    }
    if (
      saveVoiceLockSnapshotIfAbsent({
        guildId: snapshot.guildId,
        channelId,
        overwrites: snapshot.overwrites,
        now: Number(snapshot.createdAt) || Date.now(),
      })
    )
      imported += 1;
    else skipped += 1;
  }
  try {
    renameSync(filePath, `${filePath}.imported-${Date.now()}`);
  } catch {
    /* keep file; import is idempotent */
  }
  return { imported, skipped };
}

/** Pure: is the channel still effectively private (@everyone Connect denied)? */
export function isChannelStillLocked(currentOverwrites, everyoneId) {
  const everyone = (currentOverwrites ?? []).find((o) => o.id === everyoneId);
  return Boolean(
    everyone && connectState(everyone.allow, everyone.deny) === false,
  );
}

/**
 * Startup/resume reconciliation:
 * - deleted channel → snapshot and private registry entry are dropped;
 * - channel whose @everyone deny was removed by hand while the bot was
 *   offline → the deny is re-applied (the original snapshot is kept so
 *   UNPV still restores the true original state).
 * Unknown guilds (bot removed, allowlist) are left untouched.
 */
export async function reconcileVoiceLocks(
  client,
  {
    onDeleted = () => {},
    onRelocked = () => {},
    isAllowedGuild = () => true,
  } = {},
) {
  const result = { deleted: 0, relocked: 0, kept: 0 };
  for (const snapshot of listVoiceLockSnapshots()) {
    if (!isAllowedGuild(snapshot.guildId)) continue;
    const guild = client?.guilds?.cache?.get?.(snapshot.guildId);
    if (!guild) continue;
    const channel =
      guild.channels?.cache?.get?.(snapshot.channelId) ??
      (await guild.channels
        ?.fetch?.(snapshot.channelId)
        .catch((error) => (error?.code === 10003 ? null : undefined)));
    if (channel === undefined) continue; // transient error: never drop state
    if (!channel) {
      deleteVoiceLockSnapshot(snapshot.channelId);
      onDeleted(snapshot);
      result.deleted += 1;
      continue;
    }
    const current = [
      ...(channel.permissionOverwrites?.cache?.values?.() ?? []),
    ].map((o) => ({
      id: o.id,
      type: o.type,
      allow: o.allow.bitfield.toString(),
      deny: o.deny.bitfield.toString(),
    }));
    if (!isChannelStillLocked(current, guild.id)) {
      try {
        await channel.permissionOverwrites.edit(
          guild.roles.everyone,
          { Connect: false },
          "Rétablissement du mode privé après redémarrage",
        );
        onRelocked(snapshot);
        result.relocked += 1;
      } catch {
        /* missing permission: keep snapshot, UNPV still possible */
      }
      continue;
    }
    result.kept += 1;
  }
  return result;
}
