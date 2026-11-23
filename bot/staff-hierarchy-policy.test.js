import test from "node:test";
import assert from "node:assert/strict";
import { isDiscordSnowflake, staffSupervisorAssignmentDecision } from "./staff-hierarchy-policy.js";

const ids = {
  guild: "1562643485981544559",
  owner: "100000000000000001",
  moderator: "100000000000000002",
  supervisor: "100000000000000003",
  lead: "100000000000000004",
};

test("staff supervisor assignments validate Discord IDs and reject self-management", () => {
  assert.equal(isDiscordSnowflake(ids.moderator), true);
  assert.equal(isDiscordSnowflake("not-an-id"), false);
  assert.equal(staffSupervisorAssignmentDecision({
    guildId: ids.guild,
    staffUserId: ids.moderator,
    supervisorUserId: ids.moderator,
  }).allowed, false);
});

test("server owner stays at the top of the staff hierarchy", () => {
  const decision = staffSupervisorAssignmentDecision({
    guildId: ids.guild,
    staffUserId: ids.owner,
    supervisorUserId: ids.supervisor,
    guildOwnerId: ids.owner,
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /sommet/);
});

test("hierarchy supports several levels but rejects direct and indirect cycles", () => {
  const relations = [
    { staff_user_id: ids.moderator, supervisor_user_id: ids.supervisor },
    { staff_user_id: ids.supervisor, supervisor_user_id: ids.lead },
  ];
  const valid = staffSupervisorAssignmentDecision({
    guildId: ids.guild,
    staffUserId: ids.lead,
    supervisorUserId: ids.owner,
    guildOwnerId: ids.owner,
    existingRelations: relations,
  });
  assert.equal(valid.allowed, true);

  const indirectCycle = staffSupervisorAssignmentDecision({
    guildId: ids.guild,
    staffUserId: ids.lead,
    supervisorUserId: ids.moderator,
    guildOwnerId: ids.owner,
    existingRelations: relations,
  });
  assert.equal(indirectCycle.allowed, false);
  assert.match(indirectCycle.reason, /boucle/);

  const directCycle = staffSupervisorAssignmentDecision({
    guildId: ids.guild,
    staffUserId: ids.moderator,
    supervisorUserId: ids.moderator,
    existingRelations: relations,
  });
  assert.equal(directCycle.allowed, false);
});
