import test from "node:test";
import assert from "node:assert/strict";
import { buildWelcomePayload, renderWelcomeMessage, FWU_WELCOME_COLOR } from "./welcome.js";

const member = {
  id: "123456789012345678",
  user: { createdTimestamp: 1_700_000_000_000, displayAvatarURL: () => "https://cdn.example/avatar.png" },
  guild: { name: "FWU", memberCount: 42 },
};

test("welcome template replaces supported placeholders and sanitizes server text", () => {
  assert.equal(
    renderWelcomeMessage("Bienvenue {user} sur {server} · {memberCount} · {accountCreatedAt} · {other}", {
      user: "<@123>", server: "FWU\nserveur", memberCount: 42, accountCreatedAt: 1_700_000_000_000,
    }),
    "Bienvenue <@123> sur FWUserveur · 42 · <t:1700000000:D> · {other}",
  );
});

test("welcome is disabled without explicit enablement and channel configuration", () => {
  assert.equal(buildWelcomePayload(member, { enabled: false, channelId: "123456789012345678" }), null);
  assert.equal(buildWelcomePayload(member, { enabled: true, channelId: "" }), null);
});

test("welcome payload uses FWU dark red branding and only pings the joining member", () => {
  const payload = buildWelcomePayload(member, { enabled: true, channelId: "123456789012345679", message: "Bienvenue {user} sur **{server}** !" }, 1_800_000_000_000);
  assert.ok(payload);
  const embed = payload.embeds[0].toJSON();
  assert.equal(embed.color, FWU_WELCOME_COLOR);
  assert.match(embed.description, /Bienvenue <@123456789012345678> sur \*\*FWU\*\*/);
  assert.deepEqual(payload.allowedMentions, { parse: [], users: ["123456789012345678"] });
  assert.equal(embed.fields.length, 2);
});


test("departure message is opt-in and reuses the configured welcome channel by default", async () => {
  const { buildDeparturePayload } = await import("./welcome.js");
  assert.equal(buildDeparturePayload(member, { leaveEnabled: false, channelId: "123456789012345679" }), null);
  const result = buildDeparturePayload(member, { channelId: "123456789012345679", leaveEnabled: true, leaveMessage: "Au revoir {user}, à bientôt sur {server} !" }, 1_800_000_000_000);
  assert.equal(result.channelId, "123456789012345679");
  const embed = result.payload.embeds[0].toJSON();
  assert.match(embed.description, /Au revoir <@123456789012345678>, à bientôt sur FWU/);
  assert.deepEqual(result.payload.allowedMentions, { parse: [], users: ["123456789012345678"] });
});
