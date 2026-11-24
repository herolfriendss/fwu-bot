// Her? V4 — modération avancée et vérification.
//
// Les avertissements, le journal et l’éligibilité sont stockés localement dans
// SQLite, toujours par serveur. Les permissions Discord sont revérifiées à chaque
// commande ; aucune sanction ne peut viser un rôle supérieur au bot.
import { updateModuleSettings } from "./module-settings.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle } from "discord.js";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { db, transaction } from "./database.js";
import { sendCentralLog } from "./logs.js";
import { LOGS_HUB_GUILD_ID, logSourceForGuild, sendToLogsHub } from "./logs-hub.js";
import {
  activeWarnings, sanitizeReason, verificationEligible, warningExpiry,
} from "./moderation-policy.js";
import { respondInPlaceSafe } from "./interaction-reply.js";
import { runModerationAction } from "./moderation-actions.js";

const P = PermissionFlagsBits;
const MAX_CASE_DETAILS = 1_000;
const MODERATION_COMMANDS = new Set(["warn", "warnings", "unmute", "kick", "ban", "purge", "slowmode", "lock", "unlock", "verify"]);
const CASE_ACTIONS = new Set(["warn", "mute", "unmute", "kick", "ban"]);
const APPEALABLE_ACTIONS = new Set(["warn", "mute", "kick", "ban"]);
const APPEAL_WINDOW_MS = 7 * 86_400_000;

function encodeCaseDetails(details) {
  if (details == null) return null;
  try {
    const encoded = JSON.stringify(details);
    if (typeof encoded !== "string") return JSON.stringify({ truncated: true, reason: "unsupported" });
    return encoded.length <= MAX_CASE_DETAILS ? encoded : JSON.stringify({ truncated: true, reason: "size_limit" });
  } catch {
    return JSON.stringify({ truncated: true, reason: "unserializable" });
  }
}

function decodeCaseDetails(encoded) {
  if (!encoded) return null;
  try {
    return JSON.parse(encoded);
  } catch {
    return null;
  }
}

export function recordModerationCase({ guildId, userId, moderatorId, action, reason, details = null }) {
  if (!guildId || !userId || !moderatorId || !CASE_ACTIONS.has(action)) {
    throw new Error("Dossier de modération invalide.");
  }
  const encodedDetails = encodeCaseDetails(details);
  const result = db.prepare(`INSERT INTO moderation_cases
    (guild_id,user_id,moderator_id,action,reason,details_json,created_at)
    VALUES(?,?,?,?,?,?,?)`).run(
    guildId,
    userId,
    moderatorId,
    action,
    sanitizeReason(reason),
    encodedDetails,
    Date.now(),
  );
  return Number(result.lastInsertRowid);
}

export function listModerationCases(guildId, userId, limit = 10) {
  if (!guildId || !userId) return [];
  return db.prepare(`SELECT * FROM moderation_cases
    WHERE guild_id=? AND user_id=? ORDER BY id DESC LIMIT ?`)
    .all(guildId, userId, Math.min(25, Math.max(1, Math.floor(Number(limit) || 10))))
    .map((row) => ({
      id: Number(row.id),
      guildId: row.guild_id,
      userId: row.user_id,
      moderatorId: row.moderator_id,
      action: row.action,
      reason: row.reason,
      details: decodeCaseDetails(row.details_json),
      createdAt: Number(row.created_at),
    }));
}

export function createSanctionAppeal(guildId, appellantId, caseId, body, now = Date.now()) {
  if (!guildId || !appellantId || !Number.isSafeInteger(caseId) || caseId < 1) throw new Error("Référence d’appel invalide.");
  if (String(body ?? "").trim().length < 10) throw new Error("L’appel doit contenir au moins 10 caractères.");
  const cleanBody = sanitizeReason(body, 1_000);
  if (cleanBody.length < 10) throw new Error("L’appel doit contenir au moins 10 caractères.");
  const sanction = db.prepare(`SELECT id,user_id,action,created_at FROM moderation_cases
    WHERE guild_id=? AND id=? AND action IN ('warn','mute','kick','ban')`).get(guildId, caseId);
  if (!sanction || sanction.user_id !== appellantId) throw new Error("Ce dossier ne t’appartient pas ou n’autorise pas d’appel.");
  if (Number(sanction.created_at) > now || now - Number(sanction.created_at) > APPEAL_WINDOW_MS) throw new Error("Le délai d’appel de 7 jours est dépassé.");
  const result = db.prepare(`INSERT INTO moderation_appeals
    (guild_id,case_id,appellant_id,body,status,submitted_at) VALUES(?,?,?,?, 'pending',?)`)
    .run(guildId, caseId, appellantId, cleanBody, now);
  return Number(result.lastInsertRowid);
}

