// FWU DM ALL: the OWNER sends one private message to every member (or to the
// members of one role). Strictly reserved to PND_OWNER_DISCORD_ID.
//
// Same safety pattern as /rankall: preview → confirmation (60 s) → paced run
// that can be stopped → summary. One run per server at a time, a cooldown
// between two runs, a member cap, bots excluded, never any mention ping.
// A run cut by a restart is marked "interrupted" and never resumed silently
// (resuming could DM the same members twice).
import { randomBytes } from "node:crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { db } from "./database.js";
import { sendCentralLog, systemLogEmbed } from "./logs.js";
import { parsePndOwnerId } from "./pnd-owner-policy.js";
import { recordSysPlusAudit } from "./systems/sysplus/audit.js";
import { HER_THEME_COLOR, HER_THEME_FOOTER } from "./theme.js";

const envNumber = (name, fallback, min = 0) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min ? value : fallback;
};
export const DMALL_PREVIEW_TTL_MS = 60_000;
export const DMALL_MAX_MEMBERS = envNumber("PND_DMALL_MAX_MEMBERS", 1_000, 1);
export const DMALL_STEP_DELAY_MS = envNumber("PND_DMALL_STEP_DELAY_MS", 1_500);
export const DMALL_COOLDOWN_MS = envNumber("PND_DMALL_COOLDOWN_MS", 60 * 60_000);
export const DMALL_MAX_LENGTH = 1_800;
export const DMALL_DENIED = "⛔ DM ALL est strictement réservé au propriétaire de FWU.";

db.exec(`CREATE TABLE IF NOT EXISTS dmall_jobs (
  job_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, actor_id TEXT NOT NULL, role_id TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('preview','running','completed','stopped','interrupted','cancelled','expired')),
  target_count INTEGER NOT NULL DEFAULT 0, sent_count INTEGER NOT NULL DEFAULT 0, failed_count INTEGER NOT NULL DEFAULT 0,
  stop_requested INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS dmall_jobs_guild_idx ON dmall_jobs(guild_id,status,created_at DESC);`);

export function isDmAllOwner(userId) {
  const owner = parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);
  return Boolean(owner && owner === userId);
}

function rowToJob(row) {
  if (!row) return null;
  return {
    id: row.job_id, guildId: row.guild_id, actorId: row.actor_id, roleId: row.role_id, message: row.message,
    status: row.status, targetCount: row.target_count, sentCount: row.sent_count, failedCount: row.failed_count,
    stopRequested: row.stop_requested === 1, createdAt: row.created_at, expiresAt: row.expires_at,
    startedAt: row.started_at, finishedAt: row.finished_at,
  };
}

export function getDmAllJob(jobId) {
  if (typeof jobId !== "string" || !/^[a-f0-9]{12}$/.test(jobId)) return null;
  return rowToJob(db.prepare("SELECT * FROM dmall_jobs WHERE job_id=?").get(jobId));
}

/** Members who will receive the DM: humans only, optionally limited to one role. */
export function planDmAll(members, roleId = null) {
  let bots = 0;
  const recipients = [];
  for (const member of members) {
    if (member?.user?.bot) { bots += 1; continue; }
    if (roleId && !member?.roles?.cache?.has?.(roleId)) continue;
    recipients.push(member);
  }
  return { recipients, bots };
}

export function normalizeDmAllMessage(text) {
  const message = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!message) throw new Error("Le message est vide.");
  if (message.length > DMALL_MAX_LENGTH) throw new Error(`Message trop long (${message.length}/${DMALL_MAX_LENGTH} caractères).`);
  return message;
}

function lastRun(guildId) {
  return db.prepare("SELECT started_at FROM dmall_jobs WHERE guild_id=? AND started_at IS NOT NULL ORDER BY started_at DESC LIMIT 1").get(guildId)?.started_at ?? null;
}

