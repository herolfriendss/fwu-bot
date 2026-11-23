import assert from "node:assert/strict";
import test from "node:test";
import { db } from "./database.js";
import { addCentralLogObserver, sendCentralLog } from "./logs.js";
import {
  activeAfkSession,
  buildResumeEmbed,
  canUseResume,
  handleResumeInteraction,
  handleResumeMessage,
  parseAfkPrefix,
  pruneResumeEvents,
  recordResumeEvent,
  runAfkAction,
  severityOf,
  summarizeResume,
} from "./resume.js";

const OWNER = "100000000000000001";
const STAFF = "100000000000000002";
const MEMBER = "100000000000000003";
const SYS_ROLE = "200000000000000001";
process.env.PND_OWNER_DISCORD_ID = OWNER;

function reset() {
  db.exec("DELETE FROM resume_events; DELETE FROM afk_sessions;");
}

function member(id, roles = []) {
  const guild = { id: "g1", ownerId: "999999999999999999" };
  return { id, guild, roles: { cache: new Map(roles.map((r) => [r, {}])) }, permissions: { has: () => false } };
}

test("severity and routine filtering", () => {
  reset();
  assert.equal(severityOf({ title: "🚨 ACL risquée sur un salon" }), "high");
  assert.equal(severityOf({ title: "⛔ Membre banni", color: 0xef4444 }), "high");
  assert.equal(severityOf({ title: "⏳ Exclusion temporaire appliquée", color: 0xf59e0b }), "medium");
  assert.equal(severityOf({ title: "➕ Salon créé" }), "info");
  assert.equal(recordResumeEvent("g1", { title: "⚙️ DOG — commande utilisée" }), false, "bruit ignoré");
  assert.equal(recordResumeEvent("g1", { title: "" }), false);
  assert.equal(recordResumeEvent("g1", { title: "⛔ Membre banni", description: "Serveur source : **X** (`1`)\nMembre : <@5>", color: 0xef4444 }, 1_000), true);
  const row = db.prepare("SELECT category, severity, summary FROM resume_events").get();
  assert.deepEqual({ ...row }, { category: "moderation", severity: "high", summary: "Membre : <@5>" });
});

