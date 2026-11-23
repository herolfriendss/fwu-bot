import {
  createCommunityEvent, signUpCommunityEvent, leaveCommunityEvent, cancelCommunityEvent,
  listUpcomingCommunityEvents, submitRecruitmentApplication,
  getRadarSummary, getWrappedMemberSummary, incrementDailyMetric,
  createAcademyTrack, listAcademyTracks, getAcademyTrack, completeAcademyStep,
  addAcademyQuestion, getAcademyProgress,
  createAwardCampaign, listOpenAwardCampaigns, voteAwardCampaign, closeAwardCampaign,
  createStory, getStory, approveStory, publishStory, listPublishedStories,
  listRecruitmentApplications, getRecruitmentApplication, reviewRecruitmentApplication,
  getRecruitmentQuestions, setRecruitmentQuestions,
  assignRecruitmentApplication, getRecruitmentAssignment, scheduleRecruitmentInterview,
  listRecruitmentInterviews, completeRecruitmentInterview, cancelRecruitmentInterview,
} from "./organization.js";
import { parsePndOwnerIds } from "./pnd-owner-policy.js";

const noMentions = { parse: [], repliedUser: false };
const STAFF_PERMISSION_NAMES = ["ManageGuild", "Administrator"];

function canManageCommunity(message, context = {}) {
  if (message.guild?.ownerId === message.author.id) return true;
  if (parsePndOwnerIds(context.ownerIds).includes(message.author.id)) return true;
  if (STAFF_PERMISSION_NAMES.some((permission) => message.member?.permissions?.has?.(permission))) return true;
  const settings = context.settings?.[message.guild?.id] ?? context.settings ?? {};
  const roleIds = [settings.sysPlus?.roleId, settings.adminPlus?.roleId].filter(Boolean);
  return roleIds.some((roleId) => message.member?.roles?.cache?.has?.(roleId));
}

