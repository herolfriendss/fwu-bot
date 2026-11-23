import { ChannelType, PermissionFlagsBits } from "discord.js";

/**
 * WAKEUP: walk a connected member through every eligible public voice channel.
 *
 * This module holds the pure/testable parts (channel selection, message
 * sanitising, cooldown/locks, the move loop). Authorisation and Discord
 * response handling stay in voice-commands.js.
 */

export const WAKEUP_MAX_CHANNELS = 25;
export const WAKEUP_MESSAGE_MAX = 300;
const DEFAULT_STEP_DELAY_MS = 1500;
const DEFAULT_COOLDOWN_MS = 60_000;

const clampMs = (raw, fallback, max) => {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.min(value, max) : fallback;
};
export const wakeupStepDelayMs = () =>
  clampMs(process.env.PND_WAKEUP_STEP_DELAY_MS, DEFAULT_STEP_DELAY_MS, 10_000);
export const wakeupCooldownMs = () =>
  clampMs(process.env.PND_WAKEUP_COOLDOWN_MS, DEFAULT_COOLDOWN_MS, 3_600_000);

const SNOWFLAKE = /^\d{5,25}$/;

/** Configured channel ids (preferred) from the guild settings; invalid values are ignored. */
export function normalizeWakeupConfig(settings) {
  const raw = settings?.wakeup ?? {};
  const id = (value) =>
    typeof value === "string" && SNOWFLAKE.test(value.trim())
      ? value.trim()
      : null;
  return {
    ownerChannelId: id(raw.ownerChannelId),
    waitingChannelId: id(raw.waitingChannelId),
    excludedChannelIds: new Set(
      (Array.isArray(raw.excludedChannelIds) ? raw.excludedChannelIds : [])
        .map(id)
        .filter(Boolean),
    ),
  };
}

