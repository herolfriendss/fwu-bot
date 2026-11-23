import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedRuntimeGuild,
  filterInactiveSourceGuilds,
  hasIsolatedLogPermissions,
  isLogsHub,
  isActiveSourceGuild,
  logChannelForGuild,
  logChannelKey,
  LOG_CHANNELS,
  ALL_LOG_CHANNELS,
  LOG_ROLES,
  MZ_LOG_ROLES,
  LOGS_HUB_GUILD_ID,
  RESERVED_SOURCE_GUILD_ID,
  logRolesForCategory,
} from "./logs-hub.js";

test("only active source and dedicated log server are allowlisted", () => {
  assert.equal(allowedRuntimeGuild("1562643485981544559"), true);
  assert.equal(allowedRuntimeGuild(LOGS_HUB_GUILD_ID), true);
  assert.equal(allowedRuntimeGuild(RESERVED_SOURCE_GUILD_ID), false);
  assert.equal(isLogsHub(LOGS_HUB_GUILD_ID), true);
  assert.equal(isActiveSourceGuild(RESERVED_SOURCE_GUILD_ID), false);
});
test("an explicit runtime guild allowlist cannot activate MZ without its separate opt-in", () => {
  const configured = [
    "1562643485981544559",
    RESERVED_SOURCE_GUILD_ID,
    "test-guild",
    RESERVED_SOURCE_GUILD_ID,
  ];
  assert.deepEqual(filterInactiveSourceGuilds(configured), ["1562643485981544559", "test-guild"]);
  assert.deepEqual(filterInactiveSourceGuilds(configured, true), [
    "1562643485981544559",
    RESERVED_SOURCE_GUILD_ID,
    "test-guild",
  ]);
  assert.deepEqual(filterInactiveSourceGuilds([RESERVED_SOURCE_GUILD_ID]), []);
});
test("log titles route into the intended private channels", () => {
  assert.equal(logChannelKey("DOG — membre en laisse"), "dog");
  assert.equal(logChannelKey("Économie PND — achat"), "economy");
  assert.equal(logChannelKey("Arrivée d’un membre"), "members");
  assert.equal(logChannelKey("Erreur bot"), "errors");
  assert.equal(new Set(LOG_CHANNELS.map((c) => c.key)).size, LOG_CHANNELS.length);
});
test("PND and reserved MZ events route to separate log channels", () => {
  const pnd = logChannelForGuild("1562643485981544559", "DOG — membre en laisse");
  const mz = logChannelForGuild(RESERVED_SOURCE_GUILD_ID, "DOG — membre en laisse");
  assert.equal(pnd?.name, "logs-dog-menotte");
  assert.equal(mz?.name, "mz-logs-dog-menotte");
  assert.notEqual(pnd?.category, mz?.category);
  assert.equal(logChannelForGuild("unconfigured-guild", "Erreur bot"), null);
  assert.equal(ALL_LOG_CHANNELS.length, LOG_CHANNELS.length * 2);
});
test("dedicated log server has the planned role catalogue", () => {
  assert.deepEqual(
    LOG_ROLES.map((r) => r.name),
    ["Logs Owner", "Logs Admin", "Logs Modération", "Logs Économie", "Logs Recrutement", "Logs Viewer"],
  );
  assert.deepEqual(
    MZ_LOG_ROLES.map((r) => r.name),
    LOG_ROLES.map((r) => `MZ ${r.name}`),
  );
  assert.equal(
    new Set([...LOG_ROLES, ...MZ_LOG_ROLES].map((r) => r.name)).size,
    LOG_ROLES.length * 2,
  );
});