export function createDmAllPreview({ guildId, actorId, roleId = null, message, targetCount, now = Date.now(), cooldownMs = DMALL_COOLDOWN_MS }) {
  db.prepare("UPDATE dmall_jobs SET status='expired',finished_at=? WHERE guild_id=? AND status='preview' AND expires_at<=?").run(now, guildId, now);
  if (db.prepare("SELECT 1 FROM dmall_jobs WHERE guild_id=? AND status='running'").get(guildId)) {
    throw new Error("Un DM ALL est déjà en cours sur ce serveur. Arrête-le ou attends la fin.");
  }
  const previous = lastRun(guildId);
  if (previous && now - previous < cooldownMs) {
    throw new Error(`Un DM ALL a déjà été lancé <t:${Math.floor(previous / 1000)}:R>. Prochain envoi possible <t:${Math.floor((previous + cooldownMs) / 1000)}:R>.`);
  }
  if (!targetCount) throw new Error("Aucun membre à contacter.");
  if (targetCount > DMALL_MAX_MEMBERS) throw new Error(`Trop de destinataires (${targetCount}). Plafond : ${DMALL_MAX_MEMBERS} (\`PND_DMALL_MAX_MEMBERS\`).`);
  db.prepare("UPDATE dmall_jobs SET status='cancelled',finished_at=? WHERE guild_id=? AND status='preview'").run(now, guildId);
  const id = randomBytes(6).toString("hex");
  db.prepare(`INSERT INTO dmall_jobs(job_id,guild_id,actor_id,role_id,message,status,target_count,created_at,expires_at)
    VALUES(?,?,?,?,?,'preview',?,?,?)`).run(id, guildId, actorId, roleId, message, targetCount, now, now + DMALL_PREVIEW_TTL_MS);
  return getDmAllJob(id);
}

/** Atomically moves a valid preview to "running" (double-click safe). */
export function claimDmAllJob(jobId, actorId, now = Date.now()) {
  const job = getDmAllJob(jobId);
  if (!job) return { ok: false, reason: "Ce DM ALL est introuvable." };
  if (job.actorId !== actorId) return { ok: false, reason: "Cette confirmation appartient à un autre utilisateur." };
  if (job.status !== "preview") return { ok: false, reason: job.status === "running" ? "Ce DM ALL est déjà en cours." : "Ce DM ALL n'est plus en attente de confirmation." };
  if (job.expiresAt <= now) {
    db.prepare("UPDATE dmall_jobs SET status='expired',finished_at=? WHERE job_id=?").run(now, jobId);
    return { ok: false, reason: "La confirmation a expiré. Relance la commande." };
  }
  if (db.prepare("SELECT 1 FROM dmall_jobs WHERE guild_id=? AND status='running'").get(job.guildId)) {
    return { ok: false, reason: "Un DM ALL est déjà en cours sur ce serveur." };
  }
  const changed = Number(db.prepare("UPDATE dmall_jobs SET status='running',started_at=? WHERE job_id=? AND status='preview'").run(now, jobId).changes);
  return changed ? { ok: true, job: getDmAllJob(jobId) } : { ok: false, reason: "Ce DM ALL est déjà en cours." };
}

export function cancelDmAllPreview(jobId, actorId, now = Date.now()) {
  const job = getDmAllJob(jobId);
  if (!job || job.actorId !== actorId) return false;
  return Number(db.prepare("UPDATE dmall_jobs SET status='cancelled',finished_at=? WHERE job_id=? AND status='preview'").run(now, jobId).changes) > 0;
}

export function requestDmAllStop(jobId, actorId) {
  const job = getDmAllJob(jobId);
  if (!job || job.actorId !== actorId || job.status !== "running") return false;
  db.prepare("UPDATE dmall_jobs SET stop_requested=1 WHERE job_id=?").run(jobId);
  return true;
}

/** Runs cut by a restart are never resumed: they would DM some members twice. */
export function recoverInterruptedDmAllJobs(now = Date.now()) {
  db.prepare("UPDATE dmall_jobs SET status='expired',finished_at=? WHERE status='preview' AND expires_at<=?").run(now, now);
  return Number(db.prepare("UPDATE dmall_jobs SET status='interrupted',finished_at=? WHERE status='running'").run(now).changes);
}

