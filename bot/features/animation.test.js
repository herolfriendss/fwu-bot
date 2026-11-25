import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "pnd-anim-")), "economy.sqlite");
const {
  parseCount, evaluateCount, applyCount, setCountingChannel, disableCounting, countingConfig, countDeleted,
  countingLeaderboard, breakMessage,
} = await import("./counting.js");
const {
  normalizeStarEmoji, reactionMatches, saveStarboardConfig, starboardConfig, starboardAction, countStars,
  isPublicChannel, starPayload, rememberStarPost, starPost, starboardStats, handleStarReaction,
} = await import("./starboard.js");
const {
  parisClock, isQotdDue, qotdConfig, saveQotdConfig, cleanQuestion, addQuestion, nextQuestion, pendingQuestions,
  postQotd, runQotd, qotdPayload,
} = await import("./qotd.js");
const { BUILTIN_QUESTIONS } = await import("./qotd-questions.js");
const { handleAnimationInteraction, isAnimationStaff, handleCountingMessage } = await import("./animation-commands.js");

const G = "100000000000000777";
const A = "200000000000000001";
const B = "200000000000000002";
const CH = "300000000000000001";

// ─── Comptage ────────────────────────────────────────────────────────────────

test("a count is the number at the start of the message only", () => {
  assert.equal(parseCount("12"), 12);
  assert.equal(parseCount("  12 !!"), 12);
  assert.equal(parseCount("12 c'est moi"), 12);
  assert.equal(parseCount("salut 12"), null, "le nombre doit être au début");
  assert.equal(parseCount("1.5"), null);
  assert.equal(parseCount("1,5"), null);
  assert.equal(parseCount("0"), null);
  assert.equal(parseCount("1234567890"), null, "plus de 9 chiffres refusés");
  assert.equal(parseCount(""), null);
});

test("the next number must follow, and nobody counts twice in a row", () => {
  assert.deepEqual(evaluateCount({ current: 0, record: 0 }, A, 1), { ok: true, next: 1, record: true, milestone: false });
  assert.deepEqual(evaluateCount({ current: 4, record: 10, lastUserId: B }, A, 5), { ok: true, next: 5, record: false, milestone: false });
  assert.deepEqual(evaluateCount({ current: 4, lastUserId: B }, A, 6), { ok: false, reason: "wrong_number", expected: 5 });
  assert.deepEqual(evaluateCount({ current: 4, lastUserId: A }, A, 5), { ok: false, reason: "same_user", expected: 5 });
  assert.equal(evaluateCount({ current: 99, record: 200, lastUserId: B }, A, 100).milestone, true);
});

