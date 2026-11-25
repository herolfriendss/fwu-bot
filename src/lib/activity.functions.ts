import { createServerFn } from "@tanstack/react-start";
import { requireOwner, snowflake } from "./discord.server";

export const getActivitySnapshot = createServerFn({ method: "GET" })
  .inputValidator((d: { guildId: string }) => ({ guildId: snowflake(d.guildId) }))
  .handler(async ({ data }) => {
    await requireOwner();
    const { readActivitySnapshot } = await import("./activity.server");
    return readActivitySnapshot(data.guildId);
  });
