import { createServerFn } from "@tanstack/react-start";
import { discord, requireOwner, snowflake, cache } from "@/lib/discord.server";

const str = (v: unknown, max: number, min = 0) => {
  const s = String(v ?? "").trim();
  if (s.length < min || s.length > max) throw new Error(`Texte invalide (${min}–${max} caractères)`);
  return s;
};
const write = async <T,>(path: string, method: string, body?: unknown, reason?: string) => {
  const headers: Record<string, string> = {};
  const r = await discord<T>(path, {
    method,
    body: body === undefined ? null : JSON.stringify(body),
    ...(reason ? { headers: { ...headers, "X-Audit-Log-Reason": encodeURIComponent(reason) } } : {}),
  }).catch((e) => {
    // Discord returns 204 No Content for many writes; json() fails on empty body
    if (e instanceof SyntaxError) return null as T;
    throw e;
  });
  cache.clear();
  return r;
};

/* ---------- Profil ---------- */
export const updateProfile = createServerFn({ method: "POST" })
  .inputValidator((d: { username?: string; avatar?: string | null }) => {
    const out: { username?: string; avatar?: string | null } = {};
    if (d.username) out.username = str(d.username, 32, 2);
    if (d.avatar !== undefined) {
      if (d.avatar !== null && !/^data:image\/(png|jpeg|gif|webp);base64,/.test(d.avatar)) throw new Error("Image invalide");
      if (d.avatar && d.avatar.length > 10_000_000) throw new Error("Image trop lourde");
      out.avatar = d.avatar;
    }
    return out;
  })
  .handler(async ({ data }) => {
    await requireOwner();
    await write("users/@me", "PATCH", data);
    return { ok: true };
  });

export const updateNickname = createServerFn({ method: "POST" })
  .inputValidator((d: { guildId: string; nick: string }) => ({ guildId: snowflake(d.guildId), nick: str(d.nick, 32) }))
  .handler(async ({ data }) => {
    await requireOwner();
    await write(`guilds/${data.guildId}/members/@me`, "PATCH", { nick: data.nick || null });
    return { ok: true };
  });

/* ---------- Serveur ---------- */
type RawRole = { id: string; name: string; color: number; position: number; managed: boolean; members?: number };
type RawChannel = { id: string; name: string; type: number; position: number; parent_id: string | null; topic?: string | null };
type RawMember = { user: { id: string; username: string; global_name?: string | null; avatar: string | null; bot?: boolean }; nick?: string | null; roles: string[]; communication_disabled_until?: string | null };

export const getGuildAdmin = createServerFn({ method: "GET" })
  .inputValidator((d: { guildId: string }) => ({ guildId: snowflake(d.guildId) }))
  .handler(async ({ data }) => {
    await requireOwner();
    const g = data.guildId;
    const [roles, channels] = await Promise.all([
      discord<RawRole[]>(`guilds/${g}/roles`),
      discord<RawChannel[]>(`guilds/${g}/channels`),
    ]);
    let members: RawMember[] = [];
    let membersError: string | null = null;
    try {
      members = await discord<RawMember[]>(`guilds/${g}/members?limit=200`);
    } catch {
      membersError = "Activez « Server Members Intent » dans le portail développeur Discord pour voir les membres.";
    }
    return {
      roles: roles
        .filter((r) => r.name !== "@everyone")
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, color: r.color, managed: r.managed })),
      channels: channels
        .sort((a, b) => a.position - b.position)
        .map((c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parent_id, topic: c.topic ?? "" })),
      members: members.map((m) => ({
        id: m.user.id,
        name: m.nick || m.user.global_name || m.user.username,
        username: m.user.username,
        avatar: m.user.avatar,
        bot: !!m.user.bot,
        roles: m.roles,
        timedOutUntil: m.communication_disabled_until ?? null,
      })),
      membersError,
    };
  });

export const createChannel = createServerFn({ method: "POST" })
  .inputValidator((d: { guildId: string; name: string; type: number; topic?: string; parentId?: string | null }) => {
    if (![0, 2, 4, 5].includes(d.type)) throw new Error("Type invalide");
    return { guildId: snowflake(d.guildId), name: str(d.name, 100, 1), type: d.type, topic: str(d.topic, 1024), parentId: d.parentId ? snowflake(d.parentId) : null };
  })
  .handler(async ({ data }) => {
    await requireOwner();
    await write(`guilds/${data.guildId}/channels`, "POST", {
      name: data.name, type: data.type, ...(data.topic && data.type !== 4 ? { topic: data.topic } : {}), ...(data.parentId && data.type !== 4 ? { parent_id: data.parentId } : {}),
    });
    return { ok: true };
  });

