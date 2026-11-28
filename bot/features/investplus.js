// Invest + — données et règles des abonnements (formules, abonnés, espaces privés,
// demandes des membres, historique). Aucune dépendance Discord ici : tout est testable.
//
// Principe : Invest + ne détient ni ne place l'argent de personne. Une formule est
// soit payée en PND (monnaie interne du serveur), soit attribuée à la main par
// l'administrateur (« manuel ») quand le règlement se fait en dehors du bot.
import { db, transaction } from "../database.js";
import { grantPnd } from "../economy.js";

export const DAY = 86_400_000;
// pnd : payé dans le bot en PND ; manuel : payé hors du bot (argent réel, géré par l'administration) ;
// mixte : au choix du membre, PND ou paiement réel.
export const PAY_MODES = Object.freeze(["manuel", "pnd", "mixte"]);
export const payableInPnd = (plan) => plan?.payMode === "pnd" || plan?.payMode === "mixte";
export const payableReal = (plan) => plan?.payMode === "manuel" || plan?.payMode === "mixte";
export const STATUSES = Object.freeze(["active", "paused", "expired", "cancelled"]);
export const STATUS_LABELS = Object.freeze({ active: "🟢 Actif", paused: "⏸️ En pause", expired: "⚪ Expiré", cancelled: "🔴 Résilié" });
export const REQUEST_KINDS = Object.freeze({ souscrire: "Souscription (paiement réel)", renouveler: "Renouvellement", changer: "Changement de formule", question: "Question" });
export const LIMITS = Object.freeze({ name: 40, description: 300, benefits: 900, note: 200, request: 500, welcome: 900, maxPlans: 25, maxDays: 3650, maxPrice: 1_000_000_000 });

db.exec(`
  CREATE TABLE IF NOT EXISTS investplus_config (
    guild_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, category_id TEXT, admin_channel_id TEXT,
    staff_role_id TEXT, welcome TEXT, reminder_days INTEGER NOT NULL DEFAULT 3
  );
  CREATE TABLE IF NOT EXISTS investplus_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    benefits TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL DEFAULT 0, period_days INTEGER NOT NULL DEFAULT 30,
    role_id TEXT, pay_mode TEXT NOT NULL DEFAULT 'manuel', active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS investplus_plans_name ON investplus_plans(guild_id, name COLLATE NOCASE);
  CREATE TABLE IF NOT EXISTS investplus_subscriptions (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, plan_id INTEGER NOT NULL, status TEXT NOT NULL,
    started_at INTEGER NOT NULL, expires_at INTEGER, paused_remaining INTEGER, reminded INTEGER NOT NULL DEFAULT 0,
    note TEXT, updated_by TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS investplus_subscriptions_due ON investplus_subscriptions(status, expires_at);
  CREATE TABLE IF NOT EXISTS investplus_spaces (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, channel_id TEXT NOT NULL, panel_message_id TEXT,
    created_at INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS investplus_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL,
    plan_id INTEGER, amount INTEGER NOT NULL DEFAULT 0, detail TEXT, actor_id TEXT, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS investplus_history_member ON investplus_history(guild_id, user_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS investplus_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL,
    plan_id INTEGER, body TEXT, status TEXT NOT NULL DEFAULT 'open', handled_by TEXT, created_at INTEGER NOT NULL, handled_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS investplus_requests_open ON investplus_requests(guild_id, status, created_at);
`);
// Prix en argent réel affiché aux membres (texte libre, ex. « 9,99 € / mois ») et instructions de paiement.
try { db.exec("ALTER TABLE investplus_plans ADD COLUMN real_price TEXT"); } catch { /* déjà là */ }
try { db.exec("ALTER TABLE investplus_config ADD COLUMN payment_info TEXT"); } catch { /* déjà là */ }