function parseDate(value) {
  if (typeof value !== "string" || !/(Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) return NaN;
  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? parsed : NaN;
}

function formatEvent(event) {
  return `**#${event.id} — ${event.title}**\n<t:${Math.floor(event.startsAt / 1000)}:F> · ${event.signups} inscrit(s)\n${event.description || "Aucune description"}`;
}

function resolvePrefix(items, property, token) {
  const matches = items.filter((item) => item[property] === token || item[property].startsWith(token));
  return matches.length === 1 ? matches[0] : null;
}

function parseExplicitDate(value) {
  if (typeof value !== "string" || !/(Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) return NaN;
  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? parsed : NaN;
}

function formatShortId(id) { return String(id).slice(0, 8); }

export async function handleOrganizationMessage(message, context = {}) {
  if (!message?.guild || !message.author || message.author.bot) return false;
  const raw = String(message.content ?? "").trim();
  const eventMatch = raw.match(/^=pndevent(?:\s+([a-z]+))?(?:\s+([\s\S]*))?$/i);
  if (eventMatch) {
    const sub = (eventMatch[1] ?? "list").toLowerCase();
    const args = (eventMatch[2] ?? "").trim();
    try {
      if (sub === "list") {
        const events = listUpcomingCommunityEvents(message.guild.id);
        await message.reply({ content: events.length ? `📅 **Événements PND**\n\n${events.map(formatEvent).join("\n\n")}` : "Aucun événement à venir.", allowedMentions: noMentions });
        return true;
      }
      if (sub === "create") {
        if (!canManageCommunity(message, context) && !message.member?.permissions?.has?.("ManageEvents")) {
          await message.reply({ content: "⛔ Créer un événement est réservé au staff autorisé.", allowedMentions: noMentions });
          return true;
        }
        const [date, title, ...descriptionParts] = args.split("|").map((part) => part.trim());
        const startsAt = parseDate(date);
        const description = descriptionParts.join(" | ");
        if (!Number.isFinite(startsAt) || !title) {
          await message.reply({ content: "Utilisation : `=pndevent create 2026-11-20T20:00:00+01:00 | Titre | Description` (date avec fuseau horaire explicite).", allowedMentions: noMentions });
          return true;
        }
        const id = createCommunityEvent(message.guild.id, message.author.id, { title, description, startsAt, channelId: message.channel.id });
        await message.reply({ content: `✅ Événement **#${id}** créé : **${title}** · <t:${Math.floor(startsAt / 1000)}:F>\nLes membres peuvent utiliser \`=pndevent join ${id}\` pour s'inscrire.`, allowedMentions: noMentions });
        return true;
      }
      const id = Number(args.split(/\s+/, 1)[0]);
      if (!Number.isSafeInteger(id) || id < 1) {
        await message.reply({ content: "Utilisation : `=pndevent list`, `=pndevent join <id>` ou `=pndevent leave <id>` ou `=pndevent cancel <id>`.", allowedMentions: noMentions });
        return true;
      }
      if (sub === "join") {
        const result = signUpCommunityEvent(message.guild.id, id, message.author.id);
        if (result.signedUp) incrementDailyMetric(message.guild.id, "events_joined", 1);
        await message.reply({ content: result.signedUp ? `✅ Tu es inscrit(e) à l'événement **#${id}**.` : `Tu es déjà inscrit(e) à l'événement **#${id}**.`, allowedMentions: noMentions });
        return true;
      }
      if (sub === "leave") {
        const result = leaveCommunityEvent(message.guild.id, id, message.author.id);
        await message.reply({ content: result.left ? `Tu as quitté l'événement **#${id}**.` : "Tu n'étais pas inscrit(e) à cet événement.", allowedMentions: noMentions });
        return true;
      }
      if (sub === "cancel") {
        const result = cancelCommunityEvent(message.guild.id, id, message.author.id, {
          authorizeActor: ({ guildId, actorId }) => guildId === message.guild.id && actorId === message.author.id && canManageCommunity(message, context),
        });
        await message.reply({ content: `🛑 Événement #${result.eventId} annulé.`, allowedMentions: noMentions });
        return true;
      }
    } catch (error) {
      await message.reply({ content: `❌ ${error instanceof Error ? error.message : "Impossible de traiter l'événement."}`, allowedMentions: noMentions });
      return true;
    }
    await message.reply({ content: "Commande événement inconnue. Utilise `=pndevent list`, `=pndevent create`, `=pndevent join <id>` ou `=pndevent leave <id>` ou `=pndevent cancel <id>`.", allowedMentions: noMentions });
    return true;
  }

  if (/^=candidature(?:\s|$)/i.test(raw)) {
    const answerText = raw.replace(/^=candidature\s*/i, "").trim();
    const questions = getRecruitmentQuestions(message.guild.id);
    if (!answerText && questions.length) {
      await message.reply({ content: `📝 **Candidature PND**\n${questions.map((question) => `**${question.position}.** ${question.prompt}`).join("\n")}\n\nRéponds dans l'ordre avec : \`=candidature réponse 1 | réponse 2 | ...\``, allowedMentions: noMentions });
      return true;
    }
    const answers = answerText.split("|").map((item) => item.trim()).filter(Boolean);
    try {
      const result = submitRecruitmentApplication(message.guild.id, message.author.id, answers);
      await message.reply({ content: `✅ Candidature envoyée. Référence : \`${result.applicationId.slice(0, 8)}\`. Elle sera examinée par l'équipe. Les réponses sont conservées au maximum 90 jours.`, allowedMentions: noMentions });
    } catch (error) {
      await message.reply({ content: `❌ ${error instanceof Error ? error.message : "Impossible d'envoyer la candidature."}`, allowedMentions: noMentions });
    }
    return true;
  }

  if (/^=candidatures(?:\s|$)/i.test(raw)) {
    if (!canManageCommunity(message, context)) {
      await message.reply({ content: "⛔ Les dossiers de recrutement sont réservés au staff autorisé.", allowedMentions: noMentions });
      return true;
    }
    const [, sub = "list", token = "", decisionRaw = "", ...noteParts] = raw.split(/\s+/);
    try {
      if (sub === "list") {
        const applications = listRecruitmentApplications(message.guild.id, "pending", 30);
        await message.reply({ content: applications.length ? `**Candidatures en attente**\n${applications.map((item) => `• \`${formatShortId(item.application_id)}\` — <@${item.applicant_id}> — <t:${Math.floor(item.submitted_at / 1000)}:R>`).join("\n")}` : "Aucune candidature en attente.", allowedMentions: { parse: ["users"] } });
        return true;
      }
      if (sub === "questions") {
        const payload = raw.replace(/^=candidatures\s+questions\s*/i, "").trim();
        if (!payload) {
          const questions = getRecruitmentQuestions(message.guild.id);
          await message.reply({ content: questions.length ? `**Questions de candidature actives**\n${questions.map((item) => `${item.position}. ${item.prompt}`).join("\n")}` : "Aucune question configurée. Utilise `=candidatures questions Question 1 | Question 2`.", allowedMentions: noMentions });
          return true;
        }
        const configured = setRecruitmentQuestions(message.guild.id, message.author.id, payload.split("|").map((item) => item.trim()), { authorizeActor: ({ guildId, actorId }) => guildId === message.guild.id && actorId === message.author.id && canManageCommunity(message, context) });
        await message.reply({ content: `✅ ${configured.length} question(s) de candidature configurée(s). Les prochaines candidatures utiliseront ce formulaire.`, allowedMentions: noMentions });
        return true;
      }
      if (sub === "entretiens") {
        const interviews = listRecruitmentInterviews(message.guild.id);
        await message.reply({ content: interviews.length ? `**Entretiens à venir**\n${interviews.map((item) => `• \`${formatShortId(item.interviewId)}\` — candidature \`${formatShortId(item.applicationId)}\` · <@${item.applicantId}> · <t:${Math.floor(item.startsAt / 1000)}:F> · évaluateur <@${item.interviewerId}>${item.channelId ? ` · <#${item.channelId}>` : ""}`).join("\n")}` : "Aucun entretien planifié.", allowedMentions: { parse: ["users"] } });
        return true;
      }
      if (sub === "entretien") {
        const payload = raw.replace(/^=candidatures\s+entretien\s+/i, "").trim();
        const match = payload.match(/^(\S+)\s+(\S+)\s+<@!?([0-9]{5,25})>(?:\s+<#([0-9]{5,25})>)?$/);
        if (!match) throw new Error("Utilise `=candidatures entretien <id> 2026-12-01T20:00:00+01:00 <@évaluateur> [<#salon>]`.");
        const application = resolvePrefix(listRecruitmentApplications(message.guild.id, "all", 50), "application_id", match[1]);
        const startsAt = parseExplicitDate(match[2]);
        if (!application || !Number.isFinite(startsAt)) throw new Error("Candidature ou date d'entretien invalide.");
        const interviewer = await message.guild.members.fetch(match[3]).catch(() => null);
        if (!interviewer || interviewer.user?.bot) throw new Error("L'évaluateur doit être un membre humain du serveur.");
        if (!canManageCommunity({ ...message, author: interviewer.user, member: interviewer }, context)) throw new Error("L'évaluateur doit faire partie du staff SYS+/ADMIN+ ou disposer des permissions de gestion.");
        const channelId = match[4] ?? null;
        if (channelId) {
          const channel = await message.guild.channels.fetch(channelId).catch(() => null);
          if (!channel?.isTextBased?.()) throw new Error("Le salon d'entretien doit être un salon textuel du serveur.");
        }
        const interview = scheduleRecruitmentInterview(message.guild.id, application.application_id, message.author.id, match[3], startsAt, channelId, { authorizeActor: ({ guildId, actorId }) => guildId === message.guild.id && actorId === message.author.id && canManageCommunity(message, context) });
        await message.reply({ content: `📅 Entretien planifié pour <@${application.applicant_id}> avec <@${match[3]}> le <t:${Math.floor(startsAt / 1000)}:F>. Référence : \`${formatShortId(interview.interviewId)}\`.`, allowedMentions: { parse: ["users"] } });
        return true;
      }
      if (sub === "assign") {
        const payload = raw.replace(/^=candidatures\s+assign\s+/i, "").trim();
        const match = payload.match(/^(\S+)\s+<@!?([0-9]{5,25})>$/);
        if (!match) throw new Error("Utilise `=candidatures assign <id> <@responsable>`.");
        const application = resolvePrefix(listRecruitmentApplications(message.guild.id, "all", 50), "application_id", match[1]);
        if (!application) throw new Error("Candidature introuvable ou identifiant ambigu.");
        const assignee = await message.guild.members.fetch(match[2]).catch(() => null);
        if (!assignee || assignee.user?.bot) throw new Error("Le responsable doit être un membre humain du serveur.");
        if (!canManageCommunity({ ...message, author: assignee.user, member: assignee }, context)) throw new Error("Le responsable doit faire partie du staff SYS+/ADMIN+ ou disposer des permissions de gestion.");
        const result = assignRecruitmentApplication(message.guild.id, application.application_id, message.author.id, match[2], { authorizeActor: ({ guildId, actorId }) => guildId === message.guild.id && actorId === message.author.id && canManageCommunity(message, context) });
        await message.reply({ content: `👤 Candidature \`${formatShortId(result.applicationId)}\` affectée à <@${result.assigneeId}>.`, allowedMentions: { parse: ["users"] } });
        return true;
      }
      if (sub === "evaluation") {
        const payload = raw.replace(/^=candidatures\s+evaluation\s+/i, "").trim();
        const [head, ...notes] = payload.split("|").map((part) => part.trim());
        const [interviewToken, scoreToken] = head.split(/\s+/, 2);
        const interview = resolvePrefix(listRecruitmentInterviews(message.guild.id, { fromAt: 0, status: "scheduled", limit: 50 }), "interviewId", interviewToken);
        if (!interview) throw new Error("Entretien introuvable ou identifiant ambigu.");
        const result = completeRecruitmentInterview(message.guild.id, interview.interviewId, message.author.id, Number(scoreToken), notes.join(" | "), { authorizeActor: ({ guildId, actorId }) => guildId === message.guild.id && actorId === message.author.id && canManageCommunity(message, context) });
        await message.reply({ content: `✅ Entretien \`${formatShortId(result.interviewId)}\` évalué : **${result.score}/5**.`, allowedMentions: noMentions });
        return true;
      }
      if (sub === "annuler-entretien") {
        const interview = resolvePrefix(listRecruitmentInterviews(message.guild.id, { fromAt: 0, status: "scheduled", limit: 50 }), "interviewId", token);
        if (!interview) throw new Error("Entretien introuvable ou identifiant ambigu.");
        cancelRecruitmentInterview(message.guild.id, interview.interviewId, message.author.id, { authorizeActor: ({ guildId, actorId }) => guildId === message.guild.id && actorId === message.author.id && canManageCommunity(message, context) });
        await message.reply({ content: `🛑 Entretien \`${formatShortId(interview.interviewId)}\` annulé.`, allowedMentions: noMentions });
        return true;
      }
      const application = resolvePrefix(listRecruitmentApplications(message.guild.id, "all", 50), "application_id", token);
      if (!application) throw new Error("Candidature introuvable ou identifiant ambigu.");
      if (sub === "voir") {
        const details = getRecruitmentApplication(message.guild.id, application.application_id);
        const assignment = getRecruitmentAssignment(message.guild.id, details.applicationId);
        await message.reply({ content: `**Dossier ${formatShortId(details.applicationId)}** · <@${details.applicantId}>\nStatut : **${details.status}**${assignment ? ` · Responsable : <@${assignment.assigneeId}>` : " · Non affecté"}\n${details.answers.map((answer, index) => `**${index + 1}. ${details.questions[index] ?? `Question ${index + 1}`}**\n${answer}`).join("\n\n")}`, allowedMentions: { parse: ["users"] } });
        return true;
      }
      if (sub === "review") {
        const decision = decisionRaw.toLowerCase();
        const note = noteParts.join(" ");
        const result = reviewRecruitmentApplication(message.guild.id, application.application_id, message.author.id, decision, note, { authorizeActor: ({ guildId, actorId }) => guildId === message.guild.id && actorId === message.author.id && canManageCommunity(message, context) });
        const applicant = await message.guild.members.fetch(application.applicant_id).catch(() => null);
        const decisionMessage = result.status === "accepted"
          ? "🎉 Ta candidature PND a été retenue. Le staff te contactera pour la suite."
          : result.status === "rejected"
            ? "Merci pour ta candidature PND. Après examen, elle n'a pas été retenue cette fois-ci."
            : "Ta candidature PND est toujours en cours d'examen. Le staff reviendra vers toi dès que possible.";
        let notified = false;
        if (applicant?.send) notified = await applicant.send({ content: decisionMessage, allowedMentions: { parse: [] } }).then(() => true).catch(() => false);
        await message.reply({ content: `✅ Candidature ${formatShortId(result.applicationId)} : **${result.status}**. ${notified ? "Le candidat a été informé en DM." : "DM non envoyé (membre introuvable ou messages privés fermés)."}`, allowedMentions: noMentions });
        return true;
      }
      throw new Error("Utilise `=candidatures`, `questions <question 1> | <question 2>`, `voir <id>`, `assign <id> <@responsable>`, `entretien <id> <date ISO> <@évaluateur> [<#salon>]`, `entretiens`, `evaluation <id> <note 1-5> | notes`, `annuler-entretien <id>` ou `review <id> accepted|rejected|review [note]`.");
    } catch (error) {
      await message.reply({ content: `❌ ${error instanceof Error ? error.message : "Erreur de recrutement."}`, allowedMentions: noMentions });
    }
    return true;
  }

  if (/^=academy(?:\s|$)/i.test(raw)) {
    const [, sub = "list", ...rest] = raw.split(/\s+/);
    try {
      if (sub === "list") {
        const tracks = listAcademyTracks(message.guild.id);
        await message.reply({ content: tracks.length ? `🎓 **PND Academy**\n${tracks.map((track) => `• \`${formatShortId(track.trackId)}\` — ${track.title} (${track.stepCount} étapes)`).join("\n")}` : "Aucun parcours actif.", allowedMentions: noMentions });
        return true;
      }
      if (sub === "create") {
        if (!canManageCommunity(message, context)) throw new Error("Création réservée au staff autorisé.");
        const payload = raw.slice("=academy create".length).trim();
        const [title, stepText] = payload.split("|").map((value) => value.trim());
        if (!title || !stepText) throw new Error("Utilise `=academy create Titre | Étape 1:Description ; Étape 2:Description`.");
        const steps = stepText.split(";").map((part) => {
          const [stepTitle, ...description] = part.split(":");
          return { title: stepTitle.trim(), description: description.join(":").trim(), quiz: [] };
        });
        const track = createAcademyTrack(message.guild.id, message.author.id, title, steps);
        await message.reply({ content: `✅ Parcours **${track.title}** créé (` + `\`${formatShortId(track.trackId)}\`) avec ${track.steps.length} étape(s). Ajoute les quiz avec \`=academy quiz ${formatShortId(track.trackId)} 1 | Question | Choix A | Choix B | bonne réponse (1-2)\`.`, allowedMentions: noMentions });
        return true;
      }
      const track = resolvePrefix(listAcademyTracks(message.guild.id, 50), "trackId", rest[0] ?? "");
      if (!track) throw new Error("Parcours introuvable ou identifiant ambigu.");
      if (sub === "show") {
        const details = getAcademyTrack(message.guild.id, track.trackId);
        const requestedStep = rest[1] == null ? null : Number(rest[1]) - 1;
        if (requestedStep != null && (!Number.isSafeInteger(requestedStep) || !details.steps[requestedStep])) throw new Error("Numéro d'étape invalide.");
        const lines = requestedStep == null
          ? [`🎓 **${details.title}** · ${details.steps.length} étape(s)`, ...details.steps.map((step) => `${step.index + 1}. **${step.title}** · ${step.quiz.length} question(s)`), `Détail d'une étape : \`=academy show ${formatShortId(track.trackId)} <numéro>\`.`]
          : (() => {
              const step = details.steps[requestedStep];
              return [`🎓 **${details.title} — Étape ${requestedStep + 1} : ${step.title}**`, step.description || "Pas de description", ...step.quiz.map((question, index) => `Q${index + 1}. ${question.prompt}\n${question.choices.map((choice, i) => `${i + 1}) ${choice}`).join(" · ")}`), `Validation : \`=academy complete ${formatShortId(track.trackId)} ${requestedStep + 1} | ${step.quiz.map(() => "1").join(",")}\` (remplace par tes réponses).`];
            })();
        const pages = [];
        let page = "";
        for (const line of lines) {
          const next = page ? `${page}\n\n${line}` : line;
          if (next.length > 1750 && page) { pages.push(page); page = line; }
          else page = next;
        }
        if (page) pages.push(page);
        for (const content of pages) await message.reply({ content, allowedMentions: noMentions });
        return true;
      }
      if (sub === "quiz") {
        if (!canManageCommunity(message, context)) throw new Error("Configuration des quiz réservée au staff autorisé.");
        const payload = raw.slice("=academy quiz".length).trim();
        const [head, ...fields] = payload.split("|").map((value) => value.trim());
        const [trackToken, stepToken] = head.split(/\s+/, 2);
        const stepIndex = Number(stepToken) - 1;
        if (!Number.isSafeInteger(stepIndex) || stepIndex < 0 || fields.length < 4) throw new Error("Utilise `=academy quiz <id> <étape> | Question | Choix 1 | Choix 2 | bonne réponse (1-based)`. Ajoute 2 à 5 choix.");
        const correct = Number(fields.at(-1)) - 1;
        const choices = fields.slice(1, -1);
        if (!Number.isSafeInteger(correct) || correct < 0 || correct >= choices.length) throw new Error("Le numéro de bonne réponse ne correspond à aucun choix.");
        const selected = resolvePrefix(listAcademyTracks(message.guild.id, 50), "trackId", trackToken);
        if (!selected) throw new Error("Parcours introuvable.");
        const result = addAcademyQuestion(message.guild.id, selected.trackId, message.author.id, stepIndex, { prompt: fields[0], choices, answerIndex: correct }, { authorizeActor: ({ guildId, actorId }) => guildId === message.guild.id && actorId === message.author.id && canManageCommunity(message, context) });
        await message.reply({ content: `✅ Question ajoutée à l'étape ${stepIndex + 1} (${result.questionCount}/5).`, allowedMentions: noMentions });
        return true;
      }
      if (sub === "progress") {
        const progress = getAcademyProgress(message.guild.id, track.trackId, message.author.id);
        const state = progress.complete ? "Parcours terminé 🎓" : `Prochaine étape : **${progress.nextStep + 1}**`;
        await message.reply({ content: `📊 **Ta progression — ${track.title}**\n${progress.completedSteps.length}/${progress.stepCount} étape(s) validée(s)\n${state}`, allowedMentions: noMentions });
        return true;
      }
      if (sub === "complete") {
        const restText = raw.slice("=academy complete".length).trim();
        const [trackToken, stepToken] = restText.split(/\s+/, 2);
        const stepIndex = Number(stepToken) - 1;
        const payload = raw.split("|")[1] ?? "";
        const answers = payload.trim() ? payload.split(",").map((value) => Number(value.trim()) - 1) : [];
        if (!Number.isSafeInteger(stepIndex) || stepIndex < 0) throw new Error("Numéro d'étape invalide.");
        const selected = resolvePrefix(listAcademyTracks(message.guild.id, 50), "trackId", trackToken);
        if (!selected) throw new Error("Parcours introuvable.");
        const result = completeAcademyStep(message.guild.id, selected.trackId, message.author.id, stepIndex, answers);
        const total = getAcademyTrack(message.guild.id, selected.trackId).steps.length;
        await message.reply({ content: result.duplicate ? `ℹ️ Cette étape est déjà validée. Progression : ${result.completedSteps.length}/${total}.` : `✅ Étape validée. Progression : ${result.completedSteps.length}/${total}. ${result.complete ? "Parcours terminé ! 🎓" : ""}`, allowedMentions: noMentions });
        return true;
      }
      throw new Error("Utilise `=academy list`, `create`, `show <id>`, `quiz <id> <étape> | question | choix... | bonne réponse`, `progress <id>` ou `complete <id> <étape> | réponses`.");
    } catch (error) {
      await message.reply({ content: `❌ ${error instanceof Error ? error.message : "Erreur Academy."}`, allowedMentions: noMentions });
    }
    return true;
  }

  if (/^=award(?:\s|$)/i.test(raw)) {
    const [, sub = "list", ...rest] = raw.split(/\s+/);
    try {
      if (sub === "list") {
        const campaigns = listOpenAwardCampaigns(message.guild.id);
        await message.reply({ content: campaigns.length ? `🏆 **Campagnes ouvertes**\n${campaigns.map((campaign) => `• \`${formatShortId(campaign.campaignId)}\` — ${campaign.title} · fin <t:${Math.floor(campaign.endsAt / 1000)}:R>\n  ${campaign.options.map((option, index) => `${index + 1}. ${option}`).join(" · ")}`).join("\n")}` : "Aucune campagne de vote ouverte.", allowedMentions: noMentions });
        return true;
      }
      if (sub === "create") {
        if (!canManageCommunity(message, context)) throw new Error("Création réservée au staff autorisé.");
        const payload = raw.slice("=award create".length).trim();
        const [date, title, ...options] = payload.split("|").map((value) => value.trim());
        const endsAt = parseExplicitDate(date);
        if (!Number.isFinite(endsAt) || !title) throw new Error("Utilise `=award create 2026-12-01T20:00:00+01:00 | Titre | Choix 1 | Choix 2`.");
        const campaign = createAwardCampaign(message.guild.id, message.author.id, title, options, endsAt);
        await message.reply({ content: `✅ Vote **${campaign.title}** créé (` + `\`${formatShortId(campaign.campaignId)}\`).`, allowedMentions: noMentions });
        return true;
      }
      const campaign = resolvePrefix(listOpenAwardCampaigns(message.guild.id, Date.now(), 50), "campaignId", rest[0] ?? "");
      if (!campaign) throw new Error("Campagne introuvable ou identifiant ambigu.");
      if (sub === "vote") {
        const optionIndex = Number(rest[1]) - 1;
        const result = voteAwardCampaign(message.guild.id, campaign.campaignId, message.author.id, optionIndex);
        await message.reply({ content: `✅ Ton vote pour **${result.option}** est enregistré.`, allowedMentions: noMentions });
        return true;
      }
      if (sub === "close") {
        if (!canManageCommunity(message, context)) throw new Error("Clôture réservée au staff autorisé.");
        const result = closeAwardCampaign(message.guild.id, campaign.campaignId, message.author.id, { authorizeActor: ({ guildId, actorId }) => guildId === message.guild.id && actorId === message.author.id && canManageCommunity(message, context), allowEarly: true });
        await message.reply({ content: `🏆 Vote clôturé. Gagnant : **${result.winner ?? "Aucun"}** · ${result.totalVotes} vote(s).`, allowedMentions: noMentions });
        return true;
      }
      throw new Error("Utilise `=award list`, `create`, `vote <id> <numéro>` ou `close <id>`.");
    } catch (error) {
      await message.reply({ content: `❌ ${error instanceof Error ? error.message : "Erreur Award."}`, allowedMentions: noMentions });
    }
    return true;
  }

  if (/^=story(?:\s|$)/i.test(raw)) {
    const [, sub = "list", ...rest] = raw.split(/\s+/);
    try {
      if (sub === "list") {
        const stories = listPublishedStories(message.guild.id);
        await message.reply({ content: stories.length ? `📖 **Stories PND**\n${stories.map((story) => `• **${story.title}** — ${story.body.slice(0, 240)}`).join("\n")}` : "Aucune story publiée.", allowedMentions: noMentions });
        return true;
      }
      if (sub === "create") {
        const payload = raw.slice("=story create".length).trim();
        const [title, ...body] = payload.split("|").map((value) => value.trim());
        const story = createStory(message.guild.id, message.author.id, title, body.join(" | "), Date.now() + 7 * 24 * 60 * 60_000);
        await message.reply({ content: `✅ Story envoyée en modération (` + `\`${story.storyId}\`). Elle sera publiée après validation du staff.`, allowedMentions: noMentions });
        return true;
      }
      if (!canManageCommunity(message, context)) throw new Error("Validation réservée au staff autorisé.");
      const storyId = rest[0];
      if (!storyId) throw new Error("Identifiant de story manquant.");
      const current = getStory(message.guild.id, storyId);
      if (!current) throw new Error("Story introuvable.");
      const options = { authorizeActor: ({ guildId, actorId }) => guildId === message.guild.id && actorId === message.author.id && canManageCommunity(message, context) };
      if (sub === "approve") approveStory(message.guild.id, storyId, message.author.id, options);
      else if (sub === "publish") publishStory(message.guild.id, storyId, message.author.id, options);
      else throw new Error("Utilise `=story list`, `create`, `approve <id>` ou `publish <id>`.");
      await message.reply({ content: sub === "approve" ? "✅ Story validée. Le staff peut maintenant la publier." : `✅ Story **${current.title}** publiée.`, allowedMentions: noMentions });
    } catch (error) {
      await message.reply({ content: `❌ ${error instanceof Error ? error.message : "Erreur story."}`, allowedMentions: noMentions });
    }
    return true;
  }

  if (/^=radar(?:\s|$)/i.test(raw)) {
    if (!canManageCommunity(message, context)) {
      await message.reply({ content: "⛔ Le Radar est réservé au staff autorisé.", allowedMentions: noMentions });
      return true;
    }
    const [, from, to] = raw.split(/\s+/);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const summary = getRadarSummary(message.guild.id, from ?? today, to ?? from ?? today);
      const lines = Object.entries(summary.metrics).map(([key, value]) => `• ${key} : ${value === null ? "non mesuré" : value}`);
      await message.reply({ content: `📡 **PND Radar** · ${summary.fromDay} → ${summary.toDay}\n${lines.join("\n")}`, allowedMentions: noMentions });
    } catch (error) {
      await message.reply({ content: `❌ ${error instanceof Error ? error.message : "Période invalide."} Utilisation : \`=radar [AAAA-MM-JJ] [AAAA-MM-JJ]\`.`, allowedMentions: noMentions });
    }
    return true;
  }

  if (/^=wrapped(?:\s|$)/i.test(raw)) {
    try {
      const now = Date.now();
      const start = new Date(now);
      start.setMonth(start.getMonth() - 1);
      const summary = getWrappedMemberSummary(message.guild.id, message.author.id, start.getTime(), now);
      const hours = Math.floor(summary.voiceMinutes / 60);
      await message.reply({ content: `✨ **Ton PND Wrapped** (30 derniers jours)\n• Opérations PND : ${summary.economyOperations}\n• Volume PND : ${summary.economyVolume}\n• Sessions vocales : ${summary.voiceSessions}\n• Temps vocal : ${hours} h\n• Réputation reçue : ${summary.reputationReceived}\n• Messages : non mesurés`, allowedMentions: noMentions });
    } catch {
      await message.reply({ content: "❌ Impossible de générer ton Wrapped pour le moment.", allowedMentions: noMentions });
    }
    return true;
  }
  return false;
}
