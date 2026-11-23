import {
  expireStories, purgeExpiredRecruitmentApplications, closeExpiredAwardCampaigns,
  claimDueCommunityEventReminders, releaseCommunityEventReminder,
  claimDueRecruitmentInterviewReminders, completeRecruitmentInterviewReminder, releaseRecruitmentInterviewReminder,
  isRecruitmentInterviewReminderDelivered, markRecruitmentInterviewReminderDelivered,
} from "./organization.js";

/** Daily maintenance is guild scoped and only removes content with explicit expiry. */
export async function runOrganizationMaintenance(client, allowedGuildIds, now = Date.now(), record = () => {}) {
  const allowed = new Set(Array.isArray(allowedGuildIds) ? allowedGuildIds : []);
  const results = { guilds: 0, storiesExpired: 0, applicationsPurged: 0, awardsClosed: 0, eventsReminded: 0, eventReminderFailures: 0, interviewsReminded: 0, interviewReminderFailures: 0 };
  for (const guild of client.guilds.cache.values()) {
    if (!allowed.has(guild.id)) continue;
    results.guilds++;
    try { results.storiesExpired += expireStories(guild.id, now); } catch { record("organization_story_cleanup_error"); }
    try { results.applicationsPurged += purgeExpiredRecruitmentApplications(guild.id, now); } catch { record("organization_recruitment_cleanup_error"); }
    try { results.awardsClosed += closeExpiredAwardCampaigns(guild.id, now); } catch { record("organization_award_close_error"); }
    try {
      const reminders = claimDueCommunityEventReminders(guild.id, now);
      for (const event of reminders) {
        const channel = event.channelId ? await guild.channels.fetch(event.channelId).catch(() => null) : null;
        if (!channel?.isTextBased?.() || !channel.send) { releaseCommunityEventReminder(guild.id, event.id); results.eventReminderFailures++; continue; }
        const content = `📅 **Rappel d'événement PND — #${event.id}**\n**${event.title}**\n<t:${Math.floor(event.startsAt / 1000)}:F> (<t:${Math.floor(event.startsAt / 1000)}:R>)\n${event.description || "Aucune description"}\nOrganisateur : <@${event.hostId}> · ${event.signups} inscrit(s)`;
        try {
          await channel.send({ content, allowedMentions: { parse: [], users: [event.hostId], roles: [], repliedUser: false } });
          results.eventsReminded++;
        } catch { releaseCommunityEventReminder(guild.id, event.id); results.eventReminderFailures++; }
      }
    } catch { record("organization_event_reminder_error"); }
    try {
      const reminders = claimDueRecruitmentInterviewReminders(guild.id, now);
      for (const reminder of reminders) {
        const content = `📅 **Rappel d'entretien PND**\nCandidat : <@${reminder.applicantId}>\nÉvaluateur : <@${reminder.interviewerId}>\nHoraire : <t:${Math.floor(reminder.startsAt / 1000)}:F> (<t:${Math.floor(reminder.startsAt / 1000)}:R>)\nRéférence : \`${reminder.interviewId.slice(0, 8)}\``;
        if (reminder.channelId) {
          const channel = await guild.channels.fetch(reminder.channelId).catch(() => null);
          if (channel?.isTextBased?.() && channel.send) {
            await channel.send({ content, allowedMentions: { parse: [], users: [reminder.applicantId, reminder.interviewerId], roles: [], repliedUser: false } });
            markRecruitmentInterviewReminderDelivered(guild.id, reminder.interviewId, reminder.applicantId, now);
            markRecruitmentInterviewReminderDelivered(guild.id, reminder.interviewId, reminder.interviewerId, now);
          }
        } else {
          for (const userId of new Set([reminder.applicantId, reminder.interviewerId])) {
            if (isRecruitmentInterviewReminderDelivered(guild.id, reminder.interviewId, userId)) continue;
            const member = await guild.members.fetch(userId).catch(() => null);
            if (member?.send) {
              const delivered = await member.send({ content, allowedMentions: { parse: [], users: [reminder.applicantId, reminder.interviewerId], roles: [], repliedUser: false } }).then(() => true).catch(() => false);
              if (delivered) markRecruitmentInterviewReminderDelivered(guild.id, reminder.interviewId, userId, now);
            }
          }
        }
        const allDelivered = [reminder.applicantId, reminder.interviewerId].every((userId) => isRecruitmentInterviewReminderDelivered(guild.id, reminder.interviewId, userId));
        if (allDelivered && completeRecruitmentInterviewReminder(guild.id, reminder.interviewId, now, now)) results.interviewsReminded++;
        else { releaseRecruitmentInterviewReminder(guild.id, reminder.interviewId, now); results.interviewReminderFailures++; }
      }
    } catch { record("organization_interview_reminder_error"); }
  }
  if (results.storiesExpired || results.applicationsPurged || results.awardsClosed || results.eventsReminded || results.interviewsReminded) record("organization_maintenance_complete");
  return results;
}

export function startOrganizationMaintenance(client, allowedGuildIds, record = () => {}, shouldRun = () => true) {
  let running = false;
  const run = async () => {
    if (running || !shouldRun()) return;
    running = true;
    try { await runOrganizationMaintenance(client, allowedGuildIds, Date.now(), record); }
    catch { record("organization_maintenance_error"); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(() => { void run(); }, 60 * 60_000);
  timer.unref?.();
  return timer;
}
