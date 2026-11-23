import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-v4-mission-route-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { handleV4SlashInteraction } = await import("./v4-commands.js");
const { pndBalance, recordMissionProgress } = await import("./economy.js");
const { db } = await import("./database.js");

function interactionFor(action) {
  const replies = [];
  const member = { id: "member-a", permissions: { has: () => false } };
  return {
    replies,
    deferred: null,
    isChatInputCommand: () => true,
    inGuild: () => true,
    commandName: "job",
    commandId: "interaction-a",
    commandType: 1,
    guildId: "guild-a",
    guild: {
      id: "guild-a",
      members: { fetch: async () => member },
    },
    user: { id: "member-a" },
    channel: { id: "channel-a" },
    options: {
      getSubcommandGroup: () => "mission",
      getSubcommand: () => action,
    },
    deferReply: async function (payload) {
      this.deferred = payload;
    },
    editReply: async (payload) => {
      replies.push(payload);
    },
    followUp: async (payload) => {
      replies.push(payload);
    },
  };
}

test("/job mission status and claim route through the shared guild-isolated economy", async (context) => {
  context.after(() => {
    db.close();
    delete process.env.HER_DB_PATH;
    rmSync(directory, { recursive: true, force: true });
  });

  const status = interactionFor("status");
  assert.equal(await handleV4SlashInteraction(status), true);
  assert.match(status.replies[0].embeds[0].data.title, /Missions PND du jour/);

  recordMissionProgress("guild-a", "member-a", "work");
  recordMissionProgress("guild-a", "member-a", "work");
  recordMissionProgress("guild-a", "member-a", "work");
  const claim = interactionFor("claim");
  assert.equal(await handleV4SlashInteraction(claim), true);
  assert.match(claim.replies[0].content, /150 PND/);
  assert.equal(pndBalance("guild-a", "member-a").balance, 150);
  assert.equal(pndBalance("guild-b", "member-a").balance, 0);
});
