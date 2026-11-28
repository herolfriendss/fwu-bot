import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.HER_DB_PATH = join(mkdtempSync(join(tmpdir(), "fwu-authority-")), "db.sqlite");
const { handleAuthorityInteraction, AUTHORITY_TYPE_CHOICES } = await import("./authority-commands.js");
const { EXCEPTIONABLE } = await import("../authority.js");

const G = "111111111111111111";
const OWNER = "100000000000000001"; const MEMBER = "300000000000000005"; const SYS = "300000000000000003";
const env = { PND_OWNER_DISCORD_ID: OWNER, PND_AUTHORITY_SECRET: "secret-test" };

function fakeClient() {
  const dms = [];
  return { dms, users: { fetch: async (id) => ({ id, send: async (p) => { dms.push(p); return p; } }) } };
}
function slash(userId, sub, options = {}) {
  const out = {};
  return {
    out,
    isChatInputCommand: () => true, isButton: () => false, commandName: "authority", guildId: G, user: { id: userId },
    options: { getSubcommand: () => sub, getString: (n) => options[n] ?? null, getInteger: (n) => options[n] ?? null, getUser: (n) => (options[n] ? { id: options[n] } : null) },
    deferReply: async () => {}, editReply: async (p) => { Object.assign(out, p); },
  };
}
function click(userId, customId) {
  const out = {};
  return { out, isButton: () => true, customId, user: { id: userId }, reply: async (p) => { Object.assign(out, p); }, update: async (p) => { Object.assign(out, p, { updated: true }); } };
}

test("choices shown to members are exactly the exceptionable catalogue", () => {
  assert.deepEqual(AUTHORITY_TYPE_CHOICES.map((c) => c.value).sort(), [...EXCEPTIONABLE].sort());
});

test("member asks, OWNER is told in DM with buttons, only the OWNER's click decides, once", async () => {
  const client = fakeClient();
  const ask = slash(MEMBER, "demander", { type: "voice.room.extra", justification: "Tournoi vocal ce week-end", duree: "12h" });
  await handleAuthorityInteraction(ask, { env, client });
  assert.match(ask.out.content, /Demande n°1 envoyée/);
  const dm = client.dms[0];
  const approveId = dm.components[0].components[0].data.custom_id;
  assert.match(approveId, /^authority:approve:111111111111111111:1:/);

  const intruder = click(SYS, approveId);
  await handleAuthorityInteraction(intruder, { env });
  assert.match(intruder.out.content, /Seul l'OWNER/);

  const ok = click(OWNER, approveId);
  await handleAuthorityInteraction(ok, { env });
  assert.equal(ok.out.updated, true);
  assert.match(ok.out.content, /Approuvée/);

  const replay = click(OWNER, approveId);
  await handleAuthorityInteraction(replay, { env });
  assert.match(replay.out.content, /déjà traitée/);

  const status = slash(MEMBER, "statut", { numero: 1 });
  await handleAuthorityInteraction(status, { env });
  assert.match(status.out.embeds[0].data.title, /active/);
  const spy = slash(SYS, "historique", { numero: 1 });
  await handleAuthorityInteraction(spy, { env });
  assert.match(spy.out.content, /réservée/);
});

test("OWNER-only subcommands refuse everyone else; OWNER can revoke", async () => {
  const panel = slash(SYS, "panneau");
  await handleAuthorityInteraction(panel, { env });
  assert.match(panel.out.content, /Réservé à l'OWNER/);
  const revoke = slash(OWNER, "decider", { numero: 1, action: "revoquer" });
  await handleAuthorityInteraction(revoke, { env });
  assert.match(revoke.out.content, /révoquée/);
  const mine = slash(MEMBER, "mes-demandes");
  await handleAuthorityInteraction(mine, { env });
  assert.match(mine.out.content, /révoquée/);
});