export function buildDmAllEmbed(guildName, message) {
  return {
    color: HER_THEME_COLOR,
    title: `📨 Message de ${String(guildName ?? "ton serveur").slice(0, 200)}`,
    description: message,
    footer: { text: HER_THEME_FOOTER },
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function executeDmAllJob({ job, guildName, recipients, onProgress = async () => {}, sleep = wait, stepDelayMs = DMALL_STEP_DELAY_MS }) {
  const embed = buildDmAllEmbed(guildName, job.message);
  let sent = 0;
  let failed = 0;
  let processed = 0;
  let stopped = false;
  const save = () => db.prepare("UPDATE dmall_jobs SET sent_count=?,failed_count=? WHERE job_id=?").run(sent, failed, job.id);
  for (const member of recipients) {
    if (db.prepare("SELECT stop_requested FROM dmall_jobs WHERE job_id=?").get(job.id)?.stop_requested === 1) {
      stopped = true;
      break;
    }
    processed += 1;
    try {
      await member.send({ embeds: [embed], allowedMentions: { parse: [] } });
      sent += 1;
    } catch {
      failed += 1; // DMs closed, member left, or blocked the bot.
    }
    if (processed % 10 === 0) {
      save();
      await onProgress({ processed, total: recipients.length, sent, failed }).catch(() => {});
    }
    if (stepDelayMs && processed < recipients.length) await sleep(stepDelayMs);
  }
  save();
  const status = stopped ? "stopped" : "completed";
  db.prepare("UPDATE dmall_jobs SET status=?,finished_at=? WHERE job_id=?").run(status, Date.now(), job.id);
  return { status, sent, failed, processed, total: recipients.length };
}

// ---- Discord surface (slash, prefix, buttons) ----

function previewPayload(job, guildName, roleId, bots) {
  const minutes = Math.max(1, Math.ceil((job.targetCount * DMALL_STEP_DELAY_MS) / 60_000));
  const content = [
    "⚠️ **DM ALL — aperçu**",
    `Destinataires : **${job.targetCount}** membre(s)${roleId ? ` du rôle <@&${roleId}>` : ""} · bots exclus : **${bots}**`,
    `Durée estimée : environ **${minutes} min** (un message toutes les ${(DMALL_STEP_DELAY_MS / 1000).toLocaleString("fr-FR")} s).`,
    "Les membres aux MP fermés seront comptés en échec. Aucune mention n'est envoyée.",
    "Message tel qu'il sera reçu ci-dessous. Confirme dans les 60 secondes.",
  ].join("\n");
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`dmall:confirm:${job.id}`).setLabel(`Envoyer à ${job.targetCount} membres`).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`dmall:abort:${job.id}`).setLabel("Annuler").setStyle(ButtonStyle.Secondary),
  );
  return { content, embeds: [buildDmAllEmbed(guildName, job.message)], components: [row], allowedMentions: { parse: [] } };
}

async function buildPreview(guild, actorId, roleId, text) {
  const message = normalizeDmAllMessage(text);
  if (roleId) {
    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) throw new Error("Rôle introuvable.");
  }
  const members = await guild.members.fetch();
  const plan = planDmAll([...members.values()], roleId);
  const job = createDmAllPreview({ guildId: guild.id, actorId, roleId, message, targetCount: plan.recipients.length });
  return previewPayload(job, guild.name, roleId, plan.bots);
}

export function parseDmAllPrefix(content) {
  const match = /^=dmall(?:\s+([\s\S]*))?$/i.exec(String(content ?? "").trim());
  if (!match) return null;
  let rest = String(match[1] ?? "").trim();
  let roleId = null;
  const role = /^<@&(\d{5,25})>\s*/.exec(rest);
  if (role) { roleId = role[1]; rest = rest.slice(role[0].length); }
  return { roleId, message: rest };
}

export async function handleDmAllMessage(message, settings = {}) {
  const parsed = parseDmAllPrefix(message?.content);
  if (!parsed) return false;
  if (!message.guild || !message.member) return true;
  const mentions = { parse: [] };
  if (!isDmAllOwner(message.author.id)) {
    await message.reply({ content: DMALL_DENIED, allowedMentions: mentions });
    return true;
  }
  if (!parsed.message) {
    await message.reply({ content: "Utilisation : `=dmall [@rôle] ton message`.", allowedMentions: mentions });
    return true;
  }
  try {
    await message.reply(await buildPreview(message.guild, message.author.id, parsed.roleId, parsed.message));
  } catch (error) {
    await message.reply({ content: `❌ ${error instanceof Error ? error.message : "Action impossible."}`, allowedMentions: mentions });
  }
  return true;
}

async function editInPlace(interaction, payload) {
  try { await interaction.editReply(payload); }
  catch { await interaction.message?.edit?.(payload).catch(() => {}); }
}

