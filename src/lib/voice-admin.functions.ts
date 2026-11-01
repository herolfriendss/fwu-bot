import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwner, discord } from "./discord.server";
import { voiceAccessSchema } from "./voice-access";

const guildSchema = z.object({ guildId: z.string().regex(/^\d{5,25}$/) });

export const getVoiceAdmin = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => guildSchema.parse(input))
  .handler(async ({ data }) => {
    await requireOwner();
    const { readBotSettings } = await import("./bot-settings.server");
    const [settings, roles] = await Promise.all([
      readBotSettings(data.guildId),
      discord<{ id: string; name: string; position: number }[]>(`guilds/${data.guildId}/roles`),
    ]);
    return { access: settings.voiceAccess, roles: roles.filter((r) => r.id !== data.guildId).sort((a, b) => b.position - a.position).map((r) => ({ id: r.id, name: r.name })) };
  });

export const saveVoiceAdmin = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => guildSchema.extend({ access: voiceAccessSchema }).parse(input))
  .handler(async ({ data }) => {
    await requireOwner();
    const roles = await discord<{ id: string }[]>(`guilds/${data.guildId}/roles`);
    const validIds = new Set(roles.filter((r) => r.id !== data.guildId).map((r) => r.id));
    for (const id of [...(data.access.panelRoleIds ?? []), ...(data.access.pvRoleIds ?? [])]) {
      if (!validIds.has(id)) throw new Error("Un rôle n’existe plus sur ce serveur. Actualise la page.");
    }
    const { readBotSettings } = await import("./bot-settings.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const settings = await readBotSettings(data.guildId);
    const { error } = await supabaseAdmin.from("bot_settings").upsert({ guild_id: data.guildId, settings: { ...settings, voiceAccess: data.access } as never, updated_at: new Date().toISOString() });
    if (error) throw new Error("Impossible d’enregistrer les accès vocaux.");
    return { access: data.access };
  });