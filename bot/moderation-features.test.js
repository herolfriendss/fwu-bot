// Tests des nouvelles commandes : GUARD (+ban…), FDPDLAVOC (;mv, ;accessall),
// FWU (/tempmute, quotas, embeds, règlement IA). Discord et la passerelle IA sont
// simulés ; les quotas utilisent un vrai PostgreSQL si SHARED_DATABASE_URL_TEST est défini.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { PermissionFlagsBits as P } from "discord.js";

process.env.PND_OWNER_DISCORD_ID = "100000000000000001";
process.env.SHARED_LOG_OUTBOX_PATH = join(mkdtempSync(join(tmpdir(), "fwu-mf-")), "outbox.jsonl");

const { parseGuardCommand, handleGuardPrefixCommand } = await import("./guard-commands.js");
const { parseMoveCommand, isAccessAllCommand, handleVoiceMoveCommand } = await import("./voice-move.js");
const { validateRules, generateRules, rulesToEmbedPages } = await import("./rules-ai.js");
const { validateEmbedData, parseColor, checkUrl, parseMessageLink, embedJsonToData, screeningPayload } = await import("./embeds.js");
const { parseQuotaValue, parseUserReference, formatQuotaTable, formatSanctionLine } = await import("./staff-moderation.js");
const { describeDiscordError } = await import("./moderation-actions.js");
const { closeSharedDb, initSharedDb, sharedQuery } = await import("./shared/db.js");
const { runSharedMigrations } = await import("./shared/migrate.js");
const { setRoleTiersForTests } = await import("./shared/tiers.js");

