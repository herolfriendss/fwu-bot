import test from "node:test";
import assert from "node:assert/strict";
import { formatRoleTierList, handleStaffModerationInteraction, ownerOnlyRefusal } from "./staff-moderation.js";
import { forgetTierCache, setRoleTiersForTests } from "./shared/tiers.js";

const OWNER = "100000000000001234";
const GUILD = "200000000000000001";
const STAFF_ROLE = "300000000000000010";

function fakeInteraction({ userId, roleIds = [], sub = "paliers" }) {
  const calls = [];
  const roles = new Map(roleIds.map((id) => [id, { id, name: "Modo" }]));
  const guild = { id: GUILD, roles: { cache: new Map() } };
  const interaction = {
    commandName: "quota",
    deferred: false,
    replied: false,
    guild,
    guildId: GUILD,
    user: { id: userId },
    member: { id: userId, guild, roles: { cache: roles } },
    options: { getSubcommandGroup: () => null, getSubcommand: () => sub },
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    async deferReply(payload) { calls.push(["defer", payload]); this.deferred = true; },
    async reply(payload) { calls.push(["reply", payload]); this.replied = true; },
    async editReply(payload) { calls.push(["edit", payload]); },
  };
  return { interaction, calls };
}

test("/quota paliers : liste lisible, libellé de secours, rôles « % » sans palier signalés", () => {
  const text = formatRoleTierList(
    [{ roleId: "1", tier: 10 }, { roleId: "2", tier: 42 }],
    [{ id: "1", name: "10 %" }, { id: "3", name: "50 % test" }, { id: "4", name: "Membre" }],
  );
  assert.match(text, /<@&1> → 10 % · Modérateur/);
  assert.match(text, /<@&2> → 42 %/);
  assert.match(text, /Sans palier.*<@&3>/);
  assert.doesNotMatch(text, /<@&4>/);
  assert.match(formatRoleTierList([]), /Aucune association explicite/);
});

test("/quota paliers : jamais au-delà de la limite Discord", () => {
  const roles = Array.from({ length: 200 }, (_, i) => ({ id: String(10n ** 17n + BigInt(i)), name: `${i} %` }));
  assert.ok(formatRoleTierList([], roles).length <= 2000);
});

test("refus owner : indique la fin de l'identifiant attendu, ou l'absence d'owner", () => {
  assert.match(ownerOnlyRefusal(OWNER), /…1234/);
  assert.doesNotMatch(ownerOnlyRefusal(OWNER), new RegExp(OWNER));
  assert.match(ownerOnlyRefusal(null), /Aucun owner/);
});

test("/quota paliers : refusé sans palier de modération", async () => {
  process.env.PND_OWNER_DISCORD_ID = OWNER;
  forgetTierCache();
  setRoleTiersForTests(GUILD, []);
  const { interaction, calls } = fakeInteraction({ userId: "400000000000000001" });
  await handleStaffModerationInteraction(interaction);
  assert.equal(calls.length, 1);
  assert.match(calls[0][1].content, /Réservé au staff/);
});

test("/quota paliers : ouvert au staff (plus réservé à l'owner)", async () => {
  process.env.PND_OWNER_DISCORD_ID = OWNER;
  forgetTierCache();
  setRoleTiersForTests(GUILD, [[STAFF_ROLE, 10]]);
  const { interaction, calls } = fakeInteraction({ userId: "400000000000000002", roleIds: [STAFF_ROLE] });
  await handleStaffModerationInteraction(interaction);
  assert.equal(calls[0][0], "defer");
  // Sans base centrale dans les tests : la lecture échoue proprement, mais le contrôle d'accès est passé.
  assert.doesNotMatch(calls.at(-1)[1].content, /Seul l'owner|Réservé au staff/);
});

test("/quota palier (modification) : toujours owner uniquement, avec l'aide au diagnostic", async () => {
  process.env.PND_OWNER_DISCORD_ID = OWNER;
  forgetTierCache();
  setRoleTiersForTests(GUILD, [[STAFF_ROLE, 10]]);
  const { interaction, calls } = fakeInteraction({ userId: "400000000000000002", roleIds: [STAFF_ROLE], sub: "palier" });
  await handleStaffModerationInteraction(interaction);
  assert.match(calls[0][1].content, /Seul l'owner[\s\S]*…1234/);
});
