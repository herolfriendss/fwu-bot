import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits as P } from "discord.js";
import {
  buildWakeupDirectMessage,
  claimWakeup,
  eligibleWakeupChannels,
  formatWakeupSummary,
  normalizeWakeupConfig,
  resetWakeupState,
  runWakeupSequence,
  sanitizeWakeupMessage,
  WAKEUP_MAX_CHANNELS,
} from "./wakeup.js";

const ALL = [P.ViewChannel, P.Connect, P.MoveMembers];
const everyone = { name: "@everyone" };
const target = { id: "400000000000000001" };
const bot = { id: "200000000000000000" };

function voice(
  id,
  name,
  position,
  { type = 2, pub = true, targetOk = true, botMove = true } = {},
) {
  const grant = (flags) => ({ has: (flag) => flags.includes(flag) });
  return {
    id,
    name,
    type,
    rawPosition: position,
    permissionsFor: (who) =>
      who === everyone
        ? grant(pub ? [P.ViewChannel, P.Connect] : [])
        : who === target
          ? grant(targetOk ? [P.ViewChannel, P.Connect] : [])
          : who === bot
            ? grant(botMove ? ALL : [P.ViewChannel, P.Connect])
            : grant([]),
  };
}
const guildWith = (channels, extra = {}) => ({
  id: "100000000000000001",
  afkChannelId: null,
  roles: { everyone },
  channels: { cache: new Map(channels.map((c) => [c.id, c])) },
  ...extra,
});
const names = (list) => list.map((c) => c.name);
const config = (settings) => normalizeWakeupConfig(settings);

test("only public, accessible voice channels are eligible, ordered by position", () => {
  const guild = guildWith([
    voice("1", "Général", 3),
    voice("2", "Détente", 1),
    voice("3", "Privé", 2, { pub: false }),
    voice("4", "Fermé pour lui", 4, { targetOk: false }),
    voice("5", "Bot ne peut pas", 5, { botMove: false }),
    voice("6", "Texte", 6, { type: 0 }),
    voice("7", "Scène", 7, { type: 13 }),
  ]);
  assert.deepEqual(
    names(eligibleWakeupChannels({ guild, target, bot, config: config({}) })),
    ["Détente", "Général"],
  );
});

test("Owner and waiting channels are excluded by configured id", () => {
  const guild = guildWith([
    voice("10000", "Salon du boss", 0),
    voice("11000", "Sas", 1),
    voice("12000", "Général", 2),
  ]);
  const cfg = config({
    wakeup: { ownerChannelId: "10000", waitingChannelId: "11000" },
  });
  assert.deepEqual(
    names(eligibleWakeupChannels({ guild, target, bot, config: cfg })),
    ["Général"],
  );
});

test("invalid configured ids are ignored", () => {
  const cfg = config({
    wakeup: {
      ownerChannelId: "abc",
      waitingChannelId: 42,
      excludedChannelIds: ["x", "12345", null],
    },
  });
  assert.equal(cfg.ownerChannelId, null);
  assert.equal(cfg.waitingChannelId, null);
  assert.deepEqual([...cfg.excludedChannelIds], ["12345"]);
});

test("name fallback excludes Owner and waiting rooms, in any accent or decoration", () => {
  const guild = guildWith([
    voice("1", "👑 Owner", 0),
    voice("2", "Salon d’attente", 1),
    voice("3", "WAITING room", 2),
    voice("4", "Général", 3),
  ]);
  assert.deepEqual(
    names(eligibleWakeupChannels({ guild, target, bot, config: config({}) })),
    ["Général"],
  );
});

test("configured ids take precedence: the name fallback is off for a configured slot", () => {
  const guild = guildWith([
    voice("20000", "Owner lounge public", 0),
    voice("21000", "Vrai salon staff", 1),
    voice("22000", "Attente", 2),
  ]);
  const cfg = config({ wakeup: { ownerChannelId: "21000" } });
  // owner slot configured -> "Owner lounge public" is no longer excluded by name; waiting slot still falls back to the name
  assert.deepEqual(
    names(eligibleWakeupChannels({ guild, target, bot, config: cfg })),
    ["Owner lounge public"],
  );
});

test("the AFK channel and explicitly excluded channels are skipped", () => {
  const guild = guildWith(
    [
      voice("30000", "AFK", 0),
      voice("31000", "Muet", 1),
      voice("32000", "Général", 2),
    ],
    { afkChannelId: "30000" },
  );
  const cfg = config({ wakeup: { excludedChannelIds: ["31000"] } });
  assert.deepEqual(
    names(eligibleWakeupChannels({ guild, target, bot, config: cfg })),
    ["Général"],
  );
});

test("the number of visited channels is capped", () => {
  const guild = guildWith(
    Array.from({ length: 40 }, (_, i) =>
      voice(String(i + 1), `Salon ${i + 1}`, i),
    ),
  );
  assert.equal(
    eligibleWakeupChannels({ guild, target, bot, config: config({}) }).length,
    WAKEUP_MAX_CHANNELS,
  );
});

test("the custom message cannot ping anyone", () => {
  const dirty = "@everyone @here <@123456> <@&999999> <@!42424> coucou ".repeat(
    40,
  );
  const clean = sanitizeWakeupMessage(dirty);
  assert.ok(clean.length <= 300);
  assert.doesNotMatch(clean, /<@/);
  assert.doesNotMatch(clean, /@everyone|@here/i);
  assert.match(clean, /coucou/);
  assert.equal(sanitizeWakeupMessage(undefined), "");
});

