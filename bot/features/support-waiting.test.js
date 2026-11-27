import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits as P } from "discord.js";
import { WAITING, configureWaiting, disableWaiting, handleWaitingButton, handleWaitingVoiceState, waitingConfig } from "./support-waiting.js";

const T = 1_000_000;
const setup = () => {
  const sent = []; const edits = [];
  const message = { id: "m1", edit: async (p) => edits.push(p.content) };
  const alert = { send: async (p) => { sent.push(p); return message; }, messages: { fetch: async () => message } };
  const guild = { id: "g", channels: { cache: new Map([["alerte", alert]]) } };
  const member = { id: "u", user: { bot: false } };
  const state = (channelId) => ({ guild, member, channelId });
  return { sent, edits, state };
};

test("config : salle et alerte obligatoires, désactivable", () => {
  assert.throws(() => configureWaiting("g", { roomId: "r" }), /Choisis/);
  assert.equal(waitingConfig("g"), null);
  configureWaiting("g", { roomId: "salle", alertChannelId: "alerte", roleId: "staff" });
  assert.equal(waitingConfig("g").roleId, "staff");
});

test("entrée → alerte avec rôle, anti-répétition 2 min, prise en charge, sortie → mise à jour", async () => {
  const { sent, edits, state } = setup();
  assert.equal(await handleWaitingVoiceState(state(null), state("autre"), T), null, "autre salon : rien");
  const first = await handleWaitingVoiceState(state(null), state("salle"), T);
  assert.equal(first.alerted, true);
  assert.match(sent[0].content, /<@&staff>.*<@u> attend dans <#salle>/s);
  assert.deepEqual(sent[0].allowedMentions, { roles: ["staff"], users: [] });
  await handleWaitingVoiceState(state("salle"), state(null), T + 1000);
  assert.match(edits.at(-1), /a quitté la salle d'attente/);
  assert.equal(await handleWaitingVoiceState(state(null), state("salle"), T + 2000), null, "trop tôt");
  const again = await handleWaitingVoiceState(state(null), state("salle"), T + WAITING.cooldownMs + 5000);
  const click = (perm) => ({ isButton: () => true, customId: `support:take:${again.id}`, user: { id: "mod" }, member: { permissions: { has: (p) => perm && p === P.MoveMembers } }, reply: async () => {}, update: async (p) => edits.push(p.content) });
  assert.equal(await handleWaitingButton(click(false)), true);
  assert.equal(edits.at(-1).includes("s'occupe"), false, "sans permission : refusé");
  await handleWaitingButton(click(true));
  assert.match(edits.at(-1), /<@mod> s'occupe de <@u>/);
  await handleWaitingVoiceState(state("salle"), state("staffvoc"), T + WAITING.cooldownMs + 9000);
  assert.match(edits.at(-1), /pris en charge par <@mod>/);
  assert.equal(disableWaiting("g"), true);
  assert.equal(await handleWaitingVoiceState(state(null), state("salle"), T + 10 * WAITING.cooldownMs), null, "désactivé");
});