test("counting game: a run, a mistake that resets, the record kept, the leaderboard", () => {
  const post = (userId, content, messageId = `${Math.random()}`) => applyCount({ guildId: G, channelId: CH, userId, messageId, content });
  assert.equal(post(A, "1"), null, "inactif tant que le staff n'a pas choisi de salon");
  setCountingChannel(G, CH);
  assert.equal(applyCount({ guildId: G, channelId: "other", userId: A, messageId: "x", content: "1" }), null, "autre salon ignoré");
  assert.equal(post(A, "bonjour"), null, "on peut discuter sans casser la série");
  assert.equal(post(A, "1").ok, true);
  assert.equal(post(B, "2").ok, true);
  assert.equal(post(A, "3", "m3").ok, true);
  assert.equal(countingConfig(G).record, 3);
  const fail = post(A, "4");
  assert.equal(fail.ok, false);
  assert.equal(fail.reason, "same_user");
  assert.equal(fail.broken, 3);
  assert.match(breakMessage(A, fail), /cassé la série à \*\*3\*\*.*deux fois d'affilée/);
  const state = countingConfig(G);
  assert.equal(state.current, 0);
  assert.equal(state.record, 3, "le record survit à la remise à zéro");
  assert.equal(state.fails, 1);
  assert.equal(post(B, "5").reason, "wrong_number");
  assert.match(breakMessage(B, { reason: "wrong_number", expected: 1, broken: 0 }), /il fallait écrire \*\*1\*\*/);
  const board = countingLeaderboard(G);
  assert.deepEqual(board.map((r) => [r.userId, r.correct, r.mistakes]), [[A, 2, 1], [B, 1, 1]]);
});

test("deleting the last valid number tells everyone where the count is", () => {
  const G2 = "100000000000000778";
  setCountingChannel(G2, CH);
  applyCount({ guildId: G2, channelId: CH, userId: A, messageId: "m1", content: "1" });
  assert.equal(countDeleted(G2, CH, "other"), null, "un autre message supprimé ne dit rien");
  assert.deepEqual(countDeleted(G2, CH, "m1"), { current: 1, userId: A });
  assert.equal(countDeleted(G2, CH, "m1"), null, "une seule annonce par suppression");
  assert.equal(countingConfig(G2).current, 1, "la série continue");
});

test("moving the counting channel restarts at 1; disabling keeps the record", () => {
  const G3 = "100000000000000779";
  setCountingChannel(G3, CH);
  applyCount({ guildId: G3, channelId: CH, userId: A, messageId: "1", content: "1" });
  applyCount({ guildId: G3, channelId: CH, userId: B, messageId: "2", content: "2" });
  assert.equal(setCountingChannel(G3, CH).current, 2, "même salon : rien ne change");
  const moved = setCountingChannel(G3, "300000000000000009");
  assert.equal(moved.current, 0);
  assert.equal(moved.record, 2);
  assert.equal(disableCounting(G3), true);
  assert.equal(applyCount({ guildId: G3, channelId: "300000000000000009", userId: A, messageId: "3", content: "1" }), null);
});

test("the counting channel reacts ✅ / 🏆 / 🎉 and explains a mistake without pinging others", async () => {
  const G4 = "100000000000000780";
  setCountingChannel(G4, CH);
  const reactions = [];
  const replies = [];
  const msg = (userId, content, id) => ({
    guildId: G4, channelId: CH, id, content, author: { id: userId, bot: false },
    react: async (e) => { reactions.push(e); }, reply: async (p) => { replies.push(p); },
  });
  assert.equal(await handleCountingMessage(msg(A, "1", "a")), true);
  assert.equal(await handleCountingMessage(msg(B, "salut", "b")), false);
  assert.equal(await handleCountingMessage(msg(B, "2", "c")), true);
  assert.equal(await handleCountingMessage(msg(B, "3", "d")), true);
  assert.deepEqual(reactions, ["🏆", "🏆", "❌"]);
  assert.deepEqual(replies[0].allowedMentions, { users: [B], repliedUser: false });
  assert.equal(await handleCountingMessage({ ...msg(A, "1", "e"), author: { id: A, bot: true } }), false, "les bots ne comptent pas");
});

// ─── Vedette ─────────────────────────────────────────────────────────────────

test("star emoji: unicode or a server emoji, nothing else", () => {
  assert.equal(normalizeStarEmoji(""), "⭐");
  assert.equal(normalizeStarEmoji("🔥"), "🔥");
  assert.equal(normalizeStarEmoji("<:pnd:123456789012345678>"), "123456789012345678");
  assert.equal(normalizeStarEmoji("<a:dance:123456789012345678>"), "123456789012345678");
  assert.throws(() => normalizeStarEmoji("@everyone"), /Emoji invalide/);
  assert.throws(() => normalizeStarEmoji("abc"), /Emoji invalide/);
  assert.equal(reactionMatches("⭐", { name: "⭐" }), true);
  assert.equal(reactionMatches("⭐", { name: "⭐️" }), true, "le sélecteur de variante est ignoré");
  assert.equal(reactionMatches("⭐", { name: "🔥" }), false);
  assert.equal(reactionMatches("123456789012345678", { id: "123456789012345678", name: "pnd" }), true);
  assert.equal(reactionMatches("⭐", { id: "123456789012345678", name: "⭐" }), false, "un emoji perso nommé ⭐ ne compte pas");
});

test("stars: bots never count, the author counts only if allowed; posts are created once then updated", () => {
  const users = [{ id: A }, { id: B }, { id: "bot", bot: true }];
  assert.equal(countStars(users, A, false), 1);
  assert.equal(countStars(users, A, true), 2);
  assert.equal(starboardAction({ stars: 2, threshold: 3, existing: null }), "none");
  assert.equal(starboardAction({ stars: 3, threshold: 3, existing: null }), "create");
  assert.equal(starboardAction({ stars: 4, threshold: 3, existing: { star_message_id: "s", stars: 3 } }), "update");
  assert.equal(starboardAction({ stars: 1, threshold: 3, existing: { star_message_id: "s", stars: 3 } }), "update", "le compteur suit aussi les retraits");
  assert.equal(starboardAction({ stars: 3, threshold: 3, existing: { star_message_id: "s", stars: 3 } }), "none");
});

test("starboard config is validated and stats count only published posts", () => {
  assert.equal(starboardConfig(G).enabled, false);
  assert.throws(() => saveStarboardConfig(G, { channelId: CH, enabled: true, threshold: 0 }), /seuil/);
  const saved = saveStarboardConfig(G, { channelId: CH, enabled: true, threshold: 2 });
  assert.deepEqual(saved, { channelId: CH, enabled: true, emoji: "⭐", threshold: 2, allowSelf: false });
  rememberStarPost({ guildId: G, sourceMessageId: "m1", sourceChannelId: "c", authorId: A, starMessageId: "s1", stars: 5 });
  rememberStarPost({ guildId: G, sourceMessageId: "m1", sourceChannelId: "c", authorId: A, starMessageId: null, stars: 6 });
  assert.equal(starPost(G, "m1").star_message_id, "s1", "une mise à jour garde le lien vers la copie");
  assert.equal(starPost(G, "m1").stars, 6);
  assert.deepEqual(starboardStats(G), { posts: 1, best: 6, top: [{ userId: A, posts: 1 }] });
});

test("only channels visible to @everyone can reach the starboard", () => {
  const everyone = { id: "everyone" };
  const channel = (visible) => ({ guild: { roles: { everyone } }, permissionsFor: () => ({ has: () => visible }) });
  assert.equal(isPublicChannel(channel(true)), true);
  assert.equal(isPublicChannel(channel(false)), false);
  assert.equal(isPublicChannel({}), false, "dans le doute, on ne recopie pas");
});

test("the starboard copy never pings anyone and links back to the original", () => {
  const payload = starPayload({
    content: "Bonjour @everyone <@123>", url: "https://discord.com/channels/1/2/3", channelId: "2",
    author: { username: "Alice", displayAvatarURL: () => "https://cdn.discordapp.com/a.png" },
    attachments: new Map([["1", { contentType: "image/png", url: "https://cdn.discordapp.com/i.png" }]]),
  }, 4, "⭐");
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  assert.equal(payload.content, "⭐ **4** · <#2>");
  const embed = payload.embeds[0].toJSON();
  assert.match(embed.description, /Aller au message\]\(https:\/\/discord\.com\/channels\/1\/2\/3\)/);
  assert.equal(embed.image.url, "https://cdn.discordapp.com/i.png");
});

