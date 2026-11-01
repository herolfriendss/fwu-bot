import { createServerFn } from "@tanstack/react-start";
import { discord, discordWrite, invalidateCache, requireOwner, snowflake } from "@/lib/discord.server";
import { SLASH_COMMANDS, toDiscordCommand } from "@/lib/slash-commands";
import { commandFormSchema } from "@/lib/custom-commands";
import { listCustomCommands } from "@/lib/custom-commands.server";

type RegisteredCommand = { id: string; name: string; description: string; type?: number; default_member_permissions?: string | null };

export const getSlashStatus = createServerFn({ method: "GET" }).handler(async () => {
  await requireOwner();
  const app = await discord<{ id: string; verify_key?: string; interactions_endpoint_url?: string | null; bot_require_code_grant?: boolean; bot?: { username?: string } }>("applications/@me");
  const registered = await discord<RegisteredCommand[]>(`applications/${app.id}/commands`);
  const custom = await listCustomCommands(app.id);
  const ours = new Set(SLASH_COMMANDS.map((c) => c.name));
  return {
    appId: app.id,
    botName: app.bot?.username ?? "Bot Discord",
    endpoint: app.interactions_endpoint_url ?? null,
    requiresCodeGrant: !!app.bot_require_code_grant,
    hasVerifyKey: !!app.verify_key,
    registered: registered
      .map((c) => {
        const saved = custom.find((r) => r.command_id === c.id);
        return { id: c.id, name: c.name, description: c.description, type: c.type ?? 1, ours: ours.has(c.name), custom: !!saved,
          response: saved?.response ?? "", ephemeral: saved?.ephemeral ?? false, permission: saved?.permission ?? c.default_member_permissions ?? "0" };
      })
      .sort((a, b) => Number(b.ours) - Number(a.ours) || a.name.localeCompare(b.name)),
    missing: SLASH_COMMANDS.filter((c) => !registered.some((r) => r.name === c.name)).map((c) => c.name),
  };
});

// Global command registration. Guild-scoped routes (guilds/{id}/commands) are
// rejected by the Discord gateway proxy, so new commands can take up to an hour
// to appear everywhere; updates to already-registered names show up immediately.
export const registerSlashCommands = createServerFn({ method: "POST" }).handler(async () => {
  await requireOwner();
  const app = await discord<{ id: string }>("oauth2/applications/@me");
  const existing = await discord<RegisteredCommand[]>(`applications/${app.id}/commands`);
  const ours = new Set(SLASH_COMMANDS.map((c) => c.name));
  // Upsert each built-in separately; never bulk-overwrite unrelated definitions.
  for (const c of SLASH_COMMANDS) await discord(`applications/${app.id}/commands`, { method: "POST", body: JSON.stringify(toDiscordCommand(c)) });
  invalidateCache(`applications/${app.id}/commands`);
  return { ours: SLASH_COMMANDS.length, kept: existing.filter((c) => !ours.has(c.name)).length };
});

export const saveSlashCommand = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => commandFormSchema.parse(input))
  .handler(async ({ data }) => {
    await requireOwner();
    const app = await discord<{ id: string }>("oauth2/applications/@me");
    const existing = await discord<RegisteredCommand[]>(`applications/${app.id}/commands`);
    const current = data.id ? existing.find((c) => c.id === data.id) : undefined;
    if (data.id && !current) throw new Error("Cette commande n’existe plus. Actualise la liste.");
    if (current && (current.type ?? 1) !== 1) throw new Error("Seules les commandes slash sont modifiables ici.");
    if (existing.some((c) => c.name === data.name && c.id !== data.id)) throw new Error("Ce nom de commande existe déjà.");
    const builtIn = current && SLASH_COMMANDS.find((c) => c.name === current.name);
    if (builtIn && data.name !== builtIn.name) throw new Error("Le nom d’une commande intégrée ne peut pas être changé.");
    if (!builtIn && SLASH_COMMANDS.some((c) => c.name === data.name)) throw new Error("Ce nom est réservé à une commande intégrée.");
    const payload = builtIn ? { description: data.description, default_member_permissions: data.permission } : {
      name: data.name, description: data.description, type: 1, options: [], default_member_permissions: data.permission, dm_permission: false,
    };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const command = await discord<RegisteredCommand>(`applications/${app.id}/commands${data.id ? `/${data.id}` : ""}`, {
      method: data.id ? "PATCH" : "POST", body: JSON.stringify(payload),
    });
    if (!builtIn) {
      const { error } = await supabaseAdmin.from("discord_custom_commands").upsert({ application_id: app.id, command_id: command.id, name: data.name,
        description: data.description, response: data.response, ephemeral: data.ephemeral, permission: data.permission });
      if (error) throw new Error("Commande enregistrée dans Discord, mais sa réponse n’a pas pu être conservée. Enregistre-la à nouveau.");
    }
    invalidateCache(`applications/${app.id}/commands`);
    return { id: command.id };
  });

export const deleteSlashCommand = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => ({ id: snowflake(d.id) }))
  .handler(async ({ data }) => {
    await requireOwner();
    const app = await discord<{ id: string }>("oauth2/applications/@me");
    await discordWrite(`applications/${app.id}/commands/${data.id}`, "DELETE");
    invalidateCache(`applications/${app.id}/commands`);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("discord_custom_commands").delete().eq("application_id", app.id).eq("command_id", data.id);
    if (error) throw new Error("Commande supprimée de Discord ; impossible de supprimer sa réponse conservée.");
    return { ok: true };
  });
