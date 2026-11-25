import test from "node:test";
import assert from "node:assert/strict";
import { handlePanelSetupInteraction } from "./panel-setup.js";

const GUILD = "111111111111111111";
const OWNER = "222222222222222222";
const ROLE = "333333333333333333";
const CHANNEL = "444444444444444444";

function interaction({
  customId = "",
  userId = OWNER,
  command = false,
  commandName = command ? "setup" : undefined,
  manageGuild = true,
  values = [],
  fields = null,
} = {}) {
  const calls = [];
  const member = { id: userId, permissions: { has: () => manageGuild } };
  const botMember = { permissions: { has: () => true }, roles: { highest: { position: 100 } } };
  const push = (name) => async (payload) => calls.push([name, payload]);
  return {
    calls,
    customId,
    values,
    fields: fields ? { getTextInputValue: (key) => fields[key] ?? "" } : undefined,
    id: "interaction-1",
    user: { id: userId },
    guildId: GUILD,
    guild: {
      id: GUILD,
      name: "Serveur test",
      ownerId: OWNER,
      members: { fetch: async () => member, fetchMe: async () => botMember },
      roles: { fetch: async (id) => ({ id, managed: false, position: 1 }) },
      channels: {
        fetch: async (id) => ({ id, guildId: GUILD, type: 0, permissionsFor: () => ({ has: () => true }) }),
      },
    },
    commandName,
    isChatInputCommand: () => command,
    isFromMessage: () => true,
    inGuild: () => true,
    reply: push("reply"),
    update: push("update"),
    showModal: push("showModal"),
    editReply: push("editReply"),
    deferUpdate: push("deferUpdate"),
    deferReply: push("deferReply"),
  };
}

/** Faux tableau de bord : GET renvoie les réglages, POST module-settings les fusionne. */
function fakeDashboard(t, initial) {
  const store = structuredClone(initial);
  const posts = [];
  t.mock.method(globalThis, "fetch", async (_url, init = {}) => {
    if (init.method === "POST") {
      const body = JSON.parse(init.body);
      posts.push(body);
      store[body.guildId] = { ...store[body.guildId], [body.module]: body.settings };
      return new Response(JSON.stringify({ ok: true, settings: store[body.guildId] }));
    }
    return new Response(JSON.stringify({ guilds: store }));
  });
  return { store, posts };
}

const options = (extra = {}) => ({ apiUrl: "https://staging.invalid/api", secret: "test-only", ...extra });
const text = (payload) => JSON.stringify(payload);

test("/setup lists every module with its French status and no draft button", async () => {
  const setup = interaction({ command: true });
  await handlePanelSetupInteraction(setup, { [GUILD]: { spam: { enabled: true } } }, options());
  const [[name, payload]] = setup.calls;
  assert.equal(name, "reply");
  assert.equal(payload.ephemeral, true);
  const description = payload.embeds[0].data.description;
  assert.match(description, /🟢 \*\*Anti-spam et mentions\*\* — Activé/);
  assert.match(description, /🔴 \*\*Tickets communautaires\*\* — Désactivé/);
  assert.match(description, /⚙️ \*\*Modération\*\* — Toujours actif/);
  assert.equal(payload.components.length, 1);
  assert.doesNotMatch(text(payload), /brouillon|Mes brouillons|aperçu/i);
});

test("choosing a module shows its settings in French with an Activer button", async () => {
  const settings = { [GUILD]: { tickets: { enabled: false, supportRoleId: ROLE, maxOpenPerUser: 2 } } };
  const view = interaction({ customId: `pndsetup:module:${OWNER}`, values: ["tickets"] });
  await handlePanelSetupInteraction(view, settings, options());
  const [[name, payload]] = view.calls;
  assert.equal(name, "update");
  const embed = payload.embeds[0].data;
  assert.match(embed.title, /Tickets communautaires/);
  assert.match(embed.description, /Statut :\*\* Désactivé/);
  const fields = Object.fromEntries(embed.fields.map((field) => [field.name, field.value]));
  assert.equal(fields["Rôle support"], `<@&${ROLE}>`);
  assert.equal(fields["Tickets ouverts par membre"], "2");
  assert.equal(fields["Catégorie des tickets"], "*Non défini*");
  const buttons = payload.components[1].toJSON().components;
  assert.deepEqual(buttons.map((button) => button.label), ["Activer", "Modifier les réglages", "Retour à la liste"]);
  assert.equal(buttons[0].custom_id, `pndsetup:toggle:tickets:on:${OWNER}`);
});

