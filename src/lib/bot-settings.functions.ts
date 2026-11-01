import { createServerFn } from "@tanstack/react-start";
import { requireOwner, snowflake } from "./discord.server";
import { sanitizeSettings, type BotSettings } from "./bot-settings";
import { z } from "zod";
import { prefixCommandFormSchema } from "./prefix-commands";

export const getBotSettings = createServerFn({ method: "GET" })
  .inputValidator((d: { guildId: string }) => ({ guildId: snowflake(d.guildId) }))
  .handler(async ({ data }) => {
    await requireOwner();
    const { readBotSettings } = await import("./bot-settings.server");
    return readBotSettings(data.guildId);
  });

export const saveBotSettings = createServerFn({ method: "POST" })
  .inputValidator((d: { guildId: string; settings: BotSettings }) => ({ guildId: snowflake(d.guildId), settings: sanitizeSettings(d.settings) }))
  .handler(async ({ data }) => {
    await requireOwner();
    const { writeBotSettings } = await import("./bot-settings.server");
    return writeBotSettings(data.guildId, data.settings);
  });

// Never return protected secret values to the browser.
export const getBotConnection = createServerFn({ method: "GET" }).handler(async () => {
  await requireOwner();
  return { configured: Boolean(process.env["BOT_SYNC_SECRET"]) };
});

export const savePrefixCommand = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ guildId: z.string().regex(/^\d{5,25}$/), originalName: z.string().optional(), command: prefixCommandFormSchema }).parse(input))
  .handler(async ({ data }) => {
    await requireOwner();
    const { readBotSettings, writeBotSettings } = await import("./bot-settings.server");
    const settings = await readBotSettings(data.guildId);
    if (data.originalName && !settings.prefixCommands.some((c) => c.name === data.originalName)) throw new Error("Cette commande n’existe plus. Actualise la liste.");
    if (settings.prefixCommands.some((c) => c.name === data.command.name && c.name !== data.originalName)) throw new Error("Ce nom de commande existe déjà.");
    const commands = data.originalName ? settings.prefixCommands.map((c) => c.name === data.originalName ? data.command : c) : [...settings.prefixCommands, data.command];
    return writeBotSettings(data.guildId, { ...settings, prefixCommands: commands }, true);
  });

export const deletePrefixCommand = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ guildId: z.string().regex(/^\d{5,25}$/), name: z.string().min(1).max(32) }).parse(input))
  .handler(async ({ data }) => {
    await requireOwner();
    const { readBotSettings, writeBotSettings } = await import("./bot-settings.server");
    const settings = await readBotSettings(data.guildId);
    return writeBotSettings(data.guildId, { ...settings, prefixCommands: settings.prefixCommands.filter((c) => c.name !== data.name) }, true);
  });
