// Her? V4 — GuildGuard : admission, anti-raid et isolation des serveurs.
//
// Toutes les décisions sont calculées par des fonctions pures testables. Le
// processus Oracle ne fait ensuite qu’appliquer l’action (expulsion, rôle de
// quarantaine ou journalisation). Aucune donnée d’un serveur n’est lue par un
// autre : les réglages et les compteurs sont indexés par identifiant de serveur.
import { parsePndOwnerId } from "./pnd-owner-policy.js";
import { EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { sendCentralLog } from "./logs.js";
import {
  accountAgeDays,
  evaluateJoin,
  guardReason,
  isQuarantineRoleAssignable,
  parseGuildAllowlist,
  raidTriggered,
} from "./guild-guard-policy.js";

export {
  accountAgeDays,
  evaluateJoin,
  guardReason,
  isQuarantineRoleAssignable,
  parseGuildAllowlist,
  raidTriggered,
};

const joinTracker = new Map(); // guildId -> timestamps de connexion
const raidNotified = new Set();

export function guardLogEmbed({ guild, member, action, reason, guard, ageDays }) {
  const colors = { allow: 0x22c55e, log: 0xf59e0b, quarantine: 0xf97316, kick: 0xef4444 };
  return new EmbedBuilder()
    .setColor(colors[action] ?? 0x6d28d9)
    .setTitle("🛡️ GuildGuard")
    .setDescription(guardReason(reason, guard?.minAccountAgeDays ?? 0))
    .addFields(
      { name: "Membre", value: `${member.user.tag} (${member.id})`, inline: true },
      { name: "Compte", value: `${ageDays.toFixed(1)} jour(s)`, inline: true },
      {
        name: "Action",
        value: action === "quarantine" ? "Rôle de quarantaine" : action,
        inline: true,
      },
      { name: "Serveur", value: `${guild.name} (${guild.id})`, inline: false },
    )
    .setTimestamp(new Date());
}

async function sendGuardLog(guild, guard, embed) {
  await sendCentralLog(guild, { logs: guard?.logs }, embed, [guard?.logChannelId]).catch(() => {});
}

/**
 * Applique GuildGuard à une nouvelle arrivée. Retourne true si une action a été
 * prise ou journalisée, false si le membre est autorisé sans bruit.
 */
export async function handleGuildGuardJoin(member, guard, record = () => {}) {
  if (!guard?.enabled || member.user.bot) return false;
  const guild = member.guild;
  const now = Date.now();
  const windowMs = Math.max(10, Number(guard.raidWindowSeconds ?? 60)) * 1000;
  const recent = (joinTracker.get(guild.id) ?? []).filter((at) => now - at < windowMs);
  recent.push(now);
  joinTracker.set(guild.id, recent);

  const raidMode = raidTriggered(recent, now, windowMs, Number(guard.raidJoinThreshold ?? 0));
  if (raidMode && !raidNotified.has(guild.id)) {
    raidNotified.add(guild.id);
    record("guild_guard_raid");
    await sendGuardLog(
      guild,
      guard,
      new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("🚨 GuildGuard — rafale détectée")
        .setDescription(
          `${recent.length} connexions en moins de ${Math.round(windowMs / 1000)} secondes. Le mode anti-raid est appliqué aux nouvelles arrivées.`,
        )
        .setTimestamp(new Date()),
    );
    const timer = setTimeout(() => raidNotified.delete(guild.id), windowMs * 2);
    timer.unref?.();
  }

  // The OWNER is never kicked or quarantined, even during a raid.
  if (member.id && member.id === parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID)) return false;
  const decision = evaluateJoin({ createdAt: member.user.createdAt, now, guard, raidMode });
  if (decision.action === "allow") return false;
  const ageDays = accountAgeDays(member.user.createdAt, now);
  let appliedAction = "log";
  try {
    if (decision.action === "kick") {
      await member.kick(guardReason(decision.reason, guard.minAccountAgeDays).slice(0, 500));
      appliedAction = "kick";
      record("guild_guard_kick");
    } else if (decision.action === "quarantine" && guard.quarantineRoleId) {
      const role = await guild.roles.fetch(guard.quarantineRoleId).catch(() => null);
      const bot = await guild.members.fetchMe().catch(() => null);
      if (
        !isQuarantineRoleAssignable(
          role,
          guild.id,
          bot?.roles?.highest?.position ?? -1,
          Boolean(bot?.permissions?.has(PermissionFlagsBits.ManageRoles)),
        )
      ) {
        throw new Error("quarantine_role_unavailable");
      }
      await member.roles.add(role, "GuildGuard : quarantaine");
      appliedAction = "quarantine";
      record("guild_guard_quarantine");
    } else {
      record("guild_guard_log");
    }
  } catch {
    record("guild_guard_error");
  }
  const embed = guardLogEmbed({
    guild,
    member,
    action: appliedAction,
    reason: decision.reason,
    guard,
    ageDays,
  });
  await sendGuardLog(guild, guard, embed);
  return appliedAction === "kick" || appliedAction === "quarantine";
}

/** Une guilde est autorisée si l’allowlist est vide ou la contient. */
export function guildAllowed(guildId, allowlist) {
  return !allowlist?.length || allowlist.includes(guildId);
}

/** Quitte immédiatement un serveur absent de l’allowlist globale (isolation). */
export async function handleGuildCreate(guild, allowlist, record = () => {}) {
  if (guildAllowed(guild.id, allowlist)) return false;
  record("guild_blocked");
  await guild.leave().catch(() => {});
  return true;
}

/**
 * Applique l’allowlist aux serveurs déjà présents (redémarrage, allowlist
 * ajoutée après coup) : le bot ne peut pas rester sur un troisième serveur.
 * Les données locales ne sont pas supprimées, seul le serveur est quitté.
 */
export async function enforceGuildAllowlist(client, allowlist, record = () => {}) {
  if (!allowlist?.length) return 0;
  let left = 0;
  for (const guild of client.guilds.cache.values()) {
    if (guildAllowed(guild.id, allowlist)) continue;
    record("guild_blocked");
    try {
      await guild.leave();
      left++;
    } catch {
      record("guild_guard_error");
    }
  }
  if (left) console.log(`[bot] allowlist: ${left} serveur(s) non autorisé(s) quitté(s).`);
  return left;
}

/** Utilisé par les tests et après un redémarrage pour oublier les rafales. */
export function resetGuildGuardState(guildId = null) {
  if (guildId) {
    joinTracker.delete(guildId);
    raidNotified.delete(guildId);
  } else {
    joinTracker.clear();
    raidNotified.clear();
  }
}
