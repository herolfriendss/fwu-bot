import { randomUUID } from "node:crypto";
import { db, transaction } from "./database.js";

const SNOWFLAKE = /^\d{5,25}$/;
const METRICS = new Set(["messages", "joins", "leaves", "voice_minutes", "tickets_opened", "events_joined"]);
const RETENTION_MS = 90 * 24 * 60 * 60_000;
const clean = (value, max, label) => {
  if (typeof value !== "string") throw new Error(`${label} invalide.`);
  const result = value.replace(/@/g, "＠").trim();
  if (!result || result.length > max) throw new Error(`${label} doit contenir entre 1 et ${max} caractères.`);
  return result;
};
const assertGuild = (guildId) => {
  if (typeof guildId !== "string" || !SNOWFLAKE.test(guildId)) throw new Error("Identifiant de serveur invalide.");
};
const assertUser = (userId) => {
  if (typeof userId !== "string" || !SNOWFLAKE.test(userId)) throw new Error("Identifiant membre invalide.");
};

// EVENTS --------------------------------------------------------------------
export function createCommunityEvent(guildId, hostId, input, now = Date.now()) {
  assertGuild(guildId); assertUser(hostId);
  const title = clean(input.title, 100, "Le titre");
  const description = typeof input.description === "string" ? input.description.replace(/@/g, "＠").trim().slice(0, 1000) : "";
  const startsAt = Number(input.startsAt);
  if (!Number.isSafeInteger(startsAt) || startsAt < now + 60_000 || startsAt > now + 365 * 24 * 60 * 60_000) throw new Error("La date doit être comprise entre une minute et un an à partir de maintenant.");
  const channelId = input.channelId == null ? null : String(input.channelId);
  if (channelId && !SNOWFLAKE.test(channelId)) throw new Error("Salon invalide.");
  const result = db.prepare("INSERT INTO events(guild_id,title,description,starts_at,host_id,channel_id,created_at) VALUES(?,?,?,?,?,?,?)")
    .run(guildId, title, description, startsAt, hostId, channelId, now);
  return Number(result.lastInsertRowid);
}

export function signUpCommunityEvent(guildId, eventId, userId, now = Date.now()) {
  assertGuild(guildId); assertUser(userId);
  if (!Number.isSafeInteger(eventId) || eventId < 1) throw new Error("Événement invalide.");
  return transaction(() => {
    const event = db.prepare("SELECT starts_at,cancelled_at FROM events WHERE guild_id=? AND id=?").get(guildId, eventId);
    if (!event || event.cancelled_at != null || Number(event.starts_at) <= now) throw new Error("Événement introuvable ou déjà commencé.");
    const result = db.prepare("INSERT OR IGNORE INTO event_signups(guild_id,event_id,user_id,signed_up_at) VALUES(?,?,?,?)")
      .run(guildId, eventId, userId, now);
    return { signedUp: Number(result.changes) > 0 };
  });
}

export function listCommunityEventSignups(guildId, eventId) {
  assertGuild(guildId);
  if (!Number.isSafeInteger(eventId) || eventId < 1) throw new Error("Événement invalide.");
  return db.prepare("SELECT user_id,signed_up_at FROM event_signups WHERE guild_id=? AND event_id=? ORDER BY signed_up_at,user_id")
    .all(guildId, eventId).map((row) => ({ userId: row.user_id, signedUpAt: Number(row.signed_up_at) }));
}

export function listUpcomingCommunityEvents(guildId, now = Date.now(), limit = 20) {
  assertGuild(guildId);
  const bounded = Math.max(1, Math.min(50, Number(limit) || 20));
  return db.prepare(`SELECT e.id,e.title,e.description,e.starts_at,e.host_id,e.channel_id,
      (SELECT COUNT(*) FROM event_signups s WHERE s.guild_id=e.guild_id AND s.event_id=e.id) AS signups
    FROM events e WHERE e.guild_id=? AND e.starts_at>? AND e.cancelled_at IS NULL ORDER BY e.starts_at ASC LIMIT ?`)
    .all(guildId, now, bounded).map((row) => ({
      id: Number(row.id), title: row.title, description: row.description,
      startsAt: Number(row.starts_at), hostId: row.host_id, channelId: row.channel_id,
      signups: Number(row.signups),
    }));
}

export function leaveCommunityEvent(guildId, eventId, userId) {
  assertGuild(guildId); assertUser(userId);
  if (!Number.isSafeInteger(eventId) || eventId < 1) throw new Error("Événement invalide.");
  const result = db.prepare("DELETE FROM event_signups WHERE guild_id=? AND event_id=? AND user_id=?").run(guildId, eventId, userId);
  return { left: Number(result.changes) > 0 };
}

export function claimDueCommunityEventReminders(guildId, now = Date.now(), windowMs = 24 * 60 * 60_000, limit = 20) {
  assertGuild(guildId);
  if (!Number.isSafeInteger(windowMs) || windowMs < 60_000 || windowMs > 7 * 24 * 60 * 60_000) throw new Error("Fenêtre de rappel d'événement invalide.");
  const bounded = Math.max(1, Math.min(50, Number(limit) || 20));
  return transaction(() => {
    const rows = db.prepare(`SELECT e.id,e.title,e.description,e.starts_at,e.host_id,e.channel_id,
      (SELECT COUNT(*) FROM event_signups s WHERE s.guild_id=e.guild_id AND s.event_id=e.id) AS signups
      FROM events e WHERE e.guild_id=? AND e.cancelled_at IS NULL AND e.notified=0 AND e.starts_at>? AND e.starts_at<=?
      ORDER BY e.starts_at ASC LIMIT ?`).all(guildId, now, now + windowMs, bounded);
    const claimed = [];
    for (const row of rows) {
      const changed = db.prepare("UPDATE events SET notified=1 WHERE guild_id=? AND id=? AND notified=0 AND cancelled_at IS NULL")
        .run(guildId, row.id);
      if (Number(changed.changes)) claimed.push({ id: Number(row.id), title: row.title, description: row.description, startsAt: Number(row.starts_at), hostId: row.host_id, channelId: row.channel_id, signups: Number(row.signups) });
    }
    return claimed;
  });
}

