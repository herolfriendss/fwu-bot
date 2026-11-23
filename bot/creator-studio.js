import { randomUUID } from "node:crypto";
import { db, transaction } from "./database.js";
import { authorize } from "./platform/policy/authorize.js";

/**
 * Creator Studio — one business layer for Discord commands and the dashboard.
 *
 * Kinds: announcement (embed), story (titled text post), event (titled post with
 * a start time and location). Lifecycle:
 *
 *   draft -> pending_review -> approved -> scheduled -> published
 *     ^          |                |            |
 *     +-- reject-+                +-- cancel --+ (back to approved)
 *
 * Rules enforced here, never only in an adapter:
 *  - a reviewer can never approve their own draft (four eyes);
 *  - only approved drafts can be scheduled or published;
 *  - mentions are explicit ids. allowedMentions never includes "parse", so no
 *    @everyone / @here / role mass ping can happen even if the text contains them;
 *  - links must be https; sizes are bounded; every transition writes history.
 * The caller provides authorization facts (canCreate / canReview) and a sender
 * for Discord delivery, so the module stays testable without a connection.
 */

export const CREATOR_KINDS = Object.freeze(["announcement", "story", "event"]);
export const DRAFT_STATUSES = Object.freeze(["draft", "pending_review", "approved", "scheduled", "publishing", "published", "failed"]);
export const LIMITS = Object.freeze({
  title: 256, body: 4000, footer: 200, location: 200, templateName: 40,
  maxUserMentions: 10, maxRoleMentions: 5, maxTemplatesPerGuild: 50,
  minScheduleLeadMs: 60_000, maxScheduleAheadMs: 365 * 86_400_000,
});
const HEX_COLOR = /^#?[0-9a-fA-F]{6}$/;
const SNOWFLAKE = /^\d{5,25}$/;

function clean(value, max) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function requireHttps(url) {
  if (!url) return null;
  let parsed;
  try { parsed = new URL(String(url)); } catch { throw new Error("Lien invalide."); }
  if (parsed.protocol !== "https:") throw new Error("Seuls les liens https sont autorisés.");
  return parsed.toString().slice(0, 500);
}

function ids(values, max, label) {
  const list = [...new Set((Array.isArray(values) ? values : []).map((value) => String(value).replace(/[<@&!>]/g, "")))];
  if (list.some((id) => !SNOWFLAKE.test(id))) throw new Error(`${label} : identifiant invalide.`);
  if (list.length > max) throw new Error(`${label} : ${max} maximum.`);
  return list;
}

/** Validates and normalizes content. Pure, so it is shared by commands and dashboard. */
export function normalizeContent(kind, input = {}) {
  if (!CREATOR_KINDS.includes(kind)) throw new Error("Type de publication inconnu.");
  const title = clean(input.title, LIMITS.title);
  const body = clean(input.body, LIMITS.body);
  if (title.length < 2) throw new Error("Le titre doit contenir au moins 2 caractères.");
  if (body.length < 1) throw new Error("Le contenu ne peut pas être vide.");
  const color = input.color ? String(input.color).replace("#", "").toUpperCase() : "7C3AED";
  if (!HEX_COLOR.test(color)) throw new Error("Couleur invalide (format #RRGGBB).");
  const content = {
    title, body, color,
    footer: clean(input.footer, LIMITS.footer) || null,
    imageUrl: requireHttps(input.imageUrl),
    mentions: {
      users: ids(input.mentionUsers, LIMITS.maxUserMentions, "Mentions membres"),
      roles: ids(input.mentionRoles, LIMITS.maxRoleMentions, "Mentions rôles"),
    },
  };
  if (kind === "event") {
    const startsAt = input.startsAt == null ? null : Number(input.startsAt);
    if (startsAt !== null && !Number.isFinite(startsAt)) throw new Error("Date d'événement invalide.");
    content.event = { startsAt, location: clean(input.location, LIMITS.location) || null };
  }
  return content;
}

/** Maps stored content back to the input shape, so edits never drop mentions or event data. */
function contentToInput(content) {
  return {
    title: content.title, body: content.body, color: content.color, footer: content.footer,
    imageUrl: content.imageUrl,
    mentionUsers: content.mentions?.users ?? [], mentionRoles: content.mentions?.roles ?? [],
    startsAt: content.event?.startsAt ?? null, location: content.event?.location ?? null,
  };
}

