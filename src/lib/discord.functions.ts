import { createServerFn } from "@tanstack/react-start";
import { createHash, timingSafeEqual } from "node:crypto";
import { useSession } from "@tanstack/react-start/server";
import { sessionConfig, requireOwner, discord, snowflake, cache, type GateSession } from "./discord.server";

export const login = createServerFn({ method: "POST" })
  .inputValidator((d: { password: string }) => ({ password: String(d.password ?? "") }))
  .handler(async ({ data }) => {
    const expected = process.env["DASHBOARD_PASSWORD"];
    if (!expected) throw new Error("DASHBOARD_PASSWORD is not set");
    const a = createHash("sha256").update(data.password).digest();
    const b = createHash("sha256").update(expected).digest();
    if (!timingSafeEqual(a, b)) return { ok: false as const };
    const session = await useSession<GateSession>(sessionConfig());
    await session.update({ owner: true });
    return { ok: true as const };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const session = await useSession<GateSession>(sessionConfig());
  await session.clear();
  return { ok: true as const };
});


export type BotUser = { id: string; username: string; avatar: string | null };
export type Guild = { id: string; name: string; icon: string | null };
export type Channel = { id: string; name: string; type: number; position: number };
export type Message = {
  id: string;
  content: string;
  timestamp: string;
  author: { id: string; username: string; avatar: string | null; bot?: boolean };
};

export const getOverview = createServerFn({ method: "GET" }).handler(async () => {
  await requireOwner();
  const [bot, guilds] = await Promise.all([
    discord<BotUser>("users/@me"),
    discord<Guild[]>("users/@me/guilds?limit=200"),
  ]);
  return {
    bot: { id: bot.id, username: bot.username, avatar: bot.avatar },
    guilds: guilds.map((g) => ({ id: g.id, name: g.name, icon: g.icon })),
  };
});

export const getChannels = createServerFn({ method: "GET" })
  .inputValidator((d: { guildId: string }) => ({ guildId: snowflake(d.guildId) }))
  .handler(async ({ data }) => {
    await requireOwner();
    const chans = await discord<Channel[]>(`guilds/${data.guildId}/channels`);
    return chans
      .filter((c) => c.type === 0 || c.type === 5)
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ id: c.id, name: c.name, type: c.type, position: c.position }));
  });

export const getMessages = createServerFn({ method: "GET" })
  .inputValidator((d: { channelId: string }) => ({ channelId: snowflake(d.channelId) }))
  .handler(async ({ data }) => {
    await requireOwner();
    const msgs = await discord<Message[]>(`channels/${data.channelId}/messages?limit=30`);
    return msgs.map((m) => ({
      id: m.id,
      content: m.content,
      timestamp: m.timestamp,
      author: { id: m.author.id, username: m.author.username, avatar: m.author.avatar, bot: !!m.author.bot },
    }));
  });

export const sendMessage = createServerFn({ method: "POST" })
  .inputValidator((d: { channelId: string; content: string }) => {
    const content = String(d.content ?? "").trim();
    if (!content || content.length > 2000) throw new Error("Message must be 1–2000 characters");
    return { channelId: snowflake(d.channelId), content };
  })
  .handler(async ({ data }) => {
    await requireOwner();
    const m = await discord<Message>(`channels/${data.channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: data.content }),
    });
    cache.delete(`channels/${data.channelId}/messages?limit=30`);
    return { id: m.id };
  });