export const editChannel = createServerFn({ method: "POST" })
  .inputValidator((d: { channelId: string; name: string; topic: string }) => ({ channelId: snowflake(d.channelId), name: str(d.name, 100, 1), topic: str(d.topic, 1024) }))
  .handler(async ({ data }) => {
    await requireOwner();
    await write(`channels/${data.channelId}`, "PATCH", { name: data.name, topic: data.topic });
    return { ok: true };
  });

export const deleteChannel = createServerFn({ method: "POST" })
  .inputValidator((d: { channelId: string }) => ({ channelId: snowflake(d.channelId) }))
  .handler(async ({ data }) => {
    await requireOwner();
    await write(`channels/${data.channelId}`, "DELETE");
    return { ok: true };
  });

export const createRole = createServerFn({ method: "POST" })
  .inputValidator((d: { guildId: string; name: string; color: string }) => {
    if (!/^#[0-9a-f]{6}$/i.test(d.color)) throw new Error("Couleur invalide");
    return { guildId: snowflake(d.guildId), name: str(d.name, 100, 1), color: parseInt(d.color.slice(1), 16) };
  })
  .handler(async ({ data }) => {
    await requireOwner();
    await write(`guilds/${data.guildId}/roles`, "POST", { name: data.name, color: data.color });
    return { ok: true };
  });

export const deleteRole = createServerFn({ method: "POST" })
  .inputValidator((d: { guildId: string; roleId: string }) => ({ guildId: snowflake(d.guildId), roleId: snowflake(d.roleId) }))
  .handler(async ({ data }) => {
    await requireOwner();
    await write(`guilds/${data.guildId}/roles/${data.roleId}`, "DELETE");
    return { ok: true };
  });

export const setMemberRole = createServerFn({ method: "POST" })
  .inputValidator((d: { guildId: string; userId: string; roleId: string; add: boolean }) => ({ guildId: snowflake(d.guildId), userId: snowflake(d.userId), roleId: snowflake(d.roleId), add: !!d.add }))
  .handler(async ({ data }) => {
    await requireOwner();
    await write(`guilds/${data.guildId}/members/${data.userId}/roles/${data.roleId}`, data.add ? "PUT" : "DELETE");
    return { ok: true };
  });

/* ---------- Modération ---------- */
export const moderateMember = createServerFn({ method: "POST" })
  .inputValidator((d: { guildId: string; userId: string; action: string; minutes?: number; reason?: string }) => {
    if (!["kick", "ban", "unban", "timeout", "untimeout"].includes(d.action)) throw new Error("Action invalide");
    const minutes = Math.max(1, Math.min(40320, Math.floor(Number(d.minutes) || 10)));
    return { guildId: snowflake(d.guildId), userId: snowflake(d.userId), action: d.action, minutes, reason: str(d.reason, 400) };
  })
  .handler(async ({ data }) => {
    await requireOwner();
    const base = `guilds/${data.guildId}`;
    const r = data.reason || undefined;
    if (data.action === "kick") await write(`${base}/members/${data.userId}`, "DELETE", undefined, r);
    if (data.action === "ban") await write(`${base}/bans/${data.userId}`, "PUT", {}, r);
    if (data.action === "unban") await write(`${base}/bans/${data.userId}`, "DELETE", undefined, r);
    if (data.action === "timeout" || data.action === "untimeout") {
      const until = data.action === "timeout" ? new Date(Date.now() + data.minutes * 60_000).toISOString() : null;
      await write(`${base}/members/${data.userId}`, "PATCH", { communication_disabled_until: until }, r);
    }
    return { ok: true };
  });

export const getBans = createServerFn({ method: "GET" })
  .inputValidator((d: { guildId: string }) => ({ guildId: snowflake(d.guildId) }))
  .handler(async ({ data }) => {
    await requireOwner();
    const bans = await discord<{ reason: string | null; user: { id: string; username: string } }[]>(`guilds/${data.guildId}/bans?limit=100`);
    return bans.map((b) => ({ id: b.user.id, username: b.user.username, reason: b.reason ?? "" }));
  });

export const purgeMessages = createServerFn({ method: "POST" })
  .inputValidator((d: { channelId: string; count: number }) => ({ channelId: snowflake(d.channelId), count: Math.max(2, Math.min(100, Math.floor(Number(d.count) || 0))) }))
  .handler(async ({ data }) => {
    await requireOwner();
    const msgs = await discord<{ id: string; timestamp: string }[]>(`channels/${data.channelId}/messages?limit=${data.count}`);
    const limit = Date.now() - 13.9 * 24 * 3600_000; // Discord refuses bulk delete for messages older than 14 days
    const ids = msgs.filter((m) => new Date(m.timestamp).getTime() > limit).map((m) => m.id);
    if (ids.length >= 2) await write(`channels/${data.channelId}/messages/bulk-delete`, "POST", { messages: ids });
    else if (ids.length === 1) await write(`channels/${data.channelId}/messages/${ids[0]}`, "DELETE");
    return { deleted: ids.length, skipped: msgs.length - ids.length };
  });

export const deleteMessage = createServerFn({ method: "POST" })
  .inputValidator((d: { channelId: string; messageId: string }) => ({ channelId: snowflake(d.channelId), messageId: snowflake(d.messageId) }))
  .handler(async ({ data }) => {
    await requireOwner();
    await write(`channels/${data.channelId}/messages/${data.messageId}`, "DELETE");
    return { ok: true };
  });

const AUDIT_LABELS: Record<number, string> = {
  1: "Serveur modifié", 10: "Salon créé", 11: "Salon modifié", 12: "Salon supprimé", 20: "Membre expulsé", 22: "Membre banni",
  23: "Bannissement levé", 24: "Membre modifié", 25: "Rôles d'un membre modifiés", 30: "Rôle créé", 31: "Rôle modifié",
  32: "Rôle supprimé", 72: "Message supprimé", 73: "Messages supprimés en masse",
};

export const getAuditLog = createServerFn({ method: "GET" })
  .inputValidator((d: { guildId: string }) => ({ guildId: snowflake(d.guildId) }))
  .handler(async ({ data }) => {
    await requireOwner();
    const log = await discord<{ audit_log_entries: { id: string; action_type: number; user_id: string | null; target_id: string | null; reason?: string }[]; users: { id: string; username: string }[] }>(
      `guilds/${data.guildId}/audit-logs?limit=40`,
    );
    const names = new Map(log.users.map((u) => [u.id, u.username]));
    return log.audit_log_entries.map((e) => ({
      id: e.id,
      action: AUDIT_LABELS[e.action_type] ?? `Action n°${e.action_type}`,
      by: e.user_id ? names.get(e.user_id) ?? e.user_id : "—",
      target: e.target_id ? names.get(e.target_id) ?? e.target_id : "",
      reason: e.reason ?? "",
      date: new Date(Number(BigInt(e.id) >> 22n) + 1420070400000).toISOString(),
    }));
  });

/* ---------- Annonces ---------- */
export const sendAnnouncement = createServerFn({ method: "POST" })
  .inputValidator((d: { channelId: string; content: string; title: string; description: string; color: string; footer: string; imageUrl: string }) => {
    if (!/^#[0-9a-f]{6}$/i.test(d.color)) throw new Error("Couleur invalide");
    const imageUrl = str(d.imageUrl, 500);
    if (imageUrl && !/^https:\/\//.test(imageUrl)) throw new Error("L'image doit être un lien https");
    const out = {
      channelId: snowflake(d.channelId), content: str(d.content, 2000), title: str(d.title, 256),
      description: str(d.description, 4000), color: parseInt(d.color.slice(1), 16), footer: str(d.footer, 2048), imageUrl,
    };
    if (!out.content && !out.title && !out.description) throw new Error("L'annonce est vide");
    return out;
  })
  .handler(async ({ data }) => {
    await requireOwner();
    const hasEmbed = data.title || data.description || data.imageUrl;
    await write(`channels/${data.channelId}/messages`, "POST", {
      content: data.content || undefined,
      embeds: hasEmbed ? [{
        title: data.title || undefined, description: data.description || undefined, color: data.color,
        footer: data.footer ? { text: data.footer } : undefined, image: data.imageUrl ? { url: data.imageUrl } : undefined,
      }] : undefined,
    });
    return { ok: true };
  });
