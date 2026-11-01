import { discord } from "./discord.server";
import { type AuditEntry, AUDIT_LABELS, snowflakeDate } from "./incident-shared";
import { groupChannels } from "./server-analytics";

type RawGuild = { id: string; name: string; approximate_member_count?: number; approximate_presence_count?: number; premium_subscription_count?: number; premium_tier?: number; verification_level?: number };
type RawAudit = { audit_log_entries: AuditEntry[]; users: { id: string; username: string }[] };

export async function readServerAnalytics(guildId: string) {
  const base = `guilds/${guildId}`;
  const [guild, channels, roles, audit] = await Promise.allSettled([
    discord<RawGuild>(`${base}?with_counts=true`),
    discord<{ type: number }[]>(`${base}/channels`),
    discord<{ id: string }[]>(`${base}/roles`),
    discord<RawAudit>(`${base}/audit-logs?limit=100`),
  ]);
  if (guild.status === "rejected") throw new Error("Le serveur est inaccessible. Vérifiez que le bot y est toujours présent puis réessayez.");
  const warnings: string[] = [];
  if (channels.status === "rejected") warnings.push("Les salons sont indisponibles. Vérifiez les permissions du bot ou réessayez plus tard.");
  if (roles.status === "rejected") warnings.push("Les rôles sont momentanément indisponibles.");
  if (audit.status === "rejected") warnings.push("Journal indisponible : vérifiez la permission « Voir les logs du serveur » ou réessayez plus tard.");
  const names = new Map(audit.status === "fulfilled" ? audit.value.users.map((u) => [u.id, u.username]) : []);
  const entries = audit.status === "fulfilled" ? audit.value.audit_log_entries : null;
  return {
    guildId,
    name: guild.value.name,
    members: guild.value.approximate_member_count ?? null,
    online: guild.value.approximate_presence_count ?? null,
    boosts: guild.value.premium_subscription_count ?? null,
    boostTier: guild.value.premium_tier ?? null,
    verification: guild.value.verification_level ?? null,
    channels: channels.status === "fulfilled" ? channels.value.length : null,
    channelGroups: channels.status === "fulfilled" ? groupChannels(channels.value) : null,
    roles: roles.status === "fulfilled" ? roles.value.filter((r) => r.id !== guildId).length : null,
    audit: entries?.map((e) => ({ id: e.id, action_type: e.action_type, user_id: e.user_id, target_id: e.target_id, by: e.user_id ? names.get(e.user_id) ?? e.user_id : "Discord", action: AUDIT_LABELS[e.action_type] ?? `Action n°${e.action_type}`, date: snowflakeDate(e.id).toISOString() })) ?? null,
    auditCapped: entries?.length === 100,
    fetchedAt: new Date().toISOString(),
    warnings,
  };
}