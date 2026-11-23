import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PermissionFlagsBits as P } from "discord.js";

const directory = mkdtempSync(join(tmpdir(), "pnd-wakeup-runtime-"));
process.env.HER_DB_PATH = join(directory, "runtime.sqlite");
process.env.PND_WAKEUP_STEP_DELAY_MS = "0";
const { handleVoiceMessage, handleVoiceInteraction } =
  await import("./voice-commands.js");
const { resetWakeupState } = await import("./wakeup.js");
const { db } = await import("./database.js");

after(() => {
  db.close();
  for (const key of ["HER_DB_PATH", "PND_WAKEUP_STEP_DELAY_MS"])
    delete process.env[key];
  rmSync(directory, { recursive: true, force: true });
});
beforeEach(() => resetWakeupState());

const SETTINGS = {
  sysPlus: { roleId: "sysplus-role" },
  adminPlus: { roleId: "adminplus-role" },
};
const everyone = { name: "@everyone" };
const grant = (flags) => ({ has: (flag) => flags.includes(flag) });

function world({
  actorCanMove = true,
  targetInVoice = true,
  targetPosition = 3,
  dmFails = false,
  failOn = [],
} = {}) {
  const moves = [];
  const dms = [];
  const members = new Map();
  const guild = {
    id: "100000000000000001",
    name: "Test",
    ownerId: "100000000000000099",
    afkChannelId: null,
    roles: { everyone },
    members: {
      fetchMe: async () => bot,
      fetch: async (arg) =>
        members.get(typeof arg === "string" ? arg : arg.user) ?? null,
    },
    channels: { cache: new Map() },
  };
  const member = (
    id,
    position,
    roleIds = [],
    permissionFlags = [P.MoveMembers],
  ) => {
    const owned = new Set(roleIds);
    const m = {
      id,
      guild,
      displayName: id,
      user: { id, tag: `${id}#0001`, username: id, bot: false },
      permissions: { has: (flag) => permissionFlags.includes(flag) },
      roles: { highest: { position }, cache: { has: (r) => owned.has(r) } },
      voice: { channelId: null, setChannel: async () => {} },
      send: async () => {},
    };
    members.set(id, m);
    return m;
  };
  const bot = member("200000000000000000", 10, [], [P.MoveMembers]);
  const actor = member(
    "300000000000000001",
    5,
    ["adminplus-role"],
    actorCanMove ? [P.MoveMembers] : [],
  );
  const target = member("400000000000000001", targetPosition);
  if (targetInVoice) target.voice.channelId = "origin";
  target.voice.setChannel = async (channel) => {
    if (failOn.includes(channel.id)) throw new Error("Missing Access");
    moves.push(channel.name);
    target.voice.channelId = channel.id;
  };
  target.send = async (payload) => {
    if (dmFails) throw new Error("closed");
    dms.push(payload);
  };
  const channel = (id, name, position, { pub = true } = {}) => {
    guild.channels.cache.set(id, {
      id,
      name,
      type: 2,
      rawPosition: position,
      permissionsFor: (who) =>
        who === everyone
          ? grant(pub ? [P.ViewChannel, P.Connect] : [])
          : who === bot
            ? grant([P.ViewChannel, P.Connect, P.MoveMembers])
            : grant([P.ViewChannel, P.Connect]),
    });
  };
  channel("1", "👑 Owner", 0, { pub: false });
  channel("2", "Salle d'attente", 1);
  channel("3", "Général", 2);
  channel("4", "Détente", 3);
  channel("5", "Jeux", 4);
  channel("6", "Réunion privée", 5, { pub: false });
  return { guild, actor, target, bot, moves, dms };
}