test("central log categories deny everyone and separate PND from MZ roles", () => {
  const roles = [...LOG_ROLES, ...MZ_LOG_ROLES].map((role, index) => ({
    id: `role-${index}`,
    name: role.name,
  }));
  const everyone = { id: "everyone", name: "@everyone" };
  const bot = { id: "bot" };
  const makeCategory = (source, publicView = false, permissionOverwrites = [], categoryName = "MODERATION") => ({
    name: source === "mz" ? `MZ — ${categoryName}` : categoryName,
    guild: {
      roles: { everyone, cache: { find: (predicate) => roles.find(predicate) } },
      members: { me: bot },
    },
    permissionOverwrites: { cache: { values: () => permissionOverwrites } },
    permissionsFor(target) {
      const roleView = new Set(logRolesForCategory(categoryName, source).map((role) => role.name));
      const canView =
        target.id === "everyone" ? publicView : target.id === "bot" || roleView.has(target.name);
      return {
        has: (permission) =>
          permission === "ViewChannel"
            ? canView
            : target.id === "bot" && ["SendMessages", "EmbedLinks"].includes(permission),
      };
    },
    source,
  });

  const pndCategory = makeCategory("pnd");
  assert.equal(hasIsolatedLogPermissions(pndCategory, "pnd"), true);
  assert.equal(hasIsolatedLogPermissions(pndCategory, "mz"), false);
  const mzCategory = makeCategory("mz");
  assert.equal(hasIsolatedLogPermissions(mzCategory, "mz"), true);
  assert.equal(hasIsolatedLogPermissions(mzCategory, "pnd"), false);
  const unexpectedAllow = makeCategory("pnd", false, [
    { type: 0, id: "unapproved-role", allow: { has: () => true } },
  ]);
  assert.equal(hasIsolatedLogPermissions(unexpectedAllow, "pnd"), false);
  assert.equal(hasIsolatedLogPermissions(makeCategory("public", true), "pnd"), false);
  assert.equal(hasIsolatedLogPermissions(makeCategory("pnd", false, [
    { type: 1, id: "unapproved-member", allow: { has: () => true } },
  ]), "pnd"), false);
  const administrativeRole = roles.find((role) => role.name === "Logs Modération");
  administrativeRole.permissions = { has: (permission) => permission === "Administrator" };
  assert.equal(hasIsolatedLogPermissions(makeCategory("pnd"), "pnd"), false);
  delete administrativeRole.permissions;
});

test("central log categories grant only the roles matching their sensitivity", () => {
  assert.deepEqual(logRolesForCategory("ADMINISTRATION").map((role) => role.name), ["Logs Owner", "Logs Admin"]);
  assert.deepEqual(logRolesForCategory("MODERATION").map((role) => role.name), ["Logs Owner", "Logs Admin", "Logs Modération"]);
  assert.deepEqual(logRolesForCategory("ECONOMIE").map((role) => role.name), ["Logs Owner", "Logs Admin", "Logs Économie"]);
  assert.deepEqual(logRolesForCategory("SYSTÈMES").map((role) => role.name), ["Logs Owner", "Logs Admin"]);
  assert.equal(logRolesForCategory("MZ — MODERATION", "mz").some((role) => role.name === "MZ Logs Économie"), false);
});

test("category isolation rejects roles with Administrator and member-specific viewers", () => {
  const roles = [...LOG_ROLES, ...MZ_LOG_ROLES].map((role, index) => ({ id: `role-${index}`, name: role.name }));
  const bot = { id: "bot" };
  const everyone = { id: "everyone" };
  const adminLogsRole = roles.find((role) => role.name === "Logs Admin");
  adminLogsRole.permissions = { has: (permission) => permission === "Administrator" };
  const category = {
    name: "ECONOMIE",
    guild: { roles: { everyone, cache: { find: (predicate) => roles.find(predicate) } }, members: { me: bot } },
    permissionOverwrites: { cache: { values: () => [] } },
    permissionsFor: (target) => ({ has: (permission) => permission === "ViewChannel" ? target.id === "bot" || target.id === adminLogsRole.id || target.id === "role-3" : target.id === "bot" && ["SendMessages", "EmbedLinks"].includes(permission) }),
  };
  assert.equal(hasIsolatedLogPermissions(category, "pnd"), false);
  delete adminLogsRole.permissions;
  category.permissionOverwrites.cache.values = () => [{ type: 1, id: "unexpected-member", allow: { has: () => true } }];
  assert.equal(hasIsolatedLogPermissions(category, "pnd"), false);
});

test("ticket, verification and webhook events have dedicated central log destinations", () => {
  assert.equal(logChannelKey("Ticket créé"), "tickets");
  assert.equal(logChannelKey("Vérification CAPTCHA réussie"), "verification");
  assert.equal(logChannelKey("Webhook créé"), "webhooks");
  assert.equal(logChannelForGuild("1562643485981544559", "Ticket fermé")?.name, "logs-tickets");
  assert.equal(logChannelForGuild("1562643485981544559", "Webhook supprimé")?.name, "logs-webhooks");
});