export async function handleDmAllInteraction(interaction, settings = {}) {
  if (interaction.isChatInputCommand?.() && interaction.commandName === "dmall") {
    if (!interaction.guild) {
      await interaction.reply({ content: "Cette commande doit être utilisée dans un serveur.", ephemeral: true });
      return true;
    }
    if (!isDmAllOwner(interaction.user.id)) {
      await interaction.reply({ content: DMALL_DENIED, ephemeral: true });
      return true;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      const role = interaction.options.getRole?.("role") ?? null;
      await interaction.editReply(await buildPreview(interaction.guild, interaction.user.id, role?.id ?? null, interaction.options.getString("message", true)));
    } catch (error) {
      await interaction.editReply({ content: `❌ ${error instanceof Error ? error.message : "Action impossible."}`, embeds: [], components: [] }).catch(() => {});
    }
    return true;
  }
  if (!interaction.isButton?.() || !interaction.customId?.startsWith("dmall:")) return false;
  const [, action, jobId] = interaction.customId.split(":");
  const job = getDmAllJob(jobId);
  if (!interaction.guild || !job || job.guildId !== interaction.guild.id) {
    await interaction.reply({ content: "Ce DM ALL est introuvable ou a expiré.", ephemeral: true });
    return true;
  }
  if (!isDmAllOwner(interaction.user.id) || interaction.user.id !== job.actorId) {
    await interaction.reply({ content: DMALL_DENIED, ephemeral: true });
    return true;
  }
  if (action === "abort") {
    const cancelled = cancelDmAllPreview(jobId, interaction.user.id);
    await interaction.update({ content: cancelled ? "✖️ DM ALL annulé. Aucun message n'a été envoyé." : "Ce DM ALL n'est plus en attente.", embeds: [], components: [], allowedMentions: { parse: [] } });
    return true;
  }
  if (action === "stop") {
    const requested = requestDmAllStop(jobId, interaction.user.id);
    await interaction.reply({ content: requested ? "⏹️ Arrêt demandé : l'envoi s'interrompt après le membre en cours." : "Ce DM ALL n'est plus en cours.", ephemeral: true });
    return true;
  }
  if (action !== "confirm") return false;
  const claim = claimDmAllJob(jobId, interaction.user.id);
  if (!claim.ok) {
    await interaction.reply({ content: claim.reason, ephemeral: true });
    return true;
  }
  await interaction.deferUpdate();
  const stopRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`dmall:stop:${jobId}`).setLabel("Arrêter").setStyle(ButtonStyle.Secondary));
  try {
    const members = await interaction.guild.members.fetch();
    // Recomputed at confirmation: members who left are not contacted.
    const plan = planDmAll([...members.values()], job.roleId).recipients.slice(0, DMALL_MAX_MEMBERS);
    await editInPlace(interaction, { content: `📨 DM ALL en cours : 0/${plan.length}…`, embeds: [], components: [stopRow], allowedMentions: { parse: [] } });
    const result = await executeDmAllJob({
      job: claim.job,
      guildName: interaction.guild.name,
      recipients: plan,
      onProgress: (p) => editInPlace(interaction, { content: `📨 DM ALL en cours : ${p.processed}/${p.total} · envoyés ${p.sent} · MP fermés ${p.failed}`, components: [stopRow], allowedMentions: { parse: [] } }),
    });
    const title = result.status === "stopped" ? `⏹️ **DM ALL arrêté** (${result.processed}/${result.total})` : "✅ **DM ALL terminé**";
    const summary = `${title}\nEnvoyés : **${result.sent}**\nMP fermés ou refusés : **${result.failed}**${job.roleId ? `\nRôle ciblé : <@&${job.roleId}>` : ""}`;
    recordSysPlusAudit(interaction.guild.id, interaction.user.id, "owner.dmall", null, { jobId, roleId: job.roleId, sent: result.sent, failed: result.failed, status: result.status, length: job.message.length });
    await sendCentralLog(interaction.guild, settings, systemLogEmbed({ title: "📨 DM ALL envoyé par le propriétaire", description: `Acteur : <@${interaction.user.id}>\n${summary}\nContenu non enregistré dans les logs.` })).catch(() => {});
    await editInPlace(interaction, { content: summary, embeds: [], components: [], allowedMentions: { parse: [] } });
  } catch (error) {
    // Never leave a job "running": it would block every later DM ALL on this server.
    db.prepare("UPDATE dmall_jobs SET status='interrupted',finished_at=? WHERE job_id=? AND status='running'").run(Date.now(), jobId);
    await editInPlace(interaction, { content: `❌ ${error instanceof Error ? error.message : "DM ALL interrompu."}`, embeds: [], components: [] });
  }
  return true;
}