export function releaseCommunityEventReminder(guildId, eventId) {
  assertGuild(guildId);
  if (!Number.isSafeInteger(eventId) || eventId < 1) throw new Error("Événement invalide.");
  const changed = db.prepare("UPDATE events SET notified=0 WHERE guild_id=? AND id=? AND cancelled_at IS NULL")
    .run(guildId, eventId);
  return Number(changed.changes) > 0;
}

export function cancelCommunityEvent(guildId, eventId, actorId, { authorizeActor, now = Date.now() } = {}) {
  assertGuild(guildId); assertUser(actorId);
  if (!Number.isSafeInteger(eventId) || eventId < 1) throw new Error("Événement invalide.");
  return transaction(() => {
    const event = db.prepare("SELECT host_id,starts_at,cancelled_at FROM events WHERE guild_id=? AND id=?")
      .get(guildId, eventId);
    if (!event || event.cancelled_at != null || Number(event.starts_at) <= now) throw new Error("Événement introuvable, déjà annulé ou commencé.");
    const isHost = event.host_id === actorId;
    const isAuthorized = typeof authorizeActor === "function" && authorizeActor({ guildId, actorId, hostId: event.host_id, action: "events.cancel" }) === true;
    if (!isHost && !isAuthorized) throw new Error("Seul l'organisateur ou le staff autorisé peut annuler cet événement.");
    const result = db.prepare("UPDATE events SET cancelled_at=? WHERE guild_id=? AND id=? AND cancelled_at IS NULL")
      .run(now, guildId, eventId);
    if (!Number(result.changes)) throw new Error("Cet événement vient d'être annulé.");
    return { eventId, cancelledAt: now };
  });
}

// ACADEMY -------------------------------------------------------------------
export function createAcademyTrack(guildId, actorId, title, steps, now = Date.now()) {
  assertGuild(guildId); assertUser(actorId);
  const cleanTitle = clean(title, 80, "Le titre du parcours");
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 20) throw new Error("Un parcours doit contenir de 1 à 20 étapes.");
  const normalized = steps.map((step, index) => {
    const questions = Array.isArray(step.quiz) ? step.quiz : [];
    if (questions.length > 5) throw new Error("Chaque étape accepte au maximum cinq questions.");
    const quiz = questions.map((question) => {
      const prompt = clean(question.prompt, 250, "La question");
      if (!Array.isArray(question.choices) || question.choices.length < 2 || question.choices.length > 5 ||
          question.choices.some((choice) => typeof choice !== "string" || !choice.trim() || choice.length > 100) ||
          !Number.isInteger(question.answerIndex) || question.answerIndex < 0 || question.answerIndex >= question.choices.length) {
        throw new Error("Question de quiz invalide.");
      }
      return { prompt, choices: question.choices.map((choice) => choice.replace(/@/g, "＠").trim()), answerIndex: question.answerIndex };
    });
    return { index, title: clean(step.title, 80, "Le titre d’étape"), description: typeof step.description === "string" ? step.description.slice(0, 500) : "", quiz };
  });
  const trackId = randomUUID();
  db.prepare("INSERT INTO academy_tracks(track_id,guild_id,title,steps_json,created_by,created_at) VALUES(?,?,?,?,?,?)")
    .run(trackId, guildId, cleanTitle, JSON.stringify(normalized), actorId, now);
  return { trackId, guildId, title: cleanTitle, steps: normalized };
}

export function listAcademyTracks(guildId, limit = 20) {
  assertGuild(guildId);
  const bounded = Math.max(1, Math.min(50, Number(limit) || 20));
  return db.prepare("SELECT track_id,title,steps_json,created_at FROM academy_tracks WHERE guild_id=? AND active=1 ORDER BY created_at DESC LIMIT ?")
    .all(guildId, bounded).map((row) => ({ trackId: row.track_id, title: row.title, stepCount: JSON.parse(row.steps_json).length, createdAt: Number(row.created_at) }));
}

export function getAcademyTrack(guildId, trackId) {
  assertGuild(guildId);
  const row = db.prepare("SELECT track_id,title,steps_json,created_at FROM academy_tracks WHERE guild_id=? AND track_id=? AND active=1").get(guildId, trackId);
  if (!row) return null;
  const steps = JSON.parse(row.steps_json).map(({ index, title, description, quiz }) => ({
    index, title, description, quiz: quiz.map(({ prompt, choices }) => ({ prompt, choices })),
  }));
  return Object.freeze({ trackId: row.track_id, title: row.title, steps, createdAt: Number(row.created_at) });
}

