import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../database.js";
import { sysPlusSpan, trackTemporary, forgetTemporary, temporaryOf, runTemporarySysPlus } from "./temporary.js";

const G = "123456789012345678"; const U = "223456789012345678"; const R = "323456789012345678";
const T0 = 1_700_000_000_000;

function clientWith(removed) {
  const member = { roles: { cache: new Map([[R, {}]]), remove: async (id) => { removed.push(id); } } };
  const guild = { members: { fetch: async () => member } };
  return { user: { id: "bot" }, guilds: { cache: new Map([[G, guild]]) } };
}

test("durée : bornes et exclusivité essai/durée", () => {
  assert.equal(sysPlusSpan({}), null);
  assert.equal(sysPlusSpan({ duree: "7j" }).kind, "temporary");
  assert.equal(sysPlusSpan({ essai: true }).seconds, 14 * 86_400);
  assert.throws(() => sysPlusSpan({ duree: "10m" }));
  assert.throws(() => sysPlusSpan({ duree: "200j" }));
  assert.throws(() => sysPlusSpan({ duree: "7j", essai: true }));
});

test("forget arrête la surveillance", () => {
  trackTemporary({ guildId: G, userId: U, roleId: R, grantedBy: "o", seconds: 3600, kind: "temporary" }, T0);
  forgetTemporary(G, U);
  assert.equal(temporaryOf(G, U).status, "removed");
});

test("échéance : rôle retiré une seule fois", async () => {
  const removed = [];
  trackTemporary({ guildId: G, userId: U, roleId: R, grantedBy: "o", seconds: 3600, kind: "temporary" }, T0);
  const first = await runTemporarySysPlus(clientWith(removed), { now: T0 + 3_700_000 });
  const second = await runTemporarySysPlus(clientWith(removed), { now: T0 + 3_800_000 });
  assert.equal(first.removed, 1); assert.equal(second.removed, 0);
  assert.deepEqual(removed, [R]);
});

test("essai : alerte une fois à J-2, retrait sans confirmation", async () => {
  const removed = []; const notes = [];
  const notify = async (g, title, text, components) => { notes.push(components); };
  trackTemporary({ guildId: G, userId: U, roleId: R, grantedBy: "o", seconds: 14 * 86_400, kind: "trial" }, T0);
  assert.equal((await runTemporarySysPlus(clientWith(removed), { now: T0 + 5 * 86_400_000, notify })).warned, 0);
  const near = T0 + 12.5 * 86_400_000;
  assert.equal((await runTemporarySysPlus(clientWith(removed), { now: near, notify })).warned, 1);
  assert.equal((await runTemporarySysPlus(clientWith(removed), { now: near + 60_000, notify })).warned, 0);
  assert.equal(notes.length, 1); assert.ok(notes[0][0].components[0].custom_id.startsWith("sysptrial:confirm:"));
  assert.equal((await runTemporarySysPlus(clientWith(removed), { now: T0 + 15 * 86_400_000, notify })).removed, 1);
  assert.deepEqual(removed, [R]);
});

test("confirmation refusée si l'essai est déjà terminé", async () => {
  const { handleTrialConfirm } = await import("./temporary.js");
  trackTemporary({ guildId: G, userId: U, roleId: R, grantedBy: "o", seconds: 14 * 86_400, kind: "trial" }, T0);
  db.prepare("UPDATE sysplus_temporary SET status='expired' WHERE guild_id=? AND user_id=?").run(G, U);
  assert.equal(await handleTrialConfirm({ isButton: () => false }, {}), false);
});
