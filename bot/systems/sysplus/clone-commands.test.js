import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-clone-cmd-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { handleSysPlusMessage, handleSysPlusInteraction } = await import("./commands.js");
const { createGuildBlueprint } = await import("../../guild-blueprints.js");
const { db } = await import("../../database.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

const GUILD_ID = "700000000000000001";
const SYS_ROLE = "700000000000000002";
const ACTOR = "700000000000000003";

function collection(items) {
  const map = new Map(items.map((item) => [item.id, item]));
  return { values: () => map.values(), get: (id) => map.get(id), fetch: async () => map };
}

function buildGuild(extra = {}) {
  const created = { roles: [], channels: [] };
  const guild = {
    id: GUILD_ID,
    name: "PND test",
    ownerId: "owner",
    client: null,
    roles: {
      cache: collection([
        { id: "r-everyone", name: "@everyone", managed: false, permissions: { bitfield: 1024n }, position: 0 },
        { id: "r-staff", name: "Staff", managed: false, color: 0, hoist: true, mentionable: false, permissions: { bitfield: 1n << 3n }, position: 2 },
      ]),
      fetch: async () => null,
      create: async (data) => { created.roles.push(data); return { id: `new-role-${created.roles.length}` }; },
    },
    channels: {
      cache: collection([
        { id: "c-general", name: "general", type: 0, parentId: null, position: 0, permissionOverwrites: { cache: collection([]) } },
      ]),
      fetch: async () => null,
      create: async (data) => { created.channels.push(data); return { id: `new-chan-${created.channels.length}` }; },
    },
    ...extra,
  };
  return { guild, created };
}

function message(guild, content) {
  const replies = [];
  const member = {
    id: ACTOR,
    guild,
    roles: { cache: { has: (roleId) => roleId === SYS_ROLE } },
    permissions: { has: () => false },
  };
  return {
    replies,
    message: {
      content,
      guild,
      member,
      author: { id: ACTOR },
      reply: async (payload) => { replies.push(payload); },
    },
  };
}

// A blueprint captured from the same server, as Time Machine would store it.
const { guild: baseGuild } = buildGuild();
const { blueprintId } = createGuildBlueprint(baseGuild, "Structure test", ACTOR, { authorizeActor: () => true });
const shortId = blueprintId.slice(0, 8);
const roleCfg = { sysPlus: { roleId: SYS_ROLE } };

test("=sysp clone plan is refused without the server.tools entitlement and creates nothing", async () => {
  const { guild, created } = buildGuild();
  const { message: msg, replies } = message(guild, `=sysp clone plan ${shortId}`);
  assert.equal(await handleSysPlusMessage(msg, roleCfg, {}), true);
  assert.match(replies.at(-1), /Server Tools/);
  assert.equal(created.roles.length + created.channels.length, 0);
});

test("=sysp clone apply is refused without the entitlement even with a token, and creates nothing", async () => {
  const { guild, created } = buildGuild();
  const { message: msg, replies } = message(guild, `=sysp clone apply ${shortId} 0123456789abcdef`);
  assert.equal(await handleSysPlusMessage(msg, roleCfg, {}), true);
  assert.match(replies.at(-1), /Server Tools/);
  assert.equal(created.roles.length + created.channels.length, 0);
});

test("an unknown or ambiguous blueprint id is refused before any authorization or creation", async () => {
  const { guild, created } = buildGuild();
  const { message: msg, replies } = message(guild, "=sysp clone plan ffffffff");
  await handleSysPlusMessage(msg, roleCfg, {});
  assert.match(replies.at(-1), /introuvable ou ambigu/);
  assert.equal(created.roles.length + created.channels.length, 0);
});

test("non SYS+ members cannot reach the clone command at all", async () => {
  const { guild, created } = buildGuild();
  const replies = [];
  const outsider = {
    content: `=sysp clone apply ${shortId} x`,
    guild,
    member: { id: ACTOR, guild, roles: { cache: { has: () => false } }, permissions: { has: () => false } },
    author: { id: ACTOR },
    reply: async (payload) => { replies.push(payload); },
  };
  await handleSysPlusMessage(outsider, roleCfg, {});
  assert.match(replies.at(-1), /Accès réservé au rôle Perm Sys\+/);
  assert.equal(created.roles.length + created.channels.length, 0);
});

test("/sysp clone uses the same business flow and refusals as the prefix command, ephemerally", async () => {
  const { guild, created } = buildGuild();
  const replies = [];
  const member = { id: ACTOR, guild, roles: { cache: { has: (roleId) => roleId === SYS_ROLE } }, permissions: { has: () => false } };
  guild.members = { fetch: async () => member };
  const values = { action: "apply", blueprint: shortId, jeton: "0123456789abcdef" };
  const interaction = {
    isChatInputCommand: () => true,
    commandName: "sysp",
    guild,
    user: { id: ACTOR },
    options: {
      getSubcommand: () => "clone",
      getString: (name) => values[name] ?? null,
    },
    reply: async (payload) => { replies.push(payload); },
  };
  assert.equal(await handleSysPlusInteraction(interaction, { [GUILD_ID]: { sysPlus: { roleId: SYS_ROLE } } }, { record: () => {} }), true);
  assert.equal(replies.at(-1).ephemeral, true);
  assert.match(replies.at(-1).content, /Server Tools/);
  assert.equal(created.roles.length + created.channels.length, 0);
});