/** Texte saisi par un humain : sans mention de masse, espaces normalisés, longueur bornée. */
export function cleanText(value, max, label, { required = false, multiline = false } = {}) {
  const raw = String(value ?? "").replace(/@(everyone|here)/gi, "＠$1").replace(/<@&(\d+)>/g, "＠rôle");
  const text = (multiline ? raw.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n") : raw.replace(/\s+/g, " ")).trim();
  if (required && !text) throw new Error(`${label} est obligatoire.`);
  if (text.length > max) throw new Error(`${label} : ${max} caractères au maximum.`);
  return text;
}

const rowToConfig = (guildId, row) => ({
  guildId,
  enabled: row ? Boolean(row.enabled) : true,
  categoryId: row?.category_id ?? null,
  adminChannelId: row?.admin_channel_id ?? null,
  staffRoleId: row?.staff_role_id ?? null,
  welcome: row?.welcome ?? "",
  paymentInfo: row?.payment_info ?? "",
  reminderDays: Number(row?.reminder_days ?? 3),
});

export function investConfig(guildId) {
  return rowToConfig(guildId, db.prepare("SELECT * FROM investplus_config WHERE guild_id=?").get(guildId));
}

export function saveInvestConfig(guildId, patch = {}) {
  const next = { ...investConfig(guildId), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
  next.welcome = cleanText(next.welcome, LIMITS.welcome, "Le message d'accueil", { multiline: true });
  next.reminderDays = Math.min(30, Math.max(0, Math.trunc(Number(next.reminderDays) || 0)));
  next.paymentInfo = cleanText(next.paymentInfo ?? "", LIMITS.welcome, "Les instructions de paiement", { multiline: true });
  db.prepare(`INSERT INTO investplus_config(guild_id,enabled,category_id,admin_channel_id,staff_role_id,welcome,reminder_days)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET enabled=excluded.enabled, category_id=excluded.category_id,
    admin_channel_id=excluded.admin_channel_id, staff_role_id=excluded.staff_role_id, welcome=excluded.welcome, reminder_days=excluded.reminder_days`)
    .run(guildId, next.enabled ? 1 : 0, next.categoryId, next.adminChannelId, next.staffRoleId, next.welcome, next.reminderDays);
  db.prepare("UPDATE investplus_config SET payment_info=? WHERE guild_id=?").run(next.paymentInfo || null, guildId);
  return investConfig(guildId);
}

const rowToPlan = (row) => row && ({
  id: Number(row.id), guildId: row.guild_id, name: row.name, description: row.description, benefits: row.benefits,
  price: Number(row.price), periodDays: Number(row.period_days), roleId: row.role_id ?? null, payMode: row.pay_mode, realPrice: row.real_price ?? null,
  active: Boolean(row.active), createdAt: Number(row.created_at),
});

function checkPlanFields(fields) {
  const out = {};
  if (fields.name !== undefined) out.name = cleanText(fields.name, LIMITS.name, "Le nom", { required: true });
  if (fields.description !== undefined) out.description = cleanText(fields.description, LIMITS.description, "La description", { multiline: true });
  // Avantages : un par ligne, ou séparés par « ; » dans une commande slash.
  if (fields.benefits !== undefined) out.benefits = cleanText(String(fields.benefits).split(/\s*;\s*/).join("\n"), LIMITS.benefits, "Les avantages", { multiline: true });
  if (fields.price !== undefined) {
    const price = Number(fields.price);
    if (!Number.isSafeInteger(price) || price < 0 || price > LIMITS.maxPrice) throw new Error("Prix invalide.");
    out.price = price;
  }
  if (fields.periodDays !== undefined) {
    const days = Number(fields.periodDays);
    if (!Number.isSafeInteger(days) || days < 1 || days > LIMITS.maxDays) throw new Error(`Durée invalide : 1 à ${LIMITS.maxDays} jours.`);
    out.periodDays = days;
  }
  if (fields.payMode !== undefined) {
    if (!PAY_MODES.includes(fields.payMode)) throw new Error("Paiement : « manuel », « pnd » ou « mixte ».");
    out.payMode = fields.payMode;
  }
  if (fields.roleId !== undefined) out.roleId = fields.roleId || null;
  if (fields.realPrice !== undefined) out.realPrice = cleanText(fields.realPrice ?? "", 60, "Le prix réel") || null;
  return out;
}

export function createPlan(guildId, fields, now = Date.now()) {
  const f = checkPlanFields({ description: "", benefits: "", price: 0, periodDays: 30, payMode: "manuel", roleId: null, ...fields });
  if (payableInPnd(f) && f.price < 1) throw new Error("Une formule payable en PND doit avoir un prix d'au moins 1.");
  const count = Number(db.prepare("SELECT COUNT(*) AS n FROM investplus_plans WHERE guild_id=? AND active=1").get(guildId).n);
  if (count >= LIMITS.maxPlans) throw new Error(`${LIMITS.maxPlans} formules actives au maximum.`);
  if (planByName(guildId, f.name)) throw new Error(`Une formule « ${f.name} » existe déjà.`);
  const info = db.prepare(`INSERT INTO investplus_plans(guild_id,name,description,benefits,price,period_days,role_id,pay_mode,active,created_at,real_price)
    VALUES(?,?,?,?,?,?,?,?,1,?,?)`).run(guildId, f.name, f.description, f.benefits, f.price, f.periodDays, f.roleId, f.payMode, now, f.realPrice ?? null);
  return planById(guildId, Number(info.lastInsertRowid));
}

export function updatePlan(guildId, planId, fields) {
  const plan = planById(guildId, planId);
  if (!plan) throw new Error("Formule introuvable.");
  const f = { ...plan, ...checkPlanFields(fields) };
  if (payableInPnd(f) && f.price < 1) throw new Error("Une formule payable en PND doit avoir un prix d'au moins 1.");
  const clash = planByName(guildId, f.name);
  if (clash && clash.id !== plan.id) throw new Error(`Une formule « ${f.name} » existe déjà.`);
  db.prepare(`UPDATE investplus_plans SET name=?, description=?, benefits=?, price=?, period_days=?, role_id=?, pay_mode=?, real_price=? WHERE guild_id=? AND id=?`)
    .run(f.name, f.description, f.benefits, f.price, f.periodDays, f.roleId, f.payMode, f.realPrice ?? null, guildId, plan.id);
  return planById(guildId, plan.id);
}

/** Archiver ne coupe pas les abonnés en cours : la formule n'est simplement plus proposée. */
export function setPlanActive(guildId, planId, active) {
  const plan = planById(guildId, planId);
  if (!plan) throw new Error("Formule introuvable.");
  db.prepare("UPDATE investplus_plans SET active=? WHERE guild_id=? AND id=?").run(active ? 1 : 0, guildId, plan.id);
  return planById(guildId, plan.id);
}

export function planById(guildId, planId) {
  return rowToPlan(db.prepare("SELECT * FROM investplus_plans WHERE guild_id=? AND id=?").get(guildId, Number(planId)));
}

export function planByName(guildId, name) {
  return rowToPlan(db.prepare("SELECT * FROM investplus_plans WHERE guild_id=? AND name=? COLLATE NOCASE").get(guildId, String(name ?? "").trim()));
}

/** Retrouve une formule par numéro (« 3 », « #3 ») ou par nom. */
export function findPlan(guildId, query) {
  const text = String(query ?? "").trim();
  const id = /^#?(\d{1,9})$/.exec(text);
  return (id && planById(guildId, Number(id[1]))) || planByName(guildId, text) || null;
}

export function listPlans(guildId, { includeArchived = false } = {}) {
  return db.prepare(`SELECT * FROM investplus_plans WHERE guild_id=? ${includeArchived ? "" : "AND active=1"} ORDER BY active DESC, price, id`)
    .all(guildId).map(rowToPlan);
}

export function benefitLines(plan) {
  return String(plan?.benefits ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
}

const rowToSub = (row) => row && ({
  guildId: row.guild_id, userId: row.user_id, planId: Number(row.plan_id), status: row.status,
  startedAt: Number(row.started_at), expiresAt: row.expires_at == null ? null : Number(row.expires_at),
  pausedRemaining: row.paused_remaining == null ? null : Number(row.paused_remaining),
  reminded: Boolean(row.reminded), note: row.note ?? "", updatedBy: row.updated_by ?? null, updatedAt: Number(row.updated_at),
});

export function subscriptionOf(guildId, userId) {
  return rowToSub(db.prepare("SELECT * FROM investplus_subscriptions WHERE guild_id=? AND user_id=?").get(guildId, userId));
}

export function addHistory({ guildId, userId, kind, planId = null, amount = 0, detail = null, actorId = null }, now = Date.now()) {
  db.prepare("INSERT INTO investplus_history(guild_id,user_id,kind,plan_id,amount,detail,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(guildId, userId, kind, planId, amount, detail ? String(detail).slice(0, 300) : null, actorId, now);
}

export function historyOf(guildId, userId, limit = 10) {
  return db.prepare("SELECT * FROM investplus_history WHERE guild_id=? AND user_id=? ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(guildId, userId, limit).map((row) => ({ kind: row.kind, planId: row.plan_id == null ? null : Number(row.plan_id), amount: Number(row.amount), detail: row.detail, actorId: row.actor_id, createdAt: Number(row.created_at) }));
}

/**
 * Nouvelle échéance, pure. Même formule encore active : on prolonge à partir de
 * l'échéance actuelle (aucun jour perdu). Sinon on repart d'aujourd'hui.
 * `days` = null : sans échéance.
 */
export function nextExpiry(current, planId, days, now = Date.now()) {
  if (days == null) return null;
  const sameAndRunning = current && current.status === "active" && current.planId === planId;
  if (sameAndRunning && current.expiresAt == null) return null;
  const base = sameAndRunning && current.expiresAt > now ? current.expiresAt : now;
  return base + days * DAY;
}

function writeSub(guildId, userId, fields, actorId, now) {
  db.prepare(`INSERT INTO investplus_subscriptions(guild_id,user_id,plan_id,status,started_at,expires_at,paused_remaining,reminded,note,updated_by,updated_at)
    VALUES(@guildId,@userId,@planId,@status,@startedAt,@expiresAt,@pausedRemaining,@reminded,@note,@actorId,@now)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET plan_id=excluded.plan_id, status=excluded.status, started_at=excluded.started_at,
    expires_at=excluded.expires_at, paused_remaining=excluded.paused_remaining, reminded=excluded.reminded, note=excluded.note,
    updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
    .run({
      guildId, userId, planId: fields.planId, status: fields.status, startedAt: fields.startedAt, expiresAt: fields.expiresAt ?? null,
      pausedRemaining: fields.pausedRemaining ?? null, reminded: fields.reminded ? 1 : 0, note: fields.note ?? "", actorId, now,
    });
  return subscriptionOf(guildId, userId);
}

/**
 * Attribue (ou prolonge) une formule. `days` absent : durée de la formule ;
 * `days` = 0 : sans échéance. Retourne { subscription, previous, kind }.
 */
export function grantSubscription({ guildId, userId, planId, days, actorId = null, note, amount = 0, kind: forcedKind = null }, now = Date.now()) {
  const plan = planById(guildId, planId);
  if (!plan) throw new Error("Formule introuvable.");
  const length = days === undefined || days === null ? plan.periodDays : Number(days);
  if (!Number.isSafeInteger(length) || length < 0 || length > LIMITS.maxDays) throw new Error(`Durée invalide : 0 à ${LIMITS.maxDays} jours (0 = sans fin).`);
  return transaction(() => {
    const previous = subscriptionOf(guildId, userId);
    const renewing = previous?.status === "active" && previous.planId === plan.id;
    const expiresAt = nextExpiry(previous, plan.id, length === 0 ? null : length, now);
    const subscription = writeSub(guildId, userId, {
      planId: plan.id, status: "active", startedAt: renewing ? previous.startedAt : now, expiresAt,
      note: note === undefined ? (previous?.note ?? "") : cleanText(note, LIMITS.note, "La note"),
    }, actorId, now);
    const kind = forcedKind ?? (renewing ? "prolongation" : previous?.status === "active" ? "changement" : "attribution");
    addHistory({ guildId, userId, kind, planId: plan.id, amount, detail: length === 0 ? "sans échéance" : `${length} j`, actorId }, now);
    return { subscription, previous, plan, kind };
  });
}

/** Le membre paie lui-même sa formule en PND (débit atomique, journalisé dans l'économie). */
export function payWithPnd({ guildId, userId, planId }, now = Date.now()) {
  const plan = planById(guildId, planId);
  if (!plan || !plan.active) throw new Error("Formule introuvable ou plus proposée.");
  if (!payableInPnd(plan)) throw new Error("Cette formule ne se paie pas en PND : choisis « Je la veux (paiement réel) ».");
  return transaction(() => {
    grantPnd(guildId, userId, -plan.price, "investplus_abonnement");
    return grantSubscription({ guildId, userId, planId: plan.id, actorId: userId, amount: plan.price, kind: "paiement" }, now);
  });
}

/**
 * Un membre offre une formule payable en PND à un autre membre (débit du donateur,
 * abonnement du bénéficiaire, une ligne d'historique chez chacun). Une autre formule
 * déjà active ou en pause chez le bénéficiaire n'est jamais écrasée.
 */
export function giftWithPnd({ guildId, giverId, userId, planId }, now = Date.now()) {
  if (String(giverId) === String(userId)) throw new Error("Pour toi-même, utilise le paiement de ta formule.");
  const plan = planById(guildId, planId);
  if (!plan || !plan.active) throw new Error("Formule introuvable ou plus proposée.");
  if (!payableInPnd(plan)) throw new Error("Seules les formules payables en PND peuvent être offertes.");
  const current = subscriptionOf(guildId, userId);
  if (current?.status === "paused") throw new Error("L'abonnement de ce membre est en pause : impossible de lui offrir une formule maintenant.");
  if (current?.status === "active" && current.planId !== plan.id) throw new Error("Ce membre a déjà une autre formule active : offre-lui la même formule pour la prolonger.");
  return transaction(() => {
    grantPnd(guildId, giverId, -plan.price, "investplus_cadeau");
    const result = grantSubscription({ guildId, userId, planId: plan.id, actorId: giverId, amount: plan.price, kind: "cadeau" }, now);
    addHistory({ guildId, userId: giverId, kind: "cadeau_offert", planId: plan.id, amount: plan.price, detail: `pour ${userId}`, actorId: giverId }, now);
    return result;
  });
}

export function pauseSubscription(guildId, userId, actorId, now = Date.now()) {
  const sub = subscriptionOf(guildId, userId);
  if (sub?.status !== "active") throw new Error("Aucun abonnement actif à mettre en pause.");
  const remaining = sub.expiresAt == null ? null : Math.max(0, sub.expiresAt - now);
  const next = writeSub(guildId, userId, { ...sub, status: "paused", expiresAt: null, pausedRemaining: remaining, reminded: 0 }, actorId, now);
  addHistory({ guildId, userId, kind: "pause", planId: sub.planId, actorId }, now);
  return next;
}

export function resumeSubscription(guildId, userId, actorId, now = Date.now()) {
  const sub = subscriptionOf(guildId, userId);
  if (sub?.status !== "paused") throw new Error("Cet abonnement n'est pas en pause.");
  const expiresAt = sub.pausedRemaining == null ? null : now + sub.pausedRemaining;
  const next = writeSub(guildId, userId, { ...sub, status: "active", expiresAt, pausedRemaining: null, reminded: 0 }, actorId, now);
  addHistory({ guildId, userId, kind: "reprise", planId: sub.planId, actorId }, now);
  return next;
}

export function cancelSubscription(guildId, userId, actorId, reason = "", now = Date.now()) {
  const sub = subscriptionOf(guildId, userId);
  if (!sub || !["active", "paused"].includes(sub.status)) throw new Error("Aucun abonnement en cours à résilier.");
  const next = writeSub(guildId, userId, { ...sub, status: "cancelled", expiresAt: now, pausedRemaining: null }, actorId, now);
  addHistory({ guildId, userId, kind: "resiliation", planId: sub.planId, detail: cleanText(reason, LIMITS.note, "La raison") || null, actorId }, now);
  return next;
}

export function setSubscriptionNote(guildId, userId, note, actorId, now = Date.now()) {
  const sub = subscriptionOf(guildId, userId);
  if (!sub) throw new Error("Ce membre n'a pas d'abonnement.");
  return writeSub(guildId, userId, { ...sub, note: cleanText(note, LIMITS.note, "La note") }, actorId, now);
}

/** Abonnements actifs arrivés à échéance : passés en « expiré » et renvoyés pour suite (rôle, panneau). */
// Renouvellement automatique (choix du membre) : à l'échéance, une formule payable en PND est
// repayée si le solde suffit ; sinon elle expire normalement. Un seul essai par échéance.
db.exec("CREATE TABLE IF NOT EXISTS investplus_autorenew (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (guild_id, user_id))");
export function setAutoRenew(guildId, userId, enabled) {
  db.prepare("INSERT INTO investplus_autorenew(guild_id, user_id, enabled) VALUES (?,?,?) ON CONFLICT(guild_id, user_id) DO UPDATE SET enabled=excluded.enabled").run(guildId, userId, enabled ? 1 : 0);
  return enabled;
}
export function autoRenewEnabled(guildId, userId) {
  return Boolean(db.prepare("SELECT enabled FROM investplus_autorenew WHERE guild_id=? AND user_id=?").get(guildId, userId)?.enabled);
}
/** Tries to renew the due subscriptions of members who opted in. Returns { renewed, failed }. */
export function autoRenewDue(now = Date.now()) {
  const due = db.prepare(`SELECT s.* FROM investplus_subscriptions s JOIN investplus_autorenew a ON a.guild_id=s.guild_id AND a.user_id=s.user_id AND a.enabled=1
    WHERE s.status='active' AND s.expires_at IS NOT NULL AND s.expires_at<=? LIMIT 200`).all(now).map(rowToSub);
  const renewed = [];
  const failed = [];
  for (const sub of due) {
    try { payWithPnd({ guildId: sub.guildId, userId: sub.userId, planId: sub.planId }, now); renewed.push(sub); }
    catch (error) { failed.push({ ...sub, reason: error.message }); }
  }
  return { renewed, failed };
}

export function expireDueSubscriptions(now = Date.now()) {
  return transaction(() => {
    const rows = db.prepare("SELECT * FROM investplus_subscriptions WHERE status='active' AND expires_at IS NOT NULL AND expires_at<=? LIMIT 200").all(now).map(rowToSub);
    for (const sub of rows) {
      db.prepare("UPDATE investplus_subscriptions SET status='expired', updated_by=NULL, updated_at=? WHERE guild_id=? AND user_id=? AND status='active'").run(now, sub.guildId, sub.userId);
      addHistory({ guildId: sub.guildId, userId: sub.userId, kind: "expiration", planId: sub.planId }, now);
    }
    return rows;
  });
}

/** Abonnements qui expirent bientôt et pas encore prévenus (une seule fois par période). */
export function takeDueReminders(now = Date.now()) {
  return transaction(() => {
    const rows = db.prepare(`SELECT s.* FROM investplus_subscriptions s LEFT JOIN investplus_config c ON c.guild_id=s.guild_id
      WHERE s.status='active' AND s.reminded=0 AND s.expires_at IS NOT NULL AND s.expires_at>?
      AND s.expires_at - ? <= COALESCE(c.reminder_days, 3) * ${DAY} AND COALESCE(c.reminder_days, 3) > 0 LIMIT 200`).all(now, now).map(rowToSub);
    for (const sub of rows) db.prepare("UPDATE investplus_subscriptions SET reminded=1 WHERE guild_id=? AND user_id=?").run(sub.guildId, sub.userId);
    return rows;
  });
}

export function listSubscriptions(guildId, { status = null, limit = 25, offset = 0 } = {}) {
  const where = status ? "AND status=?" : "";
  const args = status ? [guildId, status, limit, offset] : [guildId, limit, offset];
  return db.prepare(`SELECT * FROM investplus_subscriptions WHERE guild_id=? ${where} ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, expires_at IS NULL, expires_at, updated_at DESC LIMIT ? OFFSET ?`)
    .all(...args).map(rowToSub);
}

/** Chiffres du tableau de bord administrateur. */
export function investStats(guildId, now = Date.now()) {
  const count = (sql, ...args) => Number(db.prepare(sql).get(guildId, ...args)?.n ?? 0);
  const byPlan = db.prepare(`SELECT p.id, p.name, p.price, p.period_days, p.pay_mode, COUNT(s.user_id) AS n FROM investplus_plans p
    LEFT JOIN investplus_subscriptions s ON s.plan_id=p.id AND s.guild_id=p.guild_id AND s.status='active'
    WHERE p.guild_id=? GROUP BY p.id ORDER BY p.active DESC, p.price, p.id`).all(guildId)
    .map((row) => ({ id: Number(row.id), name: row.name, price: Number(row.price), periodDays: Number(row.period_days), payMode: row.pay_mode, active: Number(row.n) }));
  // Équivalent sur 30 jours de ce que rapportent les abonnés actifs (prix ramené au mois).
  const monthly = byPlan.reduce((sum, p) => sum + Math.round((p.price * p.active * 30) / p.periodDays), 0);
  return {
    active: count("SELECT COUNT(*) AS n FROM investplus_subscriptions WHERE guild_id=? AND status='active'"),
    paused: count("SELECT COUNT(*) AS n FROM investplus_subscriptions WHERE guild_id=? AND status='paused'"),
    expiringSoon: count("SELECT COUNT(*) AS n FROM investplus_subscriptions WHERE guild_id=? AND status='active' AND expires_at IS NOT NULL AND expires_at<=?", now + 7 * DAY),
    endedLast30: count("SELECT COUNT(*) AS n FROM investplus_subscriptions WHERE guild_id=? AND status IN ('expired','cancelled') AND updated_at>=?", now - 30 * DAY),
    paidLast30: count("SELECT COALESCE(SUM(amount),0) AS n FROM investplus_history WHERE guild_id=? AND kind IN ('paiement','cadeau') AND created_at>=?", now - 30 * DAY),
    openRequests: count("SELECT COUNT(*) AS n FROM investplus_requests WHERE guild_id=? AND status='open'"),
    spaces: count("SELECT COUNT(*) AS n FROM investplus_spaces WHERE guild_id=?"),
    monthly,
    byPlan,
  };
}

// --- Espaces privés -------------------------------------------------------

export function spaceOf(guildId, userId) {
  const row = db.prepare("SELECT * FROM investplus_spaces WHERE guild_id=? AND user_id=?").get(guildId, userId);
  return row ? { guildId, userId, channelId: row.channel_id, panelMessageId: row.panel_message_id ?? null, createdAt: Number(row.created_at) } : null;
}

export function spaceByChannel(channelId) {
  const row = db.prepare("SELECT * FROM investplus_spaces WHERE channel_id=?").get(String(channelId ?? ""));
  return row ? { guildId: row.guild_id, userId: row.user_id, channelId: row.channel_id, panelMessageId: row.panel_message_id ?? null, createdAt: Number(row.created_at) } : null;
}

export function saveSpace(guildId, userId, channelId, panelMessageId = null, now = Date.now()) {
  db.prepare(`INSERT INTO investplus_spaces(guild_id,user_id,channel_id,panel_message_id,created_at) VALUES(?,?,?,?,?)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET channel_id=excluded.channel_id, panel_message_id=excluded.panel_message_id`)
    .run(guildId, userId, channelId, panelMessageId, now);
  return spaceOf(guildId, userId);
}

export function setSpacePanel(guildId, userId, panelMessageId) {
  db.prepare("UPDATE investplus_spaces SET panel_message_id=? WHERE guild_id=? AND user_id=?").run(panelMessageId, guildId, userId);
}

export function deleteSpace(guildId, userId) {
  db.prepare("DELETE FROM investplus_spaces WHERE guild_id=? AND user_id=?").run(guildId, userId);
}

export function deleteSpaceByChannel(channelId) {
  db.prepare("DELETE FROM investplus_spaces WHERE channel_id=?").run(String(channelId ?? ""));
}

export function listSpaces(guildId) {
  return db.prepare("SELECT user_id, channel_id FROM investplus_spaces WHERE guild_id=?").all(guildId).map((row) => ({ userId: row.user_id, channelId: row.channel_id }));
}

/** Nom de salon Discord sûr pour l'espace d'un membre. */
export function spaceChannelName(displayName, userId) {
  const base = String(displayName ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  return `💼・${base || String(userId).slice(-6)}`;
}

// --- Demandes des membres ---------------------------------------------------

export function createRequest({ guildId, userId, kind, planId = null, body = "" }, now = Date.now()) {
  if (!Object.hasOwn(REQUEST_KINDS, kind)) throw new Error("Type de demande inconnu.");
  const open = Number(db.prepare("SELECT COUNT(*) AS n FROM investplus_requests WHERE guild_id=? AND user_id=? AND status='open'").get(guildId, userId).n);
  if (open >= 3) throw new Error("Tu as déjà 3 demandes en attente : l'administration va te répondre.");
  const info = db.prepare("INSERT INTO investplus_requests(guild_id,user_id,kind,plan_id,body,status,created_at) VALUES(?,?,?,?,?,'open',?)")
    .run(guildId, userId, kind, planId, cleanText(body, LIMITS.request, "Le message", { multiline: true }), now);
  return requestById(guildId, Number(info.lastInsertRowid));
}

export function requestById(guildId, id) {
  const row = db.prepare("SELECT * FROM investplus_requests WHERE guild_id=? AND id=?").get(guildId, Number(id));
  return row && { id: Number(row.id), guildId: row.guild_id, userId: row.user_id, kind: row.kind, planId: row.plan_id == null ? null : Number(row.plan_id), body: row.body ?? "", status: row.status, handledBy: row.handled_by ?? null, createdAt: Number(row.created_at), handledAt: row.handled_at == null ? null : Number(row.handled_at) };
}

export function closeRequest(guildId, id, status, actorId, now = Date.now()) {
  if (!["done", "refused"].includes(status)) throw new Error("Statut de demande invalide.");
  const changed = db.prepare("UPDATE investplus_requests SET status=?, handled_by=?, handled_at=? WHERE guild_id=? AND id=? AND status='open'").run(status, actorId, now, guildId, Number(id));
  if (!Number(changed.changes)) throw new Error("Demande introuvable ou déjà traitée.");
  return requestById(guildId, id);
}

export function listOpenRequests(guildId, limit = 10) {
  return db.prepare("SELECT id FROM investplus_requests WHERE guild_id=? AND status='open' ORDER BY created_at LIMIT ?").all(guildId, limit).map((row) => requestById(guildId, row.id));
}

/** Format commun des montants. Les formules « manuel » affichent le prix tel quel, sans unité imposée. */
export function formatPrice(plan) {
  const pnd = plan?.price ? `${Number(plan.price).toLocaleString("fr-FR")} PND` : "Gratuit";
  const real = plan?.realPrice ? String(plan.realPrice) : "paiement réel";
  if (plan?.payMode === "pnd") return pnd;
  if (plan?.payMode === "mixte") return `${pnd} ou ${real}`;
  return plan?.realPrice ? real : plan?.price ? `${Number(plan.price).toLocaleString("fr-FR")} (réglé hors bot)` : "Gratuit";
}

export function formatPeriod(days) {
  if (days % 365 === 0) return days === 365 ? "par an" : `tous les ${days / 365} ans`;
  if (days % 30 === 0) return days === 30 ? "par mois" : `tous les ${days / 30} mois`;
  if (days % 7 === 0) return days === 7 ? "par semaine" : `toutes les ${days / 7} semaines`;
  return `tous les ${days} jours`;
}
