import { randomUUID } from "node:crypto";
import { db, transaction } from "./database.js";

const SNOWFLAKE = /^\d{5,25}$/;
const TRIGGERS = new Set(["member_join", "member_leave", "message_created", "voice_join", "voice_leave", "scheduled"]);
const ACTIONS = new Set(["send_message", "add_role", "remove_role"]);
const MAX_ACTIONS = 10;

function cleanText(value, max, label) {
  if (typeof value !== "string") throw new Error(`${label} invalide.`);
  const text = value.trim();
  if (!text || text.length > max) throw new Error(`${label} doit contenir entre 1 et ${max} caractères.`);
  return text;
}

export function validateAutomationRule(input = {}) {
  const name = cleanText(input.name, 60, "Le nom de règle");
  if (!TRIGGERS.has(input.triggerType)) throw new Error("Déclencheur d’automatisation invalide.");
  const raw = input.conditions ?? {};
  const conditions = {};
  if (raw.minAccountAgeDays !== undefined) {
    if (!Number.isSafeInteger(raw.minAccountAgeDays) || raw.minAccountAgeDays < 0 || raw.minAccountAgeDays > 36500) throw new Error("Âge minimal de compte invalide.");
    conditions.minAccountAgeDays = raw.minAccountAgeDays;
  }
  if (raw.requiredRoleId !== undefined) {
    if (typeof raw.requiredRoleId !== "string" || !SNOWFLAKE.test(raw.requiredRoleId)) throw new Error("Rôle conditionnel invalide.");
    conditions.requiredRoleId = raw.requiredRoleId;
  }
  if (raw.channelId !== undefined) {
    if (typeof raw.channelId !== "string" || !SNOWFLAKE.test(raw.channelId)) throw new Error("Salon conditionnel invalide.");
    conditions.channelId = raw.channelId;
  }
  if (raw.intervalMinutes !== undefined) {
    if (!Number.isSafeInteger(raw.intervalMinutes) || raw.intervalMinutes < 60 || raw.intervalMinutes > 43_200) throw new Error("Intervalle planifié compris entre 60 et 43 200 minutes attendu.");
    conditions.intervalMinutes = raw.intervalMinutes;
  }
  if (Object.keys(raw).some((key) => !["minAccountAgeDays", "requiredRoleId", "channelId", "intervalMinutes"].includes(key))) throw new Error("Condition non prise en charge.");
  if (input.triggerType === "scheduled" && conditions.intervalMinutes === undefined) throw new Error("Une règle planifiée doit définir intervalMinutes.");
  if (input.triggerType !== "scheduled" && conditions.intervalMinutes !== undefined) throw new Error("intervalMinutes est réservé aux règles planifiées.");
  if (input.triggerType === "message_created" && !conditions.channelId && !conditions.requiredRoleId) {
    throw new Error("Un déclencheur message_created doit cibler un salon ou un rôle afin d'éviter les rafales.");
  }

  if (!Array.isArray(input.actions) || input.actions.length < 1 || input.actions.length > MAX_ACTIONS) throw new Error(`Une règle doit contenir de 1 à ${MAX_ACTIONS} actions.`);
  const actions = input.actions.map((action) => {
    if (!ACTIONS.has(action?.type)) throw new Error("Action d’automatisation non autorisée.");
    if (action.type === "send_message") {
      if (typeof action.channelId !== "string" || !SNOWFLAKE.test(action.channelId)) throw new Error("Salon de publication invalide.");
      const content = cleanText(action.content, 1900, "Le message").replace(/@/g, "＠");
      return { type: action.type, channelId: action.channelId, content };
    }
    if (typeof action.roleId !== "string" || !SNOWFLAKE.test(action.roleId)) throw new Error("Rôle de l’action invalide.");
    return { type: action.type, roleId: action.roleId };
  });
  return Object.freeze({ name, triggerType: input.triggerType, conditions: Object.freeze(conditions), actions: Object.freeze(actions) });
}

function assertGuildId(guildId) {
  if (typeof guildId !== "string" || !SNOWFLAKE.test(guildId)) throw new Error("Identifiant de serveur invalide.");
}

