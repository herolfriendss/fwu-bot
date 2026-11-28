import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "fwu-ui-")), "db.sqlite");
const { buildUserCard, roleList, subscriptionLabel, handleUserCardInteraction } = await import("./user-card.js");

const G = "111111111111111111";
function fakeMember({ roles = [], voice = null, boost = null } = {}) {
  const guild = { id: G };
  return {
    id: "300000000000000005", guild, displayName: "∞⁸",
    user: { username: "interdependance", createdTimestamp: Date.UTC(2026, 4, 15), displayAvatarURL: () => "https://cdn.discordapp.com/a.png", bannerURL: () => null },
    displayAvatarURL: () => "https://cdn.discordapp.com/m.png",
    joinedTimestamp: Date.UTC(2026, 10, 11), premiumSinceTimestamp: boost,
    roles: { cache: new Map([[G, { id: G, position: 0 }], ...roles.map((r, i) => [r, { id: r, position: i + 1 }])]) },
    voice: { channel: voice },
  };
}

test("card: every section, no @everyone, highest role first, link buttons", () => {
  const voice = { id: "999", members: { size: 4 } };
  const card = buildUserCard(fakeMember({ roles: ["r1", "r2"], voice, boost: Date.UTC(2026, 10, 14) }));
  const e = card.embeds[0].toJSON();
  assert.equal(e.title, "∞⁸");
  assert.match(e.description, /`300000000000000005`/);
  const field = (n) => e.fields.find((f) => f.name.startsWith(n)).value;
  assert.equal(field("Abonnement"), "Aucun");
  assert.match(field("Informations"), /Pseudo\*\* : interdependance/);
  assert.match(field("Informations"), /Boost\*\* : depuis <t:/);
  assert.match(field("Vocal"), /<#999> · avec 3 autres/);
  assert.match(field("Dates"), /Créé.*\n.*Rejoint/);
  assert.equal(e.fields.find((f) => f.name.startsWith("Rôles")).name, "Rôles · 2");
  assert.equal(field("Rôles"), "<@&r2> <@&r1>");
  const labels = card.components[0].toJSON().components.map((c) => c.label);
  assert.deepEqual(labels, ["Profil", "Avatar"]); // no banner: no button
  assert.doesNotMatch(JSON.stringify(e), /FWU/);
});

test("many roles are cut with a counter; no voice; subscription lookup never throws", () => {
  const m = fakeMember({ roles: Array.from({ length: 80 }, (_, i) => `role${String(i).padStart(15, "0")}`) });
  const r = roleList(m);
  assert.equal(r.count, 80);
  assert.ok(r.text.length <= 1000);
  assert.match(r.text, /\+\d+$/);
  assert.equal(buildUserCard(fakeMember()).embeds[0].toJSON().fields.find((f) => f.name === "Vocal").value, "Pas en vocal");
  assert.equal(subscriptionLabel("nope", "x"), null);
});

test("/ui answers publicly with the card, defaults to the author", async () => {
  const member = fakeMember();
  let payload;
  const interaction = {
    isChatInputCommand: () => true, commandName: "ui", user: { id: member.id },
    options: { getUser: () => null },
    guild: { id: G, members: { fetch: async () => member } },
    client: { users: { fetch: async () => ({ ...member.user, bannerURL: () => "https://cdn.discordapp.com/b.png" }) } },
    deferReply: async (o) => { assert.equal(o, undefined); }, editReply: async (p) => { payload = p; },
  };
  assert.equal(await handleUserCardInteraction(interaction), true);
  assert.deepEqual(payload.components[0].toJSON().components.map((c) => c.label), ["Profil", "Avatar", "Bannière"]);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});
