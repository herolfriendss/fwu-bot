import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pnd-organization-"));
process.env.HER_DB_PATH = join(directory, "economy.sqlite");
const service = await import("./organization.js");
const { db } = await import("./database.js");

after(() => {
  db.close();
  delete process.env.HER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

test("events support guild-scoped, unique signups", () => {
  const now = 1_700_000_000_000;
  const eventId = service.createCommunityEvent("123456", "654321", {
    title: "Soirée PND", description: "Rendez-vous !", startsAt: now + 3_600_000, channelId: "111111",
  }, now);
  assert.deepEqual(service.signUpCommunityEvent("123456", eventId, "777777", now + 1), { signedUp: true });
  assert.deepEqual(service.signUpCommunityEvent("123456", eventId, "777777", now + 2), { signedUp: false });
  assert.equal(service.listCommunityEventSignups("123456", eventId).length, 1);
  assert.deepEqual(service.listCommunityEventSignups("999999", eventId), []);
});

test("academy quizzes require correct answers and track unique progress", () => {
  const track = service.createAcademyTrack("123456", "654321", "Accueil PND", [
    { title: "Règles", description: "Lis les règles.", quiz: [{ prompt: "Quel est le serveur principal ?", choices: ["PND", "MZ"], answerIndex: 0 }] },
    { title: "Sécurité", quiz: [] },
  ]);
  assert.throws(() => service.completeAcademyStep("123456", track.trackId, "777777", 0, [1]), /quiz/);
  assert.deepEqual(service.completeAcademyStep("123456", track.trackId, "777777", 0, [0]), { completedSteps: [0], complete: false });
  assert.deepEqual(service.completeAcademyStep("123456", track.trackId, "777777", 1, []), { completedSteps: [0, 1], complete: true });
  assert.throws(() => service.completeAcademyStep("999999", track.trackId, "777777", 0, [0]), /introuvable/);
});

test("awards allow one vote per member and produce a deterministic tally", () => {
  const now = 1_700_000_000_000;
  const campaign = service.createAwardCampaign("123456", "654321", "Membre du mois", ["Alice", "Bob"], now + 3_600_000, now);
  service.voteAwardCampaign("123456", campaign.campaignId, "777777", 0, now + 1);
  service.voteAwardCampaign("123456", campaign.campaignId, "888888", 1, now + 2);
  assert.throws(() => service.voteAwardCampaign("123456", campaign.campaignId, "777777", 1, now + 3), /déjà voté/);
  const result = service.closeAwardCampaign("123456", campaign.campaignId, "654321", { authorizeActor: () => true, now: now + 3_600_001 });
  assert.equal(result.totalVotes, 2);
  assert.equal(result.winner, "Alice");
  assert.throws(() => service.voteAwardCampaign("123456", campaign.campaignId, "999999", 0, now + 3_600_002), /plus de votes/);
});

test("stories need moderation before publication and are deleted after expiry", () => {
  const now = 1_700_000_000_000;
  const story = service.createStory("123456", "777777", "Info PND", "Message à publier", now + 86_400_000, now);
  assert.equal(service.listPublishedStories("123456", now).length, 0);
  assert.throws(() => service.approveStory("123456", story.storyId, "654321", { authorizeActor: () => false, now }), /Validation staff/);
  service.approveStory("123456", story.storyId, "654321", { authorizeActor: () => true, now });
  service.publishStory("123456", story.storyId, "654321", { authorizeActor: () => true, now });
  assert.equal(service.listPublishedStories("123456", now).length, 1);
  assert.equal(service.expireStories("123456", now + 86_400_001), 1);
  assert.equal(service.listPublishedStories("123456", now + 86_400_001).length, 0);
});

test("recruitment records decisions and automatically purges after the retention window", () => {
  const now = 1_700_000_000_000;
  const application = service.submitRecruitmentApplication("123456", "777777", ["Motivation", "Expérience"], now);
  assert.throws(() => service.submitRecruitmentApplication("123456", "777777", ["Doublon"], now + 1), /candidature en cours/);
  assert.equal(service.listRecruitmentApplications("123456").length, 1);
  assert.throws(() => service.reviewRecruitmentApplication("123456", application.applicationId, "654321", "accepted", "OK", { authorizeActor: () => false, now: now + 2 }), /Permission/);
  service.reviewRecruitmentApplication("123456", application.applicationId, "654321", "accepted", "Retenu", { authorizeActor: () => true, now: now + 2 });
  assert.equal(service.listRecruitmentApplications("123456", "accepted").length, 1);
  assert.equal(service.purgeExpiredRecruitmentApplications("123456", now + 90 * 24 * 60 * 60_000 + 1), 1);
  assert.equal(service.listRecruitmentApplications("123456", "all").length, 0);
});

test("expired award campaigns close automatically with a deterministic result", () => {
  const now = 1_700_000_000_000;
  const campaign = service.createAwardCampaign("123456", "654321", "Vote expirant", ["A", "B"], now + 60_001, now);
  service.voteAwardCampaign("123456", campaign.campaignId, "777777", 1, now + 1);
  assert.equal(service.closeExpiredAwardCampaigns("123456", now + 60_000), 0);
  assert.equal(service.closeExpiredAwardCampaigns("123456", now + 60_001), 1);
  assert.deepEqual(service.listOpenAwardCampaigns("123456", now + 60_002), []);
});

test("Radar returns null for missing measures and Wrapped exposes aggregates only", () => {
  const now = Date.parse("2026-03-10T12:00:00.000Z");
  service.incrementDailyMetric("123456", "messages", 14, now);
  service.incrementDailyMetric("123456", "joins", 2, now);
  const radar = service.getRadarSummary("123456", "2026-03-10", "2026-03-10");
  assert.equal(radar.metrics.messages, 14);
  assert.equal(radar.metrics.joins, 2);
  assert.equal(radar.metrics.leaves, null);
  const wrapped = service.getWrappedMemberSummary("123456", "777777", now - 1, now + 1);
  assert.equal(wrapped.messageCount, null);
  assert.equal(wrapped.economyOperations, 0);
  assert.equal(service.getRadarSummary("999999", "2026-03-10", "2026-03-10").metrics.messages, null);
});

test("academy enforces sequential progress and returns a member progress summary", () => {
  const track = service.createAcademyTrack("123456", "654321", "Parcours ordonné", [
    { title: "Bases", quiz: [] },
    { title: "Avancé", quiz: [] },
  ]);
  assert.deepEqual(service.getAcademyProgress("123456", track.trackId, "777777"), {
    completedSteps: [], nextStep: 0, stepCount: 2, complete: false, updatedAt: null,
  });
  assert.throws(() => service.completeAcademyStep("123456", track.trackId, "777777", 1, []), /d'abord terminer l'étape 1/);
  assert.deepEqual(service.completeAcademyStep("123456", track.trackId, "777777", 0, []), {
    completedSteps: [0], complete: false,
  });
  assert.deepEqual(service.completeAcademyStep("123456", track.trackId, "777777", 0, []), {
    completedSteps: [0], complete: false, duplicate: true,
  });
  assert.deepEqual(service.completeAcademyStep("123456", track.trackId, "777777", 1, []), {
    completedSteps: [0, 1], complete: true,
  });
  assert.equal(service.getAcademyProgress("123456", track.trackId, "777777").complete, true);
});

test("academy staff can add quizzes before learners start, but cannot change a started track", () => {
  const track = service.createAcademyTrack("123456", "654321", "Accueil quiz", [
    { title: "Règles", description: "Lis les règles.", quiz: [] },
  ]);
  assert.throws(() => service.addAcademyQuestion("123456", track.trackId, "888888", 0, {
    prompt: "Quel est le serveur principal ?", choices: ["PND", "MZ"], answerIndex: 0,
  }, { authorizeActor: () => false }), /Permission/);
  const added = service.addAcademyQuestion("123456", track.trackId, "654321", 0, {
    prompt: "Quel est le serveur principal ?", choices: ["MZ", "PND"], answerIndex: 1,
  }, { authorizeActor: () => true });
  assert.equal(added.questionCount, 1);
  assert.equal(service.getAcademyTrack("123456", track.trackId).steps[0].quiz[0].prompt, "Quel est le serveur principal ?");
  assert.throws(() => service.completeAcademyStep("123456", track.trackId, "777777", 0, [0]), /quiz/);
  assert.deepEqual(service.completeAcademyStep("123456", track.trackId, "777777", 0, [1]), {
    completedSteps: [0], complete: true,
  });
  assert.throws(() => service.addAcademyQuestion("123456", track.trackId, "654321", 0, {
    prompt: "Nouvelle question", choices: ["A", "B"], answerIndex: 1,
  }, { authorizeActor: () => true }), /ne peut plus être modifié/);
});


test("academy quiz configuration is bounded, hidden from learners and progress stays ordered", () => {
  const track = service.createAcademyTrack("123456", "654321", "Formation PND", [
    { title: "Accueil", quiz: [] },
    { title: "Sécurité", quiz: [] },
  ]);
  const question = { prompt: "Quel serveur est prioritaire ?", choices: ["MZ", "PND"], answerIndex: 1 };
  assert.throws(() => service.addAcademyQuestion("123456", track.trackId, "654321", 0, question), /Autorisation/);
  service.addAcademyQuestion("123456", track.trackId, "654321", 0, question, { authorizeActor: () => true });
  const learnerView = service.getAcademyTrack("123456", track.trackId);
  assert.deepEqual(learnerView.steps[0].quiz[0], { prompt: question.prompt, choices: question.choices });
  assert.equal("answerIndex" in learnerView.steps[0].quiz[0], false);
  assert.throws(() => service.completeAcademyStep("123456", track.trackId, "777777", 1, []), /d'abord terminer/);
  assert.throws(() => service.completeAcademyStep("123456", track.trackId, "777777", 0, [0]), /quiz/);
  assert.deepEqual(service.completeAcademyStep("123456", track.trackId, "777777", 0, [1]), { completedSteps: [0], complete: false });
});


test("award campaigns closed without votes have no winner", () => {
  const now = 1_700_000_000_000;
  const campaign = service.createAwardCampaign("123456", "654321", "Sans votes", ["A", "B"], now + 3_600_000, now);
  const result = service.closeAwardCampaign("123456", campaign.campaignId, "654321", { authorizeActor: () => true, now: now + 3_600_001 });
  assert.equal(result.totalVotes, 0);
  assert.equal(result.winner, null);
  assert.throws(() => service.closeAwardCampaign("123456", campaign.campaignId, "654321", { authorizeActor: () => true, now: now + 3_600_002 }), /déjà fermée/);
});


test("event cancellation is limited to the host or authorized staff and blocks new signups", () => {
  const now = 1_700_000_000_000;
  const eventId = service.createCommunityEvent("123456", "654321", { title: "Assemblée", startsAt: now + 3_600_000 }, now);
  assert.throws(() => service.cancelCommunityEvent("123456", eventId, "777777", { authorizeActor: () => false, now: now + 1 }), /organisateur ou le staff/);
  const cancelled = service.cancelCommunityEvent("123456", eventId, "654321", { now: now + 2 });
  assert.equal(cancelled.eventId, eventId);
  assert.equal(service.listUpcomingCommunityEvents("123456", now).some((event) => event.id === eventId), false);
  assert.throws(() => service.signUpCommunityEvent("123456", eventId, "777777", now + 3), /introuvable ou déjà commencé/);
  assert.throws(() => service.cancelCommunityEvent("123456", eventId, "654321", { now: now + 4 }), /déjà annulé/);
});


test("recruitment supports owner assignment, scheduled interviews and evaluations", () => {
  const now = 1_700_000_000_000;
  const application = service.submitRecruitmentApplication("123456", "777777", ["Motivé"], now);
  assert.throws(() => service.assignRecruitmentApplication("123456", application.applicationId, "654321", "888888"), /Permission/);
  const assigned = service.assignRecruitmentApplication("123456", application.applicationId, "654321", "888888", { authorizeActor: () => true, now: now + 1 });
  assert.equal(assigned.assigneeId, "888888");
  assert.equal(service.getRecruitmentAssignment("123456", application.applicationId).assigneeId, "888888");
  assert.throws(() => service.scheduleRecruitmentInterview("123456", application.applicationId, "654321", "888888", now + 60_000), /Permission/);
  const interview = service.scheduleRecruitmentInterview("123456", application.applicationId, "654321", "888888", now + 3_600_000, null, { authorizeActor: () => true, now: now + 2 });
  assert.equal(service.listRecruitmentInterviews("123456", { fromAt: now }).length, 1);
  assert.throws(() => service.completeRecruitmentInterview("123456", interview.interviewId, "654321", 6, "", { authorizeActor: () => true, now: now + 3 }), /1 et 5/);
  assert.throws(() => service.completeRecruitmentInterview("123456", interview.interviewId, "654321", 4, "Trop tôt", { authorizeActor: () => true, now: now + 4 }), /avant son horaire/);
  const completed = service.completeRecruitmentInterview("123456", interview.interviewId, "654321", 4, "Bonne communication", { authorizeActor: () => true, now: now + 3_600_003 });
  assert.equal(completed.score, 4);
  assert.equal(service.listRecruitmentInterviews("123456", { fromAt: now, status: "completed" })[0].notes, "Bonne communication");
  assert.throws(() => service.completeRecruitmentInterview("123456", interview.interviewId, "654321", 4, "", { authorizeActor: () => true, now: now + 3_600_004 }), /déjà traité/);
});


test("final recruitment decisions cancel outstanding interviews atomically", () => {
  const now = 1_700_000_000_000;
  const application = service.submitRecruitmentApplication("123456", "777778", ["Disponible"], now);
  const interview = service.scheduleRecruitmentInterview("123456", application.applicationId, "654321", "888888", now + 3_600_000, null, { authorizeActor: () => true, now: now + 1 });
  const result = service.reviewRecruitmentApplication("123456", application.applicationId, "654321", "rejected", "Merci", { authorizeActor: () => true, now: now + 2 });
  assert.equal(result.cancelledInterviews, 1);
  assert.equal(service.listRecruitmentInterviews("123456", { fromAt: now, status: "scheduled" }).length, 0);
  assert.equal(service.listRecruitmentInterviews("123456", { fromAt: now, status: "cancelled" }).length, 1);
  assert.equal(service.listRecruitmentInterviews("123456", { fromAt: 0, status: "cancelled" })[0].interviewId, interview.interviewId);
});


test("recruitment question forms are configured safely and snapshotted per application", () => {
  assert.throws(() => service.setRecruitmentQuestions("123456", "654321", ["Motivation"], { authorizeActor: () => false }), /Permission/);
  const questions = service.setRecruitmentQuestions("123456", "654321", ["Pourquoi PND ?", "Tes disponibilités ?"], { authorizeActor: () => true });
  assert.equal(questions.length, 2);
  assert.throws(() => service.submitRecruitmentApplication("123456", "777779", ["Motivé"]), /exactement 2 réponse/);
  const application = service.submitRecruitmentApplication("123456", "777779", ["Motivé", "Week-end"]);
  service.setRecruitmentQuestions("123456", "654321", ["Nouvelle question"], { authorizeActor: () => true });
  const details = service.getRecruitmentApplication("123456", application.applicationId);
  assert.deepEqual(details.questions, ["Pourquoi PND ?", "Tes disponibilités ?"]);
  assert.deepEqual(details.answers, ["Motivé", "Week-end"]);
});
