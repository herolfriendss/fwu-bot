import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { db } from "./database.js";
import {
  WET_DENIED,
  banWetAccountsAcrossNetwork,
  canReadWet,
  createWetCase,
  enforceWetOnJoin,
  getActiveWetCase,
  getWetCaseAccounts,
  handleWetInteraction,
  isWet,
  isWetOwner,
  linkWetAccount,
  listWetCases,
  revokeWetCase,
  unbanWetAccountsAcrossNetwork,
} from "./wet.js";

const OWNER = "100000000000000001";
const SYS = "100000000000000002";
const MEMBER = "100000000000000003";
const ALT = "100000000000000004";
const SYS_ROLE = "200000000000000001";
const GUILD = "300000000000000001";
const EVIDENCE = "https://discord.com/channels/300000000000000001/400000000000000001/500000000000000001";

process.env.PND_OWNER_DISCORD_ID = OWNER;

beforeEach(() => {
  db.exec("DELETE FROM wet_audit_events; DELETE FROM wet_case_accounts; DELETE FROM wet_cases;");
});

function user(id, extra = {}) {
  return { id, username: `user-${id.slice(-3)}`, bot: false, createdTimestamp: 1_700_000_000_000, ...extra };
}

function member(id, roles = []) {
  return {
    id,
    guild: { id: GUILD, ownerId: "300000000000000009" },
    roles: { cache: new Map(roles.map((role) => [role, {}])) },
  };
}

test("WET is OWNER-managed; SYS+ can only consult", () => {
  const settings = { sysPlus: { roleId: SYS_ROLE } };
  assert.equal(isWetOwner(member(OWNER)), true);
  assert.equal(isWetOwner(member(SYS)), false);
  assert.equal(canReadWet(member(OWNER), settings), true);
  assert.equal(canReadWet(member(SYS, [SYS_ROLE]), settings), true);
  assert.equal(canReadWet(member(MEMBER), settings), false);
  assert.match(WET_DENIED, /OWNER/);
});

test("WET service functions independently enforce the single configured OWNER", () => {
  assert.throws(
    () => createWetCase({ guildId: GUILD, actorId: SYS, user: user(MEMBER), reason: "Contournement confirmé et documenté", evidence: EVIDENCE }),
    /Seul l'OWNER technique/,
  );
  assert.throws(
    () => createWetCase({ guildId: GUILD, actorId: OWNER, user: user(OWNER), reason: "Compte OWNER protégé et non sanctionnable", evidence: EVIDENCE }),
    /OWNER technique est protégé/,
  );
  assert.throws(
    () => linkWetAccount({ guildId: GUILD, actorId: SYS, sourceUserId: MEMBER, user: user(ALT), reason: "Preuve du lien entre les deux comptes", evidence: EVIDENCE }),
    /Seul l'OWNER technique/,
  );
  assert.throws(
    () => revokeWetCase(MEMBER, { guildId: GUILD, actorId: SYS, reason: "Réexamen complet et décision de levée" }),
    /Seul l'OWNER technique/,
  );
});

test("creates a network WET case with evidence and public account metadata", () => {
  const caseId = createWetCase({
    guildId: GUILD,
    actorId: OWNER,
    user: user(MEMBER),
    reason: "Contournement documenté des sanctions répétées",
    evidence: EVIDENCE,
    now: 1_800_000_000_000,
  });
  const entry = getActiveWetCase(MEMBER);
  assert.equal(entry.id, caseId);
  assert.equal(entry.added_by, OWNER);
  assert.equal(entry.evidence_url, EVIDENCE);
  assert.equal(entry.username_snapshot, `user-${MEMBER.slice(-3)}`);
  assert.equal(entry.account_created_at, 1_700_000_000_000);
  assert.equal(isWet(MEMBER), true);
  assert.equal(listWetCases()[0].accounts.length, 1);
});

test("refuses duplicate active cases, weak reasons and non-HTTPS evidence", () => {
  createWetCase({ guildId: GUILD, actorId: OWNER, user: user(MEMBER), reason: "Contournement confirmé avec preuves", evidence: EVIDENCE });
  assert.throws(
    () => createWetCase({ guildId: GUILD, actorId: OWNER, user: user(MEMBER), reason: "Autre motif documenté", evidence: EVIDENCE }),
    /déjà en WET/,
  );
  assert.throws(
    () => createWetCase({ guildId: GUILD, actorId: OWNER, user: user(ALT), reason: "court", evidence: EVIDENCE }),
    /au moins 10 caractères/,
  );
  assert.throws(
    () => createWetCase({ guildId: GUILD, actorId: OWNER, user: user(ALT), reason: "Motif assez détaillé", evidence: "http://example.com/proof" }),
    /HTTPS/,
  );
  assert.equal(isWet(ALT), false);
});

