import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "fwu-mrole-")), "db.sqlite");
process.env.PND_OWNER_DISCORD_ID = "100000000000000001";
const { memberRoleTargetDecision, memberRolePosition, createMemberRole, editMemberRole, removeMemberRole } = await import("./systems/sysplus/member-roles.js");

const OWNER = "100000000000000001";

test("hierarchy: only a member below the SYS+ (or yourself); OWNER and server owner have full access", () => {
  const base = { guildOwnerId: "go", ownerId: OWNER, targetIsBot: false };
  assert.equal(memberRoleTargetDecision({ ...base, actorId: "a", targetId: "b", actorPosition: 10, targetPosition: 5 }), null);
  assert.match(memberRoleTargetDecision({ ...base, actorId: "a", targetId: "b", actorPosition: 10, targetPosition: 10 }), /sous ton rôle/);
  assert.equal(memberRoleTargetDecision({ ...base, actorId: "a", targetId: "a", actorPosition: 10, targetPosition: 10 }), null);
  assert.equal(memberRoleTargetDecision({ ...base, actorId: OWNER, targetId: "b", actorPosition: 1, targetPosition: 50 }), null);
  assert.match(memberRoleTargetDecision({ ...base, actorId: "a", targetId: OWNER, actorPosition: 99, targetPosition: 1 }), /OWNER/);
  assert.match(memberRoleTargetDecision({ ...base, actorId: "a", targetId: "b", targetIsBot: true, actorPosition: 10, targetPosition: 1 }), /bot/);
});

test("the role is placed just under what the SYS+ and the bot can manage", () => {
  assert.equal(memberRolePosition({ actorPosition: 10, botPosition: 30, actorFull: false }), 9);
  assert.equal(memberRolePosition({ actorPosition: 10, botPosition: 30, actorFull: true }), 29);
  assert.equal(memberRolePosition({ actorPosition: 1, botPosition: 30, actorFull: false }), 1);
});

test("create gives the role to the member (no permission), edit and remove work, one role per member", async () => {
  const roles = new Map();
  const added = [];
  const guild = {
    id: "g", ownerId: "go",
    roles: {
      create: async (o) => { const r = { id: `r${roles.size + 1}`, ...o, setPosition: async (p) => { r.position = p; }, edit: async (c) => Object.assign(r, c), delete: async () => roles.delete(r.id) }; roles.set(r.id, r); return r; },
      fetch: async (id) => roles.get(id) ?? null,
    },
  };
  const actor = { id: "a", roles: { highest: { position: 10 } } };
  const bot = { roles: { highest: { position: 30 } } };
  const target = { id: "b", roles: { add: async (r) => added.push(r.id) } };
  const role = await createMemberRole({ guild, actor, botMember: bot, target, name: "Les Boss", color: "#ff66cc" });
  assert.deepEqual(role.permissions, []);
  assert.equal(role.color, 0xff66cc);
  assert.equal(role.position, 9);
  assert.deepEqual(added, [role.id]);
  await assert.rejects(() => createMemberRole({ guild, actor, botMember: bot, target, name: "Deux", color: "#000000" }), /déjà un rôle perso/);
  await editMemberRole({ guild, actor, target, action: "rename", name: "Nouveau" });
  assert.equal(role.name, "Nouveau");
  await removeMemberRole({ guild, actor, target });
  assert.equal(roles.size, 0);
});