const TEST_URL = process.env.SHARED_DATABASE_URL_TEST;
const pgTest = TEST_URL ? test : test.skip;
const schema = `fwu_mf_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

before(async () => {
  if (!TEST_URL) return;
  const admin = new pg.Client({ connectionString: TEST_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  await initSharedDb({ SHARED_DATABASE_URL: TEST_URL, SHARED_DATABASE_SCHEMA: schema });
  await runSharedMigrations();
});
after(async () => {
  await closeSharedDb();
  if (!TEST_URL) return;
  const admin = new pg.Client({ connectionString: TEST_URL });
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

// ── Parsing ────────────────────────────────────────────────────────────────

test("GUARD : lecture de +ban / +kick / +unban / +purge", () => {
  assert.deepEqual(parseGuardCommand("=ban <@123456789012345678> spam répété"), { command: "ban", targetId: "123456789012345678", rest: "spam répété", rawArgs: "<@123456789012345678> spam répété" });
  assert.equal(parseGuardCommand("=kick 123456789012345678").targetId, "123456789012345678");
  assert.equal(parseGuardCommand("=unban abc").targetId, null);
  assert.equal(parseGuardCommand("=nettoyer 20").command, "purge");
  assert.equal(parseGuardCommand("=banane"), null);
  assert.equal(parseGuardCommand("=play"), null);
});

test(";mv accepte une mention ou un identifiant, et signale un identifiant invalide", () => {
  assert.deepEqual(parseMoveCommand("=mv <@123456789012345678>"), { targetId: "123456789012345678" });
  assert.deepEqual(parseMoveCommand("=mv <@!123456789012345678>"), { targetId: "123456789012345678" });
  assert.deepEqual(parseMoveCommand("=mv 123456789012345678"), { targetId: "123456789012345678" });
  assert.deepEqual(parseMoveCommand("=mv 12345"), { invalid: "12345" });
  assert.deepEqual(parseMoveCommand("=mv"), { missing: true });
  assert.equal(parseMoveCommand("=mvx 1"), null);
  assert.equal(isAccessAllCommand("=accessall"), true);
  assert.equal(isAccessAllCommand("=access @x"), false);
});

test("quotas : saisie des valeurs et des utilisateurs", () => {
  assert.equal(parseQuotaValue("4"), 4);
  assert.equal(parseQuotaValue("0"), 0);
  assert.equal(parseQuotaValue("illimité"), null);
  assert.throws(() => parseQuotaValue("-1"));
  assert.equal(parseUserReference("<@!123456789012345678>"), "123456789012345678");
  assert.equal(parseUserReference("123"), null);
  const table = formatQuotaTable([
    { command: "ban", tier: 50, maxUses: 0, windowSeconds: 86400, isDefault: true },
    { command: "ban", tier: 10, maxUses: 1, windowSeconds: 86400, isDefault: false },
  ]);
  assert.match(table, /\*\*ban\*\* — 50 % : interdit · 10 % : 1 \/ 1 j ✏️/);
  assert.match(formatSanctionLine({ createdAt: new Date(0), action: "tempmute", label: "Insultes graves", durationSeconds: 1800, moderatorId: "m", bot: "fwu", reason: "" }), /Insultes graves · 30 min · par <@m> \(fwu\)/);
});

test("erreurs Discord traduites clairement", () => {
  assert.match(describeDiscordError({ code: 50013 }), /Permission Discord manquante/);
  assert.match(describeDiscordError({ status: 429 }), /limite les requêtes/);
});

// ── Règlement IA ───────────────────────────────────────────────────────────

const RULES = [
  ["Respect mutuel", "Traite chaque membre avec courtoisie, même en cas de désaccord."],
  ["Aucune discrimination", "Les propos racistes, sexistes, homophobes ou validistes sont interdits."],
  ["Contenus interdits", "Aucun contenu pornographique, violent ou illégal, y compris en lien."],
  ["Pas de publicité", "La promotion d'autres serveurs ou services est interdite sans accord du staff."],
  ["Vie privée", "Ne partage jamais d'informations personnelles sur toi ou sur autrui."],
  ["Salons vocaux", "Pas de soundboard abusif ni de cris ; respecte la parole des autres."],
  ["Décisions du staff", "Conteste une sanction en ticket, jamais en public."],
].map(([title, description]) => ({ title, description }));

test("règlement : doublons et nombre de règles détectés", () => {
  assert.equal(validateRules(RULES).ok, true);
  const dup = validateRules([...RULES, { title: "respect mutuel", description: "Sois courtois avec tout le monde." }]);
  assert.equal(dup.ok, false);
  assert.match(dup.problems.join(), /doublon/);
  assert.equal(validateRules(RULES.slice(0, 3)).ok, false);
  const pages = rulesToEmbedPages(RULES, 200);
  assert.ok(pages.length > 1 && pages.every((page) => page.length <= 200));
  assert.match(pages[0], /^\*\*1\. Respect mutuel\*\*/);
});

test("règlement : le handler transmet les identifiants du serveur et l'authentification centrale", () => {
  assert.deepEqual(buildRulesGatewayInput(
    { id: "200000000000000001", name: "Communauté" },
    "100000000000000001",
    "Ton chaleureux",
    7,
    { apiUrl: "https://fwu.example/api/public/bot-sync", secret: "bot-sync-secret" },
  ), {
    apiUrl: "https://fwu.example/api/public/bot-sync",
    secret: "bot-sync-secret",
    guildId: "200000000000000001",
    userId: "100000000000000001",
    guildName: "Communauté",
    consignes: "Ton chaleureux",
    count: 7,
  });
});

test("règlement : génération via la passerelle FWU, sans clé ni abonnement Anthropic", async () => {
  const calls = [];
  const rules = RULES;
  const result = await generateRules({
    apiUrl: "https://fwu.example/api/public/bot-sync",
    secret: "bot-sync-secret",
    guildId: "200000000000000001",
    userId: "100000000000000001",
    guildName: "Communauté",
    consignes: "ton chaleureux",
    count: 7,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ rules }) };
    },
  });
  assert.deepEqual(result, RULES);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://fwu.example/api/public/bot-sync");
  assert.equal(calls[0].options.headers.Authorization, "Bearer bot-sync-secret");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.action, "ai-rules");
  assert.equal(body.guildId, "200000000000000001");
  assert.equal(body.userId, "100000000000000001");
  assert.equal(body.count, 7);
});

test("règlement : erreurs de passerelle et règles invalides remontent un message clair", async () => {
  const input = {
    apiUrl: "https://fwu.example/api/public/bot-sync",
    secret: "bot-sync-secret",
    guildId: "200000000000000001",
    userId: "100000000000000001",
    guildName: "Communauté",
    count: 7,
  };
  await assert.rejects(generateRules({ ...input, fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: "rate_limited" }) }) }), /saturé/);
  await assert.rejects(generateRules({ ...input, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ rules: RULES.slice(0, 2) }) }) }), /ne respecte pas/);
});

// ── Embeds ─────────────────────────────────────────────────────────────────

test("embeds : limites Discord, couleurs, URL HTTPS, import et screening", () => {
  assert.equal(parseColor("#6D28D9"), 0x6d28d9);
  assert.throws(() => parseColor("violet"));
  assert.throws(() => checkUrl("http://x.test/a.png", "Image"), /HTTPS/);
  assert.equal(checkUrl("", "Image"), null);
  assert.throws(() => validateEmbedData({}), /vide/);
  assert.throws(() => validateEmbedData({ title: "t", description: "x".repeat(4097) }), /4 096/);
  assert.throws(() => validateEmbedData({ title: "t", fields: Array.from({ length: 26 }, () => ({ name: "a", value: "b" })) }), /25 champs/);
  assert.throws(() => validateEmbedData({ description: "x".repeat(4000), fields: Array.from({ length: 3 }, () => ({ name: "a", value: "b".repeat(1000) })) }), /6 000/);
  assert.deepEqual(parseMessageLink("https://discord.com/channels/123456789012345678/223456789012345678/323456789012345678"), { guildId: "123456789012345678", channelId: "223456789012345678", messageId: "323456789012345678" });
  assert.equal(embedJsonToData({ title: "T", image: { url: "https://x/a.png" }, fields: [{ name: "a", value: "b" }] }).image, "https://x/a.png");
  const payload = screeningPayload(Array.from({ length: 20 }, (_, i) => ({ title: `R${i}`, description: "d" })), "Règles");
  assert.equal(payload.form_fields[0].field_type, "TERMS");
  assert.equal(payload.form_fields[0].values.length, 16);
});

// ── Discord simulé ─────────────────────────────────────────────────────────

// Le nom d'un rôle ne donne plus de palier : chaque rôle « N% » du test est associé via le cache.
const TEST_GUILD_ID = "200000000000000777";
const TEST_ROLE_TIERS = { "10% Modérateur": 10, "10%": 10, "50% Modérateur test": 50, "50%": 50, "100%": 100, "1%": 1, "5%": 5, "5% Administrateur": 5 };
function roleCache(names) {
  return new Map(names.map((name) => [`role:${name}`, { id: `role:${name}`, name }]));
}
function primeTestRoleTiers() {
  setRoleTiersForTests(TEST_GUILD_ID, Object.entries(TEST_ROLE_TIERS).map(([name, tier]) => [`role:${name}`, tier]));
}

function fakeVoiceWorld({ authorRoles = ["10% Modérateur"], authorPerms = [P.ViewChannel, P.Connect, P.MoveMembers], botPerms = [P.ViewChannel, P.Connect, P.MoveMembers, P.ManageRoles] } = {}) {
  primeTestRoleTiers();
  const replies = [];
  const moves = [];
  const channels = new Map();
  const members = new Map();
  const guild = {
    id: "200000000000000777", ownerId: "999", name: "Test",
    members: {
      cache: members,
      fetch: async (arg) => members.get(typeof arg === "object" ? arg.user : arg) ?? null,
      fetchMe: async () => members.get("bot"),
      get me() { return members.get("bot"); },
    },
    channels: { cache: channels },
  };
  // @everyone has the guild's id, as on Discord (=accessall opens the vocal to it).
  guild.roles = { everyone: { id: guild.id } };
  const makeChannel = (id, name) => {
    const overwrites = new Map();
    const channel = {
      id, name, guild,
      members: new Map(),
      permissionsFor: (member) => {
        const allowed = member.id === "bot" ? botPerms : member.id === "author" ? authorPerms : [P.ViewChannel];
        return { has: (bits) => (Array.isArray(bits) ? bits : [bits]).every((bit) => allowed.includes(bit)), bitfield: allowed.includes(P.ManageChannels) ? P.ManageChannels : 0n };
      },
      permissionOverwrites: {
        cache: overwrites,
        edit: async (member, perms) => { overwrites.set(member.id, { allow: { has: () => true }, perms }); },
      },
    };
    channels.set(id, channel);
    return channel;
  };
  const makeMember = (id, channel, roles = [], position = 1) => {
    const member = {
      id, guild, user: { id, bot: id === "bot", tag: `${id}#0001` },
      roles: { cache: roleCache(roles), highest: { position } },
      voice: {
        channel,
        async setChannel(target) { moves.push({ id, to: target.id }); member.voice.channel = target; },
      },
    };
    if (channel) channel.members.set(id, member);
    members.set(id, member);
    return member;
  };
  const message = (content, author) => ({
    content, guild, member: author, author: author.user, client: { user: { id: "bot" } },
    reply: async (payload) => { replies.push(typeof payload === "string" ? payload : payload.content); return null; },
  });
  return { guild, replies, moves, makeChannel, makeMember, message };
}

