// FWU — porte unique des commandes de modération, utilisée par les 5 bots.
//
//   const gate = await openModerationGate({ member, command: "kick", bot: "guard", targetId });
//   if (!gate.ok) return reply(gate.message);
//   try { …action Discord… ; await gate.succeed(); } catch (e) { await gate.fail(e); throw e; }
//
// Palier du membre → quota partagé (atomique) → action → journal. Un échec de
// l'action rend l'usage consommé. Base injoignable = refus (fail closed).
import { logCommandUsage } from "./audit.js";
import { consumeQuota, formatQuotaRefusal, refundQuota } from "./quotas.js";
import { memberTier } from "./tiers.js";

const OUTCOME_BY_REASON = { quota: "quota", unavailable: "unavailable" };

export async function openModerationGate({ member, command, bot, targetId = null, env = process.env }) {
  const guildId = member?.guild?.id;
  const userId = member?.id ?? member?.user?.id;
  if (!guildId || !userId) return { ok: false, message: "⛔ Commande utilisable uniquement sur un serveur." };
  const isBot = Boolean(member.user?.bot);
  const tier = isBot ? null : await memberTier(member, env);
  let decision;
  try {
    decision = await consumeQuota({ guildId, userId, command, tier, bot, isBot });
  } catch {
    decision = { allowed: false, reason: "unavailable" };
  }
  if (!decision.allowed) {
    await logCommandUsage({ guildId, userId, bot, command, targetId, outcome: OUTCOME_BY_REASON[decision.reason] ?? "denied", detail: decision.reason });
    return { ok: false, tier, decision, message: formatQuotaRefusal(decision, command) };
  }
  let settled = false;
  return {
    ok: true,
    tier,
    decision,
    async succeed(detail = null) {
      if (settled) return;
      settled = true;
      await logCommandUsage({ guildId, userId, bot, command, targetId, outcome: "ok", detail: detail ? String(detail).slice(0, 300) : null });
    },
    async fail(error = null) {
      if (settled) return;
      settled = true;
      await refundQuota(decision.usageId);
      await logCommandUsage({ guildId, userId, bot, command, targetId, outcome: "error", detail: String(error?.message ?? error ?? "").slice(0, 300) || null });
    },
  };
}