function rowToDraft(row) {
  if (!row) return null;
  return {
    draftId: row.draft_id,
    guildId: row.guild_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    content: JSON.parse(row.payload_json),
    status: row.status,
    authorId: row.author_id,
    reviewerId: row.reviewer_id ?? null,
    reviewNote: row.review_note ?? null,
    channelId: row.channel_id ?? null,
    scheduledAt: row.scheduled_at == null ? null : Number(row.scheduled_at),
    publishedMessageId: row.published_message_id ?? null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function history(guildId, draftId, actorId, action, detail, now) {
  db.prepare("INSERT INTO creator_history(guild_id,draft_id,actor_id,action,detail,created_at) VALUES(?,?,?,?,?,?)")
    .run(guildId, draftId, actorId, action, detail == null ? null : JSON.stringify(detail).slice(0, 1000), now);
}

function loadDraft(guildId, draftId) {
  const draft = rowToDraft(db.prepare("SELECT * FROM creator_drafts WHERE guild_id=? AND draft_id=?").get(guildId, draftId));
  if (!draft) throw new Error("Brouillon introuvable sur ce serveur.");
  return draft;
}

function setStatus(guildId, draftId, fields, now) {
  const keys = Object.keys(fields);
  const sets = keys.map((key) => `${key}=?`).join(",");
  db.prepare(`UPDATE creator_drafts SET ${sets}, updated_at=? WHERE guild_id=? AND draft_id=?`)
    .run(...keys.map((key) => fields[key]), now, guildId, draftId);
}

export function createDraft({ guildId, kind, input, actorId, canCreate, now = Date.now() }) {
  if (!canCreate) throw new Error("Création réservée aux membres SYS+ ou ADMIN+.");
  const content = normalizeContent(kind, input);
  const draftId = randomUUID();
  db.prepare(`INSERT INTO creator_drafts(draft_id,guild_id,kind,title,body,payload_json,status,author_id,channel_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(draftId, guildId, kind, content.title, content.body, JSON.stringify(content), "draft", actorId, input.channelId ?? null, now, now);
  history(guildId, draftId, actorId, "created", { kind }, now);
  return loadDraft(guildId, draftId);
}

export function updateDraft({ guildId, draftId, actorId, input, canCreate, now = Date.now() }) {
  if (!canCreate) throw new Error("Modification réservée aux membres SYS+ ou ADMIN+.");
  const current = loadDraft(guildId, draftId);
  if (current.authorId !== actorId) throw new Error("Seul l'auteur peut modifier ce brouillon.");
  if (!["draft", "failed"].includes(current.status)) throw new Error("Ce brouillon n'est plus modifiable (soumis ou planifié).");
  const content = normalizeContent(current.kind, { ...contentToInput(current.content), ...input });
  setStatus(guildId, draftId, { title: content.title, body: content.body, payload_json: JSON.stringify(content), status: "draft" }, now);
  history(guildId, draftId, actorId, "edited", null, now);
  return loadDraft(guildId, draftId);
}

export function submitDraft({ guildId, draftId, actorId, canCreate, now = Date.now() }) {
  if (!canCreate) throw new Error("Soumission réservée aux membres SYS+ ou ADMIN+.");
  const draft = loadDraft(guildId, draftId);
  if (draft.authorId !== actorId) throw new Error("Seul l'auteur peut soumettre ce brouillon.");
  if (!["draft", "failed"].includes(draft.status)) throw new Error("Seul un brouillon peut être soumis.");
  setStatus(guildId, draftId, { status: "pending_review", review_note: null }, now);
  history(guildId, draftId, actorId, "submitted", null, now);
  return loadDraft(guildId, draftId);
}

export function reviewDraft({ guildId, draftId, reviewerId, decision, note = null, canReview, now = Date.now() }) {
  if (!canReview) throw new Error("Validation réservée aux relecteurs SYS+ ou ADMIN+.");
  if (!["approve", "reject"].includes(decision)) throw new Error("Décision inconnue.");
  const draft = loadDraft(guildId, draftId);
  if (draft.authorId === reviewerId) throw new Error("Tu ne peux pas valider ton propre brouillon : un second relecteur est requis.");
  if (draft.status !== "pending_review") throw new Error("Ce brouillon n'attend pas de validation.");
  const safeNote = note ? clean(note, 300) : null;
  if (decision === "approve") {
    setStatus(guildId, draftId, { status: "approved", reviewer_id: reviewerId, review_note: safeNote }, now);
    history(guildId, draftId, reviewerId, "approved", { note: safeNote }, now);
  } else {
    setStatus(guildId, draftId, { status: "draft", reviewer_id: reviewerId, review_note: safeNote }, now);
    history(guildId, draftId, reviewerId, "rejected", { note: safeNote }, now);
  }
  return loadDraft(guildId, draftId);
}

export function scheduleDraft({ guildId, draftId, actorId, channelId, at, canCreate, now = Date.now() }) {
  if (!canCreate) throw new Error("Planification réservée aux membres SYS+ ou ADMIN+.");
  if (!SNOWFLAKE.test(String(channelId ?? ""))) throw new Error("Salon de publication invalide.");
  const draft = loadDraft(guildId, draftId);
  if (draft.status !== "approved") throw new Error("Seul un brouillon validé peut être planifié.");
  const when = Number(at);
  if (!Number.isFinite(when)) throw new Error("Date de publication invalide.");
  if (when < now + LIMITS.minScheduleLeadMs) throw new Error("La publication doit être planifiée au moins une minute à l'avance.");
  if (when > now + LIMITS.maxScheduleAheadMs) throw new Error("La planification ne peut pas dépasser un an.");
  setStatus(guildId, draftId, { status: "scheduled", scheduled_at: when, channel_id: channelId }, now);
  history(guildId, draftId, actorId, "scheduled", { at: when, channelId }, now);
  return loadDraft(guildId, draftId);
}

export function cancelSchedule({ guildId, draftId, actorId, canCreate, now = Date.now() }) {
  if (!canCreate) throw new Error("Action réservée aux membres SYS+ ou ADMIN+.");
  const draft = loadDraft(guildId, draftId);
  if (draft.status !== "scheduled") throw new Error("Ce brouillon n'est pas planifié.");
  setStatus(guildId, draftId, { status: "approved", scheduled_at: null }, now);
  history(guildId, draftId, actorId, "unscheduled", null, now);
  return loadDraft(guildId, draftId);
}

/** Builds the exact Discord payload used for both the preview and the real send. */
export function buildDiscordPayload(draft) {
  const c = draft.content;
  const embed = {
    title: c.title,
    description: c.body,
    color: parseInt(c.color, 16),
    ...(c.footer ? { footer: { text: c.footer } } : {}),
    ...(c.imageUrl ? { image: { url: c.imageUrl } } : {}),
    ...(c.event ? { fields: [
      ...(c.event.startsAt ? [{ name: "Début", value: `<t:${Math.floor(c.event.startsAt / 1000)}:F>`, inline: true }] : []),
      ...(c.event.location ? [{ name: "Lieu", value: c.event.location, inline: true }] : []),
    ] } : {}),
  };
  const mentionText = [...c.mentions.users.map((id) => `<@${id}>`), ...c.mentions.roles.map((id) => `<@&${id}>`)].join(" ");
  return {
    content: mentionText || undefined,
    embeds: [embed],
    // No "parse" key: @everyone, @here and role mass mentions can never ping.
    allowedMentions: { users: c.mentions.users, roles: c.mentions.roles, repliedUser: false },
  };
}

export function previewDraft(draft) {
  const payload = buildDiscordPayload(draft);
  const lines = [
    `**${draft.kind === "announcement" ? "Annonce" : draft.kind === "story" ? "Story" : "Événement"} — ${draft.title}**`,
    draft.content.body.slice(0, 500),
  ];
  if (payload.content) lines.push(`Mentions : ${payload.content}`);
  if (draft.content.event?.startsAt) lines.push(`Début : <t:${Math.floor(draft.content.event.startsAt / 1000)}:F>`);
  return { payload, text: lines.join("\n") };
}

/**
 * Publishes an approved draft now, or a scheduled draft that came due. `sender`
 * is injected: sender.send(channelId, payload) -> message id.
 */
export async function publishDraft({ guildId, draftId, actorId, channelId = null, sender, now = Date.now() }) {
  const before = loadDraft(guildId, draftId);
  if (!["approved", "scheduled"].includes(before.status)) throw new Error("Seul un brouillon validé ou planifié peut être publié.");
  const target = channelId ?? before.channelId;
  if (!SNOWFLAKE.test(String(target ?? ""))) throw new Error("Salon de publication invalide.");
  if (!sender || typeof sender.send !== "function") throw new Error("Service de publication indisponible.");

  // Atomic claim prevents two scheduler ticks or a manual publish from sending
  // the same draft twice. A crash during delivery is recovered as an unknown
  // outcome and is never automatically retried.
  const claimed = db.prepare(`UPDATE creator_drafts SET status='publishing',updated_at=?
    WHERE guild_id=? AND draft_id=? AND status IN ('approved','scheduled')`).run(now, guildId, draftId);
  if (Number(claimed.changes) !== 1) throw new Error("Ce brouillon est déjà en cours de publication ou a été traité.");
  const draft = loadDraft(guildId, draftId);
  try {
    const messageId = await sender.send(target, buildDiscordPayload(draft), { guildId });
    setStatus(guildId, draftId, { status: "published", published_message_id: String(messageId), channel_id: target }, now);
    history(guildId, draftId, actorId ?? "system", "published", { channelId: target, messageId: String(messageId) }, now);
    return { ok: true, messageId: String(messageId) };
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 200) : "erreur inconnue";
    setStatus(guildId, draftId, { status: "failed" }, now);
    history(guildId, draftId, actorId ?? "system", "publish_failed", {
      message: reason, outcome: "unknown", requiresManualReview: true,
    }, now);
    return { ok: false, error: reason, outcome: "unknown" };
  }
}

/**
 * Recovers drafts left in `publishing` by a process crash. Delivery may have
 * reached Discord before the crash, so these drafts are never auto-retried.
 */
export function recoverInterruptedStudioPublishes({ now = Date.now(), staleAfterMs = 5 * 60_000 } = {}) {
  const cutoff = now - Math.max(1_000, Number(staleAfterMs) || 5 * 60_000);
  return transaction(() => {
    const rows = db.prepare("SELECT guild_id,draft_id FROM creator_drafts WHERE status='publishing' AND updated_at<=? LIMIT 100").all(cutoff);
    for (const row of rows) {
      db.prepare("UPDATE creator_drafts SET status='failed',updated_at=? WHERE guild_id=? AND draft_id=? AND status='publishing'")
        .run(now, row.guild_id, row.draft_id);
      history(row.guild_id, row.draft_id, "system", "publish_interrupted", {
        outcome: "unknown", requiresManualReview: true,
        message: "Publication interrompue. Vérifier le salon Discord avant toute nouvelle tentative.",
      }, now);
    }
    return rows.length;
  });
}

/** Scheduler tick: publishes every scheduled draft whose time has come. Returns counts. */
export async function publishDueDrafts({ sender, now = Date.now(), limit = 20 }) {
  const due = db.prepare("SELECT guild_id,draft_id FROM creator_drafts WHERE status='scheduled' AND scheduled_at<=? ORDER BY scheduled_at LIMIT ?")
    .all(now, Math.min(100, Math.max(1, Number(limit) || 20)));
  let published = 0;
  let failed = 0;
  for (const row of due) {
    const result = await publishDraft({ guildId: row.guild_id, draftId: row.draft_id, sender, now });
    if (result.ok) published += 1; else failed += 1;
  }
  return { published, failed };
}

export function listDrafts(guildId, { status = null, limit = 20, favoritesOf = null } = {}) {
  const max = Math.min(50, Math.max(1, Number(limit) || 20));
  if (favoritesOf) {
    return db.prepare(`SELECT d.* FROM creator_drafts d JOIN creator_favorites f ON f.guild_id=d.guild_id AND f.draft_id=d.draft_id
      WHERE d.guild_id=? AND f.user_id=? ORDER BY d.updated_at DESC LIMIT ?`).all(guildId, favoritesOf, max).map(rowToDraft);
  }
  if (status) return db.prepare("SELECT * FROM creator_drafts WHERE guild_id=? AND status=? ORDER BY updated_at DESC LIMIT ?").all(guildId, status, max).map(rowToDraft);
  return db.prepare("SELECT * FROM creator_drafts WHERE guild_id=? ORDER BY updated_at DESC LIMIT ?").all(guildId, max).map(rowToDraft);
}

export function getDraft(guildId, draftId) {
  return loadDraft(guildId, draftId);
}

export function toggleFavorite({ guildId, userId, draftId, now = Date.now() }) {
  loadDraft(guildId, draftId);
  const exists = db.prepare("SELECT 1 FROM creator_favorites WHERE guild_id=? AND user_id=? AND draft_id=?").get(guildId, userId, draftId);
  if (exists) {
    db.prepare("DELETE FROM creator_favorites WHERE guild_id=? AND user_id=? AND draft_id=?").run(guildId, userId, draftId);
    return { favorite: false };
  }
  db.prepare("INSERT INTO creator_favorites(guild_id,user_id,draft_id,created_at) VALUES(?,?,?,?)").run(guildId, userId, draftId, now);
  return { favorite: true };
}

export function getHistory(guildId, draftId, limit = 20) {
  loadDraft(guildId, draftId);
  return db.prepare("SELECT actor_id,action,detail,created_at FROM creator_history WHERE guild_id=? AND draft_id=? ORDER BY id DESC LIMIT ?")
    .all(guildId, draftId, Math.min(100, Math.max(1, Number(limit) || 20)))
    .map((row) => ({ actorId: row.actor_id, action: row.action, detail: row.detail ? JSON.parse(row.detail) : null, at: Number(row.created_at) }));
}

export function saveTemplate({ guildId, draftId, name, actorId, canCreate, now = Date.now() }) {
  if (!canCreate) throw new Error("Modèles réservés aux membres SYS+ ou ADMIN+.");
  const safeName = clean(name, LIMITS.templateName);
  if (safeName.length < 2) throw new Error("Le nom du modèle doit contenir au moins 2 caractères.");
  const draft = loadDraft(guildId, draftId);
  return transaction(() => {
    const count = db.prepare("SELECT COUNT(*) AS n FROM creator_templates WHERE guild_id=?").get(guildId).n;
    if (count >= LIMITS.maxTemplatesPerGuild) throw new Error("Limite de modèles atteinte pour ce serveur.");
    const templateId = randomUUID();
    // Templates keep layout and wording only: no mentions, no fixed event date.
    const base = contentToInput(draft.content);
    const payload = JSON.stringify({
      kind: draft.kind, title: base.title, body: base.body, color: base.color, footer: base.footer,
      imageUrl: base.imageUrl, mentionUsers: [], mentionRoles: [],
      location: base.location, startsAt: null,
    });
    try {
      db.prepare("INSERT INTO creator_templates(template_id,guild_id,name,kind,payload_json,created_by,created_at) VALUES(?,?,?,?,?,?,?)")
        .run(templateId, guildId, safeName, draft.kind, payload, actorId, now);
    } catch {
      throw new Error("Un modèle porte déjà ce nom sur ce serveur.");
    }
    return { templateId, name: safeName, kind: draft.kind };
  });
}

export function listTemplates(guildId) {
  return db.prepare("SELECT template_id,name,kind,created_at FROM creator_templates WHERE guild_id=? ORDER BY name").all(guildId)
    .map((row) => ({ templateId: row.template_id, name: row.name, kind: row.kind, createdAt: Number(row.created_at) }));
}

/** Creates a new draft from a template. Mentions are never copied from templates. */
export function createFromTemplate({ guildId, templateName, input = {}, actorId, canCreate, now = Date.now() }) {
  const row = db.prepare("SELECT * FROM creator_templates WHERE guild_id=? AND name=?").get(guildId, clean(templateName, LIMITS.templateName));
  if (!row) throw new Error("Modèle introuvable.");
  const stored = JSON.parse(row.payload_json);
  const { kind, ...fields } = stored;
  return createDraft({ guildId, kind, input: { ...fields, ...input, mentionUsers: input.mentionUsers ?? [], mentionRoles: input.mentionRoles ?? [] }, actorId, canCreate, now });
}

/** Resolves a draft by an id prefix on one guild. Ambiguous or unknown prefixes are refused. */
export function findDraftByPrefix(guildId, prefix) {
  const token = String(prefix ?? "").trim();
  if (token.length < 4) throw new Error("Indique au moins 4 caractères de l'identifiant du brouillon.");
  const rows = db.prepare("SELECT draft_id FROM creator_drafts WHERE guild_id=? AND draft_id LIKE ? LIMIT 2").all(guildId, `${token}%`);
  if (rows.length !== 1) throw new Error("Brouillon introuvable ou ambigu sur ce serveur.");
  return rows[0].draft_id;
}

/**
 * Creator Studio access: the creator.studio entitlement plus SYS+ or ADMIN+.
 * Tiers are resolved by the caller; authorize() enforces the entitlement and tier.
 */
export function authorizeStudio({ guildId, actorId, tiers, entitlements }) {
  const decision = authorize({
    guildId,
    actor: { id: actorId },
    actionPolicy: { key: "creator.studio.use", minTiers: ["SYS_PLUS", "ADMIN_PLUS"], entitlement: "creator.studio" },
    resolved: { guildId, guildStatus: "active", moduleEnabled: true, tiers, entitlements },
  });
  return { allowed: decision.allow && decision.code === "AUTHORIZED", code: decision.code };
}

/**
 * Discord sender bound to one guild. A channel that belongs to another guild is
 * refused, so a scheduled post can never leave the server it was written for.
 */
export function createClientStudioSender(client, { isAllowedGuild = () => false } = {}) {
  return {
    send: async (channelId, payload, { guildId }) => {
      if (!isAllowedGuild(guildId)) throw new Error("Serveur non autorisé pour la publication.");
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || channel.guildId !== guildId) throw new Error("Salon introuvable sur ce serveur.");
      if (typeof channel.isTextBased === "function" && !channel.isTextBased()) throw new Error("Le salon n'accepte pas les messages.");
      const message = await channel.send(payload);
      return message.id;
    },
  };
}