test(";mv : auteur hors vocal, membre introuvable, cible hors vocal, permission manquante", async () => {
  const world = fakeVoiceWorld({ authorPerms: [P.ViewChannel, P.Connect] });
  const a = world.makeChannel("a", "A");
  const b = world.makeChannel("b", "B");
  world.makeMember("bot", null, [], 10);
  const author = world.makeMember("author", null, ["10%"], 5);
  await handleVoiceMoveCommand(world.message("=mv 123456789012345678", author), null, {});
  assert.match(world.replies.at(-1), /Rejoins d'abord un salon vocal/);
  author.voice.channel = a;
  await handleVoiceMoveCommand(world.message("=mv 123456789012345678", author), null, {});
  assert.match(world.replies.at(-1), /introuvable/);
  world.makeMember("123456789012345678", null, [], 1);
  await handleVoiceMoveCommand(world.message("=mv <@123456789012345678>", author), null, {});
  assert.match(world.replies.at(-1), /n'est pas connecté en vocal/);
  world.members = null;
  const target = world.guild.members.cache.get("123456789012345678");
  target.voice.channel = b;
  await handleVoiceMoveCommand(world.message("=mv 123456789012345678", author), null, {});
  assert.match(world.replies.at(-1), /Déplacer des membres/);
  await handleVoiceMoveCommand(world.message("=mv abc", author), null, {});
  assert.match(world.replies.at(-1), /Identifiant invalide/);
  assert.deepEqual(world.moves, []);
});

pgTest(";mv : déplacement réussi, quota partagé appliqué, usage journalisé", async () => {
  const world = fakeVoiceWorld();
  const a = world.makeChannel("a", "A");
  const b = world.makeChannel("b", "B");
  world.makeMember("bot", null, [], 10);
  const author = world.makeMember("author", a, ["50% Modérateur test"], 5);
  const target = world.makeMember("123456789012345678", b, [], 1);
  for (let i = 0; i < 6; i++) {
    target.voice.channel = b;
    await handleVoiceMoveCommand(world.message("=mv 123456789012345678", author), null, { bot: "fdpdlavoc" });
  }
  assert.equal(world.moves.length, 5, "50 % : 5 ;mv / 10 min par défaut");
  assert.match(world.replies.at(-1), /Quota atteint/);
  const { rows } = await sharedQuery("SELECT outcome, count(*)::int AS n FROM command_usage WHERE command = 'mv' GROUP BY outcome ORDER BY outcome");
  assert.deepEqual(rows.map((r) => [r.outcome, r.n]), [["ok", 5], ["quota", 1]]);
});

pgTest(";accessall : accès donné à chaque membre présent, bots exclus, usage journalisé", async () => {
  const world = fakeVoiceWorld({ authorPerms: [P.ViewChannel, P.Connect, P.ManageChannels] });
  const room = world.makeChannel("room", "Salon");
  world.makeMember("bot", room, [], 10);
  const author = world.makeMember("author", room, [], 5);
  world.makeMember("300000000000000001", room);
  world.makeMember("300000000000000002", room);
  await handleVoiceMoveCommand(world.message("=accessall", author), null, { bot: "fdpdlavoc" });
  // @everyone (guild id) is opened too, then each human member present gets their own access.
  assert.deepEqual([...room.permissionOverwrites.cache.keys()].sort(), ["200000000000000777", "300000000000000001", "300000000000000002", "author"]);
  assert.match(world.replies.at(-1), /3 accès accordé/);
  const { rows } = await sharedQuery("SELECT outcome FROM command_usage WHERE command = 'accessall'");
  assert.deepEqual(rows.map((r) => r.outcome), ["ok"]);
});

test(";accessall : refusé sans « Gérer les salons »", async () => {
  const world = fakeVoiceWorld({ authorPerms: [P.ViewChannel, P.Connect] });
  const room = world.makeChannel("room", "Salon");
  world.makeMember("bot", room, [], 10);
  const author = world.makeMember("author", room, [], 5);
  author.roles.cache = new Map();
  await handleVoiceMoveCommand(world.message("=accessall", author), {}, {});
  assert.match(world.replies.at(-1), /Gérer les salons/);
});

pgTest("+kick : quota du palier 50 % (1 / jour), refus clair au second, usage rendu si Discord échoue", async () => {
  const world = fakeVoiceWorld();
  world.makeMember("bot", null, [], 10);
  const author = world.makeMember("author", null, ["50%"], 5);
  const victim = world.makeMember("400000000000000001", null, [], 1);
  let fail = true;
  Object.assign(victim, { kickable: true, bannable: true, kick: async () => { if (fail) throw Object.assign(new Error("x"), { code: 50013 }); } });
  world.guild.client = { user: { id: "bot" } };
  world.guild.bans = { fetch: async () => null };
  const msg = (content) => world.message(content, author);
  await handleGuardPrefixCommand(msg("=kick 400000000000000001 flood"), null, { bot: "guard" });
  assert.match(world.replies.at(-1), /Permission Discord manquante/);
  fail = false;
  await handleGuardPrefixCommand(msg("=kick 400000000000000001 flood"), null, { bot: "guard" });
  assert.match(world.replies.at(-1), /expulsé/, "le premier échec n'a pas consommé le quota");
  await handleGuardPrefixCommand(msg("=kick 400000000000000001 encore"), null, { bot: "guard" });
  assert.match(world.replies.at(-1), /Quota atteint pour `kick` : \*\*1 \/ 1 j\*\*/);
  await handleGuardPrefixCommand(msg("=ban 400000000000000001"), null, { bot: "guard" });
  assert.match(world.replies.at(-1), /n'a pas accès à `ban`/);
  const { rows } = await sharedQuery("SELECT action, bot FROM sanctions WHERE target_id = '400000000000000001'");
  assert.deepEqual(rows, [{ action: "kick", bot: "guard" }]);
});

pgTest("+ban : le membre visé ne peut pas avoir un palier égal ou supérieur", async () => {
  const world = fakeVoiceWorld();
  world.makeMember("bot", null, [], 10);
  const author = world.makeMember("author", null, ["10%"], 5);
  const staff = world.makeMember("400000000000000002", null, ["5% Administrateur"], 1);
  staff.bannable = true;
  world.guild.client = { user: { id: "bot" } };
  await handleGuardPrefixCommand(world.message("=ban 400000000000000002", author), null, { bot: "guard" });
  assert.match(world.replies.at(-1), /palier égal ou supérieur/);
});

pgTest("/tempmute : la sanction choisie fixe la durée, tout est enregistré et visible dans /sanction", async () => {
  const { handleStaffModerationInteraction } = await import("./staff-moderation.js");
  const world = fakeVoiceWorld();
  world.makeMember("bot", null, [], 10);
  const author = world.makeMember("author", null, ["10% Modérateur"], 5);
  const target = world.makeMember("400000000000000009", null, [], 1);
  let timeoutMs = null;
  Object.assign(target, { moderatable: true, timeout: async (ms) => { timeoutMs = ms; } });
  world.guild.client = { user: { id: "bot" } };
  const replies = [];
  const base = (commandName, options) => ({
    commandName, guild: world.guild, guildId: world.guild.id, member: author, user: author.user,
    isAutocomplete: () => false, isChatInputCommand: () => true, deferred: false, replied: false,
    options: {
      getUser: () => target.user, getString: (name) => options[name] ?? null, getInteger: (name) => options[name] ?? null,
      getSubcommand: () => options.sub, getSubcommandGroup: () => null,
    },
    deferReply: async function () { this.deferred = true; },
    reply: async (payload) => { replies.push(payload); },
    editReply: async (payload) => { replies.push(payload); },
  });
  // Autocomplétion : les 4 sanctions par défaut, triées par durée.
  const choices = [];
  await handleStaffModerationInteraction({
    commandName: "tempmute", guildId: world.guild.id, isAutocomplete: () => true,
    options: { getFocused: () => ({ name: "sanction", value: "insultes" }) },
    respond: async (list) => { choices.push(...list); },
  });
  assert.deepEqual(choices.map((c) => c.name), ["Insultes légères — 15 min", "Insultes graves — 30 min"]);
  await handleStaffModerationInteraction(base("tempmute", { sanction: choices[1].value, raison: "message 123" }), null, { bot: "fwu" });
  assert.equal(timeoutMs, 30 * 60_000);
  assert.match(replies.at(-1).content, /exclu temporairement \*\*30 min\*\* pour \*\*Insultes graves\*\*/);
  await handleStaffModerationInteraction(base("sanction", {}), null, { bot: "fwu" });
  const history = replies.at(-1).embeds[0].toJSON();
  assert.match(history.description, /\*\*#\d+ · Exclusion \(Insultes graves\) · 30 min\*\* · <t:\d+:d> · par <@author> · fwu\n↳ message 123/, "historique unifié : une seule ligne, avec le numéro d'affaire");
  assert.match(history.footer.text, /1 sanction/);
  // Un membre 100 % ne peut ni sanctionner ni consulter.
  const member100 = world.makeMember("400000000000000010", null, ["100%"], 1);
  const denied = base("sanction", {});
  denied.member = member100;
  await handleStaffModerationInteraction(denied, null, { bot: "fwu" });
  assert.match(replies.at(-1).content, /Réservé au staff/);
});