function prefixMessage(w, content = `=wakeup <@${w.target.id}> debout`) {
  const replies = [];
  const edits = [];
  return {
    replies,
    edits,
    content,
    id: "500000000000000001",
    author: w.actor.user,
    member: w.actor,
    guild: w.guild,
    mentions: {
      members: { first: () => w.target },
      channels: { first: () => null },
    },
    reply: async (payload) => {
      replies.push(payload);
      return {
        edit: async (p) => {
          edits.push(p);
        },
      };
    },
  };
}
function slashInteraction(w, { message = "debout" } = {}) {
  const calls = { defer: 0, reply: 0, edits: [] };
  return {
    calls,
    isChatInputCommand: () => true,
    isButton: () => false,
    isUserSelectMenu: () => false,
    commandName: "wakeup",
    guild: w.guild,
    user: w.actor.user,
    options: {
      getUser: (name) => {
        assert.equal(name, "membre");
        return w.target.user;
      },
      getString: () => message,
      getChannel: () => {
        throw new Error("WAKEUP must not ask for a destination channel");
      },
    },
    deferReply: async () => {
      calls.defer++;
    },
    reply: async () => {
      calls.reply++;
    },
    editReply: async (payload) => {
      calls.edits.push(payload);
    },
  };
}

test("prefix: visits every eligible public channel once, skips Owner/waiting/private, edits its single reply", async () => {
  const w = world();
  const message = prefixMessage(w);
  await handleVoiceMessage(message, SETTINGS);
  assert.deepEqual(w.moves, ["Général", "Détente", "Jeux"]);
  assert.equal(w.dms.length, 3);
  assert.match(
    w.dms[0].content,
    /Réveille-toi, <@400000000000000001> ! C'est <@300000000000000001> qui te cherche\./,
  );
  assert.equal(message.replies.length, 1, "no second status message");
  assert.equal(message.edits.length, 1);
  assert.match(message.edits[0].content, /\*\*3\/3\*\* salon\(s\) visité\(s\)/);
  assert.deepEqual(message.edits[0].allowedMentions, { parse: [] });
});

test("slash: no destination option is read, one deferred reply is edited with the same summary", async () => {
  const w = world();
  const interaction = slashInteraction(w);
  assert.equal(await handleVoiceInteraction(interaction, SETTINGS), true);
  assert.deepEqual(w.moves, ["Général", "Détente", "Jeux"]);
  assert.equal(interaction.calls.defer, 1);
  assert.equal(interaction.calls.reply, 0);
  assert.equal(interaction.calls.edits.length, 1);
  assert.match(
    interaction.calls.edits[0].content,
    /\*\*3\/3\*\* salon\(s\) visité\(s\)/,
  );
});

test("slash and prefix produce the same visits and the same final count", async () => {
  const a = world();
  const b = world();
  const message = prefixMessage(a);
  const interaction = slashInteraction(b);
  await handleVoiceMessage(message, SETTINGS);
  resetWakeupState();
  await handleVoiceInteraction(interaction, SETTINGS);
  assert.deepEqual(a.moves, b.moves);
  assert.equal(message.edits[0].content, interaction.calls.edits[0].content);
});

test("the catalogue exposes /wakeup without any channel option", async () => {
  const { SLASH_COMMANDS } = await import("../src/lib/slash-commands.ts");
  const command = SLASH_COMMANDS.find((item) => item.name === "wakeup");
  assert.deepEqual(
    command.options.map((option) => option.name),
    ["membre", "message"],
  );
  assert.equal(
    command.options.find((option) => option.name === "membre").required,
    true,
  );
  assert.ok(
    !command.options.some(
      (option) => option.required && option.name !== "membre",
    ),
  );
});