test("the DM names the target and the author, then the optional message", () => {
  assert.equal(
    buildWakeupDirectMessage("111", "222", ""),
    "Réveille-toi, <@222> ! C'est <@111> qui te cherche.",
  );
  assert.match(buildWakeupDirectMessage("111", "222", "viens"), /\n> viens$/);
});

test("cooldown, per-actor and per-target locks", () => {
  resetWakeupState();
  const now = 1_000_000;
  const first = claimWakeup("g", "actor", "t1", now);
  assert.equal(first.ok, true);
  assert.match(
    claimWakeup("g", "actor", "t2", now).reason,
    /déjà en cours de ta part/,
  );
  assert.match(
    claimWakeup("g", "other", "t1", now).reason,
    /déjà en cours sur cette personne/,
  );
  first.release(now + 5_000);
  const cooling = claimWakeup("g", "actor", "t2", now + 6_000);
  assert.equal(cooling.ok, false);
  assert.match(cooling.reason, /recharge/);
  assert.equal(claimWakeup("g", "actor", "t2", now + 5_000 + 60_000).ok, true);
  assert.equal(
    claimWakeup("other-guild", "actor", "t9", now + 6_000).ok,
    true,
    "guilds are independent",
  );
  resetWakeupState();
});

function targetWith({ failOn = [], dmFails = false, leaveAfter = null } = {}) {
  const moves = [];
  const dms = [];
  const member = {
    id: "400000000000000001",
    voice: {
      channelId: "origin",
      setChannel: async (channel) => {
        if (failOn.includes(channel.id)) throw new Error("Missing Access");
        moves.push(channel.id);
        member.voice.channelId = channel.id;
        if (leaveAfter !== null && moves.length === leaveAfter)
          member.voice.channelId = null;
      },
    },
    send: async (payload) => {
      if (dmFails) throw new Error("Cannot send messages to this user");
      dms.push(payload);
    },
  };
  return { member, moves, dms };
}
const channelsOf = (...ids) => ids.map((id) => ({ id, name: `Salon ${id}` }));
const fast = { sleep: async () => {}, stepDelayMs: 0 };

test("each channel is visited once, in order, with one DM per move", async () => {
  const { member, moves, dms } = targetWith();
  const summary = await runWakeupSequence({
    target: member,
    actorId: "111",
    channels: channelsOf("a", "b", "c"),
    ...fast,
  });
  assert.deepEqual(moves, ["a", "b", "c"]);
  assert.equal(dms.length, 3);
  assert.deepEqual(
    {
      total: summary.total,
      visited: summary.visited,
      failed: summary.failures.length,
      dmFailed: summary.dmFailed,
    },
    { total: 3, visited: 3, failed: 0, dmFailed: 0 },
  );
  assert.deepEqual(dms[0].allowedMentions, { parse: [] });
});

test("a failed move is never announced and does not stop the sequence", async () => {
  const { member, moves, dms } = targetWith({ failOn: ["b"] });
  const summary = await runWakeupSequence({
    target: member,
    actorId: "111",
    channels: channelsOf("a", "b", "c"),
    ...fast,
  });
  assert.deepEqual(moves, ["a", "c"]);
  assert.equal(dms.length, 2, "no DM for the failed move");
  assert.equal(summary.visited, 2);
  assert.equal(summary.failures.length, 1);
  assert.match(
    formatWakeupSummary("400000000000000001", summary),
    /2\/3.*\n.*1 déplacement\(s\) en échec/,
  );
});

test("closed DMs are counted but never interrupt the sequence", async () => {
  const { member, moves } = targetWith({ dmFails: true });
  const summary = await runWakeupSequence({
    target: member,
    actorId: "111",
    channels: channelsOf("a", "b"),
    ...fast,
  });
  assert.deepEqual(moves, ["a", "b"]);
  assert.equal(summary.dmFailed, 2);
  assert.match(formatWakeupSummary("1", summary), /MP non reçu pour 2/);
});

test("the sequence stops cleanly when the target leaves voice", async () => {
  const { member, moves } = targetWith({ leaveAfter: 1 });
  const summary = await runWakeupSequence({
    target: member,
    actorId: "111",
    channels: channelsOf("a", "b", "c"),
    ...fast,
  });
  assert.deepEqual(moves, ["a"]);
  assert.equal(summary.stopped, "la personne a quitté le vocal");
});

test("a pause is applied between moves only", async () => {
  const waits = [];
  const { member } = targetWith();
  await runWakeupSequence({
    target: member,
    actorId: "1",
    channels: channelsOf("a", "b", "c"),
    sleep: async (ms) => waits.push(ms),
    stepDelayMs: 1500,
  });
  assert.deepEqual(waits, [1500, 1500]);
});

test("channels hidden from @everyone but open to the members' role (verification / auto-role) are public", () => {
  const verified = { id: "500000000000000001", name: "Vérifié" };
  const membersOnly = {
    id: "9", name: "Routine rouge", type: 2, rawPosition: 1,
    permissionsFor: (who) => ({ has: (flag) => (who === verified || who === target ? [P.ViewChannel, P.Connect] : who === bot ? ALL : []).includes(flag) }),
  };
  const guild = guildWith([membersOnly], { roles: { everyone, cache: new Map([[verified.id, verified]]) } });
  assert.deepEqual(names(eligibleWakeupChannels({ guild, target, bot, config: config({}) })), []);
  assert.deepEqual(names(eligibleWakeupChannels({ guild, target, bot, config: config({ verification: { roleId: verified.id } }) })), ["Routine rouge"]);
  assert.deepEqual(names(eligibleWakeupChannels({ guild, target, bot, config: config({ automation: { autoRoleIds: [verified.id] } }) })), ["Routine rouge"]);
});
