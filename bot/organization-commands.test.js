import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-organization-commands-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const { handleOrganizationMessage } = await import("./organization-commands.js");
const { listUpcomingCommunityEvents, listCommunityEventSignups } = await import("./organization.js");
const { db } = await import("./database.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

function makeMessage(content, { userId = "777777", ownerId = "777777", canManageEvents = true, roleIds = [] } = {}) {
  const replies = [];
  const dms = [];
  return {
    content,
    author: { id: userId, bot: false },
    guild: { id: "123456", ownerId, members: { async fetch(id) { return { id, user: { id, bot: false }, permissions: { has: (permission) => permission === "ManageGuild" }, roles: { cache: { has: () => false } }, async send(payload) { dms.push(payload); } }; } }, channels: { async fetch() { return null; } } },
    member: { permissions: { has: (permission) => permission === "ManageEvents" && canManageEvents }, roles: { cache: { has: (roleId) => roleIds.includes(roleId) } } },
    channel: { id: "222222" },
    replies,
    dms,
    async reply(payload) { replies.push(payload); },
  };
}

test("event commands create, list, join and leave with guild-scoped persistence", async () => {
  const startsAt = Date.now() + 3_600_000;
  const date = new Date(startsAt).toISOString();
  const create = makeMessage(`=pndevent create ${date} | Réunion PND | Présentation`);
  assert.equal(await handleOrganizationMessage(create), true);
  assert.match(create.replies[0].content, /Événement/);
  const events = listUpcomingCommunityEvents("123456");
  assert.equal(events.length, 1);
  const id = events[0].id;
  const join = makeMessage(`=pndevent join ${id}`);
  assert.equal(await handleOrganizationMessage(join), true);
  assert.equal(listCommunityEventSignups("123456", id).length, 1);
  const leave = makeMessage(`=pndevent leave ${id}`);
  assert.equal(await handleOrganizationMessage(leave), true);
  assert.equal(listCommunityEventSignups("123456", id).length, 0);
  const cancel = makeMessage(`=pndevent cancel ${id}`);
  await handleOrganizationMessage(cancel);
  assert.match(cancel.replies[0].content, /annulé/);
  const hidden = makeMessage("=pndevent list");
  await handleOrganizationMessage(hidden);
  assert.doesNotMatch(hidden.replies[0].content, new RegExp(`#${id}\b`));
});

test("event creation is protected and candidature validates required answers", async () => {
  const date = new Date(Date.now() + 3_600_000).toISOString();
  const denied = makeMessage(`=pndevent create ${date} | Private | Test`, { canManageEvents: false, ownerId: "999999" });
  await handleOrganizationMessage(denied);
  assert.match(denied.replies[0].content, /réservé au staff/i);
  const application = makeMessage("=candidature Je souhaite rejoindre l'équipe | Je suis disponible le week-end");
  await handleOrganizationMessage(application);
  assert.match(application.replies[0].content, /Candidature envoyée/);
  const duplicate = makeMessage("=candidature Nouvelle candidature");
  await handleOrganizationMessage(duplicate);
  assert.match(duplicate.replies[0].content, /candidature en cours/i);
});

test("Academy, Awards, Stories and recruitment staff review are usable from prefix commands", async () => {
  const academyCreate = makeMessage("=academy create Accueil PND | Règles:Lis les règles ; Présentation:Présente-toi");
  await handleOrganizationMessage(academyCreate);
  assert.match(academyCreate.replies[0].content, /Parcours/);
  const trackId = academyCreate.replies[0].content.match(/\(`([0-9a-f-]{8})`\)/i)?.[1];
  assert.ok(trackId);
  const academyShow = makeMessage(`=academy show ${trackId}`);
  await handleOrganizationMessage(academyShow);
  assert.match(academyShow.replies[0].content, /Règles/);
  const academyQuiz = makeMessage(`=academy quiz ${trackId} 1 | Quel serveur ? | MZ | PND | 2`);
  await handleOrganizationMessage(academyQuiz);
  assert.match(academyQuiz.replies[0].content, /Question ajoutée/);
  const academyStep = makeMessage(`=academy show ${trackId} 1`);
  await handleOrganizationMessage(academyStep);
  assert.match(academyStep.replies[0].content, /Quel serveur/);
  assert.doesNotMatch(academyStep.replies[0].content, /bonne réponse|answerIndex/i);
  const academyProgress = makeMessage(`=academy progress ${trackId}`);
  await handleOrganizationMessage(academyProgress);
  assert.match(academyProgress.replies[0].content, /0\/2/);
  const academyWrong = makeMessage(`=academy complete ${trackId} 1 | 1`);
  await handleOrganizationMessage(academyWrong);
  assert.match(academyWrong.replies[0].content, /quiz n’est pas validé/i);
  const academyComplete = makeMessage(`=academy complete ${trackId} 1 | 2`);
  await handleOrganizationMessage(academyComplete);
  assert.match(academyComplete.replies[0].content, /Étape validée/);

  const endsAt = new Date(Date.now() + 3_600_000).toISOString();
  const awardCreate = makeMessage(`=award create ${endsAt} | Membre du mois | Alice | Bob`);
  await handleOrganizationMessage(awardCreate);
  assert.match(awardCreate.replies[0].content, /Vote/);
  const awardId = awardCreate.replies[0].content.match(/\(`([0-9a-f-]{8})`\)/i)?.[1];
  const vote = makeMessage(`=award vote ${awardId} 1`);
  await handleOrganizationMessage(vote);
  assert.match(vote.replies[0].content, /Ton vote/);
  const close = makeMessage(`=award close ${awardId}`);
  await handleOrganizationMessage(close);
  assert.match(close.replies[0].content, /Vote clôturé/);

  const storyCreate = makeMessage("=story create Info PND | Petit message à publier");
  await handleOrganizationMessage(storyCreate);
  assert.match(storyCreate.replies[0].content, /Story envoyée en modération/);
  const storyId = storyCreate.replies[0].content.match(/\(`([0-9a-f-]{36})`\)/i)?.[1];
  assert.ok(storyId);
  const storyApprove = makeMessage(`=story approve ${storyId}`);
  await handleOrganizationMessage(storyApprove);
  assert.match(storyApprove.replies[0].content, /Story validée/);
  const storyPublish = makeMessage(`=story publish ${storyId}`);
  await handleOrganizationMessage(storyPublish);
  assert.match(storyPublish.replies[0].content, /publiée/);

  const application = makeMessage("=candidature Expérience communautaire | Motivé", { userId: "888888" });
  await handleOrganizationMessage(application);
  const applicationId = application.replies[0].content.match(/([0-9a-f]{8})/i)?.[1];
  assert.ok(applicationId);
  const applicationsList = makeMessage("=candidatures list");
  await handleOrganizationMessage(applicationsList);
  assert.match(applicationsList.replies[0].content, new RegExp(applicationId));
  const applicationView = makeMessage(`=candidatures voir ${applicationId}`);
  await handleOrganizationMessage(applicationView);
  assert.match(applicationView.replies[0].content, /Expérience communautaire/);
  const applicationReview = makeMessage(`=candidatures review ${applicationId} accepted Bienvenue dans l'équipe`);
  await handleOrganizationMessage(applicationReview);
  assert.match(applicationReview.replies[0].content, /accepted/);
  assert.equal(applicationReview.dms.length, 1);
  assert.match(applicationReview.dms[0].content, /candidature PND a été retenue/);
  assert.doesNotMatch(applicationReview.dms[0].content, /Bienvenue dans l'équipe/);
});


test("recruitment commands assign candidates and manage interview calendar", async () => {
  const application = makeMessage("=candidature Expérience | Disponibilités", { userId: "888888" });
  await handleOrganizationMessage(application);
  const applicationId = application.replies[0].content.match(/([0-9a-f]{8})/i)?.[1];
  assert.ok(applicationId);

  const assign = makeMessage(`=candidatures assign ${applicationId} <@999999>`);
  await handleOrganizationMessage(assign);
  assert.match(assign.replies[0].content, /affectée à/);

  const startsAt = new Date(Date.now() + 3_600_000).toISOString();
  const schedule = makeMessage(`=candidatures entretien ${applicationId} ${startsAt} <@999999>`);
  await handleOrganizationMessage(schedule);
  assert.match(schedule.replies[0].content, /Entretien planifié/);
  const interviewId = schedule.replies[0].content.match(/Référence : `([0-9a-f]{8})`/i)?.[1];
  assert.ok(interviewId);

  const calendar = makeMessage("=candidatures entretiens");
  await handleOrganizationMessage(calendar);
  assert.match(calendar.replies[0].content, new RegExp(interviewId));

  const evaluation = makeMessage(`=candidatures evaluation ${interviewId} 5 | Très bon échange`);
  await handleOrganizationMessage(evaluation);
  assert.match(evaluation.replies[0].content, /avant son horaire/);
});


test("recruitment question configuration is shown to candidates and snapshotted in dossiers", async () => {
  const configure = makeMessage("=candidatures questions Pourquoi PND ? | Quelles disponibilités ?");
  await handleOrganizationMessage(configure);
  assert.match(configure.replies[0].content, /2 question/);
  const prompt = makeMessage("=candidature", { userId: "777780" });
  await handleOrganizationMessage(prompt);
  assert.match(prompt.replies[0].content, /Pourquoi PND/);
  const submit = makeMessage("=candidature Pour la communauté | Le week-end", { userId: "777780" });
  await handleOrganizationMessage(submit);
  assert.match(submit.replies[0].content, /Candidature envoyée/);
  const id = submit.replies[0].content.match(/([0-9a-f]{8})/i)?.[1];
  const view = makeMessage(`=candidatures voir ${id}`);
  await handleOrganizationMessage(view);
  assert.match(view.replies[0].content, /Pourquoi PND/);
  assert.match(view.replies[0].content, /Pour la communauté/);
});


test("SYS+ and configured PND owners can manage organization workflows without guild administrator", async () => {
  const sysPlus = makeMessage("=candidatures questions Pourquoi PND ?", { userId: "555555", ownerId: "999999", canManageEvents: false, roleIds: ["sys-role"] });
  await handleOrganizationMessage(sysPlus, { settings: { "123456": { sysPlus: { roleId: "sys-role" } } } });
  assert.match(sysPlus.replies[0].content, /question.*configurée/i);

  const pndOwner = makeMessage("=candidatures questions Pourquoi maintenant ?", { userId: "444444", ownerId: "999999", canManageEvents: false });
  await handleOrganizationMessage(pndOwner, { ownerIds: ["444444"] });
  assert.match(pndOwner.replies[0].content, /question.*configurée/i);
});