function normalizedName(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Controlled name fallback, used only for a slot whose id is NOT configured:
 * a channel named "Owner" (the staff room) or a waiting room ("attente", "waiting").
 */
export function isReservedByName(channel, config) {
  const name = normalizedName(channel?.name);
  if (!config.ownerChannelId && /\bowner\b/.test(name)) return true;
  if (!config.waitingChannelId && /\b(attente|waiting)\b/.test(name))
    return true;
  return false;
}

function hasAll(permissions, flags) {
  return Boolean(permissions) && flags.every((flag) => permissions.has(flag));
}

/**
 * Eligible = voice channel that @everyone can see and join, that is not the AFK,
 * Owner or waiting channel, that the target can access and that the bot can use to move them.
 */
export function eligibleWakeupChannels({ guild, target, bot, config }) {
  const reserved = new Set(
    [
      config.ownerChannelId,
      config.waitingChannelId,
      guild.afkChannelId,
      ...config.excludedChannelIds,
    ].filter(Boolean),
  );
  const everyone = guild.roles?.everyone ?? guild.id;
  const channels = [...(guild.channels?.cache?.values?.() ?? [])]
    .filter((channel) => channel?.type === ChannelType.GuildVoice)
    .filter((channel) => !reserved.has(channel.id))
    .filter((channel) => !isReservedByName(channel, config))
    .filter((channel) =>
      hasAll(channel.permissionsFor?.(everyone), [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
      ]),
    )
    .filter((channel) =>
      hasAll(channel.permissionsFor?.(target), [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
      ]),
    )
    .filter((channel) =>
      hasAll(channel.permissionsFor?.(bot), [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.MoveMembers,
      ]),
    );
  channels.sort(
    (a, b) =>
      (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0) ||
      String(a.id).localeCompare(String(b.id)),
  );
  return channels.slice(0, WAKEUP_MAX_CHANNELS);
}

/** The optional custom message can never ping anyone: mass mentions and user/role mentions are neutralised. */
export function sanitizeWakeupMessage(value) {
  return String(value ?? "")
    .replace(/<@[!&]?\d+>/g, "")
    .replace(/<#\d+>/g, "")
    .replace(/@(everyone|here)/gi, "@​$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, WAKEUP_MESSAGE_MAX);
}

export function buildWakeupDirectMessage(actorId, targetId, announcement) {
  const base = `Réveille-toi, <@${targetId}> ! C'est <@${actorId}> qui te cherche.`;
  return announcement ? `${base}\n> ${announcement}` : base;
}

// --- cooldown and concurrency -------------------------------------------------

const lastFinishedAt = new Map();
const activeKeys = new Set();

export function resetWakeupState() {
  lastFinishedAt.clear();
  activeKeys.clear();
}

/**
 * Claims the right to run one sequence. Refuses while the same actor or the same
 * target is already being processed, and during the actor's cooldown.
 * Call release() exactly once when the sequence ends (success or failure).
 */
export function claimWakeup(guildId, actorId, targetId, now = Date.now()) {
  const actorKey = `${guildId}:actor:${actorId}`;
  const targetKey = `${guildId}:target:${targetId}`;
  if (activeKeys.has(actorKey))
    return {
      ok: false,
      reason: "Un WAKEUP est déjà en cours de ta part. Attends sa fin.",
    };
  if (activeKeys.has(targetKey))
    return {
      ok: false,
      reason: "Un WAKEUP est déjà en cours sur cette personne.",
    };
  const cooldown = wakeupCooldownMs();
  const last = lastFinishedAt.get(actorKey);
  if (last !== undefined && now - last < cooldown) {
    const seconds = Math.max(1, Math.ceil((cooldown - (now - last)) / 1000));
    return {
      ok: false,
      reason: `WAKEUP est en recharge : réessaie dans ${seconds} s.`,
    };
  }
  activeKeys.add(actorKey);
  activeKeys.add(targetKey);
  let released = false;
  return {
    ok: true,
    release(finishedAt = Date.now()) {
      if (released) return;
      released = true;
      activeKeys.delete(actorKey);
      activeKeys.delete(targetKey);
      lastFinishedAt.set(actorKey, finishedAt);
    },
  };
}

// --- the sequence -------------------------------------------------------------

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Moves the target through each channel once, in order. A failed move or a
 * closed DM never stops the sequence, and a failed move is never announced:
 * the DM is only sent after Discord confirmed the move.
 *
 * @returns {{ total:number, visited:number, failures:{channel:string, reason:string}[], dmFailed:number, stopped:string|null }}
 */
export async function runWakeupSequence({
  target,
  actorId,
  channels,
  announcement = "",
  reason = "WAKEUP",
  sleep = defaultSleep,
  stepDelayMs = wakeupStepDelayMs(),
}) {
  const summary = {
    total: channels.length,
    visited: 0,
    failures: [],
    dmFailed: 0,
    stopped: null,
  };
  const directMessage = buildWakeupDirectMessage(
    actorId,
    target.id,
    announcement,
  );
  for (const [index, channel] of channels.entries()) {
    if (!target.voice?.channelId) {
      summary.stopped = "la personne a quitté le vocal";
      break;
    }
    try {
      await target.voice.setChannel(
        channel,
        `${reason} (${index + 1}/${channels.length})`,
      );
    } catch (error) {
      summary.failures.push({
        channel: channel.name,
        reason:
          error instanceof Error
            ? error.message.slice(0, 120)
            : "déplacement refusé",
      });
      continue;
    }
    summary.visited += 1;
    try {
      await target.send({
        content: directMessage,
        allowedMentions: { parse: [] },
      });
    } catch {
      summary.dmFailed += 1;
    }
    if (stepDelayMs > 0 && index < channels.length - 1)
      await sleep(stepDelayMs);
  }
  return summary;
}

/** Final text used to edit the original reply: counts only, no status message under the panel. */
export function formatWakeupSummary(targetId, summary) {
  const lines = [
    `⏰ **WAKEUP** terminé pour <@${targetId}> : **${summary.visited}/${summary.total}** salon(s) visité(s).`,
  ];
  if (summary.failures.length) {
    const shown = summary.failures
      .slice(0, 5)
      .map((failure) => `• ${failure.channel} — ${failure.reason}`);
    lines.push(
      `⚠️ ${summary.failures.length} déplacement(s) en échec :\n${shown.join("\n")}${summary.failures.length > 5 ? `\n• … et ${summary.failures.length - 5} autre(s)` : ""}`,
    );
  }
  if (summary.dmFailed)
    lines.push(
      `✉️ MP non reçu pour ${summary.dmFailed} déplacement(s) (messages privés fermés).`,
    );
  if (summary.stopped)
    lines.push(`⏹️ Séquence interrompue : ${summary.stopped}.`);
  return lines.join("\n");
}