export function listPendingModerationAppeals(guildId, appellantId, limit = 5) {
  if (!guildId || !appellantId) return [];
  return db.prepare(`SELECT id,case_id,appellant_id,body,status,submitted_at FROM moderation_appeals
    WHERE guild_id=? AND appellant_id=? AND status='pending' ORDER BY id DESC LIMIT ?`)
    .all(guildId, appellantId, Math.min(5, Math.max(1, Math.floor(Number(limit) || 5))));
}

function moderationAppealById(appealId) {
  if (!Number.isSafeInteger(appealId) || appealId < 1) return null;
  return db.prepare(`SELECT a.*,c.action,c.reason AS sanction_reason FROM moderation_appeals a
    JOIN moderation_cases c ON c.guild_id=a.guild_id AND c.id=a.case_id WHERE a.id=?`).get(appealId) ?? null;
}

export function reviewModerationAppeal(guildId, reviewerId, appealId, decision, now = Date.now()) {
  if (!guildId || !reviewerId) throw new Error("Réviseur ou serveur invalide.");
  if (!new Set(["accepted", "rejected"]).has(decision)) throw new Error("Décision d’appel invalide.");
  const result = db.prepare(`UPDATE moderation_appeals SET status=?,reviewed_by=?,reviewed_at=?
    WHERE guild_id=? AND id=? AND status='pending'`).run(decision, reviewerId, now, guildId, appealId);
  if (!Number(result.changes)) throw new Error("Appel introuvable ou déjà traité.");
  return moderationAppealById(appealId);
}

export function canReviewModerationAppeal(source, roleNames) {
  if (source !== "pnd" && source !== "mz") return false;
  const prefix = source === "mz" ? "MZ " : "";
  const permitted = new Set([`${prefix}Logs Owner`, `${prefix}Logs Admin`, `${prefix}Logs Modération`]);
  return Array.isArray(roleNames) && roleNames.some((name) => permitted.has(name));
}

async function targetMember(guild, user) {
  return guild.members.fetch({ user: user.id, force: true }).catch(() => null);
}

async function confirm(interaction, content) {
  await interaction.editReply({ content, allowedMentions: { parse: [] } });
}

export function appealButton(caseId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`moderation:appeal:${caseId}`).setLabel("Faire appel").setStyle(ButtonStyle.Secondary),
  );
}