export function addAcademyQuestion(guildId, trackId, actorId, stepIndex, question, { authorizeActor, now = Date.now() } = {}) {
  assertGuild(guildId); assertUser(actorId);
  if (typeof authorizeActor !== "function") throw new Error("Autorisation de modification requise.");
  const track = db.prepare("SELECT steps_json,active,created_by FROM academy_tracks WHERE guild_id=? AND track_id=?")
    .get(guildId, trackId);
  if (!track || track.active !== 1) throw new Error("Parcours introuvable ou désactivé.");
  if (authorizeActor({ guildId, actorId, creatorId: track.created_by, action: "academy.quiz.edit" }) !== true) throw new Error("Permission de modifier ce parcours refusée.");
  if (!Number.isSafeInteger(stepIndex) || stepIndex < 0) throw new Error("Étape invalide.");
  const steps = JSON.parse(track.steps_json);
  const step = steps[stepIndex];
  if (!step) throw new Error("Étape introuvable.");
  const prompt = clean(question?.prompt, 250, "La question");
  if (!Array.isArray(question?.choices) || question.choices.length < 2 || question.choices.length > 5 ||
      question.choices.some((choice) => typeof choice !== "string" || !choice.trim() || choice.trim().length > 100) ||
      !Number.isSafeInteger(question.answerIndex) || question.answerIndex < 0 || question.answerIndex >= question.choices.length) {
    throw new Error("La question doit avoir de 2 à 5 choix et une bonne réponse valide.");
  }
  return transaction(() => {
    const started = Number(db.prepare("SELECT COUNT(*) AS count FROM academy_progress WHERE guild_id=? AND track_id=?")
      .get(guildId, trackId).count);
    if (started > 0) throw new Error("Le parcours ne peut plus être modifié : au moins un membre a déjà commencé.");
    if (!Array.isArray(step.quiz)) step.quiz = [];
    if (step.quiz.length >= 5) throw new Error("Cette étape contient déjà cinq questions.");
    const cleanQuestion = { prompt, choices: question.choices.map((choice) => clean(choice, 100, "Le choix")), answerIndex: question.answerIndex };
    step.quiz.push(cleanQuestion);
    const result = db.prepare("UPDATE academy_tracks SET steps_json=? WHERE guild_id=? AND track_id=? AND active=1")
      .run(JSON.stringify(steps), guildId, trackId);
    if (!Number(result.changes)) throw new Error("Le parcours a changé pendant la modification.");
    return { stepIndex, questionCount: step.quiz.length, question: { prompt, choices: cleanQuestion.choices } };
  });
}

export function getAcademyProgress(guildId, trackId, userId) {
  assertGuild(guildId); assertUser(userId);
  const track = db.prepare("SELECT steps_json,active FROM academy_tracks WHERE guild_id=? AND track_id=?").get(guildId, trackId);
  if (!track || track.active !== 1) throw new Error("Parcours introuvable ou désactivé.");
  const stepCount = JSON.parse(track.steps_json).length;
  const row = db.prepare("SELECT completed_steps_json,updated_at FROM academy_progress WHERE guild_id=? AND track_id=? AND user_id=?")
    .get(guildId, trackId, userId);
  const completedSteps = row ? JSON.parse(row.completed_steps_json) : [];
  return Object.freeze({
    completedSteps,
    nextStep: completedSteps.length < stepCount ? completedSteps.length : null,
    stepCount,
    complete: completedSteps.length === stepCount,
    updatedAt: row ? Number(row.updated_at) : null,
  });
}

export function completeAcademyStep(guildId, trackId, userId, stepIndex, answers, now = Date.now()) {
  assertGuild(guildId); assertUser(userId);
  const track = db.prepare("SELECT steps_json,active FROM academy_tracks WHERE guild_id=? AND track_id=?").get(guildId, trackId);
  if (!track || track.active !== 1) throw new Error("Parcours introuvable ou désactivé.");
  const steps = JSON.parse(track.steps_json);
  const step = steps[stepIndex];
  if (!step || !Number.isSafeInteger(stepIndex) || stepIndex < 0) throw new Error("Étape invalide.");
  return transaction(() => {
    db.prepare("INSERT OR IGNORE INTO academy_progress(guild_id,track_id,user_id,completed_steps_json,updated_at) VALUES(?,?,?,'[]',?)")
      .run(guildId, trackId, userId, now);
    const row = db.prepare("SELECT completed_steps_json FROM academy_progress WHERE guild_id=? AND track_id=? AND user_id=?")
      .get(guildId, trackId, userId);
    const completed = JSON.parse(row.completed_steps_json);
    if (!Array.isArray(completed) || completed.some((index, position) => index !== position)) throw new Error("Progression invalide : contacte le staff.");
    if (stepIndex < completed.length) return { completedSteps: completed, complete: completed.length === steps.length, duplicate: true };
    if (stepIndex > completed.length) throw new Error(`Tu dois d'abord terminer l'étape ${completed.length + 1}.`);
    if (!Array.isArray(answers) || answers.length !== step.quiz.length || answers.some((answer, i) => answer !== step.quiz[i].answerIndex)) {
      throw new Error("Le quiz n’est pas validé. Réessaie.");
    }
    const sorted = [...completed, stepIndex];
    db.prepare("UPDATE academy_progress SET completed_steps_json=?,updated_at=? WHERE guild_id=? AND track_id=? AND user_id=?")
      .run(JSON.stringify(sorted), now, guildId, trackId, userId);
    return { completedSteps: sorted, complete: sorted.length === steps.length };
  });
}

// AWARDS --------------------------------------------------------------------
export function createAwardCampaign(guildId, actorId, title, options, endsAt, now = Date.now()) {
  assertGuild(guildId); assertUser(actorId);
  const cleanTitle = clean(title, 100, "Le titre");
  if (!Array.isArray(options) || options.length < 2 || options.length > 10) throw new Error("Une campagne doit proposer de 2 à 10 choix.");
  const normalized = options.map((option) => clean(option, 80, "Un choix"));
  if (new Set(normalized.map((v) => v.toLowerCase())).size !== normalized.length) throw new Error("Les choix doivent être uniques.");
  if (!Number.isSafeInteger(endsAt) || endsAt <= now + 60_000 || endsAt > now + 90 * 24 * 60 * 60_000) throw new Error("Date de clôture invalide.");
  const campaignId = randomUUID();
  db.prepare("INSERT INTO award_campaigns(campaign_id,guild_id,title,options_json,ends_at,created_by,created_at) VALUES(?,?,?,?,?,?,?)")
    .run(campaignId, guildId, cleanTitle, JSON.stringify(normalized), endsAt, actorId, now);
  return { campaignId, title: cleanTitle, options: normalized, endsAt };
}

