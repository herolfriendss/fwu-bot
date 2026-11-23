import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-hierarchy-runtime-"));
const statePath = join(directory, "dog-state.json");
process.env.PND_DOG_STATE_PATH = statePath;
process.env.HER_DB_PATH = join(directory, "runtime.sqlite");
process.env.PND_OWNER_DISCORD_ID = "900000000000000009";

const { handleDogCommand } = await import("./dog-commands.js");
const { handleV4SlashInteraction } = await import("./v4-commands.js");
const { handleVoiceMessage } = await import("./voice-commands.js");
const { db } = await import("./database.js");

after(() => {
  db.close();
  for (const key of [
    "PND_DOG_STATE_PATH",
    "HER_DB_PATH",
    "PND_OWNER_DISCORD_ID",
  ])
    delete process.env[key];
  rmSync(directory, { recursive: true, force: true });
});

const GUILD_ID = "100000000000000001";
const GUILD_OWNER = "100000000000000002";
const PND_OWNER = "900000000000000009";
const SETTINGS = {
  sysPlus: { roleId: "sysplus-role" },
  adminPlus: { roleId: "adminplus-role" },
};

function makeWorld({ actorPosition = 5, actorIsGuildOwner = false } = {}) {
  const calls = { roleAdds: 0, nicknames: 0, moves: 0 };
  const roleItems = [];
  const leashRole = {
    id: "leash-role",
    name: "En laisse",
    managed: false,
    position: 2,
  };
  const members = new Map();
  const guild = {
    id: GUILD_ID,
    name: "Test",
    ownerId: actorIsGuildOwner ? "100000000000000010" : GUILD_OWNER,
    members: {
      cache: { get: (id) => members.get(id) ?? null },
      fetchMe: async () => bot,
      fetch: async (arg) =>
        members.get(typeof arg === "string" ? arg : arg.user) ?? null,
    },
    roles: {
      cache: {
        find: (predicate) => roleItems.find(predicate),
        get: (id) => roleItems.find((role) => role.id === id),
      },
      create: async () => {
        roleItems.push(leashRole);
        return leashRole;
      },
    },
  };
  const make = (id, position, roleIds = []) => {
    const owned = new Set(roleIds);
    const member = {
      id,
      guild,
      nickname: "old",
      displayName: id,
      user: { id, username: id, tag: `${id}#0001`, bot: false },
      permissions: { has: () => false },
      roles: {
        highest: { position },
        cache: { has: (roleId) => owned.has(roleId), highest: { position } },
        add: async (role) => {
          calls.roleAdds++;
          owned.add(role.id);
        },
        remove: async (role) => {
          owned.delete(role.id);
        },
      },
      voice: {
        channel: null,
        channelId: null,
        setChannel: async () => {
          calls.moves++;
        },
      },
      setNickname: async function (nickname) {
        calls.nicknames++;
        this.nickname = nickname;
      },
    };
    members.set(id, member);
    return member;
  };
  const bot = make("200000000000000000", 10);
  bot.permissions = { has: () => true };
  const actorId = actorIsGuildOwner
    ? "100000000000000010"
    : "300000000000000001";
  const actor = make(actorId, actorPosition, [
    "sysplus-role",
    "adminplus-role",
  ]);
  if (actorIsGuildOwner) guild.ownerId = actor.id;
  return { guild, bot, actor, make, calls };
}

function dogMessage(world, command, target) {
  const replies = [];
  return {
    replies,
    content: `${command} <@${target.id}>`,
    author: world.actor.user,
    member: world.actor,
    guild: world.guild,
    mentions: { members: { first: () => target } },
    reply: async (payload) => {
      replies.push(payload);
      return { edit: async () => {} };
    },
  };
}

const leashRecords = () =>
  existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, "utf8") || "{}")
    : {};
const untouched = (world) => {
  assert.deepEqual(world.calls, { roleAdds: 0, nicknames: 0, moves: 0 });
};

test("DOG applies a leash to a lower-ranked target (prefix path)", async () => {
  const world = makeWorld();
  const target = world.make("400000000000000001", 3);
  const message = dogMessage(world, "=dog", target);
  assert.equal(await handleDogCommand(message, SETTINGS), true);
  assert.equal(world.calls.roleAdds, 1);
  assert.match(message.replies.at(-1).content, /en laisse/);
});

