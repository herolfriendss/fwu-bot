import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-malus-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { handleMalusInteraction, handleMalusMessage, activeKinds, expireMalus } = await import("./commands.js");
const { db } = await import("../../database.js");

function makeGuild() {
  const members = new Map();
  const make = (id, sys = false) => ({ id, user: { id, bot: false, username: id }, displayName: id, guild: null,
    roles: { cache: { has: (r) => sys && r === "sys-role", values: () => [] , some: () => false, map: () => [] }, highest: { position: sys ? 5 : 1 } },
    permissions: { has: () => sys } });
  const actor = make("sys", true), target = make("cible");
  members.set(actor.id, actor); members.set(target.id, target);
  const guild = { id: "g1", ownerId: "owner", members: { me: { id: "bot" }, cache: members, fetch: async (q) => members.get(typeof q === "string" ? q : q.user) ?? null }, roles: { cache: new Map() } };
  actor.guild = guild; target.guild = guild;
  return { guild, actor, target };
}

test("/malus perroquet then a message is reposted transformed; stop lifts it", async (context) => {
  context.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  const { guild, actor, target } = makeGuild();
  const sent = [];
  const channel = { send: async (p) => { sent.push(p.content); return { react: async () => {}, delete: async () => {} }; }, permissionsFor: () => ({ has: () => true }) };
  const replies = [];
  const interaction = (sub, extra = {}) => ({
    isChatInputCommand: () => true, inGuild: () => true, commandName: "malus", guild, channel, user: { id: actor.id },
    options: { getSubcommand: () => sub, getUser: () => target.user, getInteger: () => extra.minutes ?? null, getString: () => null },
    deferReply: async () => {}, editReply: async (p) => replies.push(p.content), reply: async () => {},
  });
  await handleMalusInteraction(interaction("perroquet", { minutes: 5 }), { sysPlus: { roleId: "sys-role" } });
  assert.match(replies.at(-1), /Perroquet posé/, replies.at(-1));
  assert.deepEqual(activeKinds("g1", "cible"), ["perroquet"]);

  let deleted = false;
  const message = { guild, channel, author: target.user, member: target, content: "abc", attachments: new Map(), delete: async () => { deleted = true; } };
  assert.equal(await handleMalusMessage(message, () => {}, { random: () => 0.5 }), true);
  assert.equal(deleted, true);
  assert.equal(sent.at(-1), "**cible** : cba");

  await handleMalusInteraction(interaction("stop"), { sysPlus: { roleId: "sys-role" } });
  assert.match(replies.at(-1), /levé/);
  assert.deepEqual(activeKinds("g1", "cible"), []);
  assert.equal(await handleMalusMessage({ ...message, delete: async () => { throw new Error("ne doit pas"); } }), false);

  // Non-SYS+ refused, owner untouchable
  const bad = { ...interaction("clown"), user: { id: "cible" } };
  await handleMalusInteraction(bad, { sysPlus: { roleId: "sys-role" } });
  assert.match(replies.at(-1), /réservés aux membres SYS\+/);

  // Expiry
  db.prepare("INSERT INTO malus_active VALUES ('g1','cible','clown','sys',0,1,NULL)").run();
  assert.equal(await expireMalus({ guilds: { cache: new Map([["g1", guild]]) } }), 1);
  assert.deepEqual(activeKinds("g1", "cible"), []);
});