test("Activer saves immediately, without a draft, and keeps the other settings", async (t) => {
  const { posts } = fakeDashboard(t, { [GUILD]: { tickets: { enabled: false, maxOpenPerUser: 3, supportRoleId: ROLE } } });
  const settings = { [GUILD]: { tickets: { enabled: false } } };
  const audits = [];
  const toggle = interaction({ customId: `pndsetup:toggle:tickets:on:${OWNER}` });
  await handlePanelSetupInteraction(toggle, settings, options({ audit: (...args) => audits.push(args), record() {} }));
  assert.deepEqual(toggle.calls.map(([name]) => name), ["deferUpdate", "editReply"]);
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].settings, { enabled: true, maxOpenPerUser: 3, supportRoleId: ROLE });
  assert.deepEqual(posts[0].changes, { enabled: true });
  assert.deepEqual(posts[0].expected, { enabled: false });
  assert.equal(settings[GUILD].tickets.enabled, true);
  const payload = toggle.calls[1][1];
  assert.match(payload.content, /est maintenant activé/);
  assert.equal(payload.components[1].toJSON().components[0].label, "Désactiver");
  assert.equal(audits.length, 1);
});

test("Désactiver always works even if a configured role disappeared", async (t) => {
  const { posts } = fakeDashboard(t, { [GUILD]: { tickets: { enabled: true, supportRoleId: ROLE } } });
  const toggle = interaction({ customId: `pndsetup:toggle:tickets:off:${OWNER}` });
  toggle.guild.roles.fetch = async () => null;
  await handlePanelSetupInteraction(toggle, { [GUILD]: { tickets: { enabled: true } } }, options());
  assert.equal(posts.length, 1);
  assert.equal(posts[0].settings.enabled, false);
  assert.match(toggle.calls[1][1].content, /désactivé/);
});

test("enabling a module that misses a required channel explains what to fill in", async (t) => {
  const { posts } = fakeDashboard(t, { [GUILD]: { verification: { enabled: false } } });
  const toggle = interaction({ customId: `pndsetup:toggle:verification:on:${OWNER}` });
  await handlePanelSetupInteraction(toggle, { [GUILD]: {} }, options());
  assert.equal(posts.length, 0);
  assert.match(toggle.calls[1][1].content, /demande un rôle validé.*Modifier les réglages/);
});

test("the form omits the on/off field and saves the edited values directly", async (t) => {
  const settings = { [GUILD]: { guildGuard: { enabled: true, youngAccountAction: "kick", minAccountAgeDays: 3 } } };
  const open = interaction({ customId: `pndsetup:form:guildGuard:${OWNER}` });
  await handlePanelSetupInteraction(open, settings, options());
  const modal = open.calls[0][1].toJSON();
  assert.equal(modal.custom_id, `pndsetup:save:guildGuard:${OWNER}`);
  const inputs = modal.components.map((row) => row.components[0]);
  assert.ok(!inputs.some((input) => input.custom_id === "enabled"));
  assert.equal(inputs.find((input) => input.custom_id === "youngAccountAction").value, "expulser");

  const { posts } = fakeDashboard(t, settings);
  const save = interaction({
    customId: `pndsetup:save:guildGuard:${OWNER}`,
    fields: { minAccountAgeDays: "7", youngAccountAction: "quarantaine", quarantineRoleId: ROLE, logChannelId: `<#${CHANNEL}>` },
  });
  await handlePanelSetupInteraction(save, settings, options());
  assert.equal(posts.length, 1);
  assert.deepEqual(Object.keys(posts[0].changes).sort(), ["logChannelId", "minAccountAgeDays", "quarantineRoleId", "youngAccountAction"]);
  assert.deepEqual(posts[0].settings, {
    enabled: true,
    youngAccountAction: "quarantine",
    minAccountAgeDays: 7,
    quarantineRoleId: ROLE,
    logChannelId: CHANNEL,
  });
  const payload = save.calls.at(-1)[1];
  assert.match(payload.content, /Réglages de \*\*Sécurité anti-raid\*\* enregistrés/);
  const fields = Object.fromEntries(payload.embeds[0].data.fields.map((field) => [field.name, field.value]));
  assert.equal(fields["Action compte récent"], "Mettre en quarantaine");
});

test("invalid form input is refused in French and nothing is saved", async (t) => {
  const { posts } = fakeDashboard(t, { [GUILD]: {} });
  const save = interaction({
    customId: `pndsetup:save:tickets:${OWNER}`,
    fields: { maxOpenPerUser: "9", categoryId: "", supportRoleId: "", logChannelId: "" },
  });
  await handlePanelSetupInteraction(save, { [GUILD]: {} }, options());
  assert.equal(posts.length, 0);
  assert.match(save.calls[0][1].content, /entre 1 et 5/);
});

test("dashboard unavailable: clear French error and the view stays usable", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("down", { status: 503 }));
  const toggle = interaction({ customId: `pndsetup:toggle:spam:on:${OWNER}` });
  await handlePanelSetupInteraction(toggle, { [GUILD]: {} }, options());
  const payload = toggle.calls[1][1];
  assert.match(payload.content, /Rien n’a été modifié/);
  assert.equal(payload.components.length, 2);
});

test("controls are bound to their author and to members who can manage the server", async () => {
  const stranger = interaction({ customId: `pndsetup:toggle:spam:on:${OWNER}`, userId: "999999999999999999" });
  await handlePanelSetupInteraction(stranger, { [GUILD]: {} }, options());
  assert.match(stranger.calls[0][1].content, /autre personne/);

  const noRights = interaction({ command: true, userId: "888888888888888888", manageGuild: false });
  await handlePanelSetupInteraction(noRights, { [GUILD]: {} }, options());
  assert.match(noRights.calls[0][1].content, /Configuration réservée/);
});