test("DOG refuses equal, higher, server-owner, PND-owner and above-bot targets without any mutation", async () => {
  const cases = [
    ["equal rank", (w) => w.make("400000000000000002", 5)],
    ["higher rank", (w) => w.make("400000000000000003", 7)],
    ["server owner", (w) => w.make(GUILD_OWNER, 1)],
    ["PND owner", (w) => w.make(PND_OWNER, 1)],
    ["above the bot", (w) => w.make("400000000000000004", 12)],
  ];
  for (const [label, build] of cases) {
    const world = makeWorld();
    const target = build(world);
    const message = dogMessage(world, "=dog", target);
    await handleDogCommand(message, SETTINGS);
    untouched(world);
    assert.match(message.replies.at(-1).content, /^❌/, label);
    assert.equal(
      leashRecords()[`${GUILD_ID}:${target.id}`],
      undefined,
      `${label}: no record written`,
    );
  }
});

test("DOG refuses an equal-rank target through the slash route as well", async () => {
  const world = makeWorld();
  const target = world.make("400000000000000005", 5);
  const replies = [];
  const interaction = {
    isChatInputCommand: () => true,
    inGuild: () => true,
    commandName: "dog",
    options: { getUser: () => target.user },
    user: world.actor.user,
    guild: world.guild,
    channel: {},
    deferReply: async () => {},
    editReply: async (payload) => replies.push(payload),
    followUp: async (payload) => replies.push(payload),
  };
  await handleV4SlashInteraction(interaction, SETTINGS);
  untouched(world);
  assert.match(replies.at(-1).content, /inférieur au tien/);
});

test("the Discord server owner may leash an equal-ranked member (native Discord rule)", async () => {
  const world = makeWorld({ actorPosition: 1, actorIsGuildOwner: true });
  world.actor.roles.cache.has = () => true;
  const target = world.make("400000000000000006", 5);
  await handleDogCommand(dogMessage(world, "=dog", target), SETTINGS);
  assert.equal(world.calls.roleAdds, 1);
});

test("releasing a leash is not blocked by actor rank", async () => {
  const world = makeWorld();
  const target = world.make("400000000000000007", 3);
  await handleDogCommand(dogMessage(world, "=dog", target), SETTINGS);
  target.roles.highest.position = 7; // promoted after being leashed
  const undog = dogMessage(world, "=undog", target);
  await handleDogCommand(undog, SETTINGS);
  assert.match(undog.replies.at(-1).content, /retirée/);
});

function menotteMessage(world, command, target, voiceChannel) {
  const replies = [];
  world.actor.voice.channel = voiceChannel;
  return {
    replies,
    content: `${command} <@${target.id}>`,
    id: "500000000000000001",
    author: world.actor.user,
    member: world.actor,
    guild: world.guild,
    mentions: { members: { first: () => target } },
    reply: async (payload) => {
      replies.push(payload);
    },
  };
}
const voiceChannel = () => ({
  id: "600000000000000001",
  type: 2,
  permissionsFor: () => ({ has: () => true }),
});
const menotteRows = () =>
  db.prepare("SELECT member_id FROM voice_menottes").all();

test("MENOTTE restricts a lower-ranked target, even for an actor holding SYS+", async () => {
  const world = makeWorld();
  const target = world.make("400000000000000008", 3);
  const message = menotteMessage(world, "=menotte", target, voiceChannel());
  await handleVoiceMessage(message, SETTINGS);
  assert.deepEqual(
    menotteRows().map((row) => row.member_id),
    [target.id],
  );
  db.prepare("DELETE FROM voice_menottes").run();
});

test("MENOTTE refuses equal, higher, server-owner, PND-owner and above-bot targets with no mutation", async () => {
  const cases = [
    ["equal rank", (w) => w.make("400000000000000009", 5)],
    ["higher rank", (w) => w.make("400000000000000010", 7)],
    ["server owner", (w) => w.make(GUILD_OWNER, 1)],
    ["PND owner", (w) => w.make(PND_OWNER, 1)],
    ["above the bot", (w) => w.make("400000000000000011", 12)],
  ];
  for (const [label, build] of cases) {
    const world = makeWorld();
    const target = build(world);
    target.voice.channelId = "600000000000000099";
    const message = menotteMessage(world, "=menotte", target, voiceChannel());
    await handleVoiceMessage(message, SETTINGS);
    assert.equal(world.calls.moves, 0, `${label}: nobody moved`);
    assert.deepEqual(menotteRows(), [], `${label}: no restriction stored`);
    assert.ok(
      message.replies.at(-1).content.length > 0,
      `${label}: refusal reason is given`,
    );
  }
});

test("MENOTTE refuses the actor targeting themselves", async () => {
  const world = makeWorld();
  const message = menotteMessage(
    world,
    "=menotte",
    world.actor,
    voiceChannel(),
  );
  await handleVoiceMessage(message, SETTINGS);
  assert.deepEqual(menotteRows(), []);
});