test("links an alternate only with explicit evidence; the case enforces both accounts", () => {
  const caseId = createWetCase({
    guildId: GUILD, actorId: OWNER, user: user(MEMBER),
    reason: "Contournement documenté des sanctions répétées", evidence: EVIDENCE,
  });
  const linkedCaseId = linkWetAccount({
    guildId: GUILD, actorId: OWNER, sourceUserId: MEMBER, user: user(ALT),
    reason: "Preuve directe du lien entre les deux comptes", evidence: EVIDENCE,
  });
  assert.equal(linkedCaseId, caseId);
  assert.equal(isWet(MEMBER), true);
  assert.equal(isWet(ALT), true);
  assert.equal(getWetCaseAccounts(caseId).length, 2);
  assert.equal(getActiveWetCase(ALT).linked_from_id, MEMBER);
  assert.throws(
    () => linkWetAccount({
      guildId: GUILD, actorId: OWNER, sourceUserId: MEMBER, user: user(ALT),
      reason: "Preuve directe du lien entre les deux comptes", evidence: EVIDENCE,
    }),
    /déjà lié/,
  );
});

test("a WET account is blocked on join; a normal account continues", async () => {
  createWetCase({
    guildId: GUILD, actorId: OWNER, user: user(MEMBER),
    reason: "Contournement documenté des sanctions répétées", evidence: EVIDENCE,
  });
  const events = [];
  const joined = {
    id: MEMBER,
    guild: { id: GUILD },
    ban: async ({ reason }) => events.push(reason),
  };
  assert.equal(await enforceWetOnJoin(joined, (event) => events.push(event)), true);
  assert.equal(events.length, 2);
  assert.equal(events[0], "WET · dossier " + getActiveWetCase(MEMBER).id.slice(0, 8) + " · Contournement documenté des sanctions répétées");
  assert.equal(events[1], "wet_rebanned");
  assert.equal(await enforceWetOnJoin({ id: ALT, guild: { id: GUILD }, ban: async () => {} }), false);
});

