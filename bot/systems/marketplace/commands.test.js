import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-market-cmd-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { db } = await import("../../database.js");
const { handleMarketPrefix } = await import("./commands.js");
const { grantEntitlement } = await import("../../entitlements.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  delete process.env.MARKETPLACE_ENABLED;
  rmSync(directory, { recursive: true, force: true });
});

const GUILD = "700000000000000001";
const OWNERS = "123456";
const SYS_ROLE = "700000000000000010";
const OWNER = "123456";
const SYS_ADMIN = "733333333333333333";
const text = (r) => (typeof r === "string" ? r : r.content);

function ctx(actor, roles = []) {
  const replies = [];
  return {
    replies,
    message: {
      guild: { id: GUILD },
      member: { id: actor, guild: { id: GUILD }, roles: { cache: { has: (r) => roles.includes(r) } }, permissions: { has: () => false } },
      author: { id: actor },
      reply: async (payload) => { replies.push(payload); },
    },
  };
}

test("while disabled (default), every action is refused", async () => {
  delete process.env.MARKETPLACE_ENABLED;
  const c = ctx(OWNER);
  await handleMarketPrefix(c.message, ["catalog"], { roleId: SYS_ROLE, configuredOwners: OWNERS });
  assert.match(text(c.replies.at(-1)), /désactivé/);
});

test("enabled: a non-owner SYS+ cannot publish to the catalogue, an owner can, and install shows consent first", async () => {
  process.env.MARKETPLACE_ENABLED = "true";
  grantEntitlement({ guildId: GUILD, packKey: "marketplace", actorId: OWNER, durationDays: 30, configuredOwners: OWNERS });
  grantEntitlement({ guildId: GUILD, packKey: "extensions", actorId: OWNER, durationDays: 30, configuredOwners: OWNERS });

  const intruder = ctx(SYS_ADMIN, [SYS_ROLE]);
  await handleMarketPrefix(intruder.message, ["publish", "carte-test", "Carte", "Résumé"], { roleId: SYS_ROLE, configuredOwners: OWNERS });
  assert.match(text(intruder.replies.at(-1)), /propriétaire/);

  const owner = ctx(OWNER, [SYS_ROLE]);
  await handleMarketPrefix(owner.message, ["publish", "carte-test", "Carte", "Résumé"], { roleId: SYS_ROLE, configuredOwners: OWNERS });
  assert.match(text(owner.replies.at(-1)), /listé/);

  const manifest = JSON.stringify({ id: "carte-test", version: "1.0.0", name: "Carte", summary: "x", permissions: ["channels.read.names"] });
  await handleMarketPrefix(owner.message, ["submit", "carte-test", manifest], { roleId: SYS_ROLE, configuredOwners: OWNERS });
  assert.match(text(owner.replies.at(-1)), /soumis à revue/);
  await handleMarketPrefix(owner.message, ["validate", "carte-test", "1.0.0"], { roleId: SYS_ROLE, configuredOwners: OWNERS });
  assert.match(text(owner.replies.at(-1)), /validée/);

  const admin = ctx(SYS_ADMIN, [SYS_ROLE]);
  await handleMarketPrefix(admin.message, ["install", "carte-test", "1.0.0"], { roleId: SYS_ROLE, configuredOwners: OWNERS });
  assert.match(text(admin.replies.at(-1)), /demande/);
  assert.match(text(admin.replies.at(-1)), /channels\.read\.names/);
  await handleMarketPrefix(admin.message, ["install", "carte-test", "1.0.0", "confirmer"], { roleId: SYS_ROLE, configuredOwners: OWNERS });
  assert.match(text(admin.replies.at(-1)), /installé/);
});

function slashInteraction({ group, sub, values = {}, bools = {}, actor = SYS_ADMIN, roles = [SYS_ROLE] }) {
  const replies = [];
  const member = { id: actor, guild: { id: GUILD }, roles: { cache: { has: (r) => roles.includes(r) } }, permissions: { has: () => false } };
  return {
    replies,
    interaction: {
      isChatInputCommand: () => true,
      commandName: "sysp",
      guild: { id: GUILD, members: { fetch: async () => member } },
      user: { id: actor },
      options: {
        getSubcommandGroup: () => group ?? null,
        getSubcommand: () => sub,
        getString: (name) => values[name] ?? null,
        getBoolean: (name) => bools[name] ?? null,
      },
      reply: async (payload) => { replies.push(payload); },
    },
  };
}

test("slash: /sysp market is routed by group only and never intercepts other SYS+ commands", async () => {
  const { handleMarketInteraction } = await import("./commands.js");
  const other = slashInteraction({ group: null, sub: "panel" });
  assert.equal(await handleMarketInteraction(other.interaction, { roleId: SYS_ROLE, configuredOwners: OWNERS }), false);
  assert.equal(other.replies.length, 0);
});

test("slash: install asks for consent first and installs only when confirmer is true", async () => {
  const { runMarketAction } = await import("./commands.js");
  const owner = { id: OWNER, guild: { id: GUILD }, roles: { cache: { has: () => true } }, permissions: { has: () => false } };
  const guild = { id: GUILD };
  await runMarketAction({ guild, member: owner, actorId: OWNER, roleId: SYS_ROLE, configuredOwners: OWNERS, action: "publish", args: ["slash-ext", "Extension slash", "Test"] });
  await runMarketAction({ guild, member: owner, actorId: OWNER, roleId: SYS_ROLE, configuredOwners: OWNERS, action: "submit", args: ["slash-ext", JSON.stringify({ id: "slash-ext", version: "1.0.0", name: "Extension slash", summary: "", permissions: ["members.read.counts"] })] });
  await runMarketAction({ guild, member: owner, actorId: OWNER, roleId: SYS_ROLE, configuredOwners: OWNERS, action: "validate", args: ["slash-ext", "1.0.0"] });

  const { handleMarketInteraction } = await import("./commands.js");
  const first = slashInteraction({ group: "market", sub: "install", values: { id: "slash-ext", version: "1.0.0" } });
  await handleMarketInteraction(first.interaction, { roleId: SYS_ROLE, configuredOwners: OWNERS });
  assert.match(first.replies.at(-1).content, /demande/);
  assert.match(first.replies.at(-1).content, /members\.read\.counts/);
  assert.equal(first.replies.at(-1).ephemeral, true);

  const second = slashInteraction({ group: "market", sub: "install", values: { id: "slash-ext", version: "1.0.0" }, bools: { confirmer: true } });
  await handleMarketInteraction(second.interaction, { roleId: SYS_ROLE, configuredOwners: OWNERS });
  assert.match(second.replies.at(-1).content, /installé/);
});