test("buttons from the old draft system answer with a clear message instead of failing", async () => {
  for (const customId of [
    `pndsetup:apply:123456:${OWNER}`,
    `pndsetup:cancel:123456:${OWNER}`,
    `pndsetup:drafts:${OWNER}`,
    `pndsetup:edit:spam:${OWNER}`,
    `pndsetup:toggle:spam:${OWNER}`,
  ]) {
    const old = interaction({ customId });
    await handlePanelSetupInteraction(old, { [GUILD]: {} }, options());
    assert.equal(old.calls.length, 1, customId);
    assert.match(old.calls[0][1].content, /n’est plus valable.*\/setup/);
  }
});

test("/panel still opens the control centre with the command catalogue", async () => {
  const panel = interaction({ command: true, commandName: "panel" });
  await handlePanelSetupInteraction(panel, {}, options({
    commandGroups: [{ category: "SYS+", commands: [{ name: "permissions" }] }],
  }));
  const select = panel.calls[0][1].components[0].toJSON();
  assert.ok(select.components[0].options.some((option) => option.value === "catalog:SYS+"));
  assert.match(panel.calls[0][1].embeds[0].data.fields[0].value, /Toujours actif|Désactivé/);
});

test("a stale cache never flips the module the wrong way", async (t) => {
  // Le site a désactivé le module ; la fiche affichait encore « Désactiver ».
  const { posts } = fakeDashboard(t, { [GUILD]: { spam: { enabled: false } } });
  const toggle = interaction({ customId: `pndsetup:toggle:spam:off:${OWNER}` });
  await handlePanelSetupInteraction(toggle, { [GUILD]: { spam: { enabled: true } } }, options());
  assert.equal(posts.length, 0);
  const payload = toggle.calls.at(-1)[1];
  assert.match(payload.content, /était déjà désactivé/);
  assert.equal(payload.components[1].toJSON().components[0].label, "Activer");
});

test("the form only sends the fields the admin changed and keeps changes made elsewhere", async (t) => {
  const shown = { [GUILD]: { tickets: { enabled: true, maxOpenPerUser: 1, supportRoleId: ROLE, categoryId: null, logChannelId: null } } };
  const open = interaction({ customId: `pndsetup:form:tickets:${OWNER}` });
  await handlePanelSetupInteraction(open, shown, options());
  // Pendant ce temps, le site change la catégorie et désactive le module.
  const { posts } = fakeDashboard(t, {
    [GUILD]: { tickets: { enabled: false, maxOpenPerUser: 1, supportRoleId: ROLE, categoryId: CHANNEL, logChannelId: null } },
  });
  const save = interaction({
    customId: `pndsetup:save:tickets:${OWNER}`,
    fields: { categoryId: "", supportRoleId: ROLE, logChannelId: "", maxOpenPerUser: "4" },
  });
  save.guild.channels.fetch = async (id) => ({ id, guildId: GUILD, type: 4, permissionsFor: () => ({ has: () => true }) });
  await handlePanelSetupInteraction(save, shown, options());
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].changes, { maxOpenPerUser: 4 });
  assert.deepEqual(posts[0].expected, { maxOpenPerUser: 1 });
  assert.equal(posts[0].settings.categoryId, CHANNEL);
  assert.equal(posts[0].settings.enabled, false);
});

test("a field changed both in the form and elsewhere is not overwritten", async (t) => {
  const shown = { [GUILD]: { tickets: { enabled: false, maxOpenPerUser: 1 } } };
  const open = interaction({ customId: `pndsetup:form:tickets:${OWNER}` });
  await handlePanelSetupInteraction(open, shown, options());
  const { posts } = fakeDashboard(t, { [GUILD]: { tickets: { enabled: false, maxOpenPerUser: 2 } } });
  const save = interaction({
    customId: `pndsetup:save:tickets:${OWNER}`,
    fields: { categoryId: "", supportRoleId: "", logChannelId: "", maxOpenPerUser: "4" },
  });
  await handlePanelSetupInteraction(save, shown, options());
  assert.equal(posts.length, 0);
  const payload = save.calls.at(-1)[1];
  assert.match(payload.content, /Modifié ailleurs entre-temps.*Tickets ouverts par membre/);
  const fields = Object.fromEntries(payload.embeds[0].data.fields.map((field) => [field.name, field.value]));
  assert.equal(fields["Tickets ouverts par membre"], "2");
});

test("a server-side conflict (409) is reported without overwriting", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, init = {}) =>
    init.method === "POST"
      ? new Response("{}", { status: 409 })
      : new Response(JSON.stringify({ guilds: { [GUILD]: { spam: { enabled: false } } } })));
  const toggle = interaction({ customId: `pndsetup:toggle:spam:on:${OWNER}` });
  await handlePanelSetupInteraction(toggle, { [GUILD]: {} }, options());
  assert.match(toggle.calls.at(-1)[1].content, /modifiés ailleurs.*Rien n’a été écrasé/);
});