test("a message reaching the threshold is copied once, even with simultaneous reactions", async () => {
  const G5 = "100000000000000781";
  const STAR = "300000000000000555";
  saveStarboardConfig(G5, { channelId: STAR, enabled: true, threshold: 2 });
  const sent = [];
  const edits = [];
  const starChannel = {
    isTextBased: () => true,
    send: async (p) => { sent.push(p); return { id: `s${sent.length}` }; },
    messages: { fetch: async () => ({ edit: async (p) => { edits.push(p); } }) },
  };
  const guild = { id: G5, roles: { everyone: {} }, channels: { fetch: async () => starChannel } };
  let voters = [{ id: B }, { id: "200000000000000003" }];
  const message = {
    id: "src1", guildId: G5, channelId: "c1", guild, partial: false, content: "top", url: "https://discord.com/x",
    author: { id: A, bot: false, username: "a", displayAvatarURL: () => undefined }, attachments: new Map(),
    channel: { guild, permissionsFor: () => ({ has: () => true }) },
  };
  const reaction = { message, emoji: { name: "⭐" }, partial: false, users: { fetch: async () => new Map(voters.map((u) => [u.id, u])) } };
  const results = await Promise.all([handleStarReaction(reaction), handleStarReaction(reaction)]);
  assert.equal(results.filter((r) => r === "created").length, 1, "une seule création");
  assert.equal(sent.length, 1, "une seule copie");
  voters = [...voters, { id: "200000000000000004" }];
  assert.equal(await handleStarReaction(reaction), "updated");
  assert.equal(edits.length, 1);
  assert.match(edits[0].content, /\*\*3\*\*/);
  assert.equal(await handleStarReaction({ ...reaction, emoji: { name: "🔥" } }), null, "autre emoji ignoré");
  assert.equal(await handleStarReaction({ ...reaction, message: { ...message, channelId: STAR } }), null, "pas d'étoiles sur le mur lui-même");
});

