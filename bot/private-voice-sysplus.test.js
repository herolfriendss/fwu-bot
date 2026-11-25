import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { privateVoicePlan } from "./voice-permissions.js";
import { isServerStaff } from "./server-staff.js";

test("a private voice blocks everyone except SYS+, the OWNER, the channel owner and the bot", () => {
  const existing = [{ id: "roleMembers", type: 0 }, { id: "someone", type: 1 }, { id: "sys", type: 0 }];
  const plan = Object.fromEntries(privateVoicePlan(existing, "guild", "chanOwner", "bot", { sysPlusRoleId: "sys", pndOwnerId: "owner" }).map((o) => [o.id, o.Connect]));
  assert.deepEqual(plan, { roleMembers: false, someone: false, sys: true, guild: false, owner: true, chanOwner: true, bot: true });
});

test("without a configured SYS+ role the lock stays strict (never opens @everyone)", () => {
  const plan = privateVoicePlan([], "guild", "chanOwner", "bot", { sysPlusRoleId: "guild" });
  assert.equal(plan.find((o) => o.id === "guild").Connect, false);
});

test("both private-voice entry points pass the SYS+ role", () => {
  const commands = readFileSync(new URL("./voice-commands.js", import.meta.url), "utf8");
  const v2 = readFileSync(new URL("./voice-v2.js", import.meta.url), "utf8");
  assert.match(commands, /lock\(channel, member, bot, settings\.sysPlus\?\.roleId \?\? null\)/);
  assert.match(commands, /lock\(channel, member, bot, sysPlusRoleId\)/);
  assert.match(v2, /lockPrivateVoiceChannel\(channel, member, channel\.guild\.members\.me \?\? channel\.client, guildSettings\?\.sysPlus\?\.roleId \?\? null\)/);
});

test("/sondage is staff only", () => {
  const perms = (bits) => ({ has: (b) => bits.includes(b) });
  const member = (id, roles = [], bits = []) => ({ id, guild: { id: "g", ownerId: "go" }, permissions: perms(bits), roles: { cache: new Map(roles.map((r) => [r, {}])) } });
  const settings = { sysPlus: { roleId: "sys" } };
  assert.equal(isServerStaff(member("u"), settings), false);
  assert.equal(isServerStaff(member("u", ["sys"]), settings), true);
  assert.equal(isServerStaff(member("go"), settings), true);
  assert.equal(isServerStaff(member("u", [], [8192n]), settings), true); // Manage Messages
  const index = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  const at = index.indexOf('if (command === "sondage") {');
  assert.ok(index.slice(at, at + 200).includes("isServerStaff(interaction.member"));
});