test("summary covers exactly the absence and puts alerts first", () => {
  reset();
  recordResumeEvent("g1", { title: "➕ Salon créé" }, 500); // before
  recordResumeEvent("g1", { title: "➕ Salon créé" }, 1_500);
  recordResumeEvent("g1", { title: "⏳ Exclusion temporaire appliquée", color: 0xf59e0b }, 1_600);
  recordResumeEvent("g1", { title: "🚨 Permission dangereuse accordée", color: 0xdc2626 }, 1_700);
  recordResumeEvent("g2", { title: "🚨 Permission dangereuse accordée" }, 1_700); // other guild
  const summary = summarizeResume("g1", 1_000, 2_000);
  assert.equal(summary.total, 3);
  assert.equal(summary.important.length, 2);
  assert.equal(summary.important[0].severity, "high");
  const embed = buildResumeEmbed(summary, { reason: "vacances", ended: true });
  assert.match(embed.title, /bon retour/);
  assert.match(embed.description, /vacances/);
  assert.equal(embed.color, 0xdc2626);
  assert.ok(embed.fields.some((f) => /priorité/.test(f.name)));
  const empty = buildResumeEmbed(summarizeResume("g1", 5_000, 6_000));
  assert.match(empty.description, /Rien d'important/);
});

test("afk on/off/resume lifecycle", () => {
  reset();
  assert.match(runAfkAction({ guildId: "g1", userId: STAFF, action: "on", reason: "réunion", now: 1_000 }).content, /Absence démarrée/);
  assert.match(runAfkAction({ guildId: "g1", userId: STAFF, action: "on", now: 1_100 }).content, /déjà absent/);
  recordResumeEvent("g1", { title: "⛔ Membre banni", color: 0xef4444 }, 1_200);
  const during = runAfkAction({ guildId: "g1", userId: STAFF, action: "resume", now: 1_300 });
  assert.equal(during.embed.fields.length, 2);
  assert.ok(activeAfkSession("g1", STAFF), "resume ne termine pas l'absence");
  const back = runAfkAction({ guildId: "g1", userId: STAFF, action: "off", now: 1_400 });
  assert.match(back.embed.title, /bon retour/);
  assert.equal(activeAfkSession("g1", STAFF), null);
  assert.match(runAfkAction({ guildId: "g1", userId: STAFF, action: "off", now: 1_500 }).content, /pas en absence/);
  const lastDay = runAfkAction({ guildId: "g1", userId: STAFF, action: "resume", hours: 500, now: 2_000 });
  assert.ok(lastDay.embed, "heures bornées à 168");
});

test("prefix parsing", () => {
  assert.deepEqual(parseAfkPrefix("=afk"), { action: "status", reason: "", hours: null });
  assert.deepEqual(parseAfkPrefix("=afk on en réunion"), { action: "on", reason: "en réunion", hours: null });
  assert.deepEqual(parseAfkPrefix("=AFK OFF"), { action: "off", reason: "", hours: null });
  assert.deepEqual(parseAfkPrefix("=afk resume 12"), { action: "resume", reason: "", hours: 12 });
  assert.deepEqual(parseAfkPrefix("=afk recap"), { action: "resume", reason: "", hours: null });
  assert.equal(parseAfkPrefix("=afkk"), null);
  assert.equal(parseAfkPrefix("=resume"), null, "=resume reste la musique");
});

test("access: OWNER and SYS+ yes, plain member no", () => {
  const settings = { sysPlus: { roleId: SYS_ROLE } };
  assert.equal(canUseResume(member(OWNER), settings), true);
  assert.equal(canUseResume(member(STAFF, [SYS_ROLE]), settings), true);
  assert.equal(canUseResume(member(MEMBER), settings), false);
  assert.equal(canUseResume(null, settings), false);
});

test("slash: private reply, refused for members", async () => {
  reset();
  const replies = [];
  const make = (userId, sub, roles = []) => ({
    isChatInputCommand: () => true,
    commandName: "afk",
    guild: { id: "g1" },
    guildId: "g1",
    member: member(userId, roles),
    user: { id: userId },
    options: { getSubcommand: () => sub, getString: () => null, getInteger: () => null },
    reply: async (payload) => { replies.push(payload); },
  });
  assert.equal(await handleResumeInteraction(make(MEMBER, "on"), {}), true);
  assert.match(replies.at(-1).content, /réservé/);
  assert.equal(replies.at(-1).ephemeral, true);
  await handleResumeInteraction(make(OWNER, "on"), {});
  await handleResumeInteraction(make(OWNER, "off"), {});
  assert.equal(replies.at(-1).ephemeral, true);
  assert.ok(replies.at(-1).embeds?.[0]);
  assert.equal(await handleResumeInteraction({ isChatInputCommand: () => true, commandName: "play" }, {}), false);
});

test("prefix: the summary goes by DM, never in the channel", async () => {
  reset();
  const replies = [];
  const dms = [];
  const reactions = [];
  const message = (content, dmWorks = true) => ({
    content,
    guild: { id: "g1" },
    member: member(OWNER),
    author: { id: OWNER, bot: false, send: async (p) => { if (!dmWorks) throw new Error("closed"); dms.push(p); } },
    reply: async (p) => { replies.push(p); },
    react: async (e) => { reactions.push(e); },
  });
  await handleResumeMessage(message("=afk on test"), {});
  assert.match(replies.at(-1).content, /Absence démarrée/);
  await handleResumeMessage(message("=afk resume"), {});
  assert.equal(dms.length, 1);
  assert.deepEqual(reactions, ["📬"]);
  const before = replies.length;
  assert.equal(replies.length, before);
  await handleResumeMessage(message("=afk off", false), {});
  assert.match(replies.at(-1).content, /MP/);
  assert.ok(!JSON.stringify(replies).includes("embeds"), "aucun résumé public");
  assert.equal(await handleResumeMessage(message("=play"), {}), false);
});

test("central logs feed RESUME through the observer, once", async () => {
  reset();
  const seen = [];
  const remove = addCentralLogObserver((guild, embed) => { seen.push(embed.title); recordResumeEvent(guild.id, embed); });
  await sendCentralLog({ id: "g1", channels: { fetch: async () => null } }, {}, { title: "⛔ Membre banni", color: 0xef4444 });
  remove();
  assert.deepEqual(seen, ["⛔ Membre banni"]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM resume_events").get().n, 1);
  assert.equal(pruneResumeEvents(Date.now() + 15 * 24 * 60 * 60_000), 1, "rétention 14 jours");
});