export function listOpenAwardCampaigns(guildId, now = Date.now(), limit = 20) {
  assertGuild(guildId);
  const bounded = Math.max(1, Math.min(50, Number(limit) || 20));
  return db.prepare("SELECT campaign_id,title,options_json,ends_at,created_by FROM award_campaigns WHERE guild_id=? AND status='open' AND ends_at>? ORDER BY ends_at ASC LIMIT ?")
    .all(guildId, now, bounded).map((row) => ({ campaignId: row.campaign_id, title: row.title, options: JSON.parse(row.options_json), endsAt: Number(row.ends_at), createdBy: row.created_by }));
}

export function voteAwardCampaign(guildId, campaignId, userId, optionIndex, now = Date.now()) {
  assertGuild(guildId); assertUser(userId);
  return transaction(() => {
    const campaign = db.prepare("SELECT options_json,ends_at,status FROM award_campaigns WHERE guild_id=? AND campaign_id=?").get(guildId, campaignId);
    if (!campaign || campaign.status !== "open" || Number(campaign.ends_at) <= now) throw new Error("Cette campagne n’accepte plus de votes.");
    const options = JSON.parse(campaign.options_json);
    if (!Number.isSafeInteger(optionIndex) || optionIndex < 0 || optionIndex >= options.length) throw new Error("Choix invalide.");
    const result = db.prepare("INSERT OR IGNORE INTO award_votes(guild_id,campaign_id,user_id,option_id,voted_at) VALUES(?,?,?,?,?)")
      .run(guildId, campaignId, userId, String(optionIndex), now);
    if (!Number(result.changes)) throw new Error("Tu as déjà voté pour cette campagne.");
    return { voted: true, option: options[optionIndex] };
  });
}

export function closeAwardCampaign(guildId, campaignId, actorId, { authorizeActor, now = Date.now(), allowEarly = false } = {}) {
  assertGuild(guildId); assertUser(actorId);
  const campaign = db.prepare("SELECT * FROM award_campaigns WHERE guild_id=? AND campaign_id=?").get(guildId, campaignId);
  if (!campaign || campaign.status !== "open") throw new Error("Campagne introuvable ou déjà fermée.");
  if (Number(campaign.ends_at) > now && !allowEarly) throw new Error("La campagne est encore ouverte.");
  if (typeof authorizeActor !== "function" || authorizeActor({ guildId, actorId, action: "awards.close" }) !== true) throw new Error("Permission de clôture requise.");
  return transaction(() => {
    const current = db.prepare("SELECT status,options_json FROM award_campaigns WHERE guild_id=? AND campaign_id=?")
      .get(guildId, campaignId);
    if (!current || current.status !== "open") throw new Error("Campagne déjà clôturée.");
    const options = JSON.parse(current.options_json);
    const counts = db.prepare("SELECT option_id,COUNT(*) AS votes FROM award_votes WHERE guild_id=? AND campaign_id=? GROUP BY option_id")
      .all(guildId, campaignId);
    const byIndex = new Map(counts.map((row) => [Number(row.option_id), Number(row.votes)]));
    const tally = options.map((option, index) => ({ option, votes: byIndex.get(index) ?? 0, index }));
    tally.sort((a, b) => b.votes - a.votes || a.index - b.index);
    const totalVotes = tally.reduce((sum, entry) => sum + entry.votes, 0);
    const result = { totalVotes, winner: totalVotes > 0 ? tally[0]?.option ?? null : null, tally };
    const updated = db.prepare("UPDATE award_campaigns SET status='closed',closed_at=?,results_json=? WHERE guild_id=? AND campaign_id=? AND status='open'")
      .run(now, JSON.stringify(result), guildId, campaignId);
    if (!Number(updated.changes)) throw new Error("Campagne déjà clôturée.");
    return result;
  });
}

export function closeExpiredAwardCampaigns(guildId, now = Date.now()) {
  assertGuild(guildId);
  const expired = db.prepare("SELECT campaign_id,options_json FROM award_campaigns WHERE guild_id=? AND status='open' AND ends_at<=? ORDER BY ends_at ASC LIMIT 100")
    .all(guildId, now);
  let closed = 0;
  for (const campaign of expired) {
    const counts = db.prepare("SELECT option_id,COUNT(*) AS votes FROM award_votes WHERE guild_id=? AND campaign_id=? GROUP BY option_id")
      .all(guildId, campaign.campaign_id);
    const byIndex = new Map(counts.map((row) => [Number(row.option_id), Number(row.votes)]));
    const options = JSON.parse(campaign.options_json);
    const tally = options.map((option, index) => ({ option, votes: byIndex.get(index) ?? 0, index }));
    tally.sort((a, b) => b.votes - a.votes || a.index - b.index);
    const result = { totalVotes: tally.reduce((sum, entry) => sum + entry.votes, 0), winner: tally[0]?.votes ? tally[0].option : null, tally };
    const changed = db.prepare("UPDATE award_campaigns SET status='closed',closed_at=?,results_json=? WHERE guild_id=? AND campaign_id=? AND status='open' AND ends_at<=?")
      .run(now, JSON.stringify(result), guildId, campaign.campaign_id, now);
    closed += Number(changed.changes);
  }
  return closed;
}

