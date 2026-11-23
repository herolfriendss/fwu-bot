import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-dog-undogall-"));
const statePath = join(directory, "dog-state.json");
process.env.PND_DOG_STATE_PATH = statePath;
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
process.env.PND_OWNER_DISCORD_ID = "100000000000000001";

const rec = (guildId, memberId, extra = {}) => ({ guildId, memberId, ownerId: "o", ownerName: "Owner", since: 1, previousNickname: "old", leashRoleId: "dogrole", ...extra });
const seed = () => writeFileSync(statePath, JSON.stringify({
  "g:here": rec("g", "here"),
  "g:gone": rec("g", "gone"),
  "oldguild:x": rec("oldguild", "x"),
  "keptguild:y": rec("keptguild", "y"),
}));
seed();

const { undogAll, pruneDepartedLeashes, canUndogAll, isMemberDogged, handleUndogAllInteraction, orphanLeashParts } = await import("./dog-commands.js");
const { db } = await import("./database.js");

function guild() {
  const calls = [];
  const here = { id: "here", roles: { cache: new Map([["dogrole", {}]]), remove: async (r) => calls.push(["remove", r]) }, setNickname: async (n) => calls.push(["nick", n]) };
  return {
    calls,
    g: {
      id: "g",
      ownerId: "go",
      members: {
        fetch: async ({ user }) => {
          if (Array.isArray(user)) return new Map(user.filter((u) => u === "here").map((u) => [u, here]));
          if (user === "here") return here;
          const error = new Error("Unknown Member"); error.code = 10007; throw error;
        },
      },
    },
  };
}
const client = { guilds: { cache: new Map([["g", {}], ["keptguild", {}]]) } };

test.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

test("/undogall serveur: releases members still here, forgets departed ones, keeps other servers", async () => {
  seed();
  utimesSync(statePath, new Date(), new Date(Date.now() + 5000));
  const { g, calls } = guild();
  const r = await undogAll({ guild: g, client, scope: "serveur" });
  assert.deepEqual(r, { released: 1, forgotten: 1, oldServers: 0, orphans: 0, failed: 0 });
  assert.deepEqual(calls, [["nick", "old"], ["remove", "dogrole"]]);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(statePath, "utf8"))).sort(), ["keptguild:y", "oldguild:x"]);
});

test("/undogall anciens: removes leashes of servers the bot left, nothing else", async () => {
  seed();
  utimesSync(statePath, new Date(), new Date(Date.now() + 10000));
  const { g, calls } = guild();
  const r = await undogAll({ guild: g, client, scope: "anciens" });
  assert.equal(r.oldServers, 1);
  assert.equal(calls.length, 0);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(statePath, "utf8"))).sort(), ["g:gone", "g:here", "keptguild:y"]);
});

test("departed members stop counting in the quota; state written by another bot is re-read", async () => {
  seed();
  utimesSync(statePath, new Date(), new Date(Date.now() + 15000));
  assert.equal(await isMemberDogged("g", "gone"), true);
  const { g } = guild();
  assert.equal(await pruneDepartedLeashes(g), 1);
  assert.equal(await isMemberDogged("g", "gone"), false);
  assert.equal(await isMemberDogged("g", "here"), true);
});

test("only the OWNER, the server owner and administrators may use /undogall", async () => {
  const m = (id, admin = false) => ({ id, guild: { id: "g", ownerId: "go" }, permissions: { has: () => admin } });
  assert.equal(canUndogAll(m("100000000000000001")), true);
  assert.equal(canUndogAll(m("go")), true);
  assert.equal(canUndogAll(m("x", true)), true);
  assert.equal(canUndogAll(m("x")), false);
  const replies = [];
  const handled = await handleUndogAllInteraction({
    isChatInputCommand: () => true, commandName: "undogall", user: { id: "x" },
    guild: { id: "g", ownerId: "go", members: { fetch: async () => m("x") } },
    deferReply: async () => {}, editReply: async (p) => replies.push(p),
  });
  assert.equal(handled, true);
  assert.match(replies[0].content, /réservé/);
});

test("leashes left by the old bot (DOG role or 🐶 nickname, nothing saved) are removed by /undogall", async () => {
  writeFileSync(statePath, JSON.stringify({}));
  utimesSync(statePath, new Date(), new Date(Date.now() + 20000));
  const calls = [];
  const legacyRole = { id: "lr", name: "🐶 En laisse · Her?", managed: false };
  const orphan = { id: "o1", nickname: "🐶 de Ancien", roles: { cache: new Map([["lr", legacyRole]]), remove: async (r) => calls.push(["remove", r.id]) }, setNickname: async (n) => calls.push(["nick", n]) };
  const clean = { id: "c1", nickname: "Normal", roles: { cache: new Map(), remove: async () => calls.push(["bad"]) }, setNickname: async () => calls.push(["bad"]) };
  const g = { id: "g", ownerId: "go", members: { fetch: async (arg) => (arg === undefined ? new Map([["o1", orphan], ["c1", clean]]) : new Map()) } };
  assert.equal(orphanLeashParts(orphan).any, true);
  assert.equal(orphanLeashParts(clean).any, false);
  const r = await undogAll({ guild: g, client, scope: "serveur" });
  assert.equal(r.orphans, 1);
  assert.deepEqual(calls, [["remove", "lr"], ["nick", null]]);
});