// ─── Question du jour ────────────────────────────────────────────────────────

test("the built-in list has 100 distinct questions with no mention", () => {
  assert.equal(BUILTIN_QUESTIONS.length, 100);
  assert.equal(new Set(BUILTIN_QUESTIONS).size, 100);
  for (const q of BUILTIN_QUESTIONS) assert.doesNotThrow(() => cleanQuestion(q), q);
});

test("Paris clock and due time follow the Paris day, including summer time", () => {
  assert.deepEqual(parisClock(Date.UTC(2026, 0, 15, 17, 30)), { day: "2026-01-15", hour: 18 });
  assert.deepEqual(parisClock(Date.UTC(2026, 6, 15, 16, 30)), { day: "2026-07-15", hour: 18 });
  assert.deepEqual(parisClock(Date.UTC(2026, 0, 15, 23, 30)), { day: "2026-01-16", hour: 0 });
  const config = { enabled: true, channelId: CH, hour: 18, lastDay: null };
  assert.equal(isQotdDue(config, Date.UTC(2026, 0, 15, 16, 59)), false);
  assert.equal(isQotdDue(config, Date.UTC(2026, 0, 15, 17, 0)), true);
  assert.equal(isQotdDue({ ...config, lastDay: "2026-01-15" }, Date.UTC(2026, 0, 15, 20, 0)), false);
  assert.equal(isQotdDue({ ...config, enabled: false }, Date.UTC(2026, 0, 15, 20, 0)), false);
});

test("staff questions are cleaned and go first; built-ins never repeat before a full round", () => {
  const GQ = "100000000000000790";
  assert.throws(() => cleanQuestion("abc"), /trop courte/);
  assert.throws(() => cleanQuestion("Qui vient ? @everyone"), /mention/);
  assert.throws(() => cleanQuestion("x".repeat(301)), /trop longue/);
  assert.equal(cleanQuestion("  Ton   jeu  préféré ? "), "Ton jeu préféré ?");
  addQuestion(GQ, "Question du staff numéro un ?", A);
  addQuestion(GQ, "Question du staff numéro deux ?", A);
  assert.equal(pendingQuestions(GQ), 2);
  assert.equal(nextQuestion(GQ).text, "Question du staff numéro un ?");
  assert.equal(nextQuestion(GQ).text, "Question du staff numéro deux ?");
  assert.equal(pendingQuestions(GQ), 0);
  const seen = new Set();
  for (let i = 0; i < BUILTIN_QUESTIONS.length; i++) {
    const q = nextQuestion(GQ, { random: () => 0.5 });
    assert.equal(q.source, "builtin");
    assert.ok(!seen.has(q.text), "aucune répétition avant d'avoir fait le tour");
    seen.add(q.text);
  }
  assert.equal(seen.size, BUILTIN_QUESTIONS.length);
  assert.equal(nextQuestion(GQ, { random: () => 0 }).source, "builtin", "le tour recommence");
});

test("the question of the day is posted once per day, with a thread, and pings only the chosen role", async () => {
  const GP = "100000000000000791";
  const ROLE = "400000000000000001";
  const sent = [];
  const threads = [];
  const channel = {
    isTextBased: () => true,
    send: async (p) => { sent.push(p); return { startThread: async (t) => { threads.push(t); } }; },
  };
  const guild = { id: GP, channels: { fetch: async () => channel } };
  const at18 = Date.UTC(2026, 0, 15, 17, 5);
  assert.equal(await runQotd([guild], at18), 0, "rien tant que ce n'est pas configuré");
  saveQotdConfig(GP, { channelId: CH, enabled: true, hour: 18, roleId: ROLE });
  assert.equal(await runQotd([guild], Date.UTC(2026, 0, 15, 16, 0)), 0, "trop tôt");
  assert.equal(await runQotd([guild], at18), 1);
  assert.equal(await runQotd([guild], at18 + 3_600_000), 0, "une seule fois par jour");
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].allowedMentions, { roles: [ROLE] });
  assert.equal(sent[0].content, `<@&${ROLE}>`);
  assert.deepEqual(threads, [{ name: "Réponses — 15/01/2026", autoArchiveDuration: 1440 }]);
  assert.equal(qotdConfig(GP).posted, 1);
  assert.equal(await runQotd([guild], Date.UTC(2026, 0, 16, 17, 5)), 1, "le lendemain, nouvelle question");
  const forced = await postQotd(guild, { force: true, now: Date.UTC(2026, 0, 16, 18, 0) });
  assert.equal(forced.ok, true, "le staff peut forcer une publication");
  assert.equal(forced.number, 3);
  assert.deepEqual(qotdPayload({ text: "Q ?" }, 1).allowedMentions, { parse: [] }, "sans rôle, aucune mention");
});

