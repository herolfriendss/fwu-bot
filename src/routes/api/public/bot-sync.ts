import { createFileRoute } from "@tanstack/react-router";
import { BOT_MODULE_SETTINGS_KEYS, type BotModuleKey } from "@/lib/bot-settings";
import { isDiscordSnowflake } from "@/lib/discord-ids";
import { canConfigureGuildModuleSettings, isConfiguredPndOwner } from "@/lib/bot-sync-authorization";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function verifyGuildModuleSettingsActor(guildId: string, actorId: string): Promise<boolean> {
  // BOT_SYNC_SECRET authenticates the bot process, not the human actor. Resolve
  // the actor's actual guild ownership/role permissions independently at the API boundary.
  const { discord, invalidateCache } = await import("@/lib/discord.server");
  invalidateCache(`guilds/${guildId}`);
  const [guild, member, roles] = await Promise.all([
    discord<{ id: string; owner_id: string }>(`guilds/${guildId}`),
    discord<{ roles?: string[] }>(`guilds/${guildId}/members/${actorId}`),
    discord<{ id: string; permissions: string }[]>(`guilds/${guildId}/roles`),
  ]);
  return canConfigureGuildModuleSettings({
    guildId,
    actorId,
    guildOwnerId: guild.owner_id,
    memberRoleIds: Array.isArray(member.roles) ? member.roles : [],
    roles,
  });
}

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
        let body: { action?: unknown; guildId?: unknown; userId?: unknown; memoryEnabled?: unknown; roleId?: unknown; actorId?: unknown; intelligenceEnabled?: unknown; intelligenceChannelId?: unknown; applicationId?: unknown; name?: unknown; permissions?: unknown; prompt?: unknown; instructions?: unknown; author?: unknown; module?: unknown; settings?: unknown; changes?: unknown; expected?: unknown };
        let rawBody: string;
        try {
          rawBody = await request.text();
        } catch {
          return json({ error: "invalid body" }, 400);
        }
        if (Buffer.byteLength(rawBody, "utf8") > 256_000) {
          return json({ error: "request body too large" }, 413);
        }
        try {
          body = JSON.parse(rawBody);
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
          if (!isConfiguredPndOwner(actorId, process.env["PND_OWNER_DISCORD_ID"])) {
            return json({ error: "forbidden" }, 403);
          }
          const { readBotSettings, writeBotSettings } = await import("@/lib/bot-settings.server");
          const current = await readBotSettings(guildId);
          const next = { ...current, sysPlus: { ...(current.sysPlus ?? {}), roleId } };
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
        if (body.action === "set-sysplus-intelligence") {
          const guildId = String(body.guildId ?? "");
          const actorId = String(body.actorId ?? "");
          const intelligenceEnabled = body.intelligenceEnabled === true;
          const rawChannelId = body.intelligenceChannelId;
          const intelligenceChannelId = rawChannelId == null || rawChannelId === "" ? null : String(rawChannelId);
          if (!isDiscordSnowflake(guildId) || !isDiscordSnowflake(actorId)
            || (intelligenceChannelId !== null && !isDiscordSnowflake(intelligenceChannelId))
            || (intelligenceEnabled && !intelligenceChannelId)) {
            return json({ error: "invalid SYS+ Intelligence configuration" }, 400);
          }
          if (!isConfiguredPndOwner(actorId, process.env["PND_OWNER_DISCORD_ID"])) {
            return json({ error: "forbidden" }, 403);
          }
          try {
            const { readBotSettings, writeBotSettings } = await import("@/lib/bot-settings.server");
            const current = await readBotSettings(guildId);
            const next = { ...current, sysPlus: { ...(current.sysPlus ?? {}), intelligenceEnabled, intelligenceChannelId } };
            const saved = await writeBotSettings(guildId, next);
            // Confirm that the canonical sanitizer did not discard either field.
            if (saved.sysPlus?.intelligenceEnabled !== intelligenceEnabled
              || (saved.sysPlus?.intelligenceChannelId ?? null) !== intelligenceChannelId) {
              console.error("[bot-sync] SYS+ Intelligence settings were not preserved by sanitization", { guildId });
              return json({ error: "settings_persistence_failed" }, 503);
            }
            let auditRecorded = false;
            try {
              const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
              const { error } = await supabaseAdmin.from("sysplus_audit_log").insert({
                guild_id: guildId, actor_id: actorId, action: "sysplus_intelligence_configured",
                target_id: intelligenceChannelId, details: { enabled: intelligenceEnabled },
              });
              auditRecorded = !error;
              if (error) console.error("[bot-sync] SYS+ Intelligence audit write failed:", error.message);
            } catch (error) {
              console.error("[bot-sync] SYS+ Intelligence audit write failed:", error instanceof Error ? error.message : "unknown error");
            }
            return json({ ok: true, intelligenceEnabled, intelligenceChannelId, auditRecorded });
          } catch (error) {
            const reason = error instanceof Error ? error.message : "unknown error";
            console.error("[bot-sync] SYS+ Intelligence settings persistence failed:", reason);
            const missingTable = /(?:PGRST205|42P01)/.test(reason);
            const permissionDenied = /(?:42501|PGRST301)/.test(reason);
            const missingSupabaseConfig = /Missing Supabase environment variable/i.test(reason);
            return json({
              error: missingTable ? "bot_settings_table_missing" : permissionDenied ? "bot_settings_permission_denied" : missingSupabaseConfig ? "supabase_not_configured" : "settings_persistence_failed",
              ...(process.env["NODE_ENV"] !== "production" ? { detail: reason.slice(0, 180) } : {}),
            }, 503);
          }
        }
        if (body.action === "set-whitelist-role") {
          const guildId = String(body.guildId ?? "");
          const roleId = String(body.roleId ?? "");
          const actorId = String(body.actorId ?? "");
          if (![guildId, roleId, actorId].every(isDiscordSnowflake)) return json({ error: "invalid identifiers" }, 400);
          if (!isConfiguredPndOwner(actorId, process.env["PND_OWNER_DISCORD_ID"])) {
            return json({ error: "forbidden" }, 403);
          }
          const { readBotSettings, writeBotSettings } = await import("@/lib/bot-settings.server");
          const current = await readBotSettings(guildId);
          const next = { ...current, sysPlus: { ...(current.sysPlus ?? {}), whitelistRoleId: roleId } };
          await writeBotSettings(guildId, next);
          let auditRecorded = false;
          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { error } = await supabaseAdmin.from("sysplus_audit_log").insert({
              guild_id: guildId,
              actor_id: actorId,
              action: "whitelist_role_updated",
              target_id: roleId,
              details: { source: "discord_owner_command" },
            });
            auditRecorded = !error;
          } catch {
            // Setting persistence is primary; audit availability is secondary.
          }
          return json({ ok: true, auditRecorded });
        }
        if (body.action === "module-settings") {
          // Module configuration changed from a Discord slash command. The
          // dashboard remains the source of truth: validate, merge with the
          // current settings and return the sanitized object for the bot cache.
          const module = String(body.module ?? "");
          const modules = new Set<string>(BOT_MODULE_SETTINGS_KEYS);
          const guildId = String(body.guildId ?? "");
          const actorId = String(body.actorId ?? "");
          if (!modules.has(module) || !isDiscordSnowflake(guildId) || !isDiscordSnowflake(actorId)) {
            return json({ error: "invalid module or actor" }, 400);
          }
          let actorAuthorized = false;
          try {
            actorAuthorized = await verifyGuildModuleSettingsActor(guildId, actorId);
          } catch (error) {
            console.error("[bot-sync] Could not verify module-settings actor:", error instanceof Error ? error.message : "unknown error");
            return json({ error: "actor_authorization_unavailable" }, 503);
          }
          if (!actorAuthorized) return json({ error: "forbidden" }, 403);
          if (JSON.stringify(body.settings ?? {}).length > 100_000) return json({ error: "settings too large" }, 413);
          const { readBotSettings, writeBotSettings } = await import("@/lib/bot-settings.server");
          const { sanitizeSettings, applyModuleChanges } = await import("@/lib/bot-settings");
          const current = await readBotSettings(guildId);
          if (body.changes && typeof body.changes === "object") {
            // Field-level write: only the changed fields, refused (409) when one of them was
            // modified elsewhere (dashboard, another /setup) since the bot read it.
            const { conflicts, next } = applyModuleChanges(current, module as BotModuleKey, body.changes, body.expected);
            if (conflicts.length) return json({ error: "conflict", conflicts, settings: current }, 409);
            const saved = await writeBotSettings(guildId, next);
            return json({ ok: true, settings: saved });
          }
          const next = sanitizeSettings({ ...current, [module]: body.settings });
          const saved = await writeBotSettings(guildId, next);
          return json({ ok: true, settings: saved });
        }
        if (body.action === "ai-memory-clear") {
          const guildId = String(body.guildId ?? "");
          const userId = String(body.userId ?? "");
          if (!isDiscordSnowflake(guildId) || !isDiscordSnowflake(userId)) {
            return json({ error: "invalid AI conversation identifiers" }, 400);
          }
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin.from("bot_ai_memory").delete().eq("guild_id", guildId).eq("user_id", userId);
          if (error) return json({ error: "ai memory clear failed" }, 503);
          return json({ ok: true });
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
        if (body.action === "ai-action-plan") {
          const planPrompt = String(body.prompt ?? "").trim().slice(0, 1200);
          const planInstructions = String(body.instructions ?? "").trim().slice(0, 1200);
          const planAuthor = String(body.author ?? "").slice(0, 80);
          const planGuildId = String(body.guildId ?? "");
          const planUserId = String(body.userId ?? "");
          if (!planPrompt) return json({ error: "empty prompt" }, 400);
          if (!isDiscordSnowflake(planGuildId) || !isDiscordSnowflake(planUserId)) return json({ error: "invalid AI action identifiers" }, 400);
          const { botAiActionPlan } = await import("@/lib/bot-ai.server");
          const plan = await botAiActionPlan(planPrompt, planInstructions, planAuthor);
          return json(plan.action ? { action: plan.action } : { error: plan.error ?? "action planning failed" }, plan.status);
        }

        const prompt = String(body.prompt ?? "").trim().slice(0, 1500);
        const instructions = String(body.instructions ?? "").trim().slice(0, 2000);
        const author = String(body.author ?? "").slice(0, 80);
        const guildId = String(body.guildId ?? "");
        const userId = String(body.userId ?? "");
        const memoryEnabled = body.memoryEnabled === true;
        if (!prompt) return json({ error: "empty prompt" }, 400);
        if (!isDiscordSnowflake(guildId) || !isDiscordSnowflake(userId)) return json({ error: "invalid AI conversation identifiers" }, 400);

        // Conversation memory is optional and opt-in in each guild's settings.
        // A database outage must not disable ordinary AI replies when memory is
        // off (or silently turn memory back on). Memory failures are logged and
        // degrade to a stateless reply; no old history is sent when opted out.
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
        let memoryStore: typeof import("@/integrations/supabase/client.server").supabaseAdmin | null = null;
        try {
          const supabase = await import("@/integrations/supabase/client.server");
          memoryStore = supabase.supabaseAdmin;
        } catch (error) {
          console.error("AI memory storage unavailable:", error instanceof Error ? error.message : "unknown error");
        }

        let history: { role: "user" | "assistant"; content: string }[] = [];
        if (memoryStore && memoryEnabled) {
          try {
            const { data, error } = await memoryStore
              .from("bot_ai_memory")
              .select("role, content")
              .eq("guild_id", guildId)
              .eq("user_id", userId)
              .gte("created_at", cutoff)
              .order("created_at", { ascending: false })
              .limit(12);
            if (error) throw error;
            history = (data ?? []).reverse().flatMap((row) => {
              if ((row.role !== "user" && row.role !== "assistant") || typeof row.content !== "string") return [];
              return [{ role: row.role, content: row.content.slice(0, 1800) }];
            });
          } catch (error) {
            console.error("AI memory read failed; continuing without history:", error instanceof Error ? error.message : "unknown error");
          }
        } else if (memoryStore && !memoryEnabled) {
          // Best-effort deletion enforces opt-out; this request never reads or
          // forwards the previous conversation even if the database is offline.
          try {
            const { error } = await memoryStore.from("bot_ai_memory").delete().eq("guild_id", guildId).eq("user_id", userId);
            if (error) console.error("AI memory opt-out purge failed:", error.message);
          } catch (error) {
            console.error("AI memory opt-out purge failed:", error instanceof Error ? error.message : "unknown error");
          }
        }

        const { botAiReply } = await import("@/lib/bot-ai.server");
        const r = await botAiReply(prompt, instructions, author, history);
        if (r.reply !== undefined && memoryEnabled && memoryStore) {
          // Typed roles match the table check constraint; empty contents are skipped
          // because the migration requires between 1 and 1800 characters.
          type MemoryRecord = { guild_id: string; user_id: string; role: "user" | "assistant"; content: string };
          const candidates: MemoryRecord[] = [
            { guild_id: guildId, user_id: userId, role: "user", content: `${author ? `${author} : ` : ""}${prompt}`.slice(0, 1800) },
            { guild_id: guildId, user_id: userId, role: "assistant", content: r.reply.slice(0, 1800) },
          ];
          try {
            const records = candidates.filter((record) => record.content.length >= 1);
            const { error: saveError } = records.length ? await memoryStore.from("bot_ai_memory").insert(records) : { error: null };
            if (saveError) console.error("AI memory write failed:", saveError.message);
            const { error: expiryError } = await memoryStore.from("bot_ai_memory").delete().lt("created_at", cutoff);
            if (expiryError) console.error("AI memory expiry cleanup failed:", expiryError.message);
          } catch (error) {
            console.error("AI memory write failed:", error instanceof Error ? error.message : "unknown error");
          }
        }
        return json(r.reply !== undefined ? { reply: r.reply } : { error: r.error }, r.status);
      },
    },
  },
});