test("refusals change nothing and say why: absent from voice, not a member, self, no permission, bot target", async () => {
  const cases = [
    ["not in voice", world({ targetInVoice: false }), /aucun salon vocal/],
    [
      "actor lacks Move Members",
      world({ actorCanMove: false }),
      /Déplacer des membres/,
    ],
  ];
  for (const [label, w, pattern] of cases) {
    const message = prefixMessage(w);
    await handleVoiceMessage(message, SETTINGS);
    assert.deepEqual(w.moves, [], label);
    assert.equal(message.edits.length, 0, label);
    assert.match(message.replies.at(-1).content, pattern, label);
  }

  const self = world();
  self.target.id = self.actor.id; // same person
  self.guild.members.fetch = async () => self.actor;
  const selfMessage = prefixMessage(self, `=wakeup <@${self.actor.id}>`);
  selfMessage.mentions.members.first = () => self.actor;
  await handleVoiceMessage(selfMessage, SETTINGS);
  assert.match(selfMessage.replies.at(-1).content, /sur toi-même/);

  const missing = world();
  const missingMessage = prefixMessage(
    missing,
    "=wakeup <@999999999999999999>",
  );
  missingMessage.mentions.members.first = () => undefined;
  await handleVoiceMessage(missingMessage, SETTINGS);
  assert.match(missingMessage.replies.at(-1).content, /pas membre du serveur/);

  const botTarget = world();
  botTarget.target.user.bot = true;
  const botMessage = prefixMessage(botTarget);
  await handleVoiceMessage(botMessage, SETTINGS);
  assert.deepEqual(botTarget.moves, []);
  assert.match(botMessage.replies.at(-1).content, /bots/);
});

test("an actor without SYS+/ADMIN+ rights is refused before any move", async () => {
  const w = world();
  w.actor.roles.cache.has = () => false;
  const interaction = slashInteraction(w);
  await handleVoiceInteraction(interaction, SETTINGS);
  assert.deepEqual(w.moves, []);
  assert.match(
    interaction.calls.edits[0].content,
    /réservé à l’OWNER et aux membres ADMIN\+/,
  );
});

test("a target whose rank is not below an ADMIN+ actor is refused", async () => {
  const w = world({ targetPosition: 5 });
  const message = prefixMessage(w);
  await handleVoiceMessage(message, SETTINGS);
  assert.deepEqual(w.moves, []);
  assert.match(message.replies.at(-1).content, /inférieur au sien/);
});

test("cooldown: an immediate second run by the same actor is refused and moves nobody", async () => {
  const w = world();
  await handleVoiceMessage(prefixMessage(w), SETTINGS);
  const before = w.moves.length;
  const again = prefixMessage(w);
  await handleVoiceMessage(again, SETTINGS);
  assert.equal(w.moves.length, before);
  assert.match(again.replies.at(-1).content, /recharge/);
});

test("an isolated move failure and closed DMs are reported in the edited reply without stopping the walk", async () => {
  const w = world({ failOn: ["4"], dmFails: true });
  const message = prefixMessage(w);
  await handleVoiceMessage(message, SETTINGS);
  assert.deepEqual(w.moves, ["Général", "Jeux"]);
  assert.equal(message.replies.length, 1);
  assert.match(message.edits[0].content, /2\/3/);
  assert.match(message.edits[0].content, /1 déplacement\(s\) en échec/);
  assert.match(message.edits[0].content, /MP non reçu pour 2/);
});

test("the movement is audited once per sequence", async () => {
  const w = world();
  await handleVoiceMessage(prefixMessage(w), SETTINGS);
  const rows = db
    .prepare(
      "SELECT target_id, details FROM sysplus_audit WHERE action='voice.wakeup' AND guild_id=?",
    )
    .all(w.guild.id);
  assert.equal(rows.length >= 1, true);
  assert.deepEqual(JSON.parse(rows.at(-1).details), {
    visited: 3,
    total: 3,
    failed: 0,
  });
});

test("no eligible channel: refusal, nothing moved, cooldown not consumed", async () => {
  const w = world();
  for (const id of ["3", "4", "5"]) w.guild.channels.cache.delete(id);
  const message = prefixMessage(w);
  await handleVoiceMessage(message, SETTINGS);
  assert.deepEqual(w.moves, []);
  assert.match(
    message.replies.at(-1).content,
    /Aucun salon vocal public éligible/,
  );
  const w2 = world();
  await handleVoiceMessage(prefixMessage(w2), SETTINGS);
  assert.equal(w2.moves.length, 3);
});