async function showSanctionAppealModal(interaction) {
  const caseId = Number(interaction.customId.split(":").at(-1));
  const row = Number.isSafeInteger(caseId) && caseId > 0
    ? db.prepare("SELECT user_id,action,created_at FROM moderation_cases WHERE id=?").get(caseId)
    : null;
  if (!row || row.user_id !== interaction.user.id || !APPEALABLE_ACTIONS.has(row.action)
    || Number(row.created_at) > Date.now() || Date.now() - Number(row.created_at) > APPEAL_WINDOW_MS) {
    await interaction.reply({ content: "Ce dossier ne peut pas être contesté depuis ce bouton (délai dépassé ou dossier non autorisé).", ephemeral: true });
    return;
  }
  const modal = new ModalBuilder().setCustomId(`moderation:appeal-submit:${caseId}`).setTitle(`Appel du dossier #${caseId}`);
  const input = new TextInputBuilder().setCustomId("body").setLabel("Explique ta demande (10 à 1 000 caractères)")
    .setStyle(TextInputStyle.Paragraph).setMinLength(10).setMaxLength(1_000).setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function submitSanctionAppeal(interaction) {
  const caseId = Number(interaction.customId.split(":").at(-1));
  const sanction = Number.isSafeInteger(caseId) && caseId > 0
    ? db.prepare("SELECT guild_id FROM moderation_cases WHERE id=? AND user_id=?").get(caseId, interaction.user.id)
    : null;
  let appealId;
  try {
    if (!sanction) throw new Error("Dossier introuvable ou non autorisé.");
    appealId = createSanctionAppeal(sanction.guild_id, interaction.user.id, caseId, interaction.fields.getTextInputValue("body"));
  } catch (error) {
    await interaction.reply({ content: error.message, ephemeral: true });
    return;
  }
  const appeal = moderationAppealById(appealId);
  const sourceGuild = interaction.client.guilds.cache.get(appeal.guild_id);
  if (!sourceGuild) {
    await interaction.reply({ content: "L’appel est enregistré, mais le serveur source est indisponible pour notifier son équipe.", ephemeral: true });
    return;
  }
  const reviewRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`moderation:appeal-review:accepted:${appealId}`).setLabel("Accepter l’appel").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`moderation:appeal-review:rejected:${appealId}`).setLabel("Rejeter l’appel").setStyle(ButtonStyle.Danger),
  );
  const embed = new EmbedBuilder().setColor(0xf59e0b).setTitle("🛡️ Appel de sanction")
    .setDescription(`Dossier #${appeal.case_id} · appel #${appealId}\nMembre : <@${appeal.appellant_id}>\nSanction : **${appeal.action}**\nMotif initial : ${(appeal.sanction_reason || "Non renseigné").slice(0, 500)}\n\n**Demande**\n${appeal.body.slice(0, 1_000)}\n\nUne décision acceptée n’annule pas automatiquement une sanction Discord.`)
    .setTimestamp(new Date(appeal.submitted_at));
  const delivered = await sendToLogsHub(interaction.client, sourceGuild, embed.toJSON(), "Modération — Appel sanction", [reviewRow.toJSON()]).catch(() => false);
  await interaction.reply({ content: delivered ? "✅ Ton appel a été transmis à l’équipe de modération. La sanction reste active pendant son examen." : "✅ Ton appel est enregistré. Le journal central est indisponible ; le staff devra consulter la base de modération.", ephemeral: true });
}

async function handleSanctionAppealReview(interaction) {
  if (interaction.guildId !== LOGS_HUB_GUILD_ID || !interaction.channel?.name?.endsWith("logs-sanctions")) {
    await interaction.reply({ content: "Cette décision doit être prise depuis le journal de sanctions correspondant.", ephemeral: true });
    return;
  }
  const [, , decision, rawId] = interaction.customId.split(":");
  const appealId = Number(rawId);
  const appeal = moderationAppealById(appealId);
  const source = appeal && logSourceForGuild(appeal.guild_id);
  if (!appeal || !source || (source === "mz" && interaction.channel.name !== "mz-logs-sanctions")
    || (source === "pnd" && interaction.channel.name !== "logs-sanctions")) {
    await interaction.reply({ content: "Appel introuvable pour ce journal.", ephemeral: true });
    return;
  }
  const reviewer = await interaction.guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
  if (!canReviewModerationAppeal(source, reviewer?.roles.cache.map((role) => role.name) ?? [])) {
    await interaction.reply({ content: "Un rôle de modération du journal correspondant est requis.", ephemeral: true });
    return;
  }
  try {
    const reviewed = reviewModerationAppeal(appeal.guild_id, interaction.user.id, appealId, decision);
    const applicant = await interaction.client.users.fetch(reviewed.appellant_id).catch(() => null);
    await applicant?.send({ content: decision === "accepted"
      ? `✅ Ton appel #${appealId} concernant le dossier #${appeal.case_id} a été accepté par l’équipe. La sanction Discord n’a pas été automatiquement levée ; contacte le staff pour la suite.`
      : `❌ Ton appel #${appealId} concernant le dossier #${appeal.case_id} a été rejeté par l’équipe.`, allowedMentions: { parse: [] } }).catch(() => {});
    await interaction.update({ components: [], embeds: interaction.message.embeds.map((item) => {
      const json = item.toJSON();
      json.fields = [...(json.fields || []), { name: "Décision", value: `${decision === "accepted" ? "Accepté" : "Rejeté"} par ${interaction.user.tag} · <t:${Math.floor(Date.now() / 1000)}:f>`, inline: false }];
      return json;
    }) });
  } catch (error) {
    await respondInPlaceSafe(interaction, { content: error.message, ephemeral: true });
  }
}