// STORIES -------------------------------------------------------------------
export function createStory(guildId, authorId, title, body, expiresAt, now = Date.now()) {
  assertGuild(guildId); assertUser(authorId);
  const cleanTitle = clean(title, 100, "Le titre");
  const cleanBody = clean(body, 1800, "Le contenu").replace(/@/g, "＠");
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 30 * 24 * 60 * 60_000) throw new Error("Expiration comprise entre maintenant et 30 jours requise.");
  const storyId = randomUUID();
  db.prepare("INSERT INTO stories(story_id,guild_id,author_id,title,body,expires_at,created_at) VALUES(?,?,?,?,?,?,?)")
    .run(storyId, guildId, authorId, cleanTitle, cleanBody, expiresAt, now);
  return { storyId, status: "draft", expiresAt };
}

export function getStory(guildId, storyId) {
  assertGuild(guildId);
  const row = db.prepare("SELECT story_id,author_id,title,body,status,expires_at,created_at FROM stories WHERE guild_id=? AND story_id=?").get(guildId, storyId);
  return row ? Object.freeze({ storyId: row.story_id, authorId: row.author_id, title: row.title, body: row.body, status: row.status, expiresAt: Number(row.expires_at), createdAt: Number(row.created_at) }) : null;
}

export function approveStory(guildId, storyId, reviewerId, { authorizeActor, now = Date.now() } = {}) {
  assertGuild(guildId); assertUser(reviewerId);
  if (typeof authorizeActor !== "function" || authorizeActor({ guildId, actorId: reviewerId, action: "stories.approve" }) !== true) throw new Error("Validation staff requise.");
  const updated = db.prepare("UPDATE stories SET status='approved',approved_by=? WHERE guild_id=? AND story_id=? AND status='draft' AND expires_at>? ")
    .run(reviewerId, guildId, storyId, now);
  if (!Number(updated.changes)) throw new Error("Story introuvable, expirée ou déjà validée.");
  return { storyId, status: "approved" };
}

export function publishStory(guildId, storyId, reviewerId, { authorizeActor, now = Date.now() } = {}) {
  assertGuild(guildId); assertUser(reviewerId);
  if (typeof authorizeActor !== "function" || authorizeActor({ guildId, actorId: reviewerId, action: "stories.publish" }) !== true) throw new Error("Publication staff requise.");
  const updated = db.prepare("UPDATE stories SET status='published',published_at=? WHERE guild_id=? AND story_id=? AND status='approved' AND expires_at>? ")
    .run(now, guildId, storyId, now);
  if (!Number(updated.changes)) throw new Error("Story non validée ou expirée.");
  return { storyId, status: "published" };
}

export function listPublishedStories(guildId, now = Date.now(), limit = 20) {
  assertGuild(guildId);
  const bounded = Math.max(1, Math.min(50, Number(limit) || 20));
  return db.prepare("SELECT story_id,title,body,author_id,expires_at FROM stories WHERE guild_id=? AND status='published' AND expires_at>? ORDER BY published_at DESC LIMIT ?")
    .all(guildId, now, bounded);
}

export function expireStories(guildId, now = Date.now()) {
  assertGuild(guildId);
  const result = db.prepare("DELETE FROM stories WHERE guild_id=? AND expires_at<=?").run(guildId, now);
  return Number(result.changes);
}

// RECRUITMENT ---------------------------------------------------------------
export function getRecruitmentQuestions(guildId) {
  assertGuild(guildId);
  return db.prepare("SELECT position,prompt FROM recruitment_questions WHERE guild_id=? ORDER BY position ASC")
    .all(guildId).map((row) => ({ position: Number(row.position), prompt: row.prompt }));
}

export function setRecruitmentQuestions(guildId, actorId, questions, { authorizeActor, now = Date.now() } = {}) {
  assertGuild(guildId); assertUser(actorId);
  if (typeof authorizeActor !== "function" || authorizeActor({ guildId, actorId, action: "recruitment.questions.configure" }) !== true) throw new Error("Permission de configuration des candidatures requise.");
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 10) throw new Error("Configure entre 1 et 10 questions.");
  const normalized = questions.map((question) => clean(question, 200, "Une question"));
  if (new Set(normalized.map((question) => question.toLowerCase())).size !== normalized.length) throw new Error("Les questions doivent être uniques.");
  return transaction(() => {
    db.prepare("DELETE FROM recruitment_questions WHERE guild_id=?").run(guildId);
    const insert = db.prepare("INSERT INTO recruitment_questions(guild_id,position,prompt,updated_by,updated_at) VALUES(?,?,?,?,?)");
    normalized.forEach((prompt, index) => insert.run(guildId, index + 1, prompt, actorId, now));
    return getRecruitmentQuestions(guildId);
  });
}

