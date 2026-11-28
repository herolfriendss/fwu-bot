// SUCK ME — /roletemp (temporary roles), /annonce (now or scheduled), /staff (ladder, promotions, absences,
// availability and on-call: STAFF CENTER, bot/staff-availability.js), /pseudo.
import { EmbedBuilder, PermissionFlagsBits as P } from "discord.js";
import { db } from "../database.js";
import { parsePndOwnerId } from "../pnd-owner-policy.js";
import { isSysPlus } from "../systems/sysplus/permissions.js";
import { parseDuration } from "./community.js";
import { roleGrantRefusal as protectedGrantRefusal } from "../role-grant-guard.js";
import { addEvidence, addNote, assignIntervention, closeIntervention, formatIntervention, getIntervention, listInterventions, openIntervention, STATUSES, validateIntervention } from "../staff-interventions.js";
import { addMinutes, cancelMeeting, createMission, finishMission, listMeetings, listMissions, parseParisDate, planMeeting, takeDueMeetingReminders } from "../staff-missions.js";
import { answerExercise, certify, formatExercise, startExercise, trainingRecord } from "../staff-training.js";
import { getAcademyProgress, listAcademyTracks } from "../organization.js";
import { commandCenterData, formatCommandCenter } from "../staff-command-center.js";
import { BOT_PROFILES } from "../bot-runtime.js";
import { activeOnCall, addHandover, availabilityOf, endOnCall, expireOnCall, formatCoverage, formatSlots, parseSlots, reachableStaff, recentHandovers, saveAvailability, startOnCall, weeklyCoverage } from "../staff-availability.js";

export const SUCKME_COMMANDS = new Set(["roletemp", "annonce", "staff", "pseudo"]);
const DANGEROUS = [P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels, P.BanMembers, P.KickMembers, P.ManageWebhooks];

db.exec(`
  CREATE TABLE IF NOT EXISTS suckme_temp_roles (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL, expires_at INTEGER NOT NULL, given_by TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id, role_id)
  );
  CREATE INDEX IF NOT EXISTS suckme_temp_roles_due_idx ON suckme_temp_roles(expires_at);
  CREATE TABLE IF NOT EXISTS suckme_announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, title TEXT, body TEXT NOT NULL,
    color INTEGER, role_id TEXT, author_id TEXT NOT NULL, due_at INTEGER NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS suckme_staff_ladder (guild_id TEXT PRIMARY KEY, roles_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS suckme_staff_absences (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT, until_at INTEGER, created_at INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id)
  );
`);

const ownerId = () => parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);
const fullAccess = (member) => member?.id === ownerId() || member?.id === member?.guild?.ownerId;
const allowed = (member, settings) => fullAccess(member) || isSysPlus(member, settings?.sysPlus?.roleId ?? null);

/** Pure: may `actor` hand out / take `role`? */
export function roleGrantRefusal({ role, actorPosition, botPosition, actorFull, guildId }) {
  if (!role || role.id === guildId || role.managed) return "Ce rôle ne peut pas être attribué.";
  if (role.position >= botPosition) return "Ce rôle est au-dessus de mon rôle : place mon rôle plus haut.";
  if (!actorFull && role.position >= actorPosition) return "Tu ne peux gérer que des rôles placés sous ton rôle le plus élevé.";
  if (!actorFull && DANGEROUS.some((flag) => role.permissions?.has?.(flag))) return "Seul l'OWNER peut donner un rôle avec des permissions de modération.";
  return null;
}

async function context(interaction) {
  const guild = interaction.guild;
  const me = guild.members.me ?? await guild.members.fetchMe();
  const actor = await guild.members.fetch({ user: interaction.user.id }).catch(() => interaction.member);
  return { guild, me, actor, actorFull: fullAccess(actor) };
}

