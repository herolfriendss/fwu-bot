import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "pnd-investplus-")), "economy.sqlite");
const { db } = await import("../database.js");
const ip = await import("./investplus.js");
const { isInvestAdmin, INVESTPLUS_COMMANDS, plansEmbed, subscriptionEmbed, planRoleRefusal } = await import("./investplus-commands.js");
const { slashCommandOwner, parsePrefixedMessage, DEFAULT_PREFIXES, BOT_PROFILES } = await import("../bot-runtime.js");
const catalog = await import("../../src/lib/slash-commands.ts");
const SLASH_COMMANDS = [...catalog.SLASH_COMMANDS, ...catalog.EXTRA_SLASH_COMMANDS];

const G = "100000000000000001";
const U = "200000000000000001";
const V = "200000000000000002";
const T0 = Date.UTC(2026, 10, 25, 12);
const { DAY } = ip;
const fresh = () => {
  for (const table of ["investplus_plans", "investplus_subscriptions", "investplus_spaces", "investplus_history", "investplus_requests", "investplus_config"]) db.prepare(`DELETE FROM ${table}`).run();
};

test("Invest + est un bot à part entière : profil, commandes slash et préfixe $", () => {
  assert.equal(BOT_PROFILES.investplus.tokenEnv, "PND_INVESTPLUS_TOKEN");
  assert.equal(DEFAULT_PREFIXES.investplus, "$");
  for (const name of INVESTPLUS_COMMANDS) {
    assert.equal(slashCommandOwner(name), "investplus", name);
    const def = SLASH_COMMANDS.find((c) => c.name === name);
    assert.ok(def, `/${name} est déclaré`);
    assert.ok(def.options.length <= 25, `/${name} reste sous la limite Discord de 25 sous-commandes`);
  }
  assert.equal(SLASH_COMMANDS.find((c) => c.name === "investadmin").defaultMemberPermissions, "32", "caché aux membres par défaut (Gérer le serveur)");
  assert.equal(slashCommandOwner("invest"), "fisc", "l'/invest de l'économie reste au FISC");
  assert.equal(parsePrefixedMessage("$abonnement", DEFAULT_PREFIXES).canonical, "=abonnement");
});

