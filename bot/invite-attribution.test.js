import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-invite-attribution-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { db } = await import("./database.js");
const { captureGuildInviteSnapshot, resolveMemberInvite, recordInviteLifecycle } = await import("./invite-attribution.js");

after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });

function fakeGuild(invites, vanityUses = null) {
  return {
    id: "123456",
    invites: { async fetch() { return new Map(invites.map((invite) => [invite.code, invite])); } },
    async fetchVanityData() { if (vanityUses == null) throw new Error("No vanity URL"); return { uses: vanityUses }; },
  };
}

test("invite attribution identifies a single use delta and keeps unknown cases unknown", async () => {
  const initial = fakeGuild([{ code: "abc", uses: 2, inviter: { id: "654321" } }]);
  assert.equal((await captureGuildInviteSnapshot(initial, 1000)).captured, true);
  const joined = await resolveMemberInvite(fakeGuild([{ code: "abc", uses: 3, inviter: { id: "654321" } }]), 2000);
  assert.deepEqual(joined, { source: "invite", inviterId: "654321", code: "abc", reason: null });
  const noDelta = await resolveMemberInvite(fakeGuild([{ code: "abc", uses: 3, inviter: { id: "654321" } }]), 3000);
  assert.equal(noDelta.source, "unknown");
  await captureGuildInviteSnapshot(fakeGuild([{ code: "abc", uses: 3, inviter: { id: "654321" } }, { code: "def", uses: 0, inviter: { id: "777777" } }]), 4000);
  const ambiguous = await resolveMemberInvite(fakeGuild([{ code: "abc", uses: 4, inviter: { id: "654321" } }, { code: "def", uses: 1, inviter: { id: "777777" } }]), 5000);
  assert.equal(ambiguous.source, "unknown");
  assert.equal(ambiguous.reason, "ambiguous_usage_delta");
});

test("vanity joins and invite lifecycle events are recorded without inventing an inviter", async () => {
  await captureGuildInviteSnapshot(fakeGuild([], 8), 1000);
  const vanity = await resolveMemberInvite(fakeGuild([], 9), 2000);
  assert.deepEqual(vanity, { source: "vanity", inviterId: null, code: null, reason: null });
  const invite = { guild: { id: "123456" }, code: "new", uses: 0, inviter: { id: "654321" } };
  assert.equal(recordInviteLifecycle(invite, "create", 3000), true);
  assert.equal(db.prepare("SELECT inviter_id FROM guild_invite_snapshots WHERE guild_id='123456' AND code='new'").get().inviter_id, "654321");
  assert.equal(recordInviteLifecycle(invite, "delete", 4000), true);
  assert.equal(db.prepare("SELECT 1 FROM guild_invite_snapshots WHERE guild_id='123456' AND code='new'").get(), undefined);
});

test("missing invite use counters never produce a guessed inviter", async () => {
  const result = await resolveMemberInvite(fakeGuild([{ code: "unknown", inviter: { id: "654321" } }]), 9000);
  assert.equal(result.source, "unknown");
  assert.equal(result.reason, "usage_unavailable");
});
