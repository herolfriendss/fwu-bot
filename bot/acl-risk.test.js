import test from "node:test";
import assert from "node:assert/strict";
import {
  PERM,
  analyzeGuildAcl,
  formatAclReport,
  newlyGrantedDangerous,
  newlyRiskyOverwrites,
  normalizeGuildForAcl,
} from "./acl-risk.js";

const everyoneId = "g";
const base = { everyoneId, botPosition: 10 };

test("a clean guild produces no finding", () => {
  const findings = analyzeGuildAcl({
    ...base,
    roles: [
      {
        id: everyoneId,
        name: "@everyone",
        position: 0,
        permissions: (1n << 10n) | (1n << 11n),
      },
    ],
    channels: [],
  });
  assert.deepEqual(findings, []);
  assert.match(formatAclReport(findings), /Aucune ACL risquée/);
});

test("@everyone with Administrator is critical and listed first", () => {
  const findings = analyzeGuildAcl({
    ...base,
    roles: [
      { id: "r", name: "Mods", position: 12, permissions: PERM.BanMembers },
      {
        id: everyoneId,
        name: "@everyone",
        position: 0,
        permissions: PERM.Administrator | PERM.MentionEveryone,
      },
    ],
  });
  assert.equal(findings[0].severity, "critical");
  assert.equal(findings[0].code, "everyone.dangerous");
  assert.ok(findings.some((f) => f.code === "everyone.sensitive"));
  assert.ok(
    findings.some((f) => f.code === "role.above_bot" && f.roleId === "r"),
  );
});

test("Administrator given to many members and missing tier role are reported", () => {
  const findings = analyzeGuildAcl({
    ...base,
    sysPlusRoleId: "gone",
    roles: [
      { id: everyoneId, name: "@everyone", position: 0, permissions: 0n },
      {
        id: "a",
        name: "Admins",
        position: 3,
        permissions: PERM.Administrator,
        memberCount: 12,
      },
      {
        id: "bot",
        name: "Bot",
        position: 9,
        managed: true,
        permissions: PERM.Administrator,
        memberCount: 1,
      },
    ],
  });
  assert.ok(
    findings.some((f) => f.code === "role.admin_many" && f.roleId === "a"),
  );
  assert.ok(findings.some((f) => f.code === "tier.missing"));
  assert.equal(
    findings.some((f) => f.roleId === "bot"),
    false,
    "managed integration roles are not flagged",
  );
});

test("channel overwrites granting escalation to @everyone or a member are flagged", () => {
  const findings = analyzeGuildAcl({
    ...base,
    roles: [
      { id: everyoneId, name: "@everyone", position: 0, permissions: 0n },
    ],
    channels: [
      {
        id: "c1",
        name: "general",
        overwrites: [
          { id: everyoneId, type: 0, allow: PERM.ManageWebhooks, deny: 0n },
        ],
      },
      {
        id: "c2",
        name: "staff",
        overwrites: [
          { id: "u1", type: 1, allow: PERM.ManageRoles, deny: 0n },
          { id: "r1", type: 0, allow: PERM.ManageMessages, deny: 0n },
        ],
      },
    ],
  });
  assert.ok(
    findings.some(
      (f) => f.code === "channel.everyone_allow" && f.channelId === "c1",
    ),
  );
  assert.ok(
    findings.some(
      (f) => f.code === "channel.member_allow" && f.memberId === "u1",
    ),
  );
  assert.equal(
    findings.some(
      (f) => f.channelId === "c2" && f.code !== "channel.member_allow",
    ),
    false,
    "role-scoped staff overwrites are normal",
  );
});

test("realtime diff only reports newly granted risks", () => {
  assert.deepEqual(
    newlyGrantedDangerous(
      PERM.BanMembers,
      PERM.BanMembers | PERM.Administrator,
    ),
    ["Administrator"],
  );
  assert.deepEqual(
    newlyGrantedDangerous(PERM.Administrator, PERM.Administrator),
    [],
  );
  const risks = newlyRiskyOverwrites(
    [{ id: everyoneId, type: 0, allow: 0n }],
    [
      { id: everyoneId, type: 0, allow: PERM.MentionEveryone },
      { id: "role", type: 0, allow: PERM.ManageRoles },
    ],
    everyoneId,
  );
  assert.deepEqual(risks, [
    { id: everyoneId, everyone: true, added: ["MentionEveryone"] },
  ]);
});

test("normalization reads discord.js-like objects", () => {
  const guild = {
    id: everyoneId,
    members: { me: { roles: { highest: { position: 7 } } } },
    roles: {
      cache: new Map([
        [
          everyoneId,
          {
            id: everyoneId,
            name: "@everyone",
            position: 0,
            managed: false,
            permissions: { bitfield: PERM.Administrator },
            members: { size: 3 },
          },
        ],
      ]),
    },
    channels: {
      cache: new Map([
        [
          "c",
          {
            id: "c",
            name: "x",
            permissionOverwrites: {
              cache: new Map([
                [
                  everyoneId,
                  {
                    id: everyoneId,
                    type: 0,
                    allow: { bitfield: 0n },
                    deny: { bitfield: 0n },
                  },
                ],
              ]),
            },
          },
        ],
      ]),
    },
  };
  const input = normalizeGuildForAcl(guild);
  assert.equal(input.botPosition, 7);
  assert.equal(analyzeGuildAcl(input)[0].code, "everyone.dangerous");
});
