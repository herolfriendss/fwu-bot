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
        let body: { action?: unknown; guildId?: unknown; roleId?: unknown; actorId?: unknown; prompt?: unknown; instructions?: unknown; author?: unknown };
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