export function createAutomationRule(guildId, actorId, input, now = Date.now()) {
  assertGuildId(guildId);
  if (typeof actorId !== "string" || !SNOWFLAKE.test(actorId)) throw new Error("Auteur invalide.");
  const rule = validateAutomationRule(input);
  const existingRules = Number(db.prepare("SELECT COUNT(*) AS count FROM automation_rules WHERE guild_id=?").get(guildId).count);
  if (existingRules >= 50) throw new Error("Maximum de 50 règles d'automatisation par serveur atteint.");
  const ruleId = randomUUID();
  db.prepare(`INSERT INTO automation_rules
    (rule_id,guild_id,name,trigger_type,conditions_json,actions_json,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(ruleId, guildId, rule.name, rule.triggerType, JSON.stringify(rule.conditions), JSON.stringify(rule.actions), actorId, now, now);
  return getAutomationRule(guildId, ruleId);
}

export function getAutomationRule(guildId, ruleId) {
  assertGuildId(guildId);
  const row = db.prepare("SELECT * FROM automation_rules WHERE guild_id=? AND rule_id=?").get(guildId, ruleId);
  if (!row) return null;
  return Object.freeze({
    ruleId: row.rule_id,
    guildId: row.guild_id,
    name: row.name,
    triggerType: row.trigger_type,
    conditions: JSON.parse(row.conditions_json),
    actions: JSON.parse(row.actions_json),
    enabled: row.enabled === 1,
    createdBy: row.created_by,
    createdAt: Number(row.created_at),
  });
}

export function listAutomationRules(guildId, limit = 20) {
  assertGuildId(guildId);
  const bounded = Math.max(1, Math.min(50, Number(limit) || 20));
  return db.prepare("SELECT rule_id FROM automation_rules WHERE guild_id=? ORDER BY created_at DESC LIMIT ?")
    .all(guildId, bounded).map((row) => getAutomationRule(guildId, row.rule_id));
}

export function getAutomationRun(guildId, runId) {
  assertGuildId(guildId);
  if (typeof runId !== "string" || !/^[0-9a-f-]{36}$/i.test(runId)) return null;
  const row = db.prepare("SELECT * FROM automation_runs WHERE guild_id=? AND run_id=?").get(guildId, runId);
  if (!row) return null;
  return Object.freeze({
    runId: row.run_id, ruleId: row.rule_id, status: row.status,
    preview: JSON.parse(row.preview_json), requestedBy: row.requested_by,
    confirmedBy: row.confirmed_by, createdAt: Number(row.created_at),
  });
}

function eventMatches(rule, event) {
  if (event.type !== rule.triggerType) return false;
  const conditions = rule.conditions;
  if (conditions.minAccountAgeDays !== undefined && Number(event.accountAgeDays) < conditions.minAccountAgeDays) return false;
  if (conditions.requiredRoleId && !Array.isArray(event.memberRoleIds ?? [])) return false;
  if (conditions.requiredRoleId && !event.memberRoleIds.includes(conditions.requiredRoleId)) return false;
  if (conditions.channelId && conditions.channelId !== event.channelId) return false;
  return true;
}

export function previewAutomationEvent(guildId, ruleId, event, requestedBy = null, now = Date.now()) {
  assertGuildId(guildId);
  const rule = getAutomationRule(guildId, ruleId);
  if (!rule || !rule.enabled) throw new Error("Règle introuvable ou désactivée sur ce serveur.");
  if (!event || event.guildId !== guildId || typeof event.id !== "string" || event.id.length < 1 || event.id.length > 180 || !TRIGGERS.has(event.type)) {
    throw new Error("Événement d’automatisation invalide ou hors serveur.");
  }
  const safeEvent = {
    id: event.id,
    type: event.type,
    guildId,
    memberId: typeof event.memberId === "string" && SNOWFLAKE.test(event.memberId) ? event.memberId : null,
    memberRoleIds: Array.isArray(event.memberRoleIds) ? event.memberRoleIds.filter((id) => typeof id === "string" && SNOWFLAKE.test(id)).slice(0, 100) : [],
    accountAgeDays: Number.isFinite(Number(event.accountAgeDays)) ? Math.max(0, Number(event.accountAgeDays)) : null,
    channelId: typeof event.channelId === "string" && SNOWFLAKE.test(event.channelId) ? event.channelId : null,
  };
  const matches = eventMatches(rule, safeEvent);
  const runId = randomUUID();
  const recentLimit = rule.triggerType === "message_created" ? 10 : 50;
  const recentCount = matches ? Number(db.prepare(`SELECT COUNT(*) AS count FROM automation_runs
    WHERE guild_id=? AND rule_id=? AND created_at>? AND status IN ('previewed','confirmed','executing','executed','failed')`)
    .get(guildId, ruleId, now - 60 * 60_000).count) : 0;
  const throttled = matches && recentCount >= recentLimit;
  const preview = {
    ruleId,
    event: safeEvent,
    matches: matches && !throttled,
    actions: matches && !throttled ? rule.actions : [],
    requiresConfirmation: true,
    note: throttled ? `Débit limité : ${recentLimit} aperçu(s) maximum par heure pour ce déclencheur.`
      : matches ? "Aucune action n’est exécutée avant confirmation explicite." : "Les conditions ne correspondent pas ; aucune action ne sera exécutée.",
  };
  const inserted = db.prepare(`INSERT OR IGNORE INTO automation_runs
    (run_id,guild_id,rule_id,event_id,status,requires_confirmation,preview_json,requested_by,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(runId, guildId, ruleId, safeEvent.id, matches && !throttled ? "previewed" : "skipped", 1, JSON.stringify(preview), requestedBy, now);
  const row = db.prepare("SELECT * FROM automation_runs WHERE guild_id=? AND rule_id=? AND event_id=?").get(guildId, ruleId, safeEvent.id);
  return Object.freeze({ runId: row.run_id, duplicate: !Number(inserted.changes), status: row.status, preview: JSON.parse(row.preview_json) });
}

export function confirmAutomationRun(guildId, runId, actorId, { authorizeActor, now = Date.now() } = {}) {
  assertGuildId(guildId);
  if (typeof actorId !== "string" || !SNOWFLAKE.test(actorId) || typeof authorizeActor !== "function") throw new Error("Confirmation non autorisée.");
  const row = db.prepare("SELECT * FROM automation_runs WHERE guild_id=? AND run_id=?").get(guildId, runId);
  if (!row || row.status !== "previewed") throw new Error("Aperçu introuvable, déjà traité ou expiré.");
  if (authorizeActor({ guildId, actorId, action: "automation.confirm", ruleId: row.rule_id }) !== true) throw new Error("Permission SYS+ ou responsable autorisé requise.");
  const updated = db.prepare(`UPDATE automation_runs SET status='confirmed',confirmed_by=?
    WHERE guild_id=? AND run_id=? AND status='previewed' AND created_at>?`)
    .run(actorId, guildId, runId, now - 15 * 60_000);
  if (!Number(updated.changes)) throw new Error("Cet aperçu a expiré ou vient d’être confirmé.");
  return Object.freeze({ runId, status: "confirmed", confirmedBy: actorId });
}

export async function executeConfirmedAutomation(guildId, runId, executor, now = Date.now()) {
  assertGuildId(guildId);
  if (typeof executor !== "function") throw new Error("Exécuteur d’automatisation indisponible.");
  const claimed = transaction(() => {
    const row = db.prepare("SELECT * FROM automation_runs WHERE guild_id=? AND run_id=?").get(guildId, runId);
    if (!row || row.status !== "confirmed") return null;
    const updated = db.prepare("UPDATE automation_runs SET status='executing' WHERE guild_id=? AND run_id=? AND status='confirmed'").run(guildId, runId);
    return Number(updated.changes) ? { row, preview: JSON.parse(row.preview_json) } : null;
  });
  if (!claimed) return { executed: false, reason: "not_confirmed_or_already_processed" };
  const results = [];
  try {
    for (const action of claimed.preview.actions) {
      // Re-validate the action allowlist at execution time; no dynamic code,
      // arbitrary URL fetch, ban/kick/mute, channel deletion or role hierarchy bypass.
      if (!ACTIONS.has(action.type)) throw new Error("Action interdite.");
      results.push(await executor({ guildId, action, event: claimed.preview.event }));
    }
    const serialized = JSON.stringify(results).slice(0, 20_000);
    db.prepare("UPDATE automation_runs SET status='executed',result_json=?,executed_at=? WHERE guild_id=? AND run_id=? AND status='executing'")
      .run(serialized, now, guildId, runId);
    return { executed: true, results };
  } catch (error) {
    db.prepare("UPDATE automation_runs SET status='failed',result_json=?,executed_at=? WHERE guild_id=? AND run_id=? AND status='executing'")
      .run(JSON.stringify({ error: error instanceof Error ? error.message.slice(0, 300) : "unknown" }), now, guildId, runId);
    return { executed: false, reason: "execution_failed_manual_review_required" };
  }
}

export function disableAutomationRule(guildId, ruleId, actorId, now = Date.now()) {
  assertGuildId(guildId);
  if (typeof actorId !== "string" || !SNOWFLAKE.test(actorId)) throw new Error("Auteur invalide.");
  const result = db.prepare("UPDATE automation_rules SET enabled=0,updated_at=? WHERE guild_id=? AND rule_id=? AND enabled=1")
    .run(now, guildId, ruleId);
  return Number(result.changes) > 0;
}


export function setAutomationApprovalChannel(guildId, actorId, channelId, now = Date.now()) {
  assertGuildId(guildId);
  if (typeof actorId !== "string" || !SNOWFLAKE.test(actorId) || typeof channelId !== "string" || !SNOWFLAKE.test(channelId)) {
    throw new Error("Identifiant du responsable ou du salon invalide.");
  }
  db.prepare(`INSERT INTO automation_rule_settings(guild_id,approval_channel_id,updated_by,updated_at)
    VALUES(?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET approval_channel_id=excluded.approval_channel_id,
    updated_by=excluded.updated_by,updated_at=excluded.updated_at`).run(guildId, channelId, actorId, now);
  return { guildId, approvalChannelId: channelId };
}

export function getAutomationApprovalChannel(guildId) {
  assertGuildId(guildId);
  return db.prepare("SELECT approval_channel_id FROM automation_rule_settings WHERE guild_id=?").get(guildId)?.approval_channel_id ?? null;
}

export function recoverInterruptedAutomationRuns(now = Date.now()) {
  const result = db.prepare(`UPDATE automation_runs SET status='failed',
    result_json=?,executed_at=? WHERE status='executing'`)
    .run(JSON.stringify({ error: "Process interrupted; manual review required." }), now);
  return Number(result.changes);
}