// ---------------------------------------------------------------- Temporary roles
async function roletemp(interaction, settings) {
  if (!allowed(interaction.member, settings)) return "⛔ Réservé aux SYS+ et à l'OWNER.";
  const sub = interaction.options.getSubcommand();
  const { guild, me, actor, actorFull } = await context(interaction);
  if (sub === "liste") {
    const rows = db.prepare("SELECT user_id, role_id, expires_at FROM suckme_temp_roles WHERE guild_id=? ORDER BY expires_at LIMIT 25").all(guild.id);
    return `⏳ **Rôles temporaires**\n${rows.map((r) => `• <@${r.user_id}> — <@&${r.role_id}> jusqu'à <t:${Math.floor(r.expires_at / 1000)}:R>`).join("\n") || "Aucun."}`;
  }
  const user = interaction.options.getUser("membre", true);
  const role = interaction.options.getRole("role", true);
  const member = await guild.members.fetch({ user: user.id }).catch(() => null);
  if (!member) return "❌ Ce membre n'est pas sur le serveur.";
  const refusal = roleGrantRefusal({ role, actorPosition: actor.roles.highest.position, botPosition: me.roles.highest.position, actorFull, guildId: guild.id })
    ?? await protectedGrantRefusal(guild, role, { actorId: actor.id, settings, removal: sub !== "donner" });
  if (refusal) return `❌ ${refusal}`;
  if (sub === "donner") {
    const ms = parseDuration(interaction.options.getString("duree", true));
    if (!ms) return "❌ Durée invalide : `30m`, `12h`, `7j`… (1 minute à 365 jours).";
    const expires = Date.now() + ms;
    await member.roles.add(role, `Rôle temporaire donné par ${interaction.user.id}`);
    db.prepare("INSERT INTO suckme_temp_roles(guild_id,user_id,role_id,expires_at,given_by) VALUES(?,?,?,?,?) ON CONFLICT(guild_id,user_id,role_id) DO UPDATE SET expires_at=excluded.expires_at, given_by=excluded.given_by")
      .run(guild.id, user.id, role.id, expires, interaction.user.id);
    return `✅ <@&${role.id}> donné à <@${user.id}> jusqu'à <t:${Math.floor(expires / 1000)}:F>.`;
  }
  await member.roles.remove(role, `Rôle temporaire retiré par ${interaction.user.id}`).catch(() => {});
  db.prepare("DELETE FROM suckme_temp_roles WHERE guild_id=? AND user_id=? AND role_id=?").run(guild.id, user.id, role.id);
  return `✅ <@&${role.id}> retiré à <@${user.id}>.`;
}

/** Every minute: remove expired temporary roles. */
export function runStaffShiftExpiry() { return expireOnCall(); }

/** Reminder 30 min before each staff meeting, in the channel where it was planned. No mass mention. */
export async function runMeetingReminders(client, now = Date.now()) {
  let sent = 0;
  for (const meeting of takeDueMeetingReminders({ now })) {
    const channel = await client.channels.fetch(meeting.channel_id).catch(() => null);
    if (!channel?.isTextBased?.() || channel.guildId !== meeting.guild_id) continue;
    await channel.send({ content: `📅 Rappel : réunion du staff n°${meeting.number} « ${meeting.topic} » <t:${Math.floor(meeting.starts_at / 1000)}:R>.`, allowedMentions: { parse: [] } }).catch(() => {});
    sent += 1;
  }
  return sent;
}

export async function runTempRoles(client, now = Date.now()) {
  const due = db.prepare("SELECT * FROM suckme_temp_roles WHERE expires_at <= ? LIMIT 100").all(now);
  for (const row of due) {
    db.prepare("DELETE FROM suckme_temp_roles WHERE guild_id=? AND user_id=? AND role_id=?").run(row.guild_id, row.user_id, row.role_id);
    const guild = client.guilds.cache.get(row.guild_id);
    const member = guild ? await guild.members.fetch({ user: row.user_id }).catch(() => null) : null;
    if (member?.roles?.cache?.has(row.role_id)) await member.roles.remove(row.role_id, "Fin du rôle temporaire").catch(() => {});
  }
  return due.length;
}

// ---------------------------------------------------------------- Announcements
function announcementPayload(row) {
  const embed = new EmbedBuilder().setColor(row.color ?? 0xe21d2f).setDescription(row.body.slice(0, 4000)).setTimestamp(new Date());
  if (row.title) embed.setTitle(row.title.slice(0, 256));
  return { content: row.role_id ? `<@&${row.role_id}>` : undefined, embeds: [embed], allowedMentions: { roles: row.role_id ? [row.role_id] : [] } };
}