export function submitRecruitmentApplication(guildId, applicantId, answers, now = Date.now()) {
  assertGuild(guildId); assertUser(applicantId);
  const configuredQuestions = getRecruitmentQuestions(guildId);
  if (!Array.isArray(answers) || answers.length < 1 || answers.length > 10) throw new Error(configuredQuestions.length ? `Réponds aux ${configuredQuestions.length} questions, dans l'ordre, en séparant chaque réponse par |.` : "Une candidature doit contenir de 1 à 10 réponses.");
  if (configuredQuestions.length && answers.length !== configuredQuestions.length) throw new Error(`Cette candidature attend exactement ${configuredQuestions.length} réponse(s), une par question.`);
  const normalized = answers.map((answer) => clean(answer, 500, "Une réponse"));
  const existing = db.prepare("SELECT application_id FROM recruitment_applications WHERE guild_id=? AND applicant_id=? AND status IN ('pending','review') LIMIT 1")
    .get(guildId, applicantId);
  if (existing) throw new Error("Tu as déjà une candidature en cours.");
  const applicationId = randomUUID();
  db.prepare("INSERT INTO recruitment_applications(application_id,guild_id,applicant_id,answers_json,questions_json,submitted_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(applicationId, guildId, applicantId, JSON.stringify(normalized), JSON.stringify(configuredQuestions.map((item) => item.prompt)), now, now, now + RETENTION_MS);
  return { applicationId, status: "pending", expiresAt: now + RETENTION_MS };
}

export function listRecruitmentApplications(guildId, status = "pending", limit = 20) {
  assertGuild(guildId);
  if (!new Set(["pending", "review", "accepted", "rejected", "all"]).has(status)) throw new Error("Filtre de candidature invalide.");
  const bounded = Math.max(1, Math.min(50, Number(limit) || 20));
  return db.prepare("SELECT application_id,applicant_id,status,reviewer_id,submitted_at,expires_at FROM recruitment_applications WHERE guild_id=? AND (?='all' OR status=?) ORDER BY submitted_at DESC LIMIT ?")
    .all(guildId, status, status, bounded);
}

export function getRecruitmentApplication(guildId, applicationId) {
  assertGuild(guildId);
  const row = db.prepare("SELECT application_id,applicant_id,answers_json,questions_json,status,reviewer_id,decision_note,submitted_at,expires_at FROM recruitment_applications WHERE guild_id=? AND application_id=?").get(guildId, applicationId);
  return row ? Object.freeze({ applicationId: row.application_id, applicantId: row.applicant_id, answers: JSON.parse(row.answers_json), questions: JSON.parse(row.questions_json ?? "[]"), status: row.status, reviewerId: row.reviewer_id, decisionNote: row.decision_note, submittedAt: Number(row.submitted_at), expiresAt: Number(row.expires_at) }) : null;
}

export function reviewRecruitmentApplication(guildId, applicationId, reviewerId, decision, note = "", { authorizeActor, now = Date.now() } = {}) {
  assertGuild(guildId); assertUser(reviewerId);
  if (!new Set(["review", "accepted", "rejected"]).has(decision)) throw new Error("Décision de candidature invalide.");
  if (typeof authorizeActor !== "function" || authorizeActor({ guildId, actorId: reviewerId, action: "recruitment.review" }) !== true) throw new Error("Permission de revue requise.");
  const safeNote = typeof note === "string" ? note.replace(/@/g, "＠").trim().slice(0, 500) : "";
  return transaction(() => {
    const updated = db.prepare(`UPDATE recruitment_applications SET status=?,reviewer_id=?,decision_note=?,updated_at=?
      WHERE guild_id=? AND application_id=? AND status IN ('pending','review') AND expires_at>?`)
      .run(decision, reviewerId, safeNote, now, guildId, applicationId, now);
    if (!Number(updated.changes)) throw new Error("Candidature introuvable, expirée ou déjà décidée.");
    const cancelledInterviews = decision === "review" ? 0 : Number(db.prepare("UPDATE recruitment_interviews SET status='cancelled',updated_at=? WHERE guild_id=? AND application_id=? AND status='scheduled'")
      .run(now, guildId, applicationId).changes);
    return { applicationId, status: decision, reviewerId, cancelledInterviews };
  });
}

export function assignRecruitmentApplication(guildId, applicationId, actorId, assigneeId, { authorizeActor, now = Date.now() } = {}) {
  assertGuild(guildId); assertUser(actorId); assertUser(assigneeId);
  if (typeof authorizeActor !== "function" || authorizeActor({ guildId, actorId, action: "recruitment.assign" }) !== true) throw new Error("Permission d'affectation requise.");
  return transaction(() => {
    const application = db.prepare("SELECT status,expires_at FROM recruitment_applications WHERE guild_id=? AND application_id=?").get(guildId, applicationId);
    if (!application || !["pending", "review"].includes(application.status) || Number(application.expires_at) <= now) throw new Error("Candidature introuvable, expirée ou déjà décidée.");
    db.prepare(`INSERT INTO recruitment_assignments(guild_id,application_id,assignee_id,assigned_by,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(guild_id,application_id) DO UPDATE SET assignee_id=excluded.assignee_id,assigned_by=excluded.assigned_by,updated_at=excluded.updated_at`)
      .run(guildId, applicationId, assigneeId, actorId, now);
    return { applicationId, assigneeId, assignedBy: actorId, updatedAt: now };
  });
}

export function getRecruitmentAssignment(guildId, applicationId) {
  assertGuild(guildId);
  const row = db.prepare("SELECT assignee_id,assigned_by,updated_at FROM recruitment_assignments WHERE guild_id=? AND application_id=?").get(guildId, applicationId);
  return row ? { assigneeId: row.assignee_id, assignedBy: row.assigned_by, updatedAt: Number(row.updated_at) } : null;
}

export function scheduleRecruitmentInterview(guildId, applicationId, actorId, interviewerId, startsAt, channelId = null, { authorizeActor, now = Date.now() } = {}) {
  assertGuild(guildId); assertUser(actorId); assertUser(interviewerId);
  if (typeof authorizeActor !== "function" || authorizeActor({ guildId, actorId, action: "recruitment.interview.schedule" }) !== true) throw new Error("Permission de planification requise.");
  if (!Number.isSafeInteger(startsAt) || startsAt < now + 5 * 60_000 || startsAt > now + 90 * 24 * 60 * 60_000) throw new Error("L'entretien doit être prévu entre 5 minutes et 90 jours à l'avance.");
  if (channelId != null && (typeof channelId !== "string" || !SNOWFLAKE.test(channelId))) throw new Error("Salon d'entretien invalide.");
  const interviewId = randomUUID();
  return transaction(() => {
    const application = db.prepare("SELECT status,expires_at FROM recruitment_applications WHERE guild_id=? AND application_id=?").get(guildId, applicationId);
    if (!application || !["pending", "review"].includes(application.status) || Number(application.expires_at) <= now) throw new Error("Candidature introuvable, expirée ou déjà décidée.");
    db.prepare(`INSERT INTO recruitment_interviews(interview_id,guild_id,application_id,interviewer_id,starts_at,channel_id,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(interviewId, guildId, applicationId, interviewerId, startsAt, channelId, actorId, now, now);
    return { interviewId, applicationId, interviewerId, startsAt, channelId, status: "scheduled" };
  });
}

export function listRecruitmentInterviews(guildId, { fromAt = Date.now(), limit = 30, status = "scheduled" } = {}) {
  assertGuild(guildId);
  if (!new Set(["scheduled", "completed", "cancelled", "all"]).has(status)) throw new Error("Filtre d'entretien invalide.");
  const bounded = Math.max(1, Math.min(50, Number(limit) || 30));
  return db.prepare(`SELECT i.interview_id,i.application_id,a.applicant_id,i.interviewer_id,i.starts_at,i.channel_id,i.status,i.score,i.notes
    FROM recruitment_interviews i JOIN recruitment_applications a ON a.guild_id=i.guild_id AND a.application_id=i.application_id
    WHERE i.guild_id=? AND i.starts_at>=? AND (?='all' OR i.status=?) ORDER BY i.starts_at ASC LIMIT ?`)
    .all(guildId, fromAt, status, status, bounded).map((row) => ({ interviewId: row.interview_id, applicationId: row.application_id, applicantId: row.applicant_id, interviewerId: row.interviewer_id, startsAt: Number(row.starts_at), channelId: row.channel_id, status: row.status, score: row.score == null ? null : Number(row.score), notes: row.notes }));
}

export function completeRecruitmentInterview(guildId, interviewId, actorId, score, notes = "", { authorizeActor, now = Date.now() } = {}) {
  assertGuild(guildId); assertUser(actorId);
  if (typeof authorizeActor !== "function" || authorizeActor({ guildId, actorId, action: "recruitment.interview.evaluate" }) !== true) throw new Error("Permission d'évaluation requise.");
  if (!Number.isSafeInteger(score) || score < 1 || score > 5) throw new Error("La note doit être comprise entre 1 et 5.");
  const safeNotes = typeof notes === "string" ? notes.replace(/@/g, "＠").trim().slice(0, 1000) : "";
  const interview = db.prepare("SELECT starts_at,status FROM recruitment_interviews WHERE guild_id=? AND interview_id=?").get(guildId, interviewId);
  if (!interview || interview.status !== "scheduled") throw new Error("Entretien introuvable ou déjà traité.");
  if (Number(interview.starts_at) > now) throw new Error("Tu ne peux pas évaluer un entretien avant son horaire prévu.");
  const updated = db.prepare("UPDATE recruitment_interviews SET status='completed',score=?,notes=?,updated_at=? WHERE guild_id=? AND interview_id=? AND status='scheduled' AND starts_at<=?")
    .run(score, safeNotes, now, guildId, interviewId, now);
  if (!Number(updated.changes)) throw new Error("Entretien introuvable, encore à venir ou déjà traité.");
  return { interviewId, status: "completed", score };
}

export function cancelRecruitmentInterview(guildId, interviewId, actorId, { authorizeActor, now = Date.now() } = {}) {
  assertGuild(guildId); assertUser(actorId);
  if (typeof authorizeActor !== "function" || authorizeActor({ guildId, actorId, action: "recruitment.interview.cancel" }) !== true) throw new Error("Permission d'annulation requise.");
  const updated = db.prepare("UPDATE recruitment_interviews SET status='cancelled',updated_at=? WHERE guild_id=? AND interview_id=? AND status='scheduled'")
    .run(now, guildId, interviewId);
  if (!Number(updated.changes)) throw new Error("Entretien introuvable ou déjà traité.");
  return { interviewId, status: "cancelled" };
}

export function claimDueRecruitmentInterviewReminders(guildId, now = Date.now(), windowMs = 24 * 60 * 60_000, limit = 20) {
  assertGuild(guildId);
  if (!Number.isSafeInteger(windowMs) || windowMs < 60_000 || windowMs > 7 * 24 * 60 * 60_000) throw new Error("Fenêtre de rappel invalide.");
  const bounded = Math.max(1, Math.min(50, Number(limit) || 20));
  return transaction(() => {
    const rows = db.prepare(`SELECT i.interview_id,i.application_id,a.applicant_id,i.interviewer_id,i.starts_at,i.channel_id
      FROM recruitment_interviews i JOIN recruitment_applications a ON a.guild_id=i.guild_id AND a.application_id=i.application_id
      WHERE i.guild_id=? AND i.status='scheduled' AND i.reminded_at IS NULL AND i.starts_at>? AND i.starts_at<=?
        AND (i.reminder_claimed_at IS NULL OR i.reminder_claimed_at<?)
      ORDER BY i.starts_at ASC LIMIT ?`).all(guildId, now, now + windowMs, now - 10 * 60_000, bounded);
    const claimed = [];
    for (const row of rows) {
      const changed = db.prepare(`UPDATE recruitment_interviews SET reminder_claimed_at=?
        WHERE guild_id=? AND interview_id=? AND status='scheduled' AND reminded_at IS NULL
          AND (reminder_claimed_at IS NULL OR reminder_claimed_at<?)`)
        .run(now, guildId, row.interview_id, now - 10 * 60_000);
      if (Number(changed.changes)) claimed.push({ interviewId: row.interview_id, applicationId: row.application_id, applicantId: row.applicant_id, interviewerId: row.interviewer_id, startsAt: Number(row.starts_at), channelId: row.channel_id });
    }
    return claimed;
  });
}

export function isRecruitmentInterviewReminderDelivered(guildId, interviewId, recipientId) {
  assertGuild(guildId); assertUser(recipientId);
  return Boolean(db.prepare("SELECT 1 FROM recruitment_interview_reminder_deliveries WHERE guild_id=? AND interview_id=? AND recipient_id=?").get(guildId, interviewId, recipientId));
}

export function markRecruitmentInterviewReminderDelivered(guildId, interviewId, recipientId, now = Date.now()) {
  assertGuild(guildId); assertUser(recipientId);
  db.prepare(`INSERT INTO recruitment_interview_reminder_deliveries(guild_id,interview_id,recipient_id,delivered_at) VALUES(?,?,?,?)
    ON CONFLICT(guild_id,interview_id,recipient_id) DO NOTHING`).run(guildId, interviewId, recipientId, now);
  return isRecruitmentInterviewReminderDelivered(guildId, interviewId, recipientId);
}

export function completeRecruitmentInterviewReminder(guildId, interviewId, claimedAt, now = Date.now()) {
  assertGuild(guildId);
  const updated = db.prepare("UPDATE recruitment_interviews SET reminded_at=?,reminder_claimed_at=NULL,updated_at=? WHERE guild_id=? AND interview_id=? AND status='scheduled' AND reminder_claimed_at=? AND reminded_at IS NULL")
    .run(now, now, guildId, interviewId, claimedAt);
  return Number(updated.changes) > 0;
}

export function releaseRecruitmentInterviewReminder(guildId, interviewId, claimedAt) {
  assertGuild(guildId);
  const updated = db.prepare("UPDATE recruitment_interviews SET reminder_claimed_at=NULL WHERE guild_id=? AND interview_id=? AND status='scheduled' AND reminder_claimed_at=? AND reminded_at IS NULL")
    .run(guildId, interviewId, claimedAt);
  return Number(updated.changes) > 0;
}

export function purgeExpiredRecruitmentApplications(guildId, now = Date.now()) {
  assertGuild(guildId);
  const result = db.prepare("DELETE FROM recruitment_applications WHERE guild_id=? AND expires_at<=?").run(guildId, now);
  return Number(result.changes);
}

// AGGREGATES: no message text, attachments, DM or private content is stored.
export function incrementDailyMetric(guildId, metric, amount = 1, now = Date.now()) {
  assertGuild(guildId);
  if (!METRICS.has(metric) || !Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000) throw new Error("Métrique ou incrément invalide.");
  const dayKey = new Date(now).toISOString().slice(0, 10);
  db.prepare(`INSERT INTO analytics_daily(guild_id,day_key,metric,metric_value,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(guild_id,day_key,metric) DO UPDATE SET metric_value=MIN(1000000000,metric_value+excluded.metric_value),updated_at=excluded.updated_at`)
    .run(guildId, dayKey, metric, amount, now);
  return dayKey;
}

export function getRadarSummary(guildId, fromDay, toDay) {
  assertGuild(guildId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDay) || !/^\d{4}-\d{2}-\d{2}$/.test(toDay) || fromDay > toDay) throw new Error("Période analytics invalide.");
  const rows = db.prepare("SELECT metric,SUM(metric_value) AS total FROM analytics_daily WHERE guild_id=? AND day_key BETWEEN ? AND ? GROUP BY metric")
    .all(guildId, fromDay, toDay);
  const values = Object.fromEntries(rows.map((row) => [row.metric, Number(row.total)]));
  return Object.freeze({ guildId, fromDay, toDay, metrics: Object.fromEntries([...METRICS].map((metric) => [metric, values[metric] ?? null])) });
}

export function getWrappedMemberSummary(guildId, userId, fromAt, toAt) {
  assertGuild(guildId); assertUser(userId);
  if (!Number.isSafeInteger(fromAt) || !Number.isSafeInteger(toAt) || fromAt > toAt) throw new Error("Période Wrapped invalide.");
  const economy = db.prepare("SELECT COUNT(*) AS operations,COALESCE(SUM(ABS(delta)),0) AS volume FROM economy_ledger WHERE guild_id=? AND user_id=? AND created_at BETWEEN ? AND ?")
    .get(guildId, userId, fromAt, toAt);
  const voice = db.prepare("SELECT COUNT(*) AS sessions,COALESCE(SUM(CASE WHEN duration_ms IS NOT NULL THEN duration_ms ELSE 0 END),0) AS duration FROM voice_sessions WHERE guild_id=? AND user_id=? AND joined_at BETWEEN ? AND ?")
    .get(guildId, userId, fromAt, toAt);
  const reputation = db.prepare("SELECT COUNT(*) AS received FROM reputation WHERE guild_id=? AND receiver_id=? AND created_at BETWEEN ? AND ?")
    .get(guildId, userId, fromAt, toAt);
  return Object.freeze({
    guildId, userId, fromAt, toAt,
    economyOperations: Number(economy.operations),
    economyVolume: Number(economy.volume),
    voiceSessions: Number(voice.sessions),
    voiceMinutes: Math.floor(Number(voice.duration) / 60_000),
    reputationReceived: Number(reputation.received),
    messageCount: null,
  });
}
