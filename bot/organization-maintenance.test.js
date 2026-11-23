import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-org-maintenance-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const org = await import("./organization.js");
const { runOrganizationMaintenance } = await import("./organization-maintenance.js");
const { db } = await import("./database.js");

after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });

test("maintenance only processes explicitly allowed guilds and purges expired community data", async () => {
  const now = 1_700_000_000_000;
  org.createStory("123456", "777777", "Old story", "Expire me", now + 1, now);
  org.submitRecruitmentApplication("123456", "888888", ["Old application"], now - 90 * 24 * 60 * 60_000 - 1);
  org.createStory("999999", "777777", "Other guild", "Keep me", now + 1, now);
  const client = { guilds: { cache: new Map([["123456", { id: "123456" }], ["999999", { id: "999999" }]]) } };
  const result = await runOrganizationMaintenance(client, ["123456"], now + 2, () => {});
  assert.equal(result.guilds, 1);
  assert.equal(result.storiesExpired, 1);
  assert.equal(result.applicationsPurged, 1);
  assert.ok(org.getStory("999999", db.prepare("SELECT story_id FROM stories WHERE guild_id=?").get("999999").story_id));
  assert.equal(org.listRecruitmentApplications("999999", "all").length, 0);
});

test("interview reminders are claimed once and delivered privately when no channel is configured", async () => {
  const now = 1_700_000_000_000;
  const application = org.submitRecruitmentApplication("123456", "777777", ["Candidat"], now - 1000);
  const interview = org.scheduleRecruitmentInterview("123456", application.applicationId, "654321", "888888", now + 12 * 60 * 60_000, null, { authorizeActor: () => true, now });
  const delivered = [];
  const guild = {
    id: "123456",
    channels: { async fetch() { return null; } },
    members: { async fetch(id) { return { async send(payload) { delivered.push({ id, payload }); } }; } },
  };
  const client = { guilds: { cache: new Map([[guild.id, guild]]) } };
  const first = await runOrganizationMaintenance(client, [guild.id], now + 1, () => {});
  assert.equal(first.interviewsReminded, 1);
  assert.equal(delivered.length, 2);
  assert.ok(delivered.every((entry) => entry.payload.content.includes(interview.interviewId.slice(0, 8))));
  const second = await runOrganizationMaintenance(client, [guild.id], now + 2, () => {});
  assert.equal(second.interviewsReminded, 0);
  assert.equal(delivered.length, 2);
});

test("failed interview reminders release their claim for a later retry", async () => {
  const now = 1_700_000_000_000;
  const application = org.submitRecruitmentApplication("123456", "777778", ["Candidat"], now - 1000);
  org.scheduleRecruitmentInterview("123456", application.applicationId, "654321", "888889", now + 12 * 60 * 60_000, null, { authorizeActor: () => true, now });
  let allowSend = false;
  const guild = {
    id: "123456",
    channels: { async fetch() { return null; } },
    members: { async fetch() { return { async send() { if (!allowSend) throw new Error("DM fermé"); } }; } },
  };
  const client = { guilds: { cache: new Map([[guild.id, guild]]) } };
  const failed = await runOrganizationMaintenance(client, [guild.id], now + 1, () => {});
  assert.equal(failed.interviewReminderFailures, 1);
  allowSend = true;
  const retried = await runOrganizationMaintenance(client, [guild.id], now + 2, () => {});
  assert.equal(retried.interviewsReminded, 1);
});

test("event reminders are delivered once to their configured channel", async () => {
  const now = 1_700_000_000_000;
  org.createCommunityEvent("123456", "777777", { title: "Soirée PND", description: "À demain", startsAt: now + 12 * 60 * 60_000, channelId: "222222" }, now);
  const sent = [];
  const guild = { id: "123456", channels: { async fetch(id) { return { id, isTextBased: () => true, async send(payload) { sent.push(payload); } }; } } };
  const client = { guilds: { cache: new Map([[guild.id, guild]]) } };
  const first = await runOrganizationMaintenance(client, [guild.id], now + 1, () => {});
  assert.equal(first.eventsReminded, 1);
  assert.match(sent[0].content, /Soirée PND/);
  assert.deepEqual(sent[0].allowedMentions.users, ["777777"]);
  const second = await runOrganizationMaintenance(client, [guild.id], now + 2, () => {});
  assert.equal(second.eventsReminded, 0);
  assert.equal(sent.length, 1);
});

test("failed event reminders release their claim for a later retry", async () => {
  const now = 1_700_000_000_000;
  org.createCommunityEvent("123456", "777778", { title: "Rencontre", startsAt: now + 12 * 60 * 60_000, channelId: "222223" }, now);
  let allowSend = false;
  const guild = { id: "123456", channels: { async fetch(id) { return { id, isTextBased: () => true, async send() { if (!allowSend) throw new Error("Salon indisponible"); } }; } } };
  const client = { guilds: { cache: new Map([[guild.id, guild]]) } };
  const failed = await runOrganizationMaintenance(client, [guild.id], now + 1, () => {});
  assert.equal(failed.eventReminderFailures, 1);
  allowSend = true;
  const retried = await runOrganizationMaintenance(client, [guild.id], now + 2, () => {});
  assert.equal(retried.eventsReminded, 1);
});

test("partial interview reminder delivery retries only the recipient who did not receive it", async () => {
  const now = 1_700_000_000_000;
  const application = org.submitRecruitmentApplication("123456", "777781", ["Candidat"], now - 1000);
  org.scheduleRecruitmentInterview("123456", application.applicationId, "654321", "888890", now + 12 * 60 * 60_000, null, { authorizeActor: () => true, now });
  const sent = [];
  let interviewerAvailable = false;
  const guild = {
    id: "123456", channels: { async fetch() { return null; } },
    members: { async fetch(id) { return { async send() { if (id === "888890" && !interviewerAvailable) throw new Error("DM fermé"); sent.push(id); } }; } },
  };
  const client = { guilds: { cache: new Map([[guild.id, guild]]) } };
  const first = await runOrganizationMaintenance(client, [guild.id], now + 1, () => {});
  assert.equal(first.interviewReminderFailures, 1);
  assert.deepEqual(sent, ["777781"]);
  interviewerAvailable = true;
  const second = await runOrganizationMaintenance(client, [guild.id], now + 2, () => {});
  assert.equal(second.interviewsReminded, 1);
  assert.deepEqual(sent, ["777781", "888890"]);
});