test("formules : création, unicité, validation, archivage", () => {
  fresh();
  const gold = ip.createPlan(G, { name: "Gold", price: 500, periodDays: 30, payMode: "pnd", benefits: "Salon privé ; Analyse mensuelle", description: "La formule complète" }, T0);
  assert.equal(gold.name, "Gold");
  assert.deepEqual(ip.benefitLines(gold), ["Salon privé", "Analyse mensuelle"]);
  assert.throws(() => ip.createPlan(G, { name: "gold", price: 1, periodDays: 30 }), /existe déjà/, "insensible à la casse");
  assert.throws(() => ip.createPlan(G, { name: "Free PND", price: 0, periodDays: 30, payMode: "pnd" }), /prix d'au moins 1/);
  assert.throws(() => ip.createPlan(G, { name: "X", price: -1, periodDays: 30 }), /Prix invalide/);
  assert.throws(() => ip.createPlan(G, { name: "X", price: 1, periodDays: 0 }), /Durée invalide/);
  assert.throws(() => ip.createPlan(G, { name: "  ", price: 1, periodDays: 3 }), /obligatoire/);
  const mention = ip.createPlan(G, { name: "Promo @everyone", price: 0, periodDays: 7 });
  assert.doesNotMatch(mention.name, /@everyone/, "aucune mention de masse dans un nom");
  assert.equal(ip.findPlan(G, `#${gold.id}`).id, gold.id);
  assert.equal(ip.findPlan(G, "GOLD").id, gold.id);
  ip.setPlanActive(G, gold.id, false);
  assert.equal(ip.listPlans(G).some((p) => p.id === gold.id), false, "archivée = plus proposée");
  assert.equal(ip.listPlans(G, { includeArchived: true }).some((p) => p.id === gold.id), true);
  const updated = ip.updatePlan(G, gold.id, { price: 600, benefits: "Un ; Deux ; Trois" });
  assert.equal(updated.price, 600);
  assert.equal(ip.benefitLines(updated).length, 3);
  assert.equal(ip.formatPeriod(30), "par mois");
  assert.equal(ip.formatPeriod(365), "par an");
  assert.equal(ip.formatPeriod(14), "toutes les 2 semaines");
});

test("échéance : prolonger la même formule ne fait perdre aucun jour", () => {
  assert.equal(ip.nextExpiry(null, 1, 30, T0), T0 + 30 * DAY);
  const running = { status: "active", planId: 1, expiresAt: T0 + 5 * DAY };
  assert.equal(ip.nextExpiry(running, 1, 30, T0), T0 + 35 * DAY, "on part de l'échéance actuelle");
  assert.equal(ip.nextExpiry(running, 2, 30, T0), T0 + 30 * DAY, "changement de formule : on repart d'aujourd'hui");
  assert.equal(ip.nextExpiry({ ...running, status: "expired" }, 1, 30, T0), T0 + 30 * DAY);
  assert.equal(ip.nextExpiry(running, 1, null, T0), null, "sans échéance");
});

test("cycle de vie : attribution, prolongation, pause, reprise, résiliation, historique", () => {
  fresh();
  const plan = ip.createPlan(G, { name: "Silver", price: 100, periodDays: 30 }, T0);
  let r = ip.grantSubscription({ guildId: G, userId: U, planId: plan.id, actorId: "admin" }, T0);
  assert.equal(r.kind, "attribution");
  assert.equal(r.subscription.expiresAt, T0 + 30 * DAY);
  r = ip.grantSubscription({ guildId: G, userId: U, planId: plan.id, days: 10, actorId: "admin" }, T0 + DAY);
  assert.equal(r.kind, "prolongation");
  assert.equal(r.subscription.expiresAt, T0 + 40 * DAY);
  assert.equal(r.subscription.startedAt, T0, "la date d'adhésion ne bouge pas");
  const paused = ip.pauseSubscription(G, U, "admin", T0 + 10 * DAY);
  assert.equal(paused.status, "paused");
  assert.equal(paused.pausedRemaining, 30 * DAY);
  const resumed = ip.resumeSubscription(G, U, "admin", T0 + 20 * DAY);
  assert.equal(resumed.expiresAt, T0 + 50 * DAY, "les jours restants sont rendus");
  assert.throws(() => ip.resumeSubscription(G, U, "admin"), /pas en pause/);
  const cancelled = ip.cancelSubscription(G, U, "admin", "fin de collaboration", T0 + 21 * DAY);
  assert.equal(cancelled.status, "cancelled");
  assert.throws(() => ip.cancelSubscription(G, U, "admin"), /Aucun abonnement en cours/);
  assert.deepEqual(ip.historyOf(G, U).map((h) => h.kind), ["resiliation", "reprise", "pause", "prolongation", "attribution"]);
  r = ip.grantSubscription({ guildId: G, userId: U, planId: plan.id, days: 0, actorId: "admin" }, T0 + 22 * DAY);
  assert.equal(r.subscription.expiresAt, null, "0 jour = sans échéance");
  assert.throws(() => ip.grantSubscription({ guildId: G, userId: U, planId: 999999 }), /introuvable/);
});

test("paiement en PND : débit atomique, refus si solde insuffisant, formules manuelles refusées", () => {
  fresh();
  const pnd = ip.createPlan(G, { name: "Membre PND", price: 300, periodDays: 7, payMode: "pnd" }, T0);
  const manual = ip.createPlan(G, { name: "Privé", price: 50, periodDays: 30 }, T0);
  db.prepare("INSERT OR REPLACE INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,?,0)").run(G, V, 400);
  const r = ip.payWithPnd({ guildId: G, userId: V, planId: pnd.id }, T0);
  assert.equal(r.kind, "paiement");
  assert.equal(Number(db.prepare("SELECT balance FROM wallets WHERE guild_id=? AND user_id=?").get(G, V).balance), 100);
  assert.throws(() => ip.payWithPnd({ guildId: G, userId: V, planId: pnd.id }, T0 + 1), /insuffisant/i);
  assert.equal(ip.subscriptionOf(G, V).expiresAt, T0 + 7 * DAY, "un paiement refusé ne prolonge rien");
  assert.throws(() => ip.payWithPnd({ guildId: G, userId: V, planId: manual.id }), /ne se paie pas en PND/);
  assert.equal(ip.investStats(G, T0).paidLast30, 300);
});

test("offrir une formule : le donateur paie, le bénéficiaire est abonné, jamais d'écrasement", () => {
  fresh();
  const W = "200000000000000003";
  const pnd = ip.createPlan(G, { name: "Membre PND", price: 300, periodDays: 7, payMode: "pnd" }, T0);
  const other = ip.createPlan(G, { name: "Autre PND", price: 100, periodDays: 7, payMode: "pnd" }, T0);
  const manual = ip.createPlan(G, { name: "Privé", price: 50, periodDays: 30 }, T0);
  db.prepare("INSERT OR REPLACE INTO wallets(guild_id,user_id,balance,bank) VALUES(?,?,?,0)").run(G, V, 700);
  assert.throws(() => ip.giftWithPnd({ guildId: G, giverId: V, userId: V, planId: pnd.id }, T0), /toi-même/);
  assert.throws(() => ip.giftWithPnd({ guildId: G, giverId: V, userId: W, planId: manual.id }, T0), /payables en PND/);
  const r = ip.giftWithPnd({ guildId: G, giverId: V, userId: W, planId: pnd.id }, T0);
  assert.equal(r.kind, "cadeau");
  assert.equal(ip.subscriptionOf(G, W).expiresAt, T0 + 7 * DAY);
  assert.ok(!ip.subscriptionOf(G, V), "le donateur n'est pas abonné");
  assert.equal(Number(db.prepare("SELECT balance FROM wallets WHERE guild_id=? AND user_id=?").get(G, V).balance), 400);
  assert.deepEqual(ip.historyOf(G, V).map((h) => h.kind), ["cadeau_offert"]);
  assert.throws(() => ip.giftWithPnd({ guildId: G, giverId: V, userId: W, planId: other.id }, T0 + 1), /autre formule active/);
  ip.giftWithPnd({ guildId: G, giverId: V, userId: W, planId: pnd.id }, T0 + 2);
  assert.equal(ip.subscriptionOf(G, W).expiresAt, T0 + 14 * DAY, "même formule : prolongée");
  assert.throws(() => ip.giftWithPnd({ guildId: G, giverId: V, userId: W, planId: pnd.id }, T0 + 3), /insuffisant/i);
  assert.equal(ip.subscriptionOf(G, W).expiresAt, T0 + 14 * DAY, "un cadeau refusé ne prolonge rien");
  ip.pauseSubscription(G, W, "admin", T0 + 4);
  assert.throws(() => ip.giftWithPnd({ guildId: G, giverId: V, userId: W, planId: pnd.id }, T0 + 5), /en pause/);
  assert.equal(ip.investStats(G, T0 + 5).paidLast30, 600);
});

test("tâches planifiées : un seul rappel par période, puis expiration", () => {
  fresh();
  ip.saveInvestConfig(G, { reminderDays: 3 });
  const plan = ip.createPlan(G, { name: "Court", price: 0, periodDays: 5 }, T0);
  ip.grantSubscription({ guildId: G, userId: U, planId: plan.id }, T0);
  assert.equal(ip.takeDueReminders(T0 + DAY).length, 0, "trop tôt");
  assert.equal(ip.takeDueReminders(T0 + 3 * DAY).length, 1);
  assert.equal(ip.takeDueReminders(T0 + 4 * DAY).length, 0, "déjà prévenu");
  assert.equal(ip.expireDueSubscriptions(T0 + 4 * DAY).length, 0);
  const expired = ip.expireDueSubscriptions(T0 + 5 * DAY);
  assert.equal(expired.length, 1);
  assert.equal(ip.subscriptionOf(G, U).status, "expired");
  assert.equal(ip.expireDueSubscriptions(T0 + 6 * DAY).length, 0, "une seule fois");
  ip.grantSubscription({ guildId: G, userId: U, planId: plan.id }, T0 + 6 * DAY);
  assert.equal(ip.takeDueReminders(T0 + 9 * DAY).length, 1, "le renouvellement réarme le rappel");
  ip.saveInvestConfig(G, { reminderDays: 0 });
  ip.grantSubscription({ guildId: G, userId: V, planId: plan.id }, T0 + 6 * DAY);
  assert.equal(ip.takeDueReminders(T0 + 10 * DAY).length, 0, "rappel désactivé");
});

test("demandes des membres : 3 en attente au maximum, traitement une seule fois", () => {
  fresh();
  const a = ip.createRequest({ guildId: G, userId: U, kind: "question", body: "Bonjour @here" }, T0);
  assert.doesNotMatch(a.body, /@here/);
  ip.createRequest({ guildId: G, userId: U, kind: "renouveler" }, T0);
  ip.createRequest({ guildId: G, userId: U, kind: "changer" }, T0);
  assert.throws(() => ip.createRequest({ guildId: G, userId: U, kind: "question" }), /3 demandes/);
  assert.throws(() => ip.createRequest({ guildId: G, userId: V, kind: "piratage" }), /inconnu/);
  assert.equal(ip.closeRequest(G, a.id, "done", "admin").status, "done");
  assert.throws(() => ip.closeRequest(G, a.id, "refused", "admin"), /déjà traitée/);
  assert.equal(ip.listOpenRequests(G).length, 2);
});

test("espaces privés : un par membre, nom de salon sûr", () => {
  fresh();
  ip.saveSpace(G, U, "300000000000000001", null, T0);
  ip.saveSpace(G, U, "300000000000000002", null, T0);
  assert.equal(ip.listSpaces(G).length, 1);
  assert.equal(ip.spaceByChannel("300000000000000002").userId, U);
  ip.deleteSpaceByChannel("300000000000000002");
  assert.equal(ip.spaceOf(G, U), null);
  assert.equal(ip.spaceChannelName("Éloïse ✨ Dupont", U), "💼・eloise-dupont");
  assert.equal(ip.spaceChannelName("✨✨", U), "💼・000001");
});

test("affichage : fiche membre sans note interne, fiche admin avec", () => {
  fresh();
  const plan = ip.createPlan(G, { name: "Gold", price: 10, periodDays: 30, benefits: "Accès VIP", description: "Tout compris" }, T0);
  ip.grantSubscription({ guildId: G, userId: U, planId: plan.id, note: "paie par virement" }, T0);
  const member = subscriptionEmbed(G, U, { now: T0 }).toJSON();
  const admin = subscriptionEmbed(G, U, { admin: true, now: T0 }).toJSON();
  assert.ok(member.fields.some((f) => f.name === "Tes avantages" && /Accès VIP/.test(f.value)));
  assert.ok(member.fields.some((f) => f.name === "À quoi ça sert"));
  assert.equal(member.fields.some((f) => /paie par virement/.test(f.value)), false, "la note reste interne");
  assert.ok(admin.fields.some((f) => /paie par virement/.test(f.value)));
  assert.match(subscriptionEmbed(G, V).toJSON().fields[0].value, /Aucun/);
  assert.equal(plansEmbed(G).toJSON().fields.length, 1);
});

test("administration : OWNER, propriétaire, Administrateur ou Gérer le serveur seulement", () => {
  const env = { PND_OWNER_DISCORD_ID: "123456789012345678" };
  const member = (id, perms = []) => ({ id, guild: { ownerId: "999999999999999999" }, permissions: { has: (p) => perms.includes(p) } });
  assert.equal(isInvestAdmin(member("123456789012345678"), env), true);
  assert.equal(isInvestAdmin(member("999999999999999999"), env), true);
  assert.equal(isInvestAdmin(member("1", [8n]), env), true, "Administrateur");
  assert.equal(isInvestAdmin(member("1", [32n]), env), true, "Gérer le serveur");
  assert.equal(isInvestAdmin(member("1", [2048n]), env), false);
  assert.equal(isInvestAdmin(null, env), false);
});

test("rôle d'une formule : un rôle à permission sensible est refusé, même pour l'OWNER (attribution automatique)", async () => {
  const guild = { id: G, roles: { everyone: { id: G } } };
  const reason = await planRoleRefusal(guild, { id: "400000000000000001", managed: false, permissions: { bitfield: 8n, has: () => true, toArray: () => ["Administrator"] } }, null);
  assert.ok(reason, "rôle Administrateur refusé");
  assert.equal(await planRoleRefusal(guild, null, null), null);
});
