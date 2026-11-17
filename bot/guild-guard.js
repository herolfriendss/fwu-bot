// Her? V4 — GuildGuard : admission, anti-raid et isolation des serveurs.
//
// Toutes les décisions sont calculées par des fonctions pures testables. Le
// processus Oracle ne fait ensuite qu’appliquer l’action (expulsion, rôle de
// quarantaine ou journalisation). Aucune donnée d’un serveur n’est lue par un
// autre : les réglages et les compteurs sont indexés par identifiant de serveur.
import { EmbedBuilder } from "discord.js";
import { accountAgeDays, evaluateJoin, guardReason, parseGuildAllowlist, raidTriggered } from "./guild-guard-policy.js";

export { accountAgeDays, evaluateJoin, guardReason, parseGuildAllowlist, raidTriggered };

const joinTracker = new Map(); // guildId -> timestamps de connexion
const raidNotified = new Set();

export function guardLogEmbed({ guild, member, action, reason, guard, ageDays }) {
  const colors = { allow: 0x22c55e, log: 0xf59e0b, quarantine: 0xf97316, kick: 0xef4444 };
  return new EmbedBuilder()
    .setColor(colors[action] ?? 0x5865f2)
    .setTitle("🛡️ GuildGuard")
    .setDescription(guardReason(reason, guard?.minAccountAgeDays ?? 0))
    .addFields(
      { name: "Membre", value: `${member.user.tag} (${member.id})`, inline: true },
      { name: "Compte", value: `${ageDays.toFixed(1)} jour(s)`, inline: true },
      { name: "Action", value: action === "quarantine" ? "Rôle de quarantaine" : action, inline: true },
      { name: "Serveur", value: `${guild.name} (${guild.id})`, inline: false },
    )
    .setTimestamp(new Date());
}

async function sendGuardLog(guild, guard, embed) {
  const channelId = guard?.logChannelId;
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

/**
 * Applique GuildGuard à une nouvelle arrivée. Retourne true si une action a été
 * prise ou journalisée, false si le membre est autorisé sans bruit.
 */
export async function handleGuildGuardJoin(member, guard, record = () => {}) {
  if (!guard?.enabled) return false;
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
    await sendGuardLog(guild, guard, new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("🚨 GuildGuard — rafale détectée")
      .setDescription(`${recent.length} connexions en moins de ${Math.round(windowMs / 1000)} secondes. Le mode anti-raid est appliqué aux nouvelles arrivées.`)
      .setTimestamp(new Date()));
    const timer = setTimeout(() => raidNotified.delete(guild.id), windowMs * 2);
    timer.unref?.();
  }

  // Bot accounts count toward join bursts so a bot-only raid cannot bypass
  // the threshold, but they are not themselves quarantined or kicked by the
  // human account-age policy.
  if (member.user.bot) return false;

  const decision = evaluateJoin({ createdAt: member.user.createdAt, now, guard, raidMode });
  if (decision.action === "allow") return false;
  const ageDays = accountAgeDays(member.user.createdAt, now);
  const embed = guardLogEmbed({ guild, member, action: decision.action, reason: decision.reason, guard, ageDays });

  try {
    if (decision.action === "kick") {
      await member.kick(guardReason(decision.reason, guard.minAccountAgeDays).slice(0, 500));
      record("guild_guard_kick");
    } else if (decision.action === "quarantine" && guard.quarantineRoleId) {
      const role = await guild.roles.fetch(guard.quarantineRoleId).catch(() => null);
      if (role) await member.roles.add(role, "GuildGuard : quarantaine").catch(() => record("guild_guard_error"));
      record("guild_guard_quarantine");
    } else {
      record("guild_guard_log");
    }
  } catch {
    record("guild_guard_error");
  }
  await sendGuardLog(guild, guard, embed);
  return decision.action === "kick" || decision.action === "quarantine";
}

/** Strict allowlist check. An empty or invalid allowlist always denies access. */
export function isGuildAllowed(guildId, allowlist) {
  return typeof guildId === "string"
    && /^\d{5,25}$/.test(guildId)
    && Array.isArray(allowlist)
    && allowlist.length > 0
    && allowlist.includes(guildId);
}

/** Keep configuration only for explicitly authorized guilds; never expose foreign guild settings. */
export function restrictGuildSettings(settings, allowlist) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return {};
  const allowed = new Set(
    (Array.isArray(allowlist) ? allowlist : []).filter((id) => typeof id === "string" && /^\d{5,25}$/.test(id)),
  );
  return Object.fromEntries(Object.entries(settings).filter(([guildId]) => allowed.has(guildId)));
}

/** Quitte immédiatement tout serveur absent de l’allowlist (isolation fail-closed). */
export async function handleGuildCreate(guild, allowlist, record = () => {}) {
  if (isGuildAllowed(guild.id, allowlist)) return false;
  record("guild_blocked");
  await guild.leave().catch(() => {});
  return true;
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