async function annonce(interaction, settings) {
  if (!allowed(interaction.member, settings)) return "⛔ Réservé aux SYS+ et à l'OWNER.";
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  if (sub === "liste") {
    const rows = db.prepare("SELECT id, channel_id, title, due_at FROM suckme_announcements WHERE guild_id=? ORDER BY due_at").all(guild.id);
    return `📣 **Annonces programmées**\n${rows.map((r) => `• #${r.id} <#${r.channel_id}> <t:${Math.floor(r.due_at / 1000)}:R> — ${r.title ?? "(sans titre)"}`).join("\n") || "Aucune."}`;
  }
  if (sub === "annuler") {
    const result = db.prepare("DELETE FROM suckme_announcements WHERE id=? AND guild_id=?").run(interaction.options.getInteger("id", true), guild.id);
    return Number(result.changes) ? "🗑️ Annonce annulée." : "❌ Annonce introuvable.";
  }
  const o = interaction.options;
  const channel = o.getChannel("salon", true);
  const colorText = o.getString("couleur");
  if (colorText && !/^#[\da-f]{6}$/i.test(colorText)) return "❌ Couleur au format #RRGGBB.";
  const role = o.getRole("mention");
  if (role && role.id === guild.id) return "❌ Pour la sécurité, pas de mention @everyone : choisis un rôle.";
  const delayText = o.getString("dans");
  const delay = delayText ? parseDuration(delayText) : 0;
  if (delayText && !delay) return "❌ Délai invalide : `30m`, `2h`, `1j`…";
  const row = { guild_id: guild.id, channel_id: channel.id, title: o.getString("titre"), body: o.getString("message", true).replace(/\\n/g, "\n"), color: colorText ? Number.parseInt(colorText.slice(1), 16) : null, role_id: role?.id ?? null };
  if (!delay) {
    await channel.send(announcementPayload(row));
    return `📣 Annonce publiée dans <#${channel.id}>.`;
  }
  const due = Date.now() + delay;
  const info = db.prepare("INSERT INTO suckme_announcements(guild_id,channel_id,title,body,color,role_id,author_id,due_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(row.guild_id, row.channel_id, row.title, row.body, row.color, row.role_id, interaction.user.id, due, Date.now());
  return `🗓️ Annonce **#${info.lastInsertRowid}** programmée <t:${Math.floor(due / 1000)}:R> dans <#${channel.id}>.`;
}

export async function runAnnouncements(client, now = Date.now()) {
  const due = db.prepare("SELECT * FROM suckme_announcements WHERE due_at <= ? LIMIT 20").all(now);
  for (const row of due) {
    db.prepare("DELETE FROM suckme_announcements WHERE id=?").run(row.id);
    const channel = await client.channels.fetch(row.channel_id).catch(() => null);
    if (channel?.isTextBased?.()) await channel.send(announcementPayload(row)).catch(() => {});
  }
  return due.length;
}

// ---------------------------------------------------------------- Staff
export function saveLadder(guildId, roleIds) {
  db.prepare("INSERT INTO suckme_staff_ladder(guild_id,roles_json) VALUES(?,?) ON CONFLICT(guild_id) DO UPDATE SET roles_json=excluded.roles_json").run(guildId, JSON.stringify(roleIds));
}
export function ladderOf(guildId) {
  try { return JSON.parse(db.prepare("SELECT roles_json FROM suckme_staff_ladder WHERE guild_id=?").get(guildId)?.roles_json ?? "[]"); } catch { return []; }
}
/** Pure: next ladder step for a member's role ids. dir = +1 (promote) or -1 (demote). */
export function ladderStep(ladder, memberRoleIds, dir) {
  const current = ladder.reduce((best, id, index) => (memberRoleIds.includes(id) ? index : best), -1);
  const next = current + dir;
  if (dir > 0 && next >= ladder.length) return { error: "Ce membre est déjà au sommet de l'échelle." };
  if (dir < 0 && current < 0) return { error: "Ce membre n'est pas dans l'échelle du staff." };
  return { add: next >= 0 ? ladder[next] : null, remove: current >= 0 ? ladder[current] : null };
}

/** Members holding a ladder role (the staff), plus the guild's configured SYS+ role holders. */
export function staffMemberIds(guild, ladder, sysPlusRoleId = null) {
  const ids = new Set();
  for (const roleId of [...ladder, sysPlusRoleId].filter(Boolean)) {
    for (const id of guild.roles.cache.get(roleId)?.members?.keys?.() ?? []) ids.add(id);
  }
  return ids;
}

const hoursOf = (ms) => Math.round(ms / 360_000) / 10;

async function staffCenter(interaction, settings, sub, guild) {
  expireOnCall();
  await guild.members.fetch().catch(() => null);
  const staffIds = staffMemberIds(guild, ladderOf(guild.id), settings?.sysPlus?.roleId ?? null);
  const isStaff = staffIds.has(interaction.user.id) || allowed(interaction.member, settings);
  if (!isStaff) return "⛔ Réservé au staff (rôles de l'échelle `/staff echelle`), aux SYS+ et à l'OWNER.";
  if (sub === "dispo") {
    const text = interaction.options.getString("creneaux");
    if (!text) return `🗓️ Tes disponibilités (heure de Paris) : ${formatSlots(availabilityOf(guild.id, interaction.user.id))}.\nPour les changer : \`/staff dispo creneaux:"lun-ven 18-23, sam 14-2"\` (\`aucun\` pour effacer).`;
    const parsed = parseSlots(text);
    if (parsed.error) return `❌ ${parsed.error}`;
    saveAvailability(guild.id, interaction.user.id, parsed.slots);
    return parsed.slots.length ? `✅ Disponibilités enregistrées (heure de Paris) : ${formatSlots(parsed.slots)}.` : "✅ Disponibilités effacées.";
  }
  if (sub === "astreinte") {
    const action = interaction.options.getString("action") ?? "voir";
    if (action === "prendre") {
      const raw = interaction.options.getString("duree");
      const duration = raw ? parseDuration(raw) : null;
      if (raw && !duration) return "❌ Durée illisible (ex. 4h, 12h, 1j).";
      const until = startOnCall(guild.id, interaction.user.id, duration ?? undefined);
      return `🟢 Tu es d'astreinte jusqu'à <t:${Math.floor(until / 1000)}:F>. L'astreinte ne donne aucun rôle ni permission : elle indique à l'équipe qui est joignable. \`/staff astreinte action:terminer\` pour l'arrêter.`;
    }
    if (action === "terminer") return endOnCall(guild.id, interaction.user.id) ? "✅ Astreinte terminée, merci !" : "Tu n'étais pas d'astreinte.";
    const shifts = activeOnCall(guild.id);
    return shifts.length
      ? `🟢 **D'astreinte**\n${shifts.map((s) => `<@${s.userId}> jusqu'à <t:${Math.floor(s.until / 1000)}:t>`).join("\n")}`
      : "Personne n'est d'astreinte pour le moment.";
  }
  if (sub === "planning") return `🗓️ **Couverture du staff sur la semaine** (heure de Paris, nombre de membres disponibles)\n${formatCoverage(weeklyCoverage(guild.id, [...staffIds]))}`;
  if (sub === "passation") {
    const note = interaction.options.getString("note");
    if (note) {
      const saved = addHandover(guild.id, interaction.user.id, note);
      if (saved.error) return `❌ ${saved.error}`;
      return `📝 Passation n°${saved.id} enregistrée. L'équipe suivante la voit avec \`/staff passation\`.`;
    }
    const notes = recentHandovers(guild.id);
    return notes.length
      ? `📝 **Dernières passations**\n${notes.map((n) => `**n°${n.id}** <t:${Math.floor(n.createdAt / 1000)}:R> par <@${n.authorId}> : ${n.note}`).join("\n")}`.slice(0, 1900)
      : "Aucune passation pour le moment. `/staff passation note:…` pour en laisser une.";
  }
  if (sub === "centre") {
    const absentIds = new Set(db.prepare("SELECT user_id FROM suckme_staff_absences WHERE guild_id=? AND (until_at IS NULL OR until_at > ?)").all(guild.id, Date.now()).map((a) => a.user_id));
    const profiles = Object.entries(BOT_PROFILES).map(([id, profile]) => ({ id, label: profile.label, optional: Boolean(profile.optional) }));
    return formatCommandCenter(commandCenterData(guild.id, { staffIds: [...staffIds], absentIds, profiles }));
  }
  // disponibles
  const absent = new Set(db.prepare("SELECT user_id FROM suckme_staff_absences WHERE guild_id=? AND (until_at IS NULL OR until_at > ?)").all(guild.id, Date.now()).map((a) => a.user_id));
  const reach = reachableStaff(guild.id, [...staffIds], { absentIds: absent });
  const list = (ids) => ids.map((id) => `<@${id}>`).join(", ") || "—";
  return [
    "📟 **Staff joignable maintenant** (heure de Paris)",
    `🟢 D'astreinte : ${list(reach.onCall)}`,
    `🗓️ Disponibles selon leurs créneaux : ${list(reach.available)}`,
    `🌙 Absents : ${absent.size}`,
    reach.declaredNone.length ? `❔ Sans créneaux déclarés : ${reach.declaredNone.length} (\`/staff dispo\`)` : null,
  ].filter(Boolean).join("\n");
}

async function interventions(interaction, settings, sub, guild) {
  await guild.members.fetch().catch(() => null);
  const staffIds = staffMemberIds(guild, ladderOf(guild.id), settings?.sysPlus?.roleId ?? null);
  const canManage = allowed(interaction.member, settings);
  if (!staffIds.has(interaction.user.id) && !canManage) return "⛔ Réservé au staff (rôles de l'échelle `/staff echelle`), aux SYS+ et à l'OWNER.";
  const o = interaction.options;
  const number = o.getInteger?.("numero") ?? null;
  const actorId = interaction.user.id;
  const say = (result, ok) => (result.error ? `❌ ${result.error}` : ok(result));
  if (sub === "ouvrir") {
    const target = o.getUser?.("membre") ?? null;
    return say(openIntervention({ guildId: guild.id, actorId, title: o.getString("titre"), targetId: target?.id ?? null, priority: o.getString("priorite") ?? "normale" }),
      (r) => `📂 Dossier d'intervention **n°${r.number}** ouvert (priorité ${r.priority}). \`/staff intervention assigner numero:${r.number}\` pour le confier.`);
  }
  if (sub === "liste") {
    const rows = listInterventions(guild.id, { status: o.getString("statut") ?? "actifs" });
    return rows.length
      ? `📂 **Dossiers d'intervention**\n${rows.map((r) => `**n°${r.number}** ${r.priority === "haute" ? "🔴 " : ""}${r.title} — ${STATUSES[r.status] ?? r.status}${r.assignee_id ? ` · <@${r.assignee_id}>` : ""} · <t:${Math.floor(r.updated_at / 1000)}:R>`).join("\n")}`.slice(0, 1900)
      : "Aucun dossier dans cette liste.";
  }
  if (sub === "voir") {
    const file = getIntervention(guild.id, number);
    return file ? formatIntervention(file) : `❌ Dossier n°${number} introuvable sur ce serveur.`;
  }
  if (sub === "assigner") {
    const assignee = o.getUser?.("membre");
    if (!assignee || !staffIds.has(assignee.id)) return "❌ Le dossier ne peut être confié qu'à un membre du staff.";
    return say(assignIntervention({ guildId: guild.id, number, actorId, assigneeId: assignee.id }), () => `👤 Dossier n°${number} confié à <@${assignee.id}>.`);
  }
  if (sub === "preuve") return say(addEvidence({ guildId: guild.id, number, actorId, link: o.getString("lien") }), (r) => `📎 Ajouté au dossier n°${number} : ${r.value}`);
  if (sub === "note") return say(addNote({ guildId: guild.id, number, actorId, text: o.getString("texte") }), () => `📝 Note ajoutée au dossier n°${number}.`);
  if (sub === "cloturer") {
    return say(closeIntervention({ guildId: guild.id, number, actorId, resolution: o.getString("conclusion"), canManage }),
      (r) => (r.pending ? `⏳ Clôture du dossier n°${number} demandée : priorité haute, un **autre** SYS+ ou l'OWNER doit la valider (\`/staff intervention valider numero:${number}\`).` : `✅ Dossier n°${number} clos.`));
  }
  if (sub === "valider") return say(validateIntervention({ guildId: guild.id, number, actorId, canManage }), () => `✅ Dossier n°${number} validé et clos.`);
  return "❌ Action inconnue.";
}

const ts = (ms, style = "f") => `<t:${Math.floor(ms / 1000)}:${style}>`;

async function missionsAndMeetings(interaction, settings, group, sub, guild) {
  await guild.members.fetch().catch(() => null);
  const staffIds = staffMemberIds(guild, ladderOf(guild.id), settings?.sysPlus?.roleId ?? null);
  const canManage = allowed(interaction.member, settings);
  if (!staffIds.has(interaction.user.id) && !canManage) return "⛔ Réservé au staff (rôles de l'échelle `/staff echelle`), aux SYS+ et à l'OWNER.";
  const o = interaction.options;
  const actorId = interaction.user.id;
  const number = o.getInteger?.("numero") ?? null;
  const say = (result, ok) => (result.error ? `❌ ${result.error}` : ok(result));
  if (group === "mission") {
    if (sub === "creer") {
      if (!canManage) return "⛔ Seuls les SYS+ et l'OWNER créent des missions.";
      const member = o.getUser?.("membre") ?? null;
      if (member && !staffIds.has(member.id)) return "❌ Une mission ne se confie qu'à un membre du staff.";
      let dueAt = null;
      if (o.getString("echeance")) { const due = parseParisDate(o.getString("echeance")); if (due.error) return `❌ ${due.error}`; dueAt = due.at; }
      return say(createMission({ guildId: guild.id, actorId, title: o.getString("titre"), assigneeId: member?.id ?? null, dueAt }),
        (r) => `🎯 Mission **n°${r.number}** créée${member ? ` pour <@${member.id}>` : " pour tout le staff"}${dueAt ? `, échéance ${ts(dueAt)}` : ""}.`);
    }
    if (sub === "liste") {
      const rows = listMissions(guild.id, { userId: actorId, all: canManage });
      return rows.length
        ? `🎯 **Missions en cours**\n${rows.map((m) => `**n°${m.number}** ${m.title} — ${m.assignee_id ? `<@${m.assignee_id}>` : "tout le staff"}${m.due_at ? ` · ${ts(m.due_at, "R")}${m.due_at < Date.now() ? " ⚠️ en retard" : ""}` : ""}`).join("\n")}`.slice(0, 1900)
        : "Aucune mission en cours.";
    }
    if (sub === "terminer") return say(finishMission({ guildId: guild.id, number, actorId, report: o.getString("bilan"), canManage }), () => `✅ Mission n°${number} terminée. Merci !`);
    if (sub === "annuler") return say(finishMission({ guildId: guild.id, number, actorId, canManage, cancel: true }), () => `🗑️ Mission n°${number} annulée.`);
  }
  if (group === "reunion") {
    if (sub === "planifier") {
      if (!canManage) return "⛔ Seuls les SYS+ et l'OWNER planifient les réunions.";
      const when = parseParisDate(o.getString("date"));
      if (when.error) return `❌ ${when.error}`;
      return say(planMeeting({ guildId: guild.id, actorId, topic: o.getString("sujet"), channelId: interaction.channelId, startsAt: when.at }),
        (r) => `📅 Réunion **n°${r.number}** planifiée ${ts(when.at)}. Rappel ici 30 min avant.`);
    }
    if (sub === "liste") {
      const next = listMeetings(guild.id);
      const past = listMeetings(guild.id, { past: true, limit: 3 });
      return [
        "📅 **Réunions à venir**", ...(next.length ? next.map((m) => `**n°${m.number}** ${m.topic} — ${ts(m.starts_at)}`) : ["—"]),
        "", "🗒️ **Dernières réunions**", ...(past.length ? past.map((m) => `**n°${m.number}** ${m.topic} — ${m.minutes ? `compte rendu : ${m.minutes.slice(0, 200)}` : "pas encore de compte rendu"}`) : ["—"]),
      ].join("\n").slice(0, 1900);
    }
    if (sub === "compte-rendu") return say(addMinutes({ guildId: guild.id, number, actorId, text: o.getString("texte") }), () => `🗒️ Compte rendu de la réunion n°${number} enregistré.`);
    if (sub === "annuler") return say(cancelMeeting({ guildId: guild.id, number, actorId, canManage }), () => `🗑️ Réunion n°${number} annulée.`);
  }
  return "❌ Action inconnue.";
}

async function training(interaction, settings, sub, guild) {
  await guild.members.fetch().catch(() => null);
  const staffIds = staffMemberIds(guild, ladderOf(guild.id), settings?.sysPlus?.roleId ?? null);
  const canManage = allowed(interaction.member, settings);
  const o = interaction.options;
  const actorId = interaction.user.id;
  if (sub === "reponse") {
    // The trainee may be a future staff member: the run itself says who may answer.
    const r = answerExercise({ guildId: guild.id, id: o.getString("id"), userId: actorId, answers: o.getString("reponses") });
    if (r.error) return `❌ ${r.error}`;
    return `🎓 **${r.scenario}** : ${r.score}/${r.total}\n${r.details.join("\n")}`.slice(0, 1900);
  }
  if (!staffIds.has(actorId) && !canManage) return "⛔ Réservé au staff (rôles de l'échelle `/staff echelle`), aux SYS+ et à l'OWNER.";
  if (sub === "exercice") {
    const trainee = o.getUser?.("membre") ?? interaction.user;
    if (trainee.id !== actorId && !canManage) return "⛔ Seuls les SYS+ et l'OWNER lancent un exercice pour quelqu'un d'autre.";
    const run = startExercise({ guildId: guild.id, traineeId: trainee.id, trainerId: actorId, scenario: o.getString("type") ?? "raid" });
    return run.error ? `❌ ${run.error}` : { public: true, content: formatExercise(run.id, run.scenario, trainee.id) };
  }
  if (sub === "valider") {
    const member = o.getUser?.("membre");
    const wanted = String(o.getString("parcours") ?? "").trim().toLowerCase();
    const found = wanted.length >= 4 ? listAcademyTracks(guild.id, 100).find((t) => String(t.trackId ?? t.track_id).toLowerCase().startsWith(wanted)) : null;
    const track = found ? { trackId: found.trackId ?? found.track_id, title: found.title } : null;
    let progress = null;
    try { progress = track && member ? getAcademyProgress(guild.id, track.trackId, member.id) : null; } catch { progress = null; }
    const r = certify({ guildId: guild.id, memberId: member?.id, actorId, canManage, track, progress });
    return r.error ? `❌ ${r.error}` : `🏅 Parcours **${track.title}** certifié pour <@${member.id}>. Rappel : une certification ne donne aucun rôle ; la promotion reste une décision (\`/staff promouvoir\`).`;
  }
  const member = o.getUser?.("membre") ?? interaction.user;
  const record = trainingRecord(guild.id, member.id);
  return [
    `🎓 **Formation de <@${member.id}>**`,
    `🏅 Parcours certifiés : ${record.certifications.map((c) => `${c.track_title} (par <@${c.certified_by}>)`).join(", ") || "aucun"}`,
    `🧪 Exercices : ${record.exercises.map((e) => `${e.title} ${e.score}/${e.total}`).join(" · ") || "aucun"}`,
  ].join("\n");
}

async function staff(interaction, settings) {
  const sub = interaction.options.getSubcommand();
  const group = interaction.options.getSubcommandGroup?.(false);
  if (group === "formation") return training(interaction, settings, sub, interaction.guild);
  if (group === "mission" || group === "reunion") return missionsAndMeetings(interaction, settings, group, sub, interaction.guild);
  if (interaction.options.getSubcommandGroup?.(false) === "intervention") return interventions(interaction, settings, sub, interaction.guild);
  if (["dispo", "astreinte", "disponibles", "planning", "passation", "centre"].includes(sub)) return staffCenter(interaction, settings, sub, interaction.guild);
  const { guild, me, actor, actorFull } = await context(interaction);
  if (sub === "absence") {
    const until = interaction.options.getString("duree") ? parseDuration(interaction.options.getString("duree")) : null;
    db.prepare("INSERT INTO suckme_staff_absences(guild_id,user_id,reason,until_at,created_at) VALUES(?,?,?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET reason=excluded.reason, until_at=excluded.until_at, created_at=excluded.created_at")
      .run(guild.id, interaction.user.id, interaction.options.getString("raison") ?? null, until ? Date.now() + until : null, Date.now());
    return `🌙 Absence enregistrée${until ? ` jusqu'à <t:${Math.floor((Date.now() + until) / 1000)}:F>` : ""}. \`/staff retour\` quand tu reviens.`;
  }
  if (sub === "retour") { db.prepare("DELETE FROM suckme_staff_absences WHERE guild_id=? AND user_id=?").run(guild.id, interaction.user.id); return "👋 Bon retour !"; }
  if (sub === "liste") {
    const ladder = ladderOf(guild.id);
    const absences = new Map(db.prepare("SELECT user_id, reason, until_at FROM suckme_staff_absences WHERE guild_id=? AND (until_at IS NULL OR until_at > ?)").all(guild.id, Date.now()).map((a) => [a.user_id, a]));
    await guild.members.fetch().catch(() => null);
    const lines = [...ladder].reverse().map((roleId) => {
      const role = guild.roles.cache.get(roleId);
      if (!role) return null;
      const names = [...role.members.values()].map((m) => `<@${m.id}>${absences.has(m.id) ? " 🌙" : ""}`);
      return `**${role.name}** (${names.length}) : ${names.join(", ") || "—"}`;
    }).filter(Boolean);
    return { public: true, content: `👥 **Staff**\n${lines.join("\n") || "Aucune échelle : `/staff echelle`."}\n🌙 = absent` };
  }
  if (!allowed(interaction.member, settings)) return "⛔ Réservé aux SYS+ et à l'OWNER.";
  if (sub === "echelle") {
    const roles = [1, 2, 3, 4, 5, 6].map((n) => interaction.options.getRole(`role${n}`)).filter(Boolean);
    for (const role of roles) {
      // L'échelle ne contient que des rôles que l'auteur pourrait lui-même donner : sinon un SYS+
      // y mettrait un rôle ADMIN+, de palier ou à permissions, puis se « promouvrait ».
      const refusal = roleGrantRefusal({ role, actorPosition: actor.roles.highest.position, botPosition: me.roles.highest.position, actorFull, guildId: guild.id })
        ?? await protectedGrantRefusal(guild, role, { actorId: actor.id, settings });
      if (refusal) return `❌ ${role.name} : ${refusal}`;
    }
    const sorted = [...new Set(roles.map((r) => r.id))].sort((a, b) => guild.roles.cache.get(a).position - guild.roles.cache.get(b).position);
    db.prepare("INSERT INTO suckme_staff_ladder(guild_id,roles_json) VALUES(?,?) ON CONFLICT(guild_id) DO UPDATE SET roles_json=excluded.roles_json").run(guild.id, JSON.stringify(sorted));
    return `✅ Échelle du staff (du plus bas au plus haut) : ${sorted.map((id) => `<@&${id}>`).join(" → ")}`;
  }
  const user = interaction.options.getUser("membre", true);
  const member = await guild.members.fetch({ user: user.id }).catch(() => null);
  if (!member) return "❌ Ce membre n'est pas sur le serveur.";
  if (sub === "promouvoir" && member.id === actor.id && !actorFull) return "⛔ Tu ne peux pas te promouvoir toi-même.";
  const step = ladderStep(ladderOf(guild.id), [...member.roles.cache.keys()], sub === "promouvoir" ? 1 : -1);
  if (step.error) return `❌ ${step.error}`;
  if (step.add) {
    const role = guild.roles.cache.get(step.add);
    const refusal = roleGrantRefusal({ role, actorPosition: actor.roles.highest.position, botPosition: me.roles.highest.position, actorFull, guildId: guild.id })
      ?? await protectedGrantRefusal(guild, role, { actorId: actor.id, settings });
    if (refusal) return `❌ ${refusal}`;
    await member.roles.add(step.add, `${sub === "promouvoir" ? "Promotion" : "Rétrogradation"} par ${interaction.user.id}`);
  }
  if (step.remove) await member.roles.remove(step.remove, `${sub === "promouvoir" ? "Promotion" : "Rétrogradation"} par ${interaction.user.id}`);
  return sub === "promouvoir" ? `⬆️ <@${user.id}> promu${step.add ? ` : <@&${step.add}>` : ""}.` : `⬇️ <@${user.id}> rétrogradé${step.add ? ` : <@&${step.add}>` : " (retiré du staff)"}.`;
}

// ---------------------------------------------------------------- Nicknames
async function pseudo(interaction, settings) {
  if (!allowed(interaction.member, settings) && !interaction.member?.permissions?.has?.(P.ManageNicknames)) return "⛔ Réservé aux SYS+, à l'OWNER et au staff (Gérer les pseudos).";
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  const user = interaction.options.getUser("membre", true);
  const member = await guild.members.fetch({ user: user.id }).catch(() => null);
  if (!member) return "❌ Ce membre n'est pas sur le serveur.";
  let locked = false;
  try { locked = Boolean(db.prepare("SELECT 1 FROM protected_nicknames WHERE guild_id=? AND member_id=?").get(guild.id, user.id)); } catch { locked = false; }
  if (locked) return "⛔ Ce pseudo est protégé par LOCKNAME : retire d'abord LOCKNAME.";
  const nickname = sub === "changer" ? interaction.options.getString("nom", true).replace(/@(everyone|here)/gi, "").trim().slice(0, 32) : null;
  if (sub === "changer" && nickname.length < 1) return "❌ Pseudo invalide.";
  await member.setNickname(nickname, `Pseudo ${sub === "changer" ? "changé" : "réinitialisé"} par ${interaction.user.id}`);
  return sub === "changer" ? `✅ Pseudo de <@${user.id}> : **${nickname}**.` : `✅ Pseudo de <@${user.id}> réinitialisé.`;
}

export async function handleSuckmeInteraction(interaction, settings = {}) {
  if (!interaction.isChatInputCommand?.() || !SUCKME_COMMANDS.has(interaction.commandName)) return false;
  if (!interaction.guild) { await interaction.reply({ content: "Cette commande s'utilise sur un serveur.", ephemeral: true }); return true; }
  const publicReply = interaction.commandName === "staff" && (interaction.options.getSubcommand(false) === "liste"
    || (interaction.options.getSubcommandGroup?.(false) === "formation" && interaction.options.getSubcommand(false) === "exercice"));
  await interaction.deferReply({ ephemeral: !publicReply });
  try {
    const result = await { roletemp, annonce, staff, pseudo }[interaction.commandName](interaction, settings);
    const payload = typeof result === "string" ? { content: result } : { ...result };
    delete payload.public;
    await interaction.editReply({ ...payload, allowedMentions: { parse: [] } });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error instanceof Error ? error.message : "Action impossible."}`, allowedMentions: { parse: [] } }).catch(() => {});
  }
  return true;
}
