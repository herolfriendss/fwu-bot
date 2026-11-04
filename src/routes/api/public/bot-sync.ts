import { createFileRoute } from "@tanstack/react-router";
import { isDiscordSnowflake } from "@/lib/discord-ids";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Called by the self-hosted bot (VPS), authenticated with BOT_SYNC_SECRET.
// GET -> all guild settings. POST -> AI reply or trusted SYS+ role update.
export const Route = createFileRoute("/api/public/bot-sync")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { checkBotSecret, readAllBotSettings } = await import("@/lib/bot-settings.server");
        if (!checkBotSecret(request)) return json({ error: "unauthorized" }, 401);
        return json({ guilds: await readAllBotSettings() });
      },
      POST: async ({ request }) => {
        const { checkBotSecret } = await import("@/lib/bot-settings.server");
        if (!checkBotSecret(request)) return json({ error: "unauthorized" }, 401);
        let body: { action?: unknown; guildId?: unknown; roleId?: unknown; actorId?: unknown; applicationId?: unknown; name?: unknown; permissions?: unknown; prompt?: unknown; instructions?: unknown; author?: unknown; module?: unknown; settings?: unknown };
        try {
          body = await request.json();
        } catch {
          return json({ error: "invalid json" }, 400);
        }
        if (body.action === "set-sysplus-role") {
          const guildId = String(body.guildId ?? "");
          const roleId = String(body.roleId ?? "");
          const actorId = String(body.actorId ?? "");
          if (![guildId, roleId, actorId].every(isDiscordSnowflake)) {
            return json({ error: "invalid identifiers" }, 400);
          }
          const { readBotSettings, writeBotSettings } = await import("@/lib/bot-settings.server");
          const current = await readBotSettings(guildId);
          const next = { ...current, sysPlus: { roleId } };
          await writeBotSettings(guildId, next);
          let auditRecorded = false;
          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { error } = await supabaseAdmin.from("sysplus_audit_log").insert({
              guild_id: guildId,
              actor_id: actorId,
              action: "sysplus_role_updated",
              target_id: roleId,
              details: { source: "discord_command" },
            });
            auditRecorded = !error;
          } catch {
            // Audit storage is secondary; the role update above has already succeeded.
          }
          // The role setting is the primary operation. Do not report it as failed
          // after it has already been persisted merely because optional audit
          // storage is unavailable (for example, before the audit migration).
          return json({ ok: true, auditRecorded });
        }
        if (body.action === "module-settings") {
          // Module configuration changed from a Discord slash command. The
          // dashboard remains the source of truth: validate, merge with the
          // current settings and return the sanitized object for the bot cache.
          const module = String(body.module ?? "");
          const modules = new Set(["guildGuard", "moderation", "verification", "tickets", "tempVoice", "automation"]);
          const guildId = String(body.guildId ?? "");
          if (!modules.has(module) || !isDiscordSnowflake(guildId)) return json({ error: "invalid module" }, 400);
          if (JSON.stringify(body.settings ?? {}).length > 100_000) return json({ error: "settings too large" }, 413);
          const { readBotSettings, writeBotSettings } = await import("@/lib/bot-settings.server");
          const { sanitizeSettings } = await import("@/lib/bot-settings");
          const current = await readBotSettings(guildId);
          const next = sanitizeSettings({ ...current, [module]: body.settings });
          const saved = await writeBotSettings(guildId, next);
          return json({ ok: true, settings: saved });
        }
        if (body.action === "custom-command") {
          // The gateway bot may receive a command created from the dashboard.
          // Resolve its saved response here so both interaction entry points use
          // the same server-only table instead of duplicating command logic.
          const applicationId = String(body.applicationId ?? "");
          const name = String(body.name ?? "").trim().toLowerCase();
          const permissions = String(body.permissions ?? "0");
          if (!isDiscordSnowflake(applicationId) || !/^[a-z0-9_-]{1,32}$/.test(name)) {
            return json({ error: "invalid command" }, 400);
          }
          const { findCustomCommandByName } = await import("@/lib/custom-commands.server");
          const saved = await findCustomCommandByName(applicationId, name);
          if (!saved) return json({ found: false });
          const { canUseCommand } = await import("@/lib/custom-commands");
          return json({
            found: true,
            allowed: canUseCommand(saved.permission, permissions),
            content: saved.response,
            ephemeral: saved.ephemeral,
          });
        }
        const prompt = String(body.prompt ?? "").trim().slice(0, 1500);
        const instructions = String(body.instructions ?? "").trim().slice(0, 2000);
        const author = String(body.author ?? "").slice(0, 80);
        if (!prompt) return json({ error: "empty prompt" }, 400);
        const { botAiReply } = await import("@/lib/bot-ai.server");
        const r = await botAiReply(prompt, instructions, author);
        return json(r.reply !== undefined ? { reply: r.reply } : { error: r.error }, r.status);
      },
    },
  },
});
