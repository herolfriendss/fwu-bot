import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChannelType, PermissionFlagsBits as P, PermissionsBitField } from "discord.js";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "fwu-autoconfig-")), "db.sqlite");
const { findChannelByName, staffLadderCandidates, runAutoconfig, autoconfigValue } = await import("./autoconfig.js");

const role = (id, position, perms = [], extra = {}) => ({ id, name: id, position, managed: false, permissions: new PermissionsBitField(perms), ...extra });

test("finds existing channels by accent-insensitive name", () => {
  const channels = [{ id: "1", name: "général", type: ChannelType.GuildText }, { id: "2", name: "💡・Idées", type: ChannelType.GuildText }, { id: "3", name: "niveaux", type: ChannelType.GuildVoice }];
  assert.equal(findChannelByName(channels, [/suggestion|idee/])?.id, "2");
  assert.equal(findChannelByName(channels, [/niveau/]), null);
});

test("staff ladder keeps moderation roles below the bot, never admins", () => {
  const roles = [role("g", 0), role("helper", 2, [P.ManageMessages]), role("mod", 4, [P.KickMembers]), role("admin", 6, [P.Administrator]), role("above", 9, [P.BanMembers]), role("bot", 5, [P.BanMembers], { managed: true }), role("vip", 3)];
  assert.deepEqual(staffLadderCandidates(roles, "g", 8), ["helper", "mod"]);
});

test("runs once: reuses, creates what is missing, fills only empty settings", async () => {
  const created = [];
  const channels = new Map([["s1", { id: "s1", name: "suggestions", type: ChannelType.GuildText }]]);
  const roles = new Map([["g", role("g", 0)], ["mod", role("mod", 3, [P.KickMembers])], ["helper", role("helper", 2, [P.ModerateMembers])]]);
  const me = { id: "bot", roles: { highest: { position: 10 } }, permissions: new PermissionsBitField([P.ManageChannels, P.ManageRoles]) };
  const guild = {
    id: "g", name: "G", members: { me },
    channels: { cache: channels, create: async (data) => { const c = { id: `c${created.length}`, ...data }; created.push(data.name); channels.set(c.id, c); return c; } },
    roles: { cache: roles, create: async (data) => { const r = role(`r${created.length}`, 1, [], { name: data.name }); created.push(data.name); roles.set(r.id, r); return r; } },
  };
  const settings = {}; const levels = {}; let ladder = [];
  const store = { setting: (g, k, v) => { settings[k] ??= v; }, levelChannel: (g, c) => { levels.c ??= c; }, ladder: () => ladder, saveLadder: (g, ids) => { ladder = ids; } };
  const serves = (d) => d !== "guard";
  await runAutoconfig([guild], serves, store);
  assert.equal(settings.suggestion_channel, "s1");
  assert.deepEqual(created, ["✨ FWU", "⭐・niveaux", "🎂・anniversaires", "🎂 Anniversaire"]);
  assert.deepEqual(ladder, ["helper", "mod"]);
  assert.ok(autoconfigValue("g", "fwu:levels"));
  created.length = 0;
  await runAutoconfig([guild], serves, store);
  assert.deepEqual(created, [], "second run creates nothing");
});
