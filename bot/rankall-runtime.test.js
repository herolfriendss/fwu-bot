import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const databasePath = `/tmp/pnd-rankall-${process.pid}.sqlite`;
process.env.HER_DB_PATH = databasePath;
process.env.PND_RANKALL_STEP_DELAY_MS = "0";
const ownerId = "400000000000000001";
process.env.PND_OWNER_DISCORD_ID = ownerId;
const runner = await import("./rankall-runner.js");
const { handleRoleInteraction, handleRoleMessage } =
  await import("./role-commands.js");
const { db } = await import("./database.js");

const guildId = "400000000000000009";
const roleId = "400000000000000010";
const botId = "400000000000000002";

after(() => {
  db.close();
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${databasePath}${suffix}`, { force: true });
});
beforeEach(() => {
  db.prepare("DELETE FROM rankall_jobs").run();
});

function makeMember(id, position, { bot = false, roles = [] } = {}) {
  const set = new Set(roles);
  return {
    id,
    displayName: `m${id.slice(-3)}`,
    user: { bot, username: id },
    roles: {
      highest: { position },
      cache: { has: (r) => set.has(r) },
      add: async (r) => {
        set.add(r.id ?? r);
      },
      remove: async (r) => {
        set.delete(r.id ?? r);
      },
    },
    permissions: { has: () => true },
    has: (r) => set.has(r),
  };
}

function makeGuild({ rolePermissions = 0n, members: extra = [] } = {}) {
  const owner = makeMember(ownerId, 50);
  const bot = makeMember(botId, 60, { bot: true });
  const members = new Map([
    [ownerId, owner],
    [botId, bot],
    ...extra.map((m) => [m.id, m]),
  ]);
  const role = {
    id: roleId,
    position: 5,
    managed: false,
    name: "Event",
    permissions: { bitfield: rolePermissions },
  };
  return {
    id: guildId,
    ownerId: "400000000000000099",
    members: {
      fetch: async (arg) =>
        arg && typeof arg === "object" && arg.user
          ? members.get(arg.user)
          : arg === undefined
            ? members
            : members.get(arg),
      fetchMe: async () => bot,
    },
    roles: { fetch: async (id) => (id === roleId ? role : null) },
    role,
    map: members,
  };
}

function makeInteraction(
  guild,
  { userId = ownerId, customId = null, command = null } = {},
) {
  const log = [];
  return {
    log,
    guild,
    user: { id: userId },
    customId,
    commandName: command,
    deferred: false,
    replied: false,
    isChatInputCommand: () => Boolean(command),
    isButton: () => Boolean(customId),
    isMessageComponent: () => Boolean(customId),
    options: { getRole: () => guild.role, getSubcommand: () => null },
    reply: async (p) => {
      log.push(["reply", p]);
    },
    deferReply: async () => {
      log.push(["deferReply"]);
    },
    deferUpdate: async () => {
      log.push(["deferUpdate"]);
    },
    editReply: async (p) => {
      log.push(["editReply", p]);
    },
    update: async (p) => {
      log.push(["update", p]);
    },
    message: {
      edit: async (p) => {
        log.push(["message.edit", p]);
      },
    },
  };
}

const lastPayload = (interaction) =>
  interaction.log
    .filter(([kind]) => kind !== "deferReply" && kind !== "deferUpdate")
    .at(-1)[1];
const jobIdFrom = (payload) =>
  payload.components[0].components[0].data.custom_id.split(":")[2];

test("plan excludes bots, holders and hierarchy-protected members", () => {
  const actor = makeMember("a", 8);
  const plan = runner.planRankAll({
    members: [
      makeMember("e", 2),
      makeMember("b", 1, { bot: true }),
      makeMember("h", 1, { roles: ["r"] }),
      makeMember("hi", 9),
    ],
    role: { id: "r", position: 4, managed: false },
    guild: { id: "g", ownerId: "o" },
    actor,
    botMember: makeMember("bot", 10),
  });
  assert.deepEqual(
    plan.eligible.map((m) => m.id),
    ["e"],
  );
  assert.equal(plan.bots, 1);
  assert.equal(plan.alreadyHolding, 1);
  assert.equal(plan.skipped.length, 1);
});

test("dangerous roles are detected", () => {
  assert.deepEqual(
    runner.dangerousRolePermissions({ permissions: { bitfield: 1n << 3n } }),
    ["Administrator"],
  );
  assert.deepEqual(
    runner.dangerousRolePermissions({
      permissions: { bitfield: (1n << 10n) | (1n << 11n) },
    }),
    [],
  );
});

test("non-owner is refused before any preview", async () => {
  const guild = makeGuild();
  const interaction = makeInteraction(guild, {
    userId: "400000000000000077",
    command: "rankall",
  });
  await handleRoleInteraction(interaction);
  assert.match(lastPayload(interaction).content, /propriétaire configuré/);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM rankall_jobs").get().c, 0);
});

test("a role with Administrator is refused at preview", async () => {
  const guild = makeGuild({
    rolePermissions: 1n << 3n,
    members: [makeMember("400000000000000020", 1)],
  });
  const interaction = makeInteraction(guild, { command: "rankall" });
  await handleRoleInteraction(interaction);
  assert.match(lastPayload(interaction).content, /permissions sensibles/);
});

test("preview → confirm assigns, double confirm is refused, undo removes only assigned members", async () => {
  const targets = [
    makeMember("400000000000000020", 1),
    makeMember("400000000000000021", 1),
    makeMember("400000000000000022", 1, { roles: [roleId] }),
  ];
  const guild = makeGuild({ members: targets });
  const slash = makeInteraction(guild, { command: "rankall" });
  await handleRoleInteraction(slash);
  const preview = lastPayload(slash);
  assert.match(preview.content, /Membres concernés : \*\*2\*\*/);
  const jobId = jobIdFrom(preview);

  const confirm = makeInteraction(guild, {
    customId: `rankall:confirm:${jobId}`,
  });
  await handleRoleInteraction(confirm);
  const done = lastPayload(confirm);
  assert.match(done.content, /Attribution terminée/);
  assert.match(done.content, /Attribués : \*\*2\*\*/);
  assert.equal(targets[0].has(roleId) && targets[1].has(roleId), true);

  const again = makeInteraction(guild, {
    customId: `rankall:confirm:${jobId}`,
  });
  await handleRoleInteraction(again);
  assert.match(lastPayload(again).content, /n'est plus en attente/);

  const undo = makeInteraction(guild, { customId: `rankall:undo:${jobId}` });
  await handleRoleInteraction(undo);
  assert.match(lastPayload(undo).content, /Retirés : \*\*2\*\*/);
  assert.equal(targets[0].has(roleId), false);
  assert.equal(
    targets[2].has(roleId),
    true,
    "pre-existing holder keeps the role",
  );
  assert.equal(runner.getRankAllJob(jobId).status, "undone");
});

test("another user cannot confirm, and abort cancels without mutation", async () => {
  const targets = [makeMember("400000000000000020", 1)];
  const guild = makeGuild({ members: targets });
  const slash = makeInteraction(guild, { command: "rankall" });
  await handleRoleInteraction(slash);
  const jobId = jobIdFrom(lastPayload(slash));
  const intruder = makeInteraction(guild, {
    userId: "400000000000000077",
    customId: `rankall:confirm:${jobId}`,
  });
  await handleRoleInteraction(intruder);
  assert.match(lastPayload(intruder).content, /propriétaire configuré/);
  const abort = makeInteraction(guild, { customId: `rankall:abort:${jobId}` });
  await handleRoleInteraction(abort);
  assert.match(lastPayload(abort).content, /annulée/);
  assert.equal(targets[0].has(roleId), false);
  assert.equal(runner.getRankAllJob(jobId).status, "cancelled");
});

test("expired previews cannot be confirmed", async () => {
  const job = runner.createRankAllPreview({
    guildId,
    actorId: ownerId,
    roleId,
    eligibleCount: 1,
    skippedCount: 0,
    now: Date.now() - 120_000,
  });
  assert.match(runner.claimRankAllJob(job.id, ownerId).reason, /expiré/);
});

test("a stop request interrupts the run and keeps it undoable", async () => {
  const guild = makeGuild();
  const members = Array.from({ length: 25 }, (_, i) =>
    makeMember(`4000000000000001${String(i).padStart(2, "0")}`, 1),
  );
  for (const m of members) guild.map.set(m.id, m);
  const job = runner.createRankAllPreview({
    guildId,
    actorId: ownerId,
    roleId,
    eligibleCount: 25,
    skippedCount: 0,
  });
  const claim = runner.claimRankAllJob(job.id, ownerId);
  const result = await runner.executeRankAllJob({
    job: claim.job,
    guild,
    role: guild.role,
    actor: guild.map.get(ownerId),
    botMember: guild.map.get(botId),
    members,
    stepDelayMs: 0,
    onProgress: async ({ processed }) => {
      if (processed === 10) runner.requestRankAllStop(job.id, ownerId);
    },
  });
  assert.equal(result.status, "stopped");
  assert.equal(result.assigned, 10);
  assert.equal(
    runner.canUndoRankAllJob(runner.getRankAllJob(job.id), ownerId).ok,
    true,
  );
});

test("a second preview is refused while a run is in progress; restart marks it interrupted", () => {
  const job = runner.createRankAllPreview({
    guildId,
    actorId: ownerId,
    roleId,
    eligibleCount: 1,
    skippedCount: 0,
  });
  runner.claimRankAllJob(job.id, ownerId);
  assert.throws(
    () =>
      runner.createRankAllPreview({
        guildId,
        actorId: ownerId,
        roleId,
        eligibleCount: 1,
        skippedCount: 0,
      }),
    /déjà en cours/,
  );
  assert.equal(runner.recoverInterruptedRankAllJobs(), 1);
  assert.equal(runner.getRankAllJob(job.id).status, "interrupted");
});

test("prefix =rankall goes through the same preview", async () => {
  const guild = makeGuild({ members: [makeMember("400000000000000020", 1)] });
  const replies = [];
  await handleRoleMessage({
    content: `=rankall <@&${roleId}>`,
    guild,
    member: {},
    author: { id: ownerId },
    mentions: { roles: { first: () => guild.role } },
    reply: async (p) => {
      replies.push(p);
    },
  });
  assert.match(replies[0].content, /aperçu/);
  assert.equal(replies[0].components[0].components.length, 2);
});

// ── Sécurité : rôles protégés ──────────────────────────────────────────────
const { setRoleTiersForTests, forgetTierCache } = await import("./shared/tiers.js");

function rankMessage(guild, actor, target, role) {
  const replies = [];
  return {
    replies,
    message: {
      content: "=rank @m @r",
      guild,
      member: actor,
      author: { id: actor.id },
      mentions: { members: { first: () => target }, roles: { first: () => role } },
      reply: async (p) => replies.push(p),
    },
  };
}

test("sécurité : un ADMIN+ ne peut pas donner un rôle de palier ; l'OWNER oui ; =rankall jamais", async () => {
  const adminPlus = makeMember("400000000000000020", 40, { roles: ["adm"] });
  const target = makeMember("400000000000000021", 2);
  const guild = makeGuild({ members: [adminPlus, target] });
  adminPlus.guild = guild;
  const settings = { adminPlus: { roleId: "adm" } };
  setRoleTiersForTests(guildId, [[roleId, 10]]);
  try {
    const denied = rankMessage(guild, adminPlus, target, guild.role);
    await handleRoleMessage(denied.message, settings);
    assert.match(denied.replies[0].content, /palier 10/);
    assert.equal(target.has(roleId), false, "aucun rôle donné");

    const owner = guild.map.get(ownerId);
    owner.guild = guild;
    const allowed = rankMessage(guild, owner, target, guild.role);
    await handleRoleMessage(allowed.message, settings);
    assert.equal(target.has(roleId), true, "l'OWNER peut donner un palier");

    const slash = makeInteraction(guild, { command: "rankall" });
    await handleRoleInteraction(slash, settings);
    assert.match(lastPayload(slash).content, /palier/, "attribution générale d'un palier refusée, même à l'OWNER");
  } finally {
    forgetTierCache();
  }
});

test("sécurité : un ADMIN+ ne peut pas donner un rôle à permission « Déplacer des membres »", async () => {
  const adminPlus = makeMember("400000000000000030", 40, { roles: ["adm"] });
  const target = makeMember("400000000000000031", 2);
  const guild = makeGuild({ rolePermissions: 1n << 24n, members: [adminPlus, target] });
  adminPlus.guild = guild;
  const { replies, message } = rankMessage(guild, adminPlus, target, guild.role);
  await handleRoleMessage(message, { adminPlus: { roleId: "adm" } });
  assert.match(replies[0].content, /MoveMembers/);
  assert.equal(target.has(roleId), false);
});
