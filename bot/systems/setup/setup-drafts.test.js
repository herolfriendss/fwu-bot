import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const directory = mkdtempSync(join(tmpdir(), "pnd-setup-drafts-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const legacyDb = new DatabaseSync(process.env.HER_DB_PATH);
legacyDb.exec(`CREATE TABLE discord_setup_drafts (
  draft_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  module TEXT NOT NULL, settings_json TEXT NOT NULL, previous_json TEXT NOT NULL DEFAULT '{}',
  changed_keys TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
)`);
legacyDb.close();
const { handlePanelSetupInteraction } = await import("./panel-setup.js");
const { db } = await import("../../database.js");

function interaction({
  customId = "",
  userId = "owner-a",
  guildId = "guild-a",
  command = false,
  commandName = command ? "setup" : undefined,
  guildOwnerId = userId,
  manageGuild = true,
  values = [],
  fields = null,
  id = "draft-a",
} = {}) {
  const responses = [];
  const member = { id: userId, permissions: { has: () => manageGuild } };
  const botMember = {
    permissions: { has: () => true },
    roles: { highest: { position: 100 } },
  };
  return {
    responses,
    customId,
    values,
    fields: fields ? { getTextInputValue: (key) => fields[key] ?? "" } : undefined,
    id,
    user: { id: userId },
    guildId,
    guild: {
      id: guildId,
      name: `Test ${guildId}`,
      ownerId: guildOwnerId,
      members: {
        fetch: async () => member,
        fetchMe: async () => botMember,
      },
      roles: { fetch: async () => null },
      channels: { fetch: async () => null },
    },
    commandName,
    isChatInputCommand: () => command,
    inGuild: () => true,
    reply: async (payload) => responses.push(payload),
    update: async (payload) => responses.push(payload),
    showModal: async (payload) => responses.push(payload),
    editReply: async (payload) => responses.push(payload),
    deferUpdate: async () => {},
  };
}

test("setup drafts can be resumed after preview expiry only by their author and guild", async (context) => {
  context.after(() => {
    db.close();
    delete process.env.HER_DB_PATH;
    rmSync(directory, { recursive: true, force: true });
  });
  assert.ok(
    db
      .prepare("PRAGMA table_info(discord_setup_drafts)")
      .all()
      .some((column) => column.name === "retained_until"),
  );

  const options = {
    apiUrl: "https://staging.invalid/api",
    secret: "test-only",
    record() {},
    audit() {},
    commandGroups: [
      { category: "SYS+", commands: [{ name: "permissions" }, { name: "sys-panel" }] },
    ],
  };
  const deniedPanel = interaction({
    command: true,
    commandName: "panel",
    userId: "member-b",
    guildOwnerId: "owner-a",
    manageGuild: false,
  });
  await handlePanelSetupInteraction(deniedPanel, {}, options);
  assert.match(deniedPanel.responses[0].content, /Configuration réservée/);

  const panel = interaction({ command: true, commandName: "panel" });
  await handlePanelSetupInteraction(panel, {}, options);
  const panelSelect = panel.responses[0].components[0].toJSON();
  assert.ok(panelSelect.components[0].options.some((option) => option.value === "catalog:SYS+"));
  const privilegedPage = interaction({ customId: "pndpanel:section", values: ["catalog:SYS+"] });
  await handlePanelSetupInteraction(privilegedPage, {}, options);
  assert.match(privilegedPage.responses[0].embeds[0].data.description, /\/permissions/);

  const setup = interaction({ command: true });
  await handlePanelSetupInteraction(setup, {}, options);
  assert.equal(setup.responses[0].components.length, 2);

  const modal = interaction({
    customId: "pndsetup:edit:moderation:owner-a",
    fields: { logChannelId: "", dmOnWarn: "oui", warnExpiryDays: "30" },
  });
  await handlePanelSetupInteraction(modal, {}, options);
  assert.match(modal.responses[0].content, /Aperçu — Modération/);
  db.prepare("UPDATE discord_setup_drafts SET expires_at=? WHERE draft_id=?").run(
    Date.now() - 1,
    "draft-a",
  );

  const ownerList = interaction({ customId: "pndsetup:drafts:owner-a" });
  await handlePanelSetupInteraction(ownerList, {}, options);
  assert.match(ownerList.responses[0].content, /brouillons sont privés/);

  const otherGuildList = interaction({ customId: "pndsetup:drafts:owner-a", guildId: "guild-b" });
  await handlePanelSetupInteraction(otherGuildList, {}, options);
  assert.equal(otherGuildList.responses[0].content, "Aucun brouillon conservé pour ce serveur.");

  const resume = interaction({ customId: "pndsetup:resume:owner-a", values: ["draft-a"] });
  await handlePanelSetupInteraction(resume, {}, options);
  assert.match(resume.responses[0].content, /Aperçu repris — Modération/);
  assert.ok(
    db.prepare("SELECT expires_at FROM discord_setup_drafts WHERE draft_id=?").get("draft-a")
      .expires_at > Date.now(),
  );

  const wrongActor = interaction({
    customId: "pndsetup:resume:owner-a",
    userId: "member-b",
    values: ["draft-a"],
  });
  await handlePanelSetupInteraction(wrongActor, {}, options);
  assert.match(wrongActor.responses[0].content, /autre personne/);
});