test("a refused send gives the day back so the question is retried later", async () => {
  const GF = "100000000000000792";
  saveQotdConfig(GF, { channelId: CH, enabled: true, hour: 0 });
  addQuestion(GF, "Une question qui doit revenir ?", A);
  let fail = true;
  const channel = { isTextBased: () => true, send: async () => { if (fail) throw new Error("Missing Permissions"); return {}; } };
  const guild = { id: GF, channels: { fetch: async () => channel } };
  const now = Date.UTC(2026, 0, 15, 12, 0);
  const result = await postQotd(guild, { now });
  assert.equal(result.ok, false);
  assert.match(result.reason, /permissions/);
  assert.equal(qotdConfig(GF).lastDay, null);
  assert.equal(qotdConfig(GF).posted, 0);
  assert.equal(pendingQuestions(GF), 1, "la question du staff n'est pas perdue");
  fail = false;
  assert.equal((await postQotd(guild, { now })).text, "Une question qui doit revenir ?");
});

// ─── Commandes ───────────────────────────────────────────────────────────────

function fakeInteraction({ group, subcommand, member, options = {} }) {
  const replies = [];
  return {
    replies,
    commandName: "anim", guildId: G, guild: { id: G }, user: { id: member.id }, member,
    replied: false, deferred: false,
    isChatInputCommand: () => true,
    options: {
      getSubcommandGroup: () => group,
      getSubcommand: () => subcommand,
      getChannel: (name) => options[name] ?? null,
      getString: (name) => options[name] ?? null,
      getInteger: (name) => options[name] ?? null,
      getBoolean: (name) => options[name] ?? null,
      getRole: (name) => options[name] ?? null,
    },
    reply: async (p) => { replies.push(p); },
  };
}

const plainMember = { id: B, guild: { ownerId: "999" }, permissions: { has: () => false } };
const staffMember = { id: A, guild: { ownerId: "999" }, permissions: { has: () => true } };

test("settings are staff-only; status and leaderboards are open to everyone", async () => {
  assert.equal(isAnimationStaff(plainMember), false);
  assert.equal(isAnimationStaff(staffMember), true);
  assert.equal(isAnimationStaff({ id: "999", guild: { ownerId: "999" }, permissions: { has: () => false } }), true, "propriétaire du serveur");
  for (const [group, subcommand] of [["comptage", "salon"], ["comptage", "desactiver"], ["vedette", "config"], ["vedette", "desactiver"], ["qdj", "config"], ["qdj", "ajouter"], ["qdj", "maintenant"]]) {
    const interaction = fakeInteraction({ group, subcommand, member: plainMember });
    assert.equal(await handleAnimationInteraction(interaction), true);
    assert.match(interaction.replies[0].content, /Réservé au staff/, `${group} ${subcommand}`);
  }
  const status = fakeInteraction({ group: "comptage", subcommand: "classement", member: plainMember });
  await handleAnimationInteraction(status);
  assert.ok(status.replies[0].embeds?.length, "classement visible par tous");
  assert.deepEqual(status.replies[0].allowedMentions, { parse: [] });
});

test("the bot refuses to save a channel where it cannot post", async () => {
  const channel = { id: CH, type: 0, guild: { members: { me: {} } }, permissionsFor: () => ({ has: () => false }) };
  const interaction = fakeInteraction({ group: "comptage", subcommand: "salon", member: staffMember, options: { salon: channel } });
  await handleAnimationInteraction(interaction);
  assert.match(interaction.replies[0].content, /il me manque : Voir le salon/);
});

test("other commands are left to their own handlers", async () => {
  assert.equal(await handleAnimationInteraction({ isChatInputCommand: () => true, commandName: "confession", guildId: G }), false);
  assert.equal(await handleAnimationInteraction({ isChatInputCommand: () => false }), false);
});