export async function handleModerationInteraction(interaction, guildSettings = {}, api = null) {
  if (interaction.isButton() && interaction.customId.startsWith("moderation:appeal:")) {
    await showSanctionAppealModal(interaction);
    return true;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith("moderation:appeal-submit:")) {
    await submitSanctionAppeal(interaction);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith("moderation:appeal-review:")) {
    await handleSanctionAppealReview(interaction);
    return true;
  }
  if (interaction.isButton() && interaction.customId === "verify:start") {
    await startVerificationChallenge(interaction, guildSettings);
    return true;
  }
  if (interaction.isModalSubmit() && interaction.customId === "verify:answer") {
    await submitVerificationChallenge(interaction, guildSettings);
    return true;
  }
  if (!interaction.isChatInputCommand() || !MODERATION_COMMANDS.has(interaction.commandName)) return false;
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Cette commande doit être utilisée sur un serveur.", ephemeral: true });
    return true;
  }

  const actor = interaction.member ?? await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!actor) {
    await interaction.reply({ content: "Je ne trouve pas ton profil sur ce serveur.", ephemeral: true });
    return true;
  }
  const settings = guildSettings ?? {};
  const command = interaction.commandName;

  try {
    if (command === "verify") {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "reaction" || subcommand === "reaction-off") {
        const { runPrefixFromSlash } = await import("./v4-commands.js");
        const { handleReactionVerificationCommand } = await import("./reaction-verification.js");
        const channel = subcommand === "reaction" ? interaction.options.getChannel("salon", true) : null;
        const role = subcommand === "reaction" ? interaction.options.getRole("role", true) : null;
        return runPrefixFromSlash(
          interaction,
          subcommand === "reaction" ? `=verification <#${channel.id}> <@&${role.id}>` : "=verification off",
          (message) => handleReactionVerificationCommand(message),
          { mentions: channel ? { channels: [guild.channels.cache.get(channel.id) ?? channel], roles: [guild.roles.cache.get(role.id) ?? role] } : {} },
        );
      }
      if (subcommand === "panel") {
        if (!actor.permissions.has(P.ManageGuild)) throw new Error("Permission Gérer le serveur requise.");
        const chosenRole = interaction.options.getRole?.("role") ?? null;
        if (chosenRole) {
          // Configure verification from Discord: enable it with this role (and this channel).
          const bot = guild.members.me ?? await guild.members.fetchMe();
          if (chosenRole.id === guild.id || chosenRole.managed) throw new Error("Choisis un vrai rôle (pas @everyone ni un rôle de bot).");
          if (chosenRole.position >= bot.roles.highest.position) throw new Error("Place mon rôle au-dessus du rôle choisi, sinon je ne pourrai pas le donner.");
          if (!api?.apiUrl || !api?.secret) throw new Error("Réglage impossible pour le moment : connexion au dashboard indisponible.");
          const panelChannel = interaction.options.getChannel("salon");
          const next = {
            enabled: true, channelId: null, minAccountAgeDays: 0, message: "",
            ...(settings.verification ?? {}),
            ...{ enabled: true, roleId: chosenRole.id, ...(panelChannel ? { channelId: panelChannel.id } : {}) },
          };
          const saved = await updateModuleSettings({ apiUrl: api.apiUrl, secret: api.secret, guildId: guild.id, module: "verification", value: next, actorId: interaction.user.id });
          Object.assign(settings, saved);
        }
        if (!settings.verification?.enabled || !settings.verification?.roleId) {
          throw new Error("La vérification n’est pas encore réglée : relance avec l’option role, par exemple /verify panel role:@Vérifié salon:#verif.");
        }
        const configured = settings.verification?.channelId;
        const channel = interaction.options.getChannel("salon")
          ?? (configured ? await guild.channels.fetch(configured).catch(() => null) : null)
          ?? interaction.channel;
        if (!channel?.isTextBased()) throw new Error("Choisis un salon textuel.");
        const embed = new EmbedBuilder()
          .setColor(0x6d28d9)
          .setTitle("✅ Vérification")
          .setDescription(settings.verification?.message || "Résous le petit calcul pour confirmer que tu es humain.");
        await channel.send({
          embeds: [embed],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("verify:start").setLabel("Commencer la vérification").setEmoji("🧩").setStyle(ButtonStyle.Success),
          )],
          allowedMentions: { parse: [] },
        });
        await interaction.reply({ content: `✅ Panneau de vérification envoyé dans <#${channel.id}>.`, ephemeral: true });
        return true;
      }
      await startVerificationChallenge(interaction, settings);
      return true;
    }

    await interaction.deferReply({ ephemeral: true });

    if (command === "warnings") {
      const user = interaction.options.getUser("membre") ?? interaction.user;
      if (user.id !== interaction.user.id && !actor.permissions.has(P.ManageMessages)) throw new Error("Permission Gérer les messages requise pour consulter un autre membre.");
      const rows = activeWarnings(db.prepare("SELECT * FROM moderation_warnings WHERE guild_id=? AND user_id=? ORDER BY id DESC LIMIT 10").all(guild.id, user.id));
      const cases = listModerationCases(guild.id, user.id, 10);
      const warningLines = rows.slice(0, 5).map((warning) => `• Avertissement #${warning.id} · <t:${Math.floor(Number(warning.created_at) / 1000)}:d> · ${warning.reason.slice(0, 80)}`);
      const caseLines = cases.slice(0, 5).map((item) => `• Dossier #${item.id} ${item.action.toUpperCase()} · <t:${Math.floor(item.createdAt / 1000)}:d> · ${item.reason.slice(0, 80)} (par <@${item.moderatorId}>)`);
      const lines = [...warningLines, ...caseLines];
      const appealRows = user.id === interaction.user.id
        ? cases.filter((item) => APPEALABLE_ACTIONS.has(item.action) && Date.now() - item.createdAt <= APPEAL_WINDOW_MS)
          .slice(0, 5).map((item) => appealButton(item.id).toJSON())
        : [];
      await interaction.editReply({
        content: lines.length ? `📁 **Historique de <@${user.id}>**\n${lines.join("\n")}` : `✅ Aucun avertissement actif ni dossier enregistré pour <@${user.id}>.`,
        components: appealRows,
        allowedMentions: { parse: [] },
      });
      return true;
    }

    if (command === "purge") {
      if (!actor.permissions.has(P.ManageMessages)) throw new Error("Permission Gérer les messages requise.");
      if (!interaction.channel?.isTextBased() || typeof interaction.channel.bulkDelete !== "function") throw new Error("Cette commande doit être utilisée dans un salon textuel.");
      const amount = interaction.options.getInteger("nombre", true);
      const deleted = await interaction.channel.bulkDelete(amount, true);
      await confirm(interaction, `🧹 ${deleted.size} message(s) supprimé(s).`);
      return true;
    }

    if (command === "slowmode") {
      if (!actor.permissions.has(P.ManageMessages)) throw new Error("Permission Gérer les messages requise.");
      if (!interaction.channel || !("setRateLimitPerUser" in interaction.channel)) throw new Error("Salon incompatible.");
      const seconds = interaction.options.getInteger("secondes", true);
      await interaction.channel.setRateLimitPerUser(seconds, `Modération par ${interaction.user.tag}`);
      await confirm(interaction, seconds ? `🐢 Mode lent réglé sur ${seconds} seconde(s).` : "🐇 Mode lent désactivé.");
      return true;
    }

    if (command === "lock" || command === "unlock") {
      if (!actor.permissions.has(P.ManageChannels)) throw new Error("Permission Gérer les salons requise.");
      if (!interaction.channel?.permissionOverwrites) throw new Error("Salon incompatible.");
      const locked = command === "lock";
      await interaction.channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: locked ? false : null }, { reason: `Modération par ${interaction.user.tag}` });
      await confirm(interaction, locked ? "🔒 Salon verrouillé." : "🔓 Salon déverrouillé.");
      return true;
    }

    const user = interaction.options.getUser("membre", true);
    const target = await targetMember(guild, user);
    const reason = sanitizeReason(interaction.options.getString("raison") ?? "");
    const bot = api?.bot ?? "fwu";
    const common = { guild, actor, command, bot, targetId: user.id, targetMember: target, targetUser: user, reason, settings, recordCase: recordModerationCase, appealButton };

    // warn / unmute / kick / ban : accès par palier de rôle + quota partagé (shared/).
    if (command === "warn") {
      const days = interaction.options.getInteger("expire") ?? 0;
      const expiresAt = warningExpiry(Date.now(), days) ?? null;
      const { caseId } = await runModerationAction({
        ...common,
        notify: settings.moderation?.dmOnWarn !== false,
        execute: async () => {
          db.prepare("INSERT INTO moderation_warnings(guild_id,user_id,moderator_id,reason,created_at,expires_at) VALUES(?,?,?,?,?,?)")
            .run(guild.id, user.id, interaction.user.id, reason, Date.now(), expiresAt);
        },
      });
      const count = db.prepare("SELECT COUNT(*) AS count FROM moderation_warnings WHERE guild_id=? AND user_id=? AND (expires_at IS NULL OR expires_at>?)").get(guild.id, user.id, Date.now()).count;
      await confirm(interaction, `⚠️ ${caseId ? `Dossier #${caseId} · ` : ""}<@${user.id}> averti (${count} actif(s)) : ${reason}`);
      return true;
    }

    if (command === "unmute") {
      if (!target) throw new Error("Ce membre n’est pas sur le serveur.");
      const { caseId } = await runModerationAction({ ...common, execute: () => target.timeout(null, reason) });
      await confirm(interaction, `🔊 ${caseId ? `Dossier #${caseId} · ` : ""}exclusion retirée à <@${user.id}>.`);
      return true;
    }

    if (command === "kick") {
      if (!target) throw new Error("Ce membre n’est pas sur le serveur.");
      const { caseId } = await runModerationAction({ ...common, execute: () => target.kick(reason) });
      await confirm(interaction, `👢 ${caseId ? `Dossier #${caseId} · ` : ""}<@${user.id}> expulsé.`);
      return true;
    }

    if (command === "ban") {
      const { caseId } = await runModerationAction({ ...common, execute: () => guild.members.ban(user.id, { reason, deleteMessageSeconds: 0 }) });
      await confirm(interaction, `🔨 ${caseId ? `Dossier #${caseId} · ` : ""}<@${user.id}> banni.`);
      return true;
    }
  } catch (error) {
    const message = `❌ ${error instanceof Error ? error.message : "Action impossible."}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: message }).catch(() => {});
    else await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    return true;
  }

  return true;
}

const challengeHash = (guildId, userId, answer) => createHash("sha256").update(`${guildId}:${userId}:${answer}`).digest();

async function startVerificationChallenge(interaction, settings) {
  const verification = settings?.verification;
  if (!verification?.enabled || !verification.roleId || !interaction.guild) {
    await interaction.reply({ content: "La vérification n’est pas configurée sur ce serveur.", ephemeral: true });
    return;
  }
  const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return interaction.reply({ content: "Profil Discord introuvable.", ephemeral: true });
  const role = await interaction.guild.roles.fetch(verification.roleId).catch(() => null);
  if (!role || role.id === interaction.guild.id || role.managed) return interaction.reply({ content: "Le rôle de vérification est introuvable ou protégé. Préviens le staff.", ephemeral: true });
  const botMember = await interaction.guild.members.fetchMe({ force: true }).catch(() => null);
  if (!botMember?.permissions.has(P.ManageRoles) || role.position >= botMember.roles.highest.position) {
    return interaction.reply({ content: "La configuration du rôle est incorrecte : le bot doit avoir Gérer les rôles et être placé au-dessus du rôle Vérifié.", ephemeral: true });
  }
  if (member.roles.cache.has(role.id)) return interaction.reply({ content: "✅ Tu es déjà vérifié.", ephemeral: true });
  const eligibility = verificationEligible(interaction.user.createdAt, Date.now(), verification.minAccountAgeDays);
  if (!eligibility.eligible) return interaction.reply({ content: `⛔ Vérification refusée : ${eligibility.reason}.`, ephemeral: true });

  const a = randomInt(2, 10), b = randomInt(2, 10), answer = String(a + b);
  const now = Date.now();
  db.prepare(`INSERT INTO verification_challenges(guild_id,user_id,answer_hash,attempts,expires_at,created_at)
    VALUES(?,?,?,0,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET answer_hash=excluded.answer_hash,attempts=0,expires_at=excluded.expires_at,created_at=excluded.created_at`)
    .run(interaction.guild.id, interaction.user.id, challengeHash(interaction.guild.id, interaction.user.id, answer).toString("hex"), now + 5 * 60_000, now);

  const modal = new ModalBuilder().setCustomId("verify:answer").setTitle("Vérification humaine");
  const input = new TextInputBuilder().setCustomId("answer").setLabel(`Combien font ${a} + ${b} ?`).setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(3).setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function submitVerificationChallenge(interaction, settings) {
  const guild = interaction.guild;
  if (!guild || !settings?.verification?.enabled || !settings.verification.roleId) {
    await interaction.reply({ content: "La vérification n’est pas active.", ephemeral: true });
    return;
  }
  const row = db.prepare("SELECT * FROM verification_challenges WHERE guild_id=? AND user_id=?").get(guild.id, interaction.user.id);
  const now = Date.now();
  if (!row || Number(row.expires_at) <= now) {
    db.prepare("DELETE FROM verification_challenges WHERE guild_id=? AND user_id=?").run(guild.id, interaction.user.id);
    await interaction.reply({ content: "⏳ Défi expiré. Clique à nouveau sur le bouton pour recommencer.", ephemeral: true });
    return;
  }
  const supplied = interaction.fields.getTextInputValue("answer").trim();
  const expected = Buffer.from(row.answer_hash, "hex");
  const actual = challengeHash(guild.id, interaction.user.id, supplied);
  const correct = expected.length === actual.length && timingSafeEqual(expected, actual);
  if (!correct) {
    const attempts = Number(row.attempts) + 1;
    if (attempts >= 3) {
      db.prepare("DELETE FROM verification_challenges WHERE guild_id=? AND user_id=?").run(guild.id, interaction.user.id);
      await interaction.reply({ content: "❌ Trois réponses incorrectes. Recommence avec le bouton de vérification.", ephemeral: true });
    } else {
      db.prepare("UPDATE verification_challenges SET attempts=? WHERE guild_id=? AND user_id=?").run(attempts, guild.id, interaction.user.id);
      await interaction.reply({ content: `❌ Mauvaise réponse. Il te reste ${3 - attempts} tentative(s).`, ephemeral: true });
    }
    return;
  }

  const [freshMember, role, botMember] = await Promise.all([
    guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null),
    guild.roles.fetch(settings.verification.roleId, { force: true }).catch(() => null),
    guild.members.fetchMe({ force: true }).catch(() => null),
  ]);
  if (!freshMember || !role || role.id === guild.id || role.managed) return interaction.reply({ content: "Membre ou rôle de vérification introuvable, ou rôle protégé. Préviens le staff.", ephemeral: true });
  if (!botMember?.permissions.has(P.ManageRoles) || role.position >= botMember.roles.highest.position) {
    return interaction.reply({ content: "Je ne peux pas attribuer ce rôle : vérifie ma permission Gérer les rôles et ma position dans la hiérarchie.", ephemeral: true });
  }
  try {
    if (freshMember.roles.cache.has(role.id)) {
      db.prepare("DELETE FROM verification_challenges WHERE guild_id=? AND user_id=?").run(guild.id, interaction.user.id);
      return interaction.reply({ content: "✅ Tu es déjà vérifié.", ephemeral: true });
    }
    await freshMember.roles.add(role, "CAPTCHA validé");
    db.prepare("DELETE FROM verification_challenges WHERE guild_id=? AND user_id=?").run(guild.id, interaction.user.id);
    const embed = new EmbedBuilder().setColor(0x22c55e).setTitle("✅ CAPTCHA réussi")
      .setDescription(`<@${interaction.user.id}> a terminé la vérification.`).setTimestamp(new Date());
    await sendCentralLog(guild, settings, embed).catch(() => {});
    await interaction.reply({ content: "✅ Vérification réussie, bienvenue sur le serveur !", ephemeral: true });
  } catch {
    await respondInPlaceSafe(interaction, { content: "Impossible d’attribuer le rôle. Vérifie la hiérarchie des rôles.", ephemeral: true });
  }
}