test("WET bans across connected guilds and preserves existing bans", async () => {
  const created = [];
  const makeGuild = (id, ownerId = "300000000000000009") => ({
    id, ownerId,
    bans: {
      fetch: async (userId) => {
        if (userId === ALT && id === "300000000000000002") return { user: { id: userId } };
        throw Object.assign(new Error("not banned"), { code: 10026 });
      },
      create: async (userId) => created.push([id, userId]),
    },
  });
  const client = { guilds: { cache: new Map([
    ["a", makeGuild("300000000000000001")],
    ["b", makeGuild("300000000000000002")],
  ]) } };
  const ownerGuild = makeGuild("300000000000000003", MEMBER);
  client.guilds.cache.set("owner", ownerGuild);
  const result = await banWetAccountsAcrossNetwork(client, [{ user_id: MEMBER }, { user_id: ALT }], {
    id: "12345678-1234-1234-1234-123456789012", reason: "test",
  });
  assert.equal(result.banned, 4);
  assert.equal(result.alreadyBanned, 1);
  assert.equal(result.skippedOwner, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(created.length, 4);
});

test("unwet revokes the complete linked case and leaves a historical audit trail", async () => {
  const caseId = createWetCase({
    guildId: GUILD, actorId: OWNER, user: user(MEMBER),
    reason: "Contournement documenté des sanctions répétées", evidence: EVIDENCE,
  });
  linkWetAccount({
    guildId: GUILD, actorId: OWNER, sourceUserId: MEMBER, user: user(ALT),
    reason: "Preuve directe du lien entre les deux comptes", evidence: EVIDENCE,
  });
  const revoked = revokeWetCase(MEMBER, {
    guildId: GUILD, actorId: OWNER, reason: "Réexamen complet et décision de levée",
  });
  assert.equal(revoked.id, caseId);
  assert.equal(revoked.accounts.length, 2);
  assert.equal(isWet(MEMBER), false);
  assert.equal(isWet(ALT), false);
  assert.equal(listWetCases().length, 0);
  assert.equal(
    revokeWetCase(MEMBER, { guildId: GUILD, actorId: OWNER, reason: "Nouvelle levée documentée" }),
    null,
  );
});

test("unwet lifts only bans created by this exact WET case and preserves independent bans", async () => {
  const caseId = "12345678-1234-1234-1234-123456789012";
  db.exec(`
    CREATE TABLE IF NOT EXISTS blacklist_entries (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
      added_by TEXT NOT NULL, added_at INTEGER NOT NULL, PRIMARY KEY(guild_id,user_id)
    );
    DELETE FROM blacklist_entries;
  `);
  const removed = [];
  const makeGuild = (id, reason) => ({
    id,
    ownerId: "300000000000000009",
    bans: {
      fetch: async (userId) => {
        if (reason === null) throw Object.assign(new Error("not banned"), { code: 10026 });
        if (reason === "return-null") return null;
        if (reason === "lookup-error") throw Object.assign(new Error("permission denied"), { code: 50013 });
        return { user: { id: userId }, reason };
      },
      remove: async (userId) => removed.push([id, userId]),
    },
  });
  const client = { guilds: { cache: new Map([
    ["owned", makeGuild("300000000000000011", "WET · dossier 12345678 · motif documenté")],
    ["manual", makeGuild("300000000000000012", "Raid — décision de modération indépendante")],
    ["absent", makeGuild("300000000000000013", null)],
    ["null", makeGuild("300000000000000015", "return-null")],
    ["lookup-error", makeGuild("300000000000000014", "lookup-error")],
  ]) } };
  const result = await unbanWetAccountsAcrossNetwork(client, [{ user_id: MEMBER }], OWNER, { id: caseId, reason: "motif documenté" });
  assert.equal(result.unbanned, 1);
  assert.equal(result.preservedOtherBan, 1);
  assert.equal(result.notBanned, 2);
  assert.equal(result.failed.length, 1);
  assert.deepEqual(removed, [["300000000000000011", MEMBER]]);
});

test("unwet preserves a ban whose reason only imitates the WET case prefix", async () => {
  const caseEntry = { id: "12345678-1234-1234-1234-123456789012", reason: "Motif WET exact attendu" };
  const client = { guilds: { cache: new Map([[
    GUILD,
    {
      id: GUILD,
      ownerId: "300000000000000009",
      bans: {
        fetch: async (userId) => ({ user: { id: userId }, reason: "WET · dossier 12345678 · motif différent" }),
        remove: async () => { throw new Error("must preserve a non-exact ban reason"); },
      },
    },
  ]]) } };
  const result = await unbanWetAccountsAcrossNetwork(client, [{ user_id: MEMBER }], OWNER, caseEntry);
  assert.equal(result.preservedOtherBan, 1);
  assert.equal(result.unbanned, 0);
});

test("unwet keeps an account banned if a new WET case was opened after revocation", async () => {
  createWetCase({
    guildId: GUILD, actorId: OWNER, user: user(MEMBER),
    reason: "Nouveau dossier WET réouvert avec preuves", evidence: EVIDENCE,
  });
  const removed = [];
  const client = { guilds: { cache: new Map([[
    GUILD,
    {
      id: GUILD,
      ownerId: "300000000000000009",
      bans: {
        fetch: async (userId) => ({ user: { id: userId }, reason: "WET · dossier ancien · motif" }),
        remove: async (userId) => removed.push(userId),
      },
    },
  ]]) } };
  const result = await unbanWetAccountsAcrossNetwork(
    client, [{ user_id: MEMBER }], OWNER, { id: "12345678-1234-1234-1234-123456789012", reason: "Nouveau dossier WET réouvert avec preuves" },
  );
  assert.equal(result.stillWet, 1);
  assert.equal(result.unbanned, 0);
  assert.deepEqual(removed, []);
});

test("unwet never lifts an independent local blacklist ban", async () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS blacklist_entries (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
      added_by TEXT NOT NULL, added_at INTEGER NOT NULL, PRIMARY KEY(guild_id,user_id)
    );
    DELETE FROM blacklist_entries;
    INSERT INTO blacklist_entries(guild_id,user_id,added_by,added_at) VALUES('${GUILD}','${MEMBER}','${OWNER}',1);
  `);
  const client = { guilds: { cache: new Map([[
    GUILD,
    { id: GUILD, ownerId: "300000000000000009", bans: { remove: async () => { throw new Error("must not unban"); } } },
  ]]) } };
  const result = await unbanWetAccountsAcrossNetwork(client, [{ user_id: MEMBER }], OWNER, "12345678-1234-1234-1234-123456789012");
  assert.equal(result.stillBlacklisted, 1);
  assert.equal(result.unbanned, 0);
});

test("the /unwet interaction passes the revoked case to exact-reason unban", async () => {
  const reason = "Contournement documenté des sanctions répétées";
  const caseId = createWetCase({
    guildId: GUILD, actorId: OWNER, user: user(MEMBER), reason, evidence: EVIDENCE,
  });
  const removed = [];
  const guild = {
    id: GUILD,
    ownerId: "300000000000000009",
    bans: {
      fetch: async (userId) => ({
        user: { id: userId },
        reason: `WET · dossier ${caseId.slice(0, 8)} · ${reason}`,
      }),
      remove: async (userId) => removed.push(userId),
    },
  };
  const replies = [];
  const interaction = {
    isChatInputCommand: () => true,
    commandName: "unwet",
    guild: { id: GUILD },
    member: member(OWNER),
    user: { id: OWNER },
    client: { guilds: { cache: new Map([[GUILD, guild]]) } },
    options: { getString: (name) => name === "id" ? MEMBER : "Réexamen complet et décision de levée" },
    deferReply: async () => {},
    editReply: async (payload) => replies.push(payload),
  };
  assert.equal(await handleWetInteraction(interaction, null), true);
  assert.deepEqual(removed, [MEMBER]);
  assert.match(replies.at(-1).content, /Débannissements WET : \\*\\*1\\*\\*/);
});
