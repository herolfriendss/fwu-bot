// Bot Discord 24h/24 — à lancer sur ton VPS. Les réglages viennent du site (onglet « Bot 24h/24 »).
import { Client, GatewayIntentBits, Partials, PermissionFlagsBits, REST } from "discord.js";
import { existsSync } from "node:fs";
// The dashboard and the Oracle bot share one command definition file. In the
// repository it lives in ../src/lib; the public source archive ships a copy at
// the bot root so an isolated installation also works.
const sharedSlashCommands = new URL("../src/lib/slash-commands.ts", import.meta.url);
const localSlashCommands = new URL("./slash-commands.ts", import.meta.url);
const slashCommandsModule = await import((existsSync(sharedSlashCommands) ? sharedSlashCommands : localSlashCommands).href);
const { SLASH_COMMANDS, slashCommandsByCategory, toDiscordCommand } = slashCommandsModule;
const EXTRA_SLASH_COMMANDS = slashCommandsModule.EXTRA_SLASH_COMMANDS ?? [];
import { resolvePrefixCommand } from "./prefix-commands.js";
import { handleVoiceMessage, handleVoiceInteraction, handleMenotteVoiceState, reconcileVoiceMenottes, expireVoiceMenottes, forgetVoicePanels, reconcilePrivateVoiceLocks } from "./voice-commands.js";
import { handleAntiMoveVoiceState, primeAntiMoveAuditSnapshots } from "./anti-move.js";
import { handleTier0Ban, handleTier0Kick, handleTier0MemberUpdate, handleTier0VoiceState, primeTier0Members } from "./tier0-shield.js";
import { recoverInterruptedRankAllJobs } from "./rankall-runner.js";
import { reportInteractionFailure } from "./interaction-reply.js";
import { labelPermissions, newlyGrantedDangerous, newlyRiskyOverwrites } from "./acl-risk.js";
import { buildHealthReport, registerHealthProvider } from "./health-report.js";
import { expireVoiceAccessRequests } from "./voice-access-store.js";
import { handleSysPlusMessage, handleSysPlusInteraction } from "./systems/sysplus/commands.js";
import { handlePackInteraction } from "./systems/entitlements/commands.js";
import { handleMarketInteraction } from "./systems/marketplace/commands.js";
import { createClientStudioSender, publishDueDrafts, recoverInterruptedStudioPublishes } from "./creator-studio.js";
import { handleWhitelistInteraction } from "./systems/sysplus/whitelist-commands.js";
import { enforceProtectedNickname, handleLocknameInteraction, handleLocknameMessage, reconcileProtectedNicknames } from "./systems/lockname/commands.js";
import { expireWaoufActions, handleWaoufInteraction, handleWaoufMessage } from "./systems/waouf/commands.js";
import { enforceLeashNickname, handleDogCommand, handleLeashVoiceState, handleUndogAllInteraction, reconcileLeashedMembers } from "./dog-commands.js";
import { handleMusicExtrasInteraction, handleMusicMessage, handleMusicInteraction, handleRadioMessage, startConfiguredRadios } from "./music/music.js";
import { economySnapshot, handleEconomyMessage, handleEconomyInteraction, reconcilePendingEconomy, recoverBlackjackGames, settleExpiredEconomyAuctions, transferEconomyRole } from "./economy.js";
import { handleV4SlashInteraction, runPrefixFromSlash } from "./v4-commands.js";
import { handleSocialMessage } from "./social.js";
import { handleCardsMessage } from "./cards.js";
import { handleGuildGuardInteraction } from "./guild-guard-commands.js";
import { enforceGuildAllowlist, guildAllowed, handleGuildCreate, handleGuildGuardJoin, parseGuildAllowlist } from "./guild-guard.js";
import { handleModerationInteraction } from "./moderation.js";
import { handleReactionVerificationCommand, handleReactionVerificationReaction } from "./reaction-verification.js";
import { shouldApplySpamLimit } from "./spam-policy.js";
import { enforceMentionFlood } from "./spam-runtime.js";
import { handleGuardianReviewMessage, recordGuardianMessageRisk, pruneGuardianRiskSignals, pruneGuardianReviews } from "./guardian-risk.js";
import { handleVoiceV2Interaction, handleVoiceV2State, forgetGuildTempVoices, forgetTempVoice, reconcileTempVoices } from "./voice-v2.js";
import { handleGamesInteraction, handleGamesMessage, startGamesScheduler } from "./games.js";
import { handleTicketChannelDelete, handleTicketsInteraction, handleTicketsMessage } from "./tickets.js";
import { purgeExpiredTranscripts } from "./ticket-records.js";
import { handleKnowledgeInteraction, handleKnowledgeMessage } from "./pnd-knowledge.js";
import { handleAutomationInteraction, handleAutomationJoin, handleAutomationMessage, startAutomationScheduler } from "./automation.js";
import { handleRoleInteraction, handleRoleMessage } from "./role-commands.js";
import { handleCustomRolesInteraction, handleCustomRolesMessage } from "./systems/sysplus/custom-roles.js";
import { handleCasinoMessage } from "./casino.js";
import { handleCasinoInteraction } from "./casino/commands.js";
import { runCascade, startCascade } from "./cascade.js";
import { handleConfessionInteraction } from "./features/confessions-commands.js";
import { handleAnimationInteraction, handleCountingDelete, handleCountingMessage, handleStarboardReaction } from "./features/animation-commands.js";
import { runQotd } from "./features/qotd.js";
import { handleOverviewInteraction } from "./features/overview.js";
import { handleClanInteraction } from "./features/clans-commands.js";
import { handleQuestInteraction } from "./features/quests-commands.js";
import { handlePerkInteraction } from "./features/perks-commands.js";
import { removeColourRole } from "./features/perks.js";
import { pruneEvents } from "./event-bus.js";
import { handleBusinessInvestmentMessage } from "./business-investments-commands.js";
import { startInvestmentMaintenance } from "./business-investments-maintenance.js";
import { handlePndIntelligenceMessage, handlePndIntelligenceInteraction, expirePendingPndIntelligenceActions, recoverInterruptedPndIntelligenceActions } from "./pnd-intelligence.js";
import { handleOrganizationMessage } from "./organization-commands.js";
import { startOrganizationMaintenance } from "./organization-maintenance.js";
import { recordAnalyticsMetric, flushAnalyticsMetrics } from "./analytics-buffer.js";
import { installProcessGuard } from "./process-guard.js";
import { autoIncidentNotice, recordGuardIncident } from "./systems/sysplus/auto-incidents.js";
import { setSysPlusAuditObserver } from "./systems/sysplus/audit.js";
import { freezeRefusal, startFreezeRefresh } from "./staff-freeze-gate.js";
import { startFreezeExpiry } from "./systems/sysplus/freeze-commands.js";
import { startStaffAbuseAlerts } from "./systems/sysplus/abuse-alerts.js";
import { recoverInterruptedAutomationRuns } from "./automation-rules.js";
import { handleAutomationRulesMessage } from "./automation-rules-commands.js";
import { previewGuildAutomationRules, previewScheduledAutomationRules, buildAutomationEventFromMember } from "./automation-rules-runtime.js";
import { handleVoicePresenceMessage, reconcileActiveVoiceSessions, trackVoiceStateUpdate } from "./voice-audit.js";
import { handleStaffMemberHistoryMessage } from "./staff-audit.js";
import { captureGuildInviteSnapshot, resolveMemberInvite, recordMemberInvite, recordInviteLifecycle } from "./invite-attribution.js";
import { addCentralLogObserver, setCentralLogRelay, systemLogEmbed, sendCentralLog } from "./logs.js";
import { BOT_PROFILES, LEASE_RENEW_MS, createDomainGate, enqueueRelayedLog, loadBotPrefixes, parsePrefixedMessage, resolveBotRuntime, slashCommandOwner, slashRegistrationPlan, takeRelayedLogs, requeueRelayedLog, countLostRelayedLogs } from "./bot-runtime.js";
import { handleLiveInteraction, handleLiveMessage } from "./live-commands.js";
import { prefixifyPayload, slashifyPayload } from "./prefix-to-slash.js";
import { enforceBlacklistOnJoin, handleBlacklistInteraction, handleBlacklistMessage, isBlacklisted } from "./blacklist.js";
import { handleDmAllInteraction, handleDmAllMessage, recoverInterruptedDmAllJobs } from "./dmall.js";
import { handleResumeInteraction, handleResumeMessage, pruneResumeEvents, recordResumeEvent } from "./resume.js";
import { handleStaffModerationInteraction, STAFF_COMMANDS } from "./staff-moderation.js";
import { handleGuardPrefixCommand } from "./guard-commands.js";
import { handleVoiceMoveCommand } from "./voice-move.js";
import { handleEmbedInteraction, EMBED_COMMANDS } from "./embeds.js";
import { SHARED_DB_ALERTS, startSharedLayer } from "./shared/index.js";
import { startUsageRetention } from "./shared/retention.js";
import { logCommandUsage } from "./shared/audit.js";
import { getVoiceConnections } from "@discordjs/voice";
import { hasAiMemoryConsent, setAiMemoryConsent } from "./ai-memory-preferences.js";
import { canUseAiMemory } from "./ai-memory-policy.js";
import { describePndAiFailure } from "./ai-error-messages.js";
import { checkLiveAlerts } from "./live-alerts.js";
import { handleWebhookInteraction } from "./webhooks.js";
import { handlePanelSetupInteraction } from "./systems/setup/panel-setup.js";
import { getPndPrivilegedIds } from "./pnd-owner-policy.js";
import { checkInteractionHierarchy } from "./hierarchy-guard.js";
import { createAntiNuke, registerBotIdentity } from "./guard/anti-nuke.js";
import { createAutomod } from "./guard/automod.js";
import { handleShieldInteraction, checkHoneypotMessage } from "./guard/shield-commands.js";
import { runAutoconfig } from "./autoconfig.js";
import { handleGuardInteraction } from "./guard/commands.js";
import { communityAutoconfig, handleCommunityInteraction, handleLevelMessage, runBirthdays, runReminders, tickVoiceXp } from "./features/community.js";
import { handleFiscInteraction, runLoanCollection, runWealthTax } from "./features/fisc.js";
import { announceUpdateResult, handleSelfUpdateInteraction } from "./features/self-update.js";
import { handleSuckmeInteraction, ladderOf, runAnnouncements, runTempRoles, saveLadder } from "./features/suckme.js";
import { armSlowCommandWatchdog } from "./interaction-watchdog.js";
import { STAFF_ONLY_MESSAGE, isServerStaff } from "./server-staff.js";
import { installOwnerShield, runAsActor } from "./owner-shield.js";
import { assertOwnerConfig } from "./owner-config.js";
import { db } from "./database.js";
import { clearConnectedMarker, clearGatewayFailures, createGatewayWatchdog, recordGatewayFailure, writeConnectedMarker } from "./gateway-watchdog.js";
import { LOGS_HUB_GUILD_ID, ACTIVE_SOURCE_GUILD_IDS, allowedRuntimeGuild, filterInactiveSourceGuilds, isLogsHub, provisionLogsHub } from "./logs-hub.js";

const { SITE_URL, BOT_SYNC_SECRET } = process.env;
// FWU multi-bot: PND_BOT_PROFILE selects the application (fwu by default, the
// historical one). See src/lib/bot-profiles.ts and bot-runtime.js.
let RUNTIME;
try { RUNTIME = resolveBotRuntime(process.env); } catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}
const DISCORD_TOKEN = RUNTIME.token;
if (!DISCORD_TOKEN || !SITE_URL || !BOT_SYNC_SECRET) {
  console.error(`❌ Remplis ${RUNTIME.config.tokenEnv}, SITE_URL et BOT_SYNC_SECRET dans le fichier .env`);
  process.exit(1);
}
const IS_FWU = RUNTIME.profile === "fwu";
// Owner decision (24/11/2026, replaces the slash-only decision of 23/11): every
// bot has its own prefix (bot/config/bots.json); FWU stays slash only. A command
// exists on its owning bot only: no other bot answers it, even as a fallback.
let BOT_PREFIXES;
try { BOT_PREFIXES = loadBotPrefixes(process.env); } catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}
const OWN_PREFIX = BOT_PREFIXES[RUNTIME.profile];
const BOT_LABEL = RUNTIME.config.label;
// One gate per process: serves(domain) says whether this process handles that
// domain right now. With no dedicated bot running, FWU serves everything.
const gate = createDomainGate({ profile: RUNTIME.profile });
const serves = (domain) => gate.serves(domain);
// A dedicated bot takes over its domain only once it is connected AND present on every
// protected server. Otherwise FWU keeps handling it: no protection gap if, for example,
// GUARD was never invited or got kicked from a server.
function dedicatedBotReady() {
  if (!client?.isReady?.()) return false;
  const servers = ALLOWED_GUILDS.filter((guildId) => !isLogsHub(guildId));
  return servers.length > 0 && servers.every((guildId) => client.guilds.cache.has(guildId));
}
function tickDomainLease() {
  if (IS_FWU) return gate.tick();
  if (dedicatedBotReady()) return gate.tick();
  if (gate.held) gate.release(); // FWU takes the domain back within a minute
  return false;
}
if (IS_FWU) gate.tick();
if (!IS_FWU) {
  setInterval(() => { tickDomainLease(); }, LEASE_RENEW_MS).unref?.();
  // Dedicated bots hand their logs to FWU (Logs Hub owner, RESUME source).
  setCentralLogRelay(({ guild, embed, fallbackChannelIds, components, allowedUserIds }) => enqueueRelayedLog({
    guildId: guild.id, sourceProfile: RUNTIME.profile, embed, fallbackChannelIds, components, allowedUserIds,
  }));
} else {
  addCentralLogObserver((guild, embed) => {
    if (!guild?.id || isLogsHub(guild.id)) return;
    try { recordResumeEvent(guild.id, embed); } catch { /* RESUME never blocks a log */ }
  });
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    gate.release();
    process.exit(0);
  });
}
// Fail closed: a contradictory OWNER configuration must stop the bot before it connects.
try { assertOwnerConfig(process.env); } catch { process.exit(1); }
const API = `${SITE_URL.replace(/\/$/, "")}/api/public/bot-sync`;
const AUTH = { Authorization: `Bearer ${BOT_SYNC_SECRET}` };
const STATUS_API = `${SITE_URL.replace(/\/$/, "")}/api/public/bot-status`;
const ECONOMY_API = `${SITE_URL.replace(/\/$/, "")}/api/public/economy-snapshot`;
// Optional isolation allowlist. Empty = accept every guild, but each guild's
// data remains isolated by guild_id in SQLite and in bot_settings.
const CONFIGURED_GUILDS = filterInactiveSourceGuilds(
  parseGuildAllowlist(RUNTIME.guildAllowlist),
  process.env.PND_MZ_ENABLED === "true",
);
const ALLOWED_GUILDS = CONFIGURED_GUILDS.length ? CONFIGURED_GUILDS : [...ACTIVE_SOURCE_GUILD_IDS, LOGS_HUB_GUILD_ID];
const startedAt = new Date().toISOString();
let lastSync = null;
const events = [];
let reporting = false;
function record(code) {
  events.push({ at: new Date().toISOString(), code });
  if (events.length > 50) events.shift();
  // No raw errors, tokens, message content or member data in reports.
  console.log(`[bot] ${code}`);
}
registerHealthProvider(() => ({ events: [...events], lastSync, startedAt }));
// S1 : les actions SYS+ qui changent des droits partent aussi au Logs Hub (le bot qui agit publie).
setSysPlusAuditObserver(({ guildId, actorId, action, targetId }) => {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  auditLog(guild, settings[guildId], "🧾 Journal SYS+", `Action : \`${action}\`\nPar : <@${actorId}> (\`${actorId}\`)${targetId ? `\nCible : ${/^\d{17,20}$/.test(String(targetId)) ? `<@${targetId}> (\`${targetId}\`)` : `\`${String(targetId).slice(0, 60)}\``}` : ""}\nHistorique : \`/sysp audit\``, 0x8b5cf6);
});
// Promesses oubliées : comptées et visibles, redémarrage au-delà de 10 en 10 min (process-guard.js).
installProcessGuard({ record });
const lastHealthStatus = new Map();
function checkHealthAlerts() {
  for (const guild of client.guilds.cache.values()) {
    if (!guildAllowed(guild.id, ALLOWED_GUILDS) || isLogsHub(guild.id)) continue;
    try {
      const { evaluation, text } = buildHealthReport(client, guild);
      const previous = lastHealthStatus.get(guild.id) ?? "ok";
      lastHealthStatus.set(guild.id, evaluation.status);
      // Alert only on transition to critical (and once on recovery), never every cycle.
      if (evaluation.status === "critical" && previous !== "critical") {
        record("health_critical");
        auditLog(guild, settings[guild.id], "🩺 Santé du bot — alerte", `${IS_FWU ? "" : `Bot : **${BOT_LABEL}**\n`}${text}`.slice(0, 3500), 0xdc2626);
      } else if (previous === "critical" && evaluation.status !== "critical") {
        auditLog(guild, settings[guild.id], "🩺 Santé du bot — rétablie", `${IS_FWU ? "" : `Bot : **${BOT_LABEL}**\n`}${text}`.slice(0, 3500), 0x22c55e);
      }
    } catch { record("health_check_error"); }
  }
}
async function reportStatus() {
  // Every FWU bot reports its own status; dedicated bots are stored in their own row.
  if (reporting) return;
  reporting = true;
  try {
    const res = await fetch(STATUS_API, {
      method: "POST", headers: { ...AUTH, "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        ...(IS_FWU ? {} : { profile: RUNTIME.profile }),
        connected: client.isReady(),
        startedAt,
        lastSync,
        events,
        guilds: client.guilds.cache
          .filter((guild) => guildAllowed(guild.id, ALLOWED_GUILDS) && !isLogsHub(guild.id))
          .map((guild) => ({
            id: guild.id,
            name: guild.name,
            icon: guild.icon,
          })),
      }),
    });
    noteStatusDelivery(res.ok ? null : `HTTP ${res.status}`);
  } catch (error) { noteStatusDelivery(error?.name === "TimeoutError" ? "délai dépassé (10 s)" : "site injoignable"); }
  finally { reporting = false; }
}
// Log status delivery problems once per outage (with the reason), not on every attempt.
let statusFailures = 0;
function noteStatusDelivery(problem) {
  if (!problem) {
    if (statusFailures >= 3) console.error(`Statut de nouveau transmis au site (après ${statusFailures} échecs).`);
    statusFailures = 0;
    return;
  }
  statusFailures += 1;
  // A single miss happens while the site restarts: only report from the third one in a row.
  if (statusFailures === 3) console.error(`Envoi du statut impossible : ${problem}. Le bot continue ; le site affichera un état ancien jusqu'au retour.`);
}
record("started");
if (serves("fisc")) recoverBlackjackGames();

let settings = {}; // { [guildId]: BotSettings }

async function sync() {
  try {
    const res = await fetch(API, { headers: AUTH, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    settings = (await res.json()).guilds ?? {};
    lastSync = new Date().toISOString();
    record("sync_ok");
  } catch {
    record("sync_error");
  }
  await reportStatus();
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasWord = (text, w) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w)}($|[^\\p{L}\\p{N}])`, "u").test(text);
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
const noMentions = { parse: ["users"] };
const ECONOMY_V4_COMMANDS = new Set(["pnd", "pnd-add", "pnd-remove", "pnd-history", "pnd-audit", "balance", "daily", "pay", "shop", "buy", "inventory", "leaderboard"]);

function auditLog(guild, settingsForGuild, title, description, color = 0xe21d2f) {
  if (!guild || isLogsHub(guild.id)) return;
  const embed = systemLogEmbed({ title, description: `Serveur source : **${guild.name}** (\`${guild.id}\`)\n${description}`, color });
  // sendCentralLog routes to the isolated Logs Hub and, when configured, the
  // legacy local channel. Keep one call so events are never duplicated.
  void sendCentralLog(guild, settingsForGuild, embed).catch(() => record("central_log_error"));
}

function auditPrefixUsage(message, category) {
  const command = String(message.content ?? "").trim().split(/\s+/, 1)[0].slice(0, 40);
  void logCommandUsage({ guildId: message.guild.id, userId: message.author.id, bot: RUNTIME.profile, command: `${OWN_PREFIX ?? "="}${command.replace(/^=/, "")}`, outcome: "ok", detail: category });
  auditLog(message.guild, settings[message.guild.id], `⚙️ ${category} — commande utilisée`,
    `Membre : <@${message.author.id}>\nCommande : \`${command}\`\nSalon : <#${message.channel.id}>`);
}

function auditSlashUsage(interaction, category) {
  if (!interaction.guildId || !interaction.guild) return;
  let action = "interaction de panneau";
  if (interaction.isChatInputCommand()) {
    let subcommand = "";
    try { subcommand = interaction.options.getSubcommand(false) ?? ""; } catch { /* no subcommand */ }
    action = `/${interaction.commandName}${subcommand ? ` ${subcommand}` : ""}`;
  } else if (interaction.isButton?.()) action = "bouton de panneau";
  else if (interaction.isStringSelectMenu?.() || interaction.isUserSelectMenu?.() || interaction.isRoleSelectMenu?.() || interaction.isChannelSelectMenu?.()) action = "menu de panneau";
  void logCommandUsage({ guildId: interaction.guildId, userId: interaction.user.id, bot: RUNTIME.profile, command: action.slice(0, 60), outcome: "ok", detail: category });
  auditLog(interaction.guild, settings[interaction.guildId], `⚙️ ${category} — action effectuée`,
    `Membre : <@${interaction.user.id}>\nAction : \`${action}\`\nSalon : ${interaction.channelId ? `<#${interaction.channelId}>` : "inconnu"}`);
}

// Nobody can touch the OWNER, whatever the path (commands, panels, jobs, automatic protections).
installOwnerShield({ report: () => record("owner_shield_blocked") });
const guardReport = (guild, { title, description, color }) => sendCentralLog(guild, settings[guild.id], systemLogEmbed({ title, description, color }));
const automod = createAutomod({ report: guardReport, record: (code) => record(code) });
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildInvites, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildWebhooks],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

let economyReporting = false;
let economySnapshotReported = false;
/**
 * Push a bounded economy mirror for every guild. SQLite remains authoritative;
 * the dashboard only displays these aggregates and never writes them back.
 */
async function reportEconomy() {
  if (economyReporting || !client.isReady()) return;
  economyReporting = true;
  try {
    const snapshots = client.guilds.cache
      .filter((guild) => guildAllowed(guild.id, ALLOWED_GUILDS) && !isLogsHub(guild.id))
      .map((guild) => economySnapshot(guild.id, guild));
    if (!snapshots.length) return;
    const res = await fetch(ECONOMY_API, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ snapshots }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!economySnapshotReported) {
      economySnapshotReported = true;
      record("economy_snapshot_ok");
    }
  } catch {
    record("economy_snapshot_error");
  } finally {
    economyReporting = false;
  }
}

async function clearAiMemory(guildId, userId) {
  const res = await fetch(API, {
    method: "POST",
    headers: { ...AUTH, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ action: "ai-memory-clear", guildId, userId }),
  });
  if (!res.ok) throw new Error(`AI memory clear failed (${res.status})`);
  return true;
}

async function handleAiMemoryInteraction(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "ia") return false;
  if (!interaction.guildId) {
    await interaction.reply({ content: "Cette commande doit être utilisée sur un serveur.", ephemeral: true });
    return true;
  }
  const subcommand = interaction.options.getSubcommand();
  await interaction.deferReply({ ephemeral: true });
  try {
    if (subcommand === "memoire") {
      const enabled = interaction.options.getString("etat", true) === "on";
      if (enabled && settings[interaction.guildId]?.ai?.memoryEnabled !== true) {
        await interaction.editReply("La mémoire IA est désactivée par la configuration du serveur. Ton consentement ne sera pas activé tant que l'équipe ne l'aura pas autorisée.");
        return true;
      }
      setAiMemoryConsent(interaction.guildId, interaction.user.id, enabled);
      if (!enabled) await clearAiMemory(interaction.guildId, interaction.user.id);
      await interaction.editReply(enabled
        ? "✅ Ton consentement est enregistré. FWU pourra utiliser les 12 derniers messages de contexte, pendant 30 jours maximum. Tu peux désactiver ou effacer ta mémoire à tout moment avec `/ia memoire` ou `/ia oublier`."
        : "🛑 Mémoire désactivée pour toi et historique effacé pour ce serveur.");
      if (interaction.guild) auditLog(interaction.guild, settings[interaction.guildId], enabled ? "🤖 IA — consentement mémoire activé" : "🤖 IA — consentement mémoire retiré", `Membre : <@${interaction.user.id}>`);
      return true;
    }
    if (subcommand !== "oublier") return false;
    await clearAiMemory(interaction.guildId, interaction.user.id);
    await interaction.editReply("🧹 Ta mémoire de conversation IA a été effacée pour ce serveur. Ton choix de consentement n'a pas été modifié.");
    if (interaction.guild) auditLog(interaction.guild, settings[interaction.guildId], "🧹 IA — mémoire effacée", `Membre : <@${interaction.user.id}>`);
  } catch {
    await interaction.editReply("❌ Impossible de modifier la mémoire pour le moment. Réessaie plus tard.");
  }
  return true;
}

const recent = new Map(); // anti-spam : `${guild}:${user}` -> timestamps
const guardianBursts = new Map(); // Guardian : fenêtres de risque, sans conservation du contenu
const aiRecent = new Map(); // limite les appels IA par membre et serveur
let recentMessagesSinceCleanup = 0;

function trackGuardianBurst(guildId, userId, now = Date.now()) {
  const key = `${guildId}:${userId}`;
  const active = (guardianBursts.get(key) ?? []).filter((at) => now - at >= 0 && now - at < 10_000);
  active.push(now);
  guardianBursts.set(key, active);
  if (guardianBursts.size > 5_000) {
    for (const [entryKey, timestamps] of guardianBursts) {
      const fresh = timestamps.filter((at) => now - at < 10_000);
      if (fresh.length) guardianBursts.set(entryKey, fresh);
      else guardianBursts.delete(entryKey);
    }
  }
  return active.length;
}

function pruneSpamState(now) {
  if (++recentMessagesSinceCleanup < 500) return;
  recentMessagesSinceCleanup = 0;
  for (const [key, timestamps] of recent) {
    const active = timestamps.filter((at) => now - at < 60_000);
    if (active.length) recent.set(key, active);
    else recent.delete(key);
  }
  for (const [key, timestamps] of guardianBursts) {
    const active = timestamps.filter((at) => now - at < 10_000);
    if (active.length) guardianBursts.set(key, active);
    else guardianBursts.delete(key);
  }
}

/** Replies of a prefix command show this bot's prefix instead of the canonical "=". */
function prefixifyMessageReplies(msg, prefix) {
  if (!prefix || prefix === "=" || typeof msg.reply !== "function") return;
  const original = msg.reply;
  msg.reply = (payload, ...rest) => original.call(msg, prefixifyPayload(payload, prefix), ...rest);
}

// GUARD anti-nuke: destructive actions in bulk are reverted and their author neutralised.
const antiNuke = createAntiNuke({
  client, report: guardReport, record: (code) => record(code),
  // S5 : chaque attaque bloquée ouvre (ou complète) un incident SYS+.
  onTriggered: async (guild, { executorId, action, outcome }) => {
    const result = recordGuardIncident({ guildId: guild.id, botId: client.user.id, kind: "nuke", detail: `${action} par ${executorId}, mesure : ${outcome}` });
    const notice = autoIncidentNotice(result);
    if (notice) await guardReport(guild, { title: "📋 Incident SYS+", description: notice, color: 0xf59e0b });
  },
});
const guardWatch = (guild) => guild && serves("guard") && guildAllowed(guild.id, ALLOWED_GUILDS) && !isLogsHub(guild.id);
client.on("channelDelete", (channel) => { if (guardWatch(channel.guild)) void antiNuke.channelDelete(channel).catch(() => record("antinuke_error")); });
client.on("roleDelete", (role) => { if (guardWatch(role.guild)) void antiNuke.roleDelete(role).catch(() => record("antinuke_error")); });
client.on("guildBanAdd", (ban) => { if (guardWatch(ban.guild)) void antiNuke.ban(ban).catch(() => record("antinuke_error")); });
client.on("guildMemberRemove", (member) => { if (guardWatch(member.guild)) void antiNuke.memberRemove(member).catch(() => record("antinuke_error")); });
client.on("webhooksUpdate", (channel) => { if (guardWatch(channel.guild)) void antiNuke.webhooksUpdate(channel).catch(() => record("antinuke_error")); });

// A prefix command runs on behalf of its author, like a slash command: the OWNER shield's
// rank rule (owner-shield.js) then applies to "+ban", "=rank"… exactly as to their slash form.
client.on("messageCreate", (msg) => (
  !msg.author?.bot && msg.guild && parsePrefixedMessage(msg.content, BOT_PREFIXES)
    ? runAsActor(msg.author.id, () => handleMessageCreate(msg))
    : handleMessageCreate(msg)
));

async function handleMessageCreate(msg) {
  if (msg.author.bot || !msg.guild) return;
  // Defense in depth: a guild outside the allowlist is ignored even while the
  // leave request is still in flight.
  if (!guildAllowed(msg.guild.id, ALLOWED_GUILDS) || isLogsHub(msg.guild.id)) return;
  const s = settings[msg.guild.id];
  // Command routing: a prefix command is answered only by the bot that owns it,
  // read with that bot's own prefix ("+ban" on GUARD, ";mv" on FDPDLAVOC…).
  // The handlers parse the canonical "=" form: the content is rewritten once here.
  // Passive checks (anti-spam, Guardian…) still follow the domain leases.
  const prefixed = parsePrefixedMessage(msg.content, BOT_PREFIXES);
  const ownCommand = Boolean(prefixed && prefixed.owner === RUNTIME.profile);
  if (ownCommand) {
    msg.content = prefixed.canonical;
    prefixifyMessageReplies(msg, OWN_PREFIX);
  }
  const runCmd = (...domains) => ownCommand && domains.includes(RUNTIME.profile);
  if (ownCommand) {
    const refusal = await freezeRefusal({ guildId: msg.guild.id, member: msg.member, prefixed: true, settings });
    if (refusal) { await msg.reply({ content: refusal, allowedMentions: { parse: [] } }).catch(() => {}); return; }
  }
  if (serves("fwu")) recordAnalyticsMetric(msg.guild.id, "messages");
  // GUARD trap channel: anyone writing there is handled and the message is gone.
  if (serves("guard")) {
    const caught = await checkHoneypotMessage(msg, s).catch(() => null);
    if (caught) {
      void guardReport(msg.guild, { title: "🪤 Salon piège", description: caught }).catch(() => {});
      record("guild_guard_quarantine");
      return;
    }
  }
  // GUARD automod: a removed message stops here (no XP, no other processing).
  if (serves("guard") && await automod(msg, s).catch(() => null)) return;
  if (serves("fwu")) void handleLevelMessage(msg).catch(() => record("levels_error"));
  if (serves("guard")) {
  const guardianNow = Date.now();
  const mentionCount = (msg.mentions?.users?.size ?? 0) + (msg.mentions?.roles?.size ?? 0) + (msg.mentions?.everyone ? 1 : 0);
  const linkCount = (String(msg.content ?? "").match(/\bhttps?:\/\/[^\s<>()]+/gi) ?? []).length;
  const guardianRisk = recordGuardianMessageRisk({
    guildId: msg.guild.id,
    userId: msg.author.id,
    messageId: msg.id,
    mentionCount,
    linkCount,
    rapidCount: trackGuardianBurst(msg.guild.id, msg.author.id, guardianNow),
    now: guardianNow,
  });
  if (guardianRisk.review?.created) {
    const signals = guardianRisk.assessment.signals.map((signal) => `${signal.signal} ×${signal.occurrences}`).join(", ");
    auditLog(msg.guild, s, "🛡️ Guardian — dossier à examiner", `Membre : <@${msg.author.id}>\nScore indicatif : **${guardianRisk.assessment.score}/100** (${guardianRisk.assessment.severity})\nSignaux : ${signals}\nDossier : **#${guardianRisk.review.id}**\nAucune sanction automatique n'a été appliquée. Utilise \`=guardian-review list\` pour examiner la file.` , 0xf59e0b);
    record("guardian_review_opened");
  }
  }
  if (runCmd("guard") && await handleGuardianReviewMessage(msg)) return;
  // SUCK ME animation: a number in the counting channel is handled here and stops.
  if (serves("suckme")) {
    try { if (await handleCountingMessage(msg)) return; } catch { record("counting_error"); }
  }
  if (runCmd("suckme") && await handleStaffMemberHistoryMessage(msg, { settings, ownerIds: getPndPrivilegedIds(process.env.PND_OWNER_DISCORD_ID, process.env.PND_COFOUNDER_DISCORD_IDS) })) { auditPrefixUsage(msg, "Historique staff"); return; }
  if (serves("suckme")) void previewGuildAutomationRules(msg.guild, "message_created", msg.id, {
    memberId: msg.author.id,
    memberRoleIds: msg.member?.roles?.cache ? [...msg.member.roles.cache.keys()] : [],
    accountAgeDays: msg.author.createdTimestamp ? Math.max(0, Math.floor((Date.now() - msg.author.createdTimestamp) / 86_400_000)) : null,
    channelId: msg.channelId,
  }, client, record);
  try {
    if (runCmd("guard") && await handleReactionVerificationCommand(msg)) return;
    if (serves("suckme") && await handleWaoufMessage(msg, settings, record)) return;
  } catch {
    record("waouf_error");
    return;
  }
  if (serves("guard") && s?.spam?.enabled && shouldApplySpamLimit(msg.member, s.sysPlus?.whitelistRoleId)) {
    if (await enforceMentionFlood(msg, s.spam, s.sysPlus?.whitelistRoleId, record)) return;
    const now = Date.now();
    pruneSpamState(now);
    const key = `${msg.guild.id}:${msg.author.id}`;
    const list = (recent.get(key) ?? []).filter((at) => now - at < s.spam.perSeconds * 1000);
    list.push(now);
    recent.set(key, list);
    if (list.length > s.spam.maxMessages) {
      recent.delete(key);
      try {
        await msg.member?.timeout(s.spam.timeoutMinutes * 60_000, "Anti-spam automatique");
        await msg.channel.send({ content: `🔇 <@${msg.author.id}> mis en sourdine ${s.spam.timeoutMinutes} min pour spam.`, allowedMentions: noMentions });
      } catch {
        record("spam_timeout_error");
      }
      return;
    }
  }
  if (runCmd("guard") && await handleGuardPrefixCommand(msg, s, { bot: RUNTIME.profile, record, audit: (title, description, color) => auditLog(msg.guild, s, title, description, color) })) { auditPrefixUsage(msg, "Administration GUARD"); return; }
  if (runCmd("fdpdlavoc") && await handleVoiceMoveCommand(msg, s, { bot: RUNTIME.profile, record, audit: (title, description, color) => auditLog(msg.guild, s, title, description, color) })) { auditPrefixUsage(msg, "Déplacement vocal"); return; }
  try {
    if (runCmd("suckme") && await handleResumeMessage(msg, s)) { auditPrefixUsage(msg, "RESUME"); return; }
    if (runCmd("guard") && await handleBlacklistMessage(msg, s)) { auditPrefixUsage(msg, "Blacklist"); return; }
    if (runCmd("suckme") && await handleLiveMessage(msg, settings, { apiUrl: API, secret: BOT_SYNC_SECRET })) { auditPrefixUsage(msg, "Alertes LIVE"); return; }
    if (runCmd("suckme") && await handleDmAllMessage(msg, s)) { auditPrefixUsage(msg, "DM ALL"); return; }
    if (runCmd("suckme") && await handleDogCommand(msg, s)) { auditPrefixUsage(msg, "DOG"); return; }
    if (runCmd("suckme") && await handleLocknameMessage(msg, s)) { auditPrefixUsage(msg, "LOCKNAME"); return; }
    if (runCmd("suckme") && await handleKnowledgeMessage(msg)) { auditPrefixUsage(msg, "PND Knowledge"); return; }
    if (runCmd("suckme") && await handleTicketsMessage(msg, s, { apiUrl: API, secret: BOT_SYNC_SECRET, record })) { auditPrefixUsage(msg, "Tickets"); return; }
    if (runCmd("suckme") && await handleCustomRolesMessage(msg, s)) { auditPrefixUsage(msg, "SYS+ rôles personnalisés"); return; }
    if (runCmd("suckme") && await handleRoleMessage(msg, s)) return;
    if (runCmd("fdpdlavoc") && await handleRadioMessage(msg)) { auditPrefixUsage(msg, "Radio"); return; }
    if (runCmd("fdpdlavoc") && await handleMusicMessage(msg)) { auditPrefixUsage(msg, "Musique"); return; }
    // voice-commands.js serves both FDPDLAVOC (=pv, =access…) and SUCK ME (=menotte, =wakeup…).
    if (runCmd("fdpdlavoc", "suckme") && await handleVoiceMessage(msg, s)) { auditPrefixUsage(msg, "Commandes vocales"); return; }
    if (runCmd("fisc") && await handleEconomyMessage(msg, s)) { auditPrefixUsage(msg, "Économie PND"); return; }
    if (runCmd("fisc") && await handleBusinessInvestmentMessage(msg)) { auditPrefixUsage(msg, "Entreprises et investissements"); return; }
    if (runCmd("suckme") && await handlePndIntelligenceMessage(msg, { apiUrl: API, secret: BOT_SYNC_SECRET, instructions: s?.ai?.instructions ?? "", settings, ownerIds: getPndPrivilegedIds(process.env.PND_OWNER_DISCORD_ID, process.env.PND_COFOUNDER_DISCORD_IDS) })) { auditPrefixUsage(msg, "PND Intelligence"); return; }
    if (runCmd("suckme") && await handleAutomationRulesMessage(msg)) { auditPrefixUsage(msg, "Règles d'automatisation"); return; }
    if (runCmd("suckme") && await handleOrganizationMessage(msg, { settings, ownerIds: getPndPrivilegedIds(process.env.PND_OWNER_DISCORD_ID, process.env.PND_COFOUNDER_DISCORD_IDS) })) { auditPrefixUsage(msg, "Communauté / PND"); return; }
    if (runCmd("suckme") && await handleSocialMessage(msg)) { auditPrefixUsage(msg, "Social"); return; }
    if (runCmd("fisc") && await handleCardsMessage(msg)) { auditPrefixUsage(msg, "Cartes"); return; }
    if (runCmd("suckme", "fisc") && await handleGamesMessage(msg, record)) { auditPrefixUsage(msg, "Jeux"); return; }
    if (runCmd("fisc") && await handleCasinoMessage(msg)) { auditPrefixUsage(msg, "PND Casino"); return; }
    if (runCmd("suckme") && await handleVoicePresenceMessage(msg)) { auditPrefixUsage(msg, "Historique vocal"); return; }
    if (runCmd("suckme") && await handleAutomationMessage(msg, s, { apiUrl: API, secret: BOT_SYNC_SECRET, record })) { auditPrefixUsage(msg, "Automatisation"); return; }
  } catch { record("voice_error"); return; }
  if (!s) return;
  const text = msg.content.toLowerCase();
  const isMod = msg.member?.permissions.has(PermissionFlagsBits.ManageMessages);

  try {
    // 1. Filtre anti-insultes
    // GUARD acts on the insult; every bot then stops (no keyword reply to an insult).
    if (s.filter.enabled && !isMod && s.filter.words.some((w) => hasWord(text, w))) {
      if (!serves("guard")) return;
      if (s.filter.deleteMessage) await msg.delete().catch(() => {});
      if (s.filter.warn) await msg.channel.send({ content: fill(s.filter.warn, { user: `<@${msg.author.id}>` }), allowedMentions: noMentions });
      return;
    }
    const aiMemoryCommand = runCmd("suckme") ? msg.content.trim().match(/^=ia\s+memoire\s+(on|off)$/i) : null;
    if (aiMemoryCommand) {
      const enabled = aiMemoryCommand[1].toLowerCase() === "on";
      if (enabled && s.ai?.memoryEnabled !== true) {
        await msg.reply({ content: "La mémoire IA est désactivée par la configuration du serveur. Demande à l'équipe de l'autoriser d'abord.", allowedMentions: noMentions });
        return;
      }
      try {
        setAiMemoryConsent(msg.guild.id, msg.author.id, enabled);
        if (!enabled) await clearAiMemory(msg.guild.id, msg.author.id);
        await msg.reply({ content: enabled ? "✅ Ton consentement mémoire est activé. 12 messages maximum, 30 jours de rétention." : "🛑 Mémoire désactivée pour toi et historique effacé.", allowedMentions: noMentions });
        auditLog(msg.guild, s, enabled ? "🤖 IA — consentement mémoire activé" : "🤖 IA — consentement mémoire retiré", `Membre : <@${msg.author.id}>`);
      } catch {
        await msg.reply({ content: "❌ Impossible de modifier ta mémoire pour le moment.", allowedMentions: noMentions });
      }
      return;
    }
    if (runCmd("suckme") && /^=ia\s+oublier$/i.test(msg.content.trim())) {
      try {
        await clearAiMemory(msg.guild.id, msg.author.id);
        await msg.reply({ content: "🧹 Ta mémoire de conversation IA a été effacée pour ce serveur. Ton consentement n'a pas été modifié.", allowedMentions: noMentions });
        auditLog(msg.guild, s, "🧹 IA — mémoire effacée", `Membre : <@${msg.author.id}>`);
      } catch {
        await msg.reply({ content: "❌ Impossible d'effacer la mémoire pour le moment. Réessaie plus tard.", allowedMentions: noMentions });
      }
      return;
    }
    // SYS+ commands are evaluated before user-defined prefix commands.
    if (runCmd("suckme") && await handleSysPlusMessage(msg, s, { apiUrl: API, secret: BOT_SYNC_SECRET, record, audit: (guild, title, description) => auditLog(guild, settings[guild.id], title, description) })) return;
    // Dashboard prefix commands: SUCK ME answers them, with its own prefix.
    if (RUNTIME.profile === "suckme" && OWN_PREFIX && String(msg.content).trim().startsWith(OWN_PREFIX)) {
      const canonical = `=${String(msg.content).trim().slice(OWN_PREFIX.length)}`;
      const command = resolvePrefixCommand(s.prefixCommands ?? [], canonical, msg.member?.permissions.bitfield.toString() ?? "0");
      if (command) {
        await msg.reply({ content: command.content, allowedMentions: { parse: [], repliedUser: false } });
        return;
      }
    }
    // AI mentions and keywords: FWU answers alone, never to another bot's command.
    if (!serves("fwu") || prefixed) return;
    // 3. IA quand on mentionne le bot
    if (s.ai.enabled && msg.mentions.users.has(client.user.id)) {
      const prompt = msg.content.replace(/<@!?\d+>/g, "").trim().slice(0, 1500);
      if (!prompt) return;
      const aiKey = `${msg.guild.id}:${msg.author.id}`;
      const now = Date.now();
      const attempts = (aiRecent.get(aiKey) ?? []).filter((time) => now - time < 60_000);
      if (attempts.length >= 5) {
        await msg.reply({ content: "Tu as atteint la limite de 5 demandes IA par minute. Réessaie un peu plus tard.", allowedMentions: noMentions });
        return;
      }
      attempts.push(now);
      aiRecent.set(aiKey, attempts);
      if (aiRecent.size > 5_000) {
        for (const [key, values] of aiRecent) {
          const active = values.filter((time) => now - time < 60_000);
          if (active.length) aiRecent.set(key, active); else aiRecent.delete(key);
        }
      }
      await msg.channel.sendTyping();
      let reply;
      try {
        const res = await fetch(API, {
          method: "POST",
          headers: { ...AUTH, "Content-Type": "application/json" },
          signal: AbortSignal.timeout(30_000),
          body: JSON.stringify({
            prompt,
            instructions: s.ai.instructions ?? "",
            author: msg.member?.displayName ?? msg.author.username,
            guildId: msg.guild.id,
            userId: msg.author.id,
            memoryEnabled: canUseAiMemory(s.ai.memoryEnabled === true, hasAiMemoryConsent(msg.guild.id, msg.author.id)),
          }),
        });
        const data = await res.json().catch(() => ({}));
        reply = typeof data.reply === "string" && data.reply.trim()
          ? data.reply.trim()
          : describePndAiFailure(res.status, data, "chat");
      } catch (error) {
        reply = error?.name === "TimeoutError" || error?.name === "AbortError"
          ? "La réponse IA prend trop de temps. Réessaie dans un instant."
          : "Le service IA est momentanément inaccessible. Réessaie plus tard.";
      }
      if (reply.length > 1900) reply = `${reply.slice(0, 1890)}…`;
      await msg.reply({ content: reply, allowedMentions: { parse: [], repliedUser: true } });
      auditLog(msg.guild, s, "🤖 IA — demande traitée", `Membre : <@${msg.author.id}>\nCanal : <#${msg.channel.id}>\nMémoire : ${canUseAiMemory(s.ai.memoryEnabled === true, hasAiMemoryConsent(msg.guild.id, msg.author.id)) ? "consentie" : "désactivée"}`);
      return;
    }
    // 4. Mots-clés
    for (const k of s.keywords) {
      if (k.exact ? text.trim() === k.trigger : hasWord(text, k.trigger)) {
        await msg.reply({ content: k.response, allowedMentions: { parse: [] } });
        return;
      }
    }
  } catch {
    record("message_error");
  }
}

client.on("messageDelete", (message) => {
  const guild = message.guild;
  if (serves("suckme") && guild && guildAllowed(guild.id, ALLOWED_GUILDS) && !isLogsHub(guild.id)) {
    void handleCountingDelete(message).catch(() => record("counting_error"));
  }
  if (!serves("fwu") || !guild || !guildAllowed(guild.id, ALLOWED_GUILDS) || message.author?.bot) return;
  auditLog(guild, settings[guild.id], "🗑️ Message supprimé", `Auteur : ${message.author ? `<@${message.author.id}>` : "inconnu"}\nSalon : <#${message.channelId}>\nContenu non enregistré pour préserver la confidentialité.` , 0xef4444);
});
client.on("messageDeleteBulk", (messages) => {
  const first = messages.first();
  const guild = first?.guild;
  if (!serves("fwu") || !guild || !guildAllowed(guild.id, ALLOWED_GUILDS)) return;
  auditLog(guild, settings[guild.id], "🧹 Suppression groupée de messages", `Salon : <#${first.channelId}>\nNombre de messages : **${messages.size}**\nAucun contenu n'est enregistré.`, 0xef4444);
});

client.on("messageReactionAdd", async (reaction, user) => {
  try {
    const guildId = reaction.message.guildId ?? reaction.message.guild?.id;
    if (guildId && (!guildAllowed(guildId, ALLOWED_GUILDS) || isLogsHub(guildId))) return;
    if (guildId && serves("suckme")) void handleStarboardReaction(reaction, user).catch(() => record("starboard_error"));
    if (!serves("guard")) return;
    await handleReactionVerificationReaction(reaction, user);
  } catch {
    record("verification_reaction_error");
  }
});
client.on("messageReactionRemove", (reaction, user) => {
  const guildId = reaction.message?.guildId ?? reaction.message?.guild?.id;
  if (!guildId || !guildAllowed(guildId, ALLOWED_GUILDS) || isLogsHub(guildId) || !serves("suckme")) return;
  void handleStarboardReaction(reaction, user).catch(() => record("starboard_error"));
});

client.on("inviteCreate", (invite) => {
  if (!serves("fwu") || !guildAllowed(invite.guild?.id, ALLOWED_GUILDS) || isLogsHub(invite.guild.id)) return;
  recordInviteLifecycle(invite, "create");
  auditLog(invite.guild, settings[invite.guild.id], "🔗 Invitation créée", `Code : \`${invite.code}\`\nCréateur : ${invite.inviter ? `<@${invite.inviter.id}>` : "inconnu"}\nSalon : ${invite.channel ? `<#${invite.channel.id}>` : "inconnu"}`);
});
client.on("inviteDelete", (invite) => {
  if (!serves("fwu") || !guildAllowed(invite.guild?.id, ALLOWED_GUILDS) || isLogsHub(invite.guild.id)) return;
  recordInviteLifecycle(invite, "delete");
  auditLog(invite.guild, settings[invite.guild.id], "🗑️ Invitation supprimée", `Code : \`${invite.code}\``);
});

/** Split mode only: let GUARD act first, then check the newcomer is still welcome. */
async function guildGuardCleared(member, guildSettings) {
  if (!guildSettings?.guildGuard?.enabled || member.user?.bot) return true;
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const fresh = await member.guild.members.fetch({ user: member.id, force: true }).catch((error) => (error?.code === 10007 ? null : member));
  if (!fresh) return false;
  const quarantineRoleId = guildSettings.guildGuard.quarantineRoleId;
  return !(quarantineRoleId && fresh.roles?.cache?.has?.(quarantineRoleId));
}

client.on("guildMemberAdd", async (member) => {
  if (!guildAllowed(member.guild.id, ALLOWED_GUILDS)) return;
  const s = settings[member.guild.id];
  const allDomains = gate.servesAll();
  // Blacklisted accounts are banned again before anything else (GUARD owns ban and the blacklist;
  // FWU takes this protection over while GUARD is offline).
  if (serves("guard") && await enforceBlacklistOnJoin(member, record)) {
    auditLog(member.guild, s, "⛔ Blacklist — compte rebanni à son arrivée", `Compte : <@${member.id}>\nID : \`${member.id}\``, 0xef4444);
    return;
  }
  if (!allDomains && !serves("guard") && isBlacklisted(member.guild.id, member.id)) return;
  if (serves("fwu")) recordAnalyticsMetric(member.guild.id, "joins");
  if (serves("suckme")) {
    void previewGuildAutomationRules(member.guild, "member_join", `${member.id}:${member.joinedTimestamp ?? Date.now()}`, buildAutomationEventFromMember(member), client, record);
    void enforceProtectedNickname(member, s).catch(() => record("lockname_reconcile_error"));
  }
  if (serves("fwu")) {
    const invite = await resolveMemberInvite(member.guild);
    try { recordMemberInvite(member.guild.id, member.id, invite); } catch { /* la fiche membre affichera « inconnu » */ }
    const inviteLabel = invite.source === "invite" ? `\nInvitation : ${invite.code} · créée par ${invite.inviterId ? `<@${invite.inviterId}>` : "créateur inconnu"}` : invite.source === "vanity" ? "\nInvitation : URL personnalisée du serveur" : "\nInvitation : attribution inconnue";
    auditLog(member.guild, s, "👋 Arrivée d’un membre", `Membre : <@${member.id}>\nID : \`${member.id}\`${inviteLabel}`, 0x22c55e);
  }
  if (serves("guard") && await handleGuildGuardJoin(member, s?.guildGuard ? { ...s.guildGuard, logs: s.logs } : s?.guildGuard, record)) return;
  // Split mode: GUARD decides in another process. Wait for it, then skip the
  // welcome/automation if GuildGuard kicked or quarantined the newcomer.
  if (!allDomains && !serves("guard") && !(await guildGuardCleared(member, s))) return;
  if (serves("suckme")) await handleAutomationJoin(member, s, record).catch(() => record("automation_error"));
  if (!serves("fwu")) return;
  const w = s?.welcome;
  if (!w?.enabled || !w.channelId) return;
  const channel = await member.guild.channels.fetch(w.channelId).catch(() => null);
  if (channel?.isTextBased()) {
    await channel.send({ content: fill(w.message, { user: `<@${member.id}>`, server: member.guild.name }), allowedMentions: noMentions }).catch(() => record("welcome_error"));
  }
});

client.on("guildMemberRemove", (member) => {
  if (!guildAllowed(member.guild.id, ALLOWED_GUILDS)) return;
  if (serves("suckme")) void previewGuildAutomationRules(member.guild, "member_leave", `${member.id}:${Date.now()}`, buildAutomationEventFromMember(member), client, record);
  if (serves("suckme")) void handleTier0Kick(member, { audit: (guild, title, description, color) => auditLog(guild, settings[guild.id], title, description, color), record }).catch(() => record("tier0_error"));
  if (!serves("fwu")) return;
  recordAnalyticsMetric(member.guild.id, "leaves");
  auditLog(member.guild, settings[member.guild.id], "🚪 Départ d’un membre", `Membre : <@${member.id}>\nID : \`${member.id}\``, 0xef4444);
});

client.on("guildMemberUpdate", (oldMember, newMember) => {
  if (!guildAllowed(newMember.guild.id, ALLOWED_GUILDS)) return;
  const logs = serves("fwu");
  const suckme = serves("suckme");
  const oldTimeout = oldMember.communicationDisabledUntilTimestamp ?? null;
  const newTimeout = newMember.communicationDisabledUntilTimestamp ?? null;
  if (logs && oldTimeout !== newTimeout) {
    if (newTimeout && newTimeout > Date.now()) auditLog(newMember.guild, settings[newMember.guild.id], "⏳ Exclusion temporaire appliquée", `Membre : <@${newMember.id}>\nFin : <t:${Math.floor(newTimeout / 1000)}:R>`, 0xf59e0b);
    else if (oldTimeout && oldTimeout > Date.now()) auditLog(newMember.guild, settings[newMember.guild.id], "⏳ Exclusion temporaire levée", `Membre : <@${newMember.id}>`, 0x22c55e);
  }
  if (serves("suckme")) {
    void handleTier0MemberUpdate(oldMember, newMember, { audit: (guild, title, description, color) => auditLog(guild, settings[guild.id], title, description, color), record })
      .catch(() => record("tier0_error"));
  }
  const nicknameChanged = oldMember.nickname !== newMember.nickname;
  const rolesChanged = oldMember.roles.cache.size !== newMember.roles.cache.size
    || oldMember.roles.cache.some((role) => !newMember.roles.cache.has(role.id));
  if (!nicknameChanged && !rolesChanged) return;
  if (logs && rolesChanged) {
    const added = newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id)).map((role) => role.name);
    const removed = oldMember.roles.cache.filter((role) => !newMember.roles.cache.has(role.id)).map((role) => role.name);
    auditLog(newMember.guild, settings[newMember.guild.id], "🎭 Modification des rôles", `Membre : <@${newMember.id}>\nAjoutés : ${added.join(", ") || "Aucun"}\nRetirés : ${removed.join(", ") || "Aucun"}`);
  }
  if (nicknameChanged && logs) auditLog(newMember.guild, settings[newMember.guild.id], "✏️ Pseudonyme modifié", `Membre : <@${newMember.id}>\nAvant : ${oldMember.nickname || oldMember.user.username}\nAprès : ${newMember.nickname || newMember.user.username}`);
  if (!suckme) return;
  if (nicknameChanged) {
    void enforceProtectedNickname(newMember, settings[newMember.guild.id]).then((restored) => { if (restored) record("lockname_restored"); }).catch(() => record("lockname_restore_error"));
  }
  enforceLeashNickname(newMember)
    .then((restored) => { if (restored) record("dog_nickname_restored"); })
    .catch(() => record("dog_enforcement_error"));
});

client.on("voiceStateUpdate", (oldState, newState) => {
  const guildIdForVoice = newState.guild?.id ?? oldState.guild?.id;
  if (!guildAllowed(guildIdForVoice, ALLOWED_GUILDS) || isLogsHub(guildIdForVoice)) return;
  const suckme = serves("suckme");
  if (suckme) {
  void trackVoiceStateUpdate(oldState, newState, client).catch(() => record("voice_audit_error"));
  // Rôle 0 % intouchable : micro/casque coupés annulés aussitôt, déplacement forcé ramené (Anti-Move forcé).
  const tier0Audit = (guild, title, description, color) => auditLog(guild, settings[guild.id], title, description, color);
  void handleTier0VoiceState(oldState, newState, { audit: tier0Audit, record })
    .catch(() => { record("tier0_error"); return { isProtected: false }; })
    .then(({ isProtected }) => handleAntiMoveVoiceState(oldState, newState, settings[guildIdForVoice], { force: isProtected }))
    .then((restored) => { if (restored) record("anti_move_restored"); })
    .catch(() => record("anti_move_error"));
  if (!oldState.channelId && newState.channelId) {
    const details = buildAutomationEventFromMember(newState.member);
    details.channelId = newState.channelId;
    void previewGuildAutomationRules(newState.guild, "voice_join", `voice:${newState.id}:${Date.now()}:join`, details, client, record);
  } else if (oldState.channelId && !newState.channelId) {
    const details = buildAutomationEventFromMember(oldState.member);
    details.channelId = oldState.channelId;
    void previewGuildAutomationRules(oldState.guild ?? newState.guild, "voice_leave", `voice:${newState.id}:${Date.now()}:leave`, details, client, record);
  }
  handleLeashVoiceState(oldState, newState)
    .then((moved) => { if (moved) record("dog_voice_returned"); })
    .catch(() => record("dog_voice_error"));
  void handleMenotteVoiceState(oldState, newState)
    .then((moved) => { if (moved) record("menotte_voice_returned"); })
    .catch(() => record("menotte_voice_error"));
  }
  if (!serves("fdpdlavoc")) return;
  const guildId = newState.guild?.id ?? oldState.guild?.id;
  const guildSettings = settings[guildId];
  const logTempVoice = (code) => {
    record(code);
    const guild = newState.guild ?? oldState.guild;
    if (!guild || !guildSettings?.logs?.channelId) return;
    const labels = { temp_voice_created: "Salon vocal temporaire créé", temp_voice_deleted: "Salon vocal temporaire supprimé", temp_voice_error: "Erreur Join-to-Create" };
    void sendCentralLog(guild, guildSettings, systemLogEmbed({
      title: `🎙️ Join-to-Create — ${labels[code] ?? code}`,
      description: `Événement : \`${code}\`\nMembre : <@${newState.id}>`,
      color: code === "temp_voice_error" ? 0xef4444 : 0xe21d2f,
    })).catch(() => {});
  };
  void handleVoiceV2State(oldState, newState, guildSettings, logTempVoice)
    .catch(() => logTempVoice("temp_voice_error"));
});

client.on("channelCreate", (channel) => {
  if (!serves("fwu") || !channel.guild || !guildAllowed(channel.guild.id, ALLOWED_GUILDS)) return;
  auditLog(channel.guild, settings[channel.guild.id], "➕ Salon créé", `Salon : **${channel.name}**\nID : \`${channel.id}\`\nType : \`${channel.type}\``);
});
const serializeChannelOverwrites = (channel) => [...(channel.permissionOverwrites?.cache?.values?.() ?? [])]
  .map((o) => ({ id: o.id, type: o.type, allow: o.allow?.bitfield ?? 0n, deny: o.deny?.bitfield ?? 0n }));
client.on("channelUpdate", (oldChannel, newChannel) => {
  if (!serves("fwu") || !newChannel.guild || !guildAllowed(newChannel.guild.id, ALLOWED_GUILDS) || isLogsHub(newChannel.guild.id)) return;
  if (oldChannel.name !== newChannel.name) {
    auditLog(newChannel.guild, settings[newChannel.guild.id], "✏️ Salon renommé", `Salon : <#${newChannel.id}>\nAvant : **${oldChannel.name}**\nAprès : **${newChannel.name}**`);
  }
  const before = serializeChannelOverwrites(oldChannel);
  const after = serializeChannelOverwrites(newChannel);
  const fingerprint = (list) => list.map((o) => `${o.id}:${o.allow}:${o.deny}`).sort().join("|");
  if (fingerprint(before) === fingerprint(after)) return;
  auditLog(newChannel.guild, settings[newChannel.guild.id], "🔐 Permissions d’un salon modifiées", `Salon : <#${newChannel.id}>\nOverwrites : **${before.length}** → **${after.length}**`);
  for (const risk of newlyRiskyOverwrites(before, after, newChannel.guild.id)) {
    record("acl_risk_detected");
    auditLog(newChannel.guild, settings[newChannel.guild.id], "🚨 ACL risquée sur un salon", `Salon : <#${newChannel.id}>\nBénéficiaire : ${risk.everyone ? "@everyone" : `<@${risk.id}>`}\nNouvelles autorisations : **${labelPermissions(risk.added)}**\nAucune correction automatique : vérification humaine requise.`, 0xdc2626);
  }
});
client.on("channelDelete", (channel) => {
  if (channel.guild && !guildAllowed(channel.guild.id, ALLOWED_GUILDS)) return;
  if (channel.guild && serves("fwu")) auditLog(channel.guild, settings[channel.guild.id], "➖ Salon supprimé", `Nom : **${channel.name ?? "inconnu"}**\nID : \`${channel.id}\``);
  // Local memory cleanup is harmless in every process.
  forgetTempVoice(channel.id);
  forgetVoicePanels(channel.id);
  if (serves("fwu")) handleTicketChannelDelete(channel, record);
});
client.on("roleCreate", (role) => {
  if (serves("fwu") && guildAllowed(role.guild.id, ALLOWED_GUILDS)) auditLog(role.guild, settings[role.guild.id], "🎭 Rôle créé", `Rôle : **${role.name}**\nID : \`${role.id}\``);
});
client.on("roleDelete", (role) => {
  if (serves("fwu") && guildAllowed(role.guild.id, ALLOWED_GUILDS)) auditLog(role.guild, settings[role.guild.id], "🎭 Rôle supprimé", `Rôle : **${role.name}**\nID : \`${role.id}\``);
});
client.on("roleUpdate", (oldRole, newRole) => {
  if (!serves("fwu") || !guildAllowed(newRole.guild.id, ALLOWED_GUILDS)) return;
  const changed = oldRole.name !== newRole.name || oldRole.color !== newRole.color
    || oldRole.hoist !== newRole.hoist || oldRole.mentionable !== newRole.mentionable
    || oldRole.permissions.bitfield !== newRole.permissions.bitfield;
  if (!changed) return;
  const granted = newlyGrantedDangerous(oldRole.permissions.bitfield, newRole.permissions.bitfield);
  if (granted.length) {
    record("acl_risk_detected");
    auditLog(newRole.guild, settings[newRole.guild.id], "🚨 Permission dangereuse accordée", `Rôle : ${newRole.id === newRole.guild.id ? "@everyone" : `<@&${newRole.id}>`}\nMembres concernés : **${newRole.id === newRole.guild.id ? newRole.guild.memberCount : newRole.members?.size ?? "?"}**\nNouvelles permissions : **${labelPermissions(granted)}**\nAucune correction automatique : vérification humaine requise.`, 0xdc2626);
  }
  auditLog(newRole.guild, settings[newRole.guild.id], "✏️ Rôle modifié", `Rôle : <@&${newRole.id}>\nNom : **${oldRole.name}** → **${newRole.name}**\nPermissions ou affichage modifiés : ${oldRole.permissions.bitfield !== newRole.permissions.bitfield || oldRole.hoist !== newRole.hoist || oldRole.mentionable !== newRole.mentionable ? "oui" : "non"}`);
});
client.on("guildBanAdd", (ban) => {
  if (serves("suckme") && guildAllowed(ban.guild.id, ALLOWED_GUILDS)) {
    void handleTier0Ban(ban, { audit: (guild, title, description, color) => auditLog(guild, settings[guild.id], title, description, color), record }).catch(() => record("tier0_error"));
  }
  if (serves("fwu") && guildAllowed(ban.guild.id, ALLOWED_GUILDS)) auditLog(ban.guild, settings[ban.guild.id], "⛔ Membre banni", `Membre : <@${ban.user.id}>\nID : \`${ban.user.id}\`` , 0xef4444);
});
client.on("guildBanRemove", (ban) => {
  if (!serves("fwu") || !guildAllowed(ban.guild.id, ALLOWED_GUILDS)) return;
  const stillBlacklisted = isBlacklisted(ban.guild.id, ban.user.id);
  auditLog(ban.guild, settings[ban.guild.id], "✅ Bannissement retiré", `Membre : <@${ban.user.id}>\nID : \`${ban.user.id}\`${stillBlacklisted ? "\n⚠️ Ce compte est toujours **blacklisté** : il sera rebanni s'il revient. Retire-le avec \`/blacklist remove\` si c'est voulu." : ""}` , 0x22c55e);
});
client.on("guildDelete", (guild) => { forgetGuildTempVoices(guild.id); if (!IS_FWU) tickDomainLease(); });
client.on("messageUpdate", (oldMessage, newMessage) => {
  const guild = newMessage.guild;
  if (!serves("fwu") || !guild || !guildAllowed(guild.id, ALLOWED_GUILDS) || isLogsHub(guild.id) || newMessage.author?.bot) return;
  // Embeds unfurling also emit messageUpdate: only log a real text edit. Content is never copied.
  if (oldMessage.partial || oldMessage.content == null || oldMessage.content === newMessage.content) return;
  auditLog(guild, settings[guild.id], "✏️ Message modifié", `Auteur : <@${newMessage.author?.id ?? "inconnu"}>\nSalon : <#${newMessage.channelId}>\nLien : ${newMessage.url ?? "indisponible"}\nContenu non enregistré pour préserver la confidentialité.`);
});
client.on("guildUpdate", (oldGuild, newGuild) => {
  if (!serves("fwu") || !guildAllowed(newGuild.id, ALLOWED_GUILDS) || isLogsHub(newGuild.id)) return;
  const changes = [];
  if (oldGuild.name !== newGuild.name) changes.push(`Nom : **${oldGuild.name}** → **${newGuild.name}**`);
  if (oldGuild.verificationLevel !== newGuild.verificationLevel) changes.push(`Niveau de vérification : ${oldGuild.verificationLevel} → ${newGuild.verificationLevel}`);
  if (oldGuild.explicitContentFilter !== newGuild.explicitContentFilter) changes.push(`Filtre de contenu : ${oldGuild.explicitContentFilter} → ${newGuild.explicitContentFilter}`);
  if (oldGuild.mfaLevel !== newGuild.mfaLevel) changes.push(`2FA modération : ${oldGuild.mfaLevel} → ${newGuild.mfaLevel}`);
  if (oldGuild.vanityURLCode !== newGuild.vanityURLCode) changes.push("URL personnalisée modifiée");
  if (oldGuild.ownerId !== newGuild.ownerId) changes.push(`Propriété transférée : <@${oldGuild.ownerId}> → <@${newGuild.ownerId}>`);
  if (oldGuild.icon !== newGuild.icon) changes.push("Icône modifiée");
  if (!changes.length) return;
  auditLog(newGuild, settings[newGuild.id], "⚙️ Serveur modifié", changes.join("\n"), oldGuild.ownerId !== newGuild.ownerId ? 0xdc2626 : 0xe21d2f);
});
client.on("threadCreate", (thread, newlyCreated) => {
  if (!serves("fwu") || !newlyCreated || !thread.guild || !guildAllowed(thread.guild.id, ALLOWED_GUILDS) || isLogsHub(thread.guild.id)) return;
  auditLog(thread.guild, settings[thread.guild.id], "🧵 Fil créé", `Fil : <#${thread.id}>\nSalon parent : <#${thread.parentId}>\nCréateur : ${thread.ownerId ? `<@${thread.ownerId}>` : "inconnu"}`);
});
client.on("threadDelete", (thread) => {
  if (!serves("fwu") || !thread.guild || !guildAllowed(thread.guild.id, ALLOWED_GUILDS) || isLogsHub(thread.guild.id)) return;
  auditLog(thread.guild, settings[thread.guild.id], "🧵 Fil supprimé", `Nom : **${thread.name ?? "inconnu"}**\nSalon parent : <#${thread.parentId}>`);
});

async function reconcilePvLocks() {
  try {
    const result = await reconcilePrivateVoiceLocks(client, { isAllowedGuild: (gid) => guildAllowed(gid, ALLOWED_GUILDS) && !isLogsHub(gid) });
    if (result.deleted) record("pv_locks_pruned");
    if (result.relocked) record("pv_locks_restored");
  } catch {
    record("pv_reconcile_error");
  }
}

async function reconcileDogLeashes() {
  try {
    const restored = await reconcileLeashedMembers(client);
    if (restored) record("dog_leashes_restored");
  } catch {
    record("dog_reconcile_error");
  }
}

client.once("clientReady", () => {
  writeConnectedMarker();
  try { clearGatewayFailures(db, RUNTIME.profile); } catch { /* diagnostic only */ }
  if (!IS_FWU) tickDomainLease();
  // Every FWU bot records its Discord id so GUARD's anti-nuke never targets its siblings.
  try { registerBotIdentity(RUNTIME.profile, client.user.id); } catch { record("bot_identity_error"); }
  // FWU community jobs: voice XP (1 min), reminders (30 s), birthdays (5 min).
  const communityGuilds = () => [...client.guilds.cache.values()].filter((g) => guildAllowed(g.id, ALLOWED_GUILDS) && !isLogsHub(g.id));
  // One-time automatic configuration (channels, roles, staff ladder) once leases are settled.
  setTimeout(() => {
    void runAutoconfig(communityGuilds(), (domain) => serves(domain) && (IS_FWU ? domain === "fwu" : domain !== "fwu"), { ...communityAutoconfig, ladder: ladderOf, saveLadder }, (guild, line) => {
      console.log(`[autoconfig] ${guild.name} : ${line}`);
      auditLog(guild, settings[guild.id], "⚙️ Configuration automatique", line, 0xe21d2f);
    }).catch(() => record("autoconfig_error"));
  }, 45_000).unref?.();
  setInterval(() => { if (serves("fwu")) void tickVoiceXp(communityGuilds()).catch(() => record("levels_error")); }, 60_000).unref?.();
  setInterval(() => { if (serves("fwu")) void runReminders(client).catch(() => record("reminders_error")); }, 30_000).unref?.();
  setInterval(() => { if (serves("fwu")) void runBirthdays(communityGuilds()).catch(() => record("birthdays_error")); }, 5 * 60_000).unref?.();
  // SUCK ME: tell the OWNER how the last /maj ended (checked every 2 minutes).
  setInterval(() => { if (serves("suckme")) void announceUpdateResult(client).catch(() => {}); }, 2 * 60_000).unref?.();
  // SUCK ME animation: question of the day, checked every 5 minutes (Paris time).
  setInterval(() => { if (serves("suckme")) void runQotd(communityGuilds()).catch(() => record("qotd_error")); }, 5 * 60_000).unref?.();
  // SUCK ME jobs: expired temporary roles and scheduled announcements (every minute).
  setInterval(() => {
    if (!serves("suckme")) return;
    void runTempRoles(client).catch(() => record("suckme_job_error"));
    void runAnnouncements(client).catch(() => record("suckme_job_error"));
  }, 60_000).unref?.();
  // LE FISC jobs: weekly wealth tax and overdue loans (hourly checks).
  setInterval(() => {
    if (!serves("fisc")) return;
    try { runWealthTax(communityGuilds().map((g) => g.id)); runLoanCollection(); } catch { record("fisc_job_error"); }
  }, 60 * 60_000).unref?.();
  // Creator Studio scheduler: publishes due drafts only on allowlisted guilds (MZ stays excluded).
  const studioSender = createClientStudioSender(client, { isAllowedGuild: (gid) => guildAllowed(gid, ALLOWED_GUILDS) && !isLogsHub(gid) });
  // Each scheduled job checks its domain at every tick: exactly one process runs it.
  setInterval(() => {
    if (!serves("suckme")) return;
    try { recoverInterruptedStudioPublishes(); } catch { record("creator_studio_recovery_error"); }
    publishDueDrafts({ sender: studioSender }).catch(() => {});
  }, 60_000).unref?.();
  for (const guild of client.guilds.cache.values()) {
    if (serves("fwu") && guildAllowed(guild.id, ALLOWED_GUILDS) && !isLogsHub(guild.id)) {
      void captureGuildInviteSnapshot(guild).then((result) => { if (!result.captured) record("invite_snapshot_unavailable"); }).catch(() => record("invite_snapshot_error"));
    }
    // Rôle 0 % intouchable : repère les membres protégés (utile pour annuler un bannissement).
    if (guildAllowed(guild.id, ALLOWED_GUILDS) && !isLogsHub(guild.id)) void primeTier0Members(guild).catch(() => record("tier0_error"));
  }
  record("connected");
  if (serves("suckme")) {
    try {
      const recovered = recoverInterruptedAutomationRuns(Date.now());
      if (recovered) record("automation_interrupted_runs_marked_for_review");
    } catch { record("automation_recovery_error"); }
    try {
      const recovered = recoverInterruptedStudioPublishes();
      if (recovered) record("creator_studio_interrupted_publications_marked_for_review");
    } catch { record("creator_studio_recovery_error"); }
  }
  // Analytics counters are buffered in memory per process: every bot flushes its own.
  flushAnalyticsMetrics();
  const analyticsTimer = setInterval(() => flushAnalyticsMetrics(), 60_000);
  analyticsTimer.unref?.();
  if (serves("fwu")) try { if (recoverInterruptedPndIntelligenceActions()) record("pnd_intelligence_interrupted_actions_marked_unknown"); } catch { record("pnd_intelligence_recovery_error"); }
  const intelligenceExpiryTimer = setInterval(() => { if (serves("fwu")) expirePendingPndIntelligenceActions(); }, 60_000);
  intelligenceExpiryTimer.unref?.();
  const guardianRetentionTimer = setInterval(() => {
    if (!serves("guard")) return;
    try { pruneGuardianRiskSignals(); pruneGuardianReviews(); } catch { record("guardian_retention_error"); }
  }, 6 * 60 * 60_000);
  guardianRetentionTimer.unref?.();
  if (serves("guard")) try { pruneGuardianRiskSignals(); pruneGuardianReviews(); } catch { record("guardian_retention_error"); }
  const scheduledAutomationTimer = setInterval(() => {
    if (!serves("suckme")) return;
    void previewScheduledAutomationRules(client, ALLOWED_GUILDS.filter((guildId) => !isLogsHub(guildId)), Date.now(), record);
  }, 60_000);
  scheduledAutomationTimer.unref?.();
  if (serves("suckme")) void previewScheduledAutomationRules(client, ALLOWED_GUILDS.filter((guildId) => !isLogsHub(guildId)), Date.now(), record);
  if (serves("suckme")) try {
    const approximateSessions = reconcileActiveVoiceSessions(client, Date.now(), (guildId) => guildAllowed(guildId, ALLOWED_GUILDS) && !isLogsHub(guildId));
    if (approximateSessions) record("voice_sessions_reconciled");
  } catch {
    record("voice_sessions_reconcile_error");
  }
  const logsGuild = client.guilds.cache.get(LOGS_HUB_GUILD_ID);
  if (logsGuild && IS_FWU) void provisionLogsHub(logsGuild, record).catch(() => record("logs_hub_provision_error"));
  if (serves("fdpdlavoc")) void reconcileTempVoices(client, record).catch(() => record("temp_voice_reconcile_error"));
  startOrganizationMaintenance(client, ALLOWED_GUILDS.filter((guildId) => !isLogsHub(guildId)), record, () => serves("fwu"));
  startInvestmentMaintenance(client, ALLOWED_GUILDS.filter((guildId) => !isLogsHub(guildId)), record, () => serves("fisc"));
  void enforceGuildAllowlist(client, ALLOWED_GUILDS, record);
  if (IS_FWU) {
    // FWU posts the logs handed over by the dedicated bots (Logs Hub + RESUME).
    let relaying = false;
    const relayTimer = setInterval(() => {
      if (relaying) return;
      relaying = true;
      void (async () => {
        for (const item of takeRelayedLogs(25)) {
          const guild = client.guilds.cache.get(item.guildId);
          if (!guild) { countLostRelayedLogs("serveur_absent"); continue; }
          // Un nouvel essai ne repasse pas par RESUME : il l'a déjà enregistré au premier.
          const delivered = await sendCentralLog(guild, settings[guild.id], item.embed, item.fallbackChannelIds, item.components, item.allowedUserIds, { skipObservers: item.attempts > 0 }).catch(() => false);
          if (!delivered) { record("central_log_error"); requeueRelayedLog(item); }
        }
      })().catch(() => record("log_relay_error")).finally(() => { relaying = false; });
    }, 2_000);
    relayTimer.unref?.();
    const resumeRetentionTimer = setInterval(() => { try { pruneResumeEvents(); } catch { record("resume_retention_error"); } }, 60 * 60_000);
    resumeRetentionTimer.unref?.();
    // Hand-over to FDPDLAVOC: once it holds the voice domain, FWU leaves the voice channels it still occupies.
    const voiceHandoverTimer = setInterval(() => {
      if (serves("fdpdlavoc")) return;
      for (const connection of getVoiceConnections().values()) {
        try { connection.destroy(); record("voice_handed_over"); } catch { record("voice_handover_error"); }
      }
    }, 30_000);
    voiceHandoverTimer.unref?.();
  }

  // Merge the V4 command surface one command at a time. A bulk PUT would wipe
  // commands created from the dashboard (custom commands) or by other tools.
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  const commandRoute = `/applications/${client.application.id}/commands`;
  void (async () => {
    const existing = await rest.get(commandRoute);
    const byName = new Map(
      (Array.isArray(existing) ? existing : [])
        .filter((command) => typeof command?.name === "string" && typeof command?.id === "string")
        .map((command) => [command.name, command]),
    );
    // /vocal-panel was folded into /voc vocal-panel to make room for the new
    // /anti-moove root command without exceeding Discord's 100-root limit.
    // Retire only this known first-party duplicate; preserve dashboard commands.
    const retiredRootCommands = ["vocal-panel"];
    for (const name of retiredRootCommands) {
      const legacy = byName.get(name);
      if (!legacy) continue;
      await rest.delete(`${commandRoute}/${legacy.id}`);
      byName.delete(name);
    }
    // Each application registers only its own commands (FWU: every domain not
    // delegated yet). Commands moved to a dedicated bot are retired one by one.
    const plan = slashRegistrationPlan(RUNTIME, SLASH_COMMANDS, EXTRA_SLASH_COMMANDS);
    for (const name of plan.retire) {
      const moved = byName.get(name);
      if (!moved) continue;
      await rest.delete(`${commandRoute}/${moved.id}`);
      byName.delete(name);
    }
    if (plan.skipped.length) record("slash_commands_over_limit");
    for (const command of plan.register) {
      const current = byName.get(command.name);
      const body = toDiscordCommand(command);
      if (current) await rest.patch(`${commandRoute}/${current.id}`, { body });
      else await rest.post(commandRoute, { body });
    }
  })()
    .then(() => record("slash_commands_registered"))
    .catch(() => record("slash_commands_registration_error"));

  void reportStatus();
  if (serves("fisc")) void reportEconomy();
  if (serves("fwu")) void checkLiveAlerts(client, settings, record);
  const liveAlertsTimer = setInterval(() => { if (serves("fwu")) void checkLiveAlerts(client, settings, record); }, 60_000);
  liveAlertsTimer.unref?.();
  const economyTimer = setInterval(() => { if (serves("fisc")) void reportEconomy(); }, 5 * 60_000);
  economyTimer.unref?.();
  const auctionSettlementTimer = setInterval(() => {
    if (!client.isReady() || !serves("fisc")) return;
    void settleExpiredEconomyAuctions(Date.now(), async (transfer) => {
      const guild = await client.guilds.fetch(transfer.guildId);
      return transferEconomyRole(guild, transfer);
    }).then((result) => {
      if (result.sold || result.expired) record("auction_settled");
      if (result.failed) record("auction_settlement_error");
    }).catch(() => record("auction_settlement_error"));
  }, 60_000);
  auctionSettlementTimer.unref?.();
  const runEconomyReconciliation = (minAgeMs) => reconcilePendingEconomy({
    minAgeMs,
    inspectRoles: async (guildId, { sellerId, buyerId, roleId }) => {
      if (!guildAllowed(guildId, ALLOWED_GUILDS)) return null;
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return null;
      const [seller, buyer] = await Promise.all([
        guild.members.fetch({ user: sellerId, force: true }).catch((error) => (error?.code === 10007 ? false : null)),
        guild.members.fetch({ user: buyerId, force: true }).catch((error) => (error?.code === 10007 ? false : null)),
      ]);
      if (seller === null || buyer === null) return null; // transient error: never decide
      return { sellerHas: Boolean(seller && seller.roles.cache.has(roleId)), buyerHas: Boolean(buyer && buyer.roles.cache.has(roleId)) };
    },
    transferRole: async (transfer) => transferEconomyRole(await client.guilds.fetch(transfer.guildId), transfer),
  }).then((result) => {
    if (result.settled || result.reopened) record("economy_pending_reconciled");
    if (result.review) record("economy_pending_review");
  }).catch(() => record("economy_reconcile_error"));
  // At startup nothing can be in flight in this process: reconcile immediately.
  // (Split mode: another process may have been mid-purchase, so keep the 10 min margin.)
  if (serves("fisc")) void runEconomyReconciliation(gate.servesAll() ? 0 : 10 * 60_000);
  const economyReconcileTimer = setInterval(() => { if (serves("fisc")) void runEconomyReconciliation(10 * 60_000); }, 10 * 60_000);
  economyReconcileTimer.unref?.();

  // Inter-bot reactions: one process drains the shared bus so a bonus is never
  // paid twice. The bot serving "fwu" owns it; if it is down the events wait.
  if (serves("fwu")) {
    startCascade();
    const drain = () => void runCascade({
      guildIds: ALLOWED_GUILDS,
      onEffect: (event, line) => console.log(`[cascade] ${event.kind} → ${line}`),
      onPerkExpired: async ({ guildId, userId, kind }) => {
        if (kind !== "couleur") return;
        const guild = client.guilds.cache.get(guildId);
        if (guild) await removeColourRole(guild, userId).catch(() => {});
      },
    }).catch(() => record("cascade_error"));
    drain();
    const cascadeTimer = setInterval(drain, 20_000);
    cascadeTimer.unref?.();
    const pruneTimer = setInterval(() => { try { pruneEvents(); } catch { record("event_prune_error"); } }, 6 * 60 * 60_000);
    pruneTimer.unref?.();
  }
  if (serves("suckme")) {
    void reconcileDogLeashes();
    void expireVoiceMenottes(client, settings).then((count) => { if (count) record("menotte_expired"); }).catch(() => record("menotte_expiration_error"));
    void reconcileVoiceMenottes(client, settings).then((count) => { if (count) record("menottes_restored"); }).catch(() => record("menotte_reconcile_error"));
  }
  const menotteExpiryTimer = setInterval(() => {
    if (!serves("suckme")) return;
    void expireVoiceMenottes(client, settings).then((count) => { if (count) record("menotte_expired"); }).catch(() => record("menotte_expiration_error"));
  }, 30_000);
  menotteExpiryTimer.unref?.();
  if (serves("fdpdlavoc")) void Promise.resolve().then(() => { const count = expireVoiceAccessRequests(); if (count) record("voice_access_requests_expired"); }).catch(() => record("voice_access_expiration_error"));
  const voiceAccessExpiryTimer = setInterval(() => {
    if (!serves("fdpdlavoc")) return;
    try { const count = expireVoiceAccessRequests(); if (count) record("voice_access_requests_expired"); }
    catch { record("voice_access_expiration_error"); }
  }, 30_000);
  voiceAccessExpiryTimer.unref?.();
  if (serves("fdpdlavoc")) void reconcilePvLocks();
  if (serves("suckme")) {
    try { if (recoverInterruptedRankAllJobs()) record("rankall_interrupted_jobs_marked"); } catch { record("rankall_recovery_error"); }
    try { if (recoverInterruptedDmAllJobs()) record("dmall_interrupted_jobs_marked"); } catch { record("dmall_recovery_error"); }
    void primeAntiMoveAuditSnapshots(client).catch(() => record("anti_move_snapshot_error"));
  }
  const transcriptPurgeTimer = setInterval(() => {
    if (!serves("fwu")) return;
    try { if (purgeExpiredTranscripts()) record("ticket_transcripts_purged"); } catch { record("ticket_transcript_purge_error"); }
  }, 60 * 60_000);
  transcriptPurgeTimer.unref?.();
  if (serves("fwu")) try { purgeExpiredTranscripts(); } catch { record("ticket_transcript_purge_error"); }
  const healthTimer = setInterval(checkHealthAlerts, 5 * 60_000);
  healthTimer.unref?.();
  const antiMoveSnapshotTimer = setInterval(() => {
    if (!serves("suckme")) return;
    void primeAntiMoveAuditSnapshots(client).catch(() => record("anti_move_snapshot_error"));
  }, 30_000);
  antiMoveSnapshotTimer.unref?.();
  if (serves("suckme")) {
    void reconcileProtectedNicknames(client, settings).then((count) => { if (count) record("lockname_restored"); }).catch(() => record("lockname_reconcile_error"));
    void expireWaoufActions(client, settings).then((count) => { if (count) record("waouf_expired"); }).catch(() => record("waouf_expiration_error"));
  }
  const waoufExpiryTimer = setInterval(() => {
    if (!serves("suckme")) return;
    void expireWaoufActions(client, settings).then((count) => { if (count) record("waouf_expired"); }).catch(() => record("waouf_expiration_error"));
  }, 30_000);
  waoufExpiryTimer.unref?.();
  if (serves("fdpdlavoc")) void startConfiguredRadios(client).then((started) => {
    if (started) record("radio_autostarted");
  }).catch(() => record("radio_autostart_error"));
});
client.on("shardDisconnect", () => { record("disconnected"); void reportStatus(); });
client.on("shardReconnecting", () => { record("reconnecting"); void reportStatus(); });
client.on("shardResume", () => {
  record("connected");
  void reportStatus();
  if (serves("fdpdlavoc")) void reconcilePvLocks();
  if (serves("suckme")) {
    void reconcileDogLeashes();
    void expireVoiceMenottes(client, settings).then((count) => { if (count) record("menotte_expired"); }).catch(() => record("menotte_expiration_error"));
    void reconcileVoiceMenottes(client, settings).catch(() => record("menotte_reconcile_error"));
    void reconcileProtectedNicknames(client, settings).catch(() => record("lockname_reconcile_error"));
    void expireWaoufActions(client, settings).then((count) => { if (count) record("waouf_expired"); }).catch(() => record("waouf_expiration_error"));
  }
  void enforceGuildAllowlist(client, ALLOWED_GUILDS, record);
});
client.on("guildCreate", (guild) => {
  if (!IS_FWU) tickDomainLease();
  void handleGuildCreate(guild, ALLOWED_GUILDS, record);
  if (serves("fwu") && guildAllowed(guild.id, ALLOWED_GUILDS) && !isLogsHub(guild.id)) {
    void captureGuildInviteSnapshot(guild).then((result) => { if (!result.captured) record("invite_snapshot_unavailable"); }).catch(() => record("invite_snapshot_error"));
  }
});
client.on("error", () => record("gateway_error"));
client.on("shardError", () => record("gateway_error"));

/** Help groups limited to the commands this application registers. */
function commandGroupsForThisBot() {
  const registered = new Set(slashRegistrationPlan(RUNTIME, SLASH_COMMANDS, EXTRA_SLASH_COMMANDS).register.map((command) => command.name));
  const groups = new Map();
  for (const group of slashCommandsByCategory()) groups.set(group.category, group.commands.filter((command) => registered.has(command.name)));
  for (const command of EXTRA_SLASH_COMMANDS) {
    if (!registered.has(command.name)) continue;
    groups.set(command.category, [...(groups.get(command.category) ?? []), command]);
  }
  return [...groups.entries()].filter(([, commands]) => commands.length).map(([category, commands]) => ({ category, commands }));
}

async function handleCoreSlashInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return false;

  const command = interaction.commandName;

  if (command === "status") {
    const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000));
    const uptime = `${Math.floor(seconds / 86400)}j ${Math.floor(seconds / 3600) % 24}h ${Math.floor(seconds / 60) % 60}min`;
    await interaction.reply({
      content: `🟢 **${IS_FWU ? "FWU" : BOT_LABEL} est en ligne**\nConnexion Discord : ${client.isReady() ? "Connecté" : "Déconnecté"}\nSynchronisation : ${lastSync ? "Opérationnelle" : "En attente"}\nTemps de fonctionnement : ${uptime}`,
      ephemeral: true,
    });
    return true;
  }

  if (command === "aide") {
    const embeds = commandGroupsForThisBot().map((group) => ({
      title: group.category,
      description: group.commands.map((c) => `**/${c.name}** — ${c.description}`).join("\n"),
    }));
    const otherBots = Object.values(BOT_PROFILES).filter((profile) => profile.id !== RUNTIME.profile && !serves(profile.id));
    await interaction.reply({
      content: IS_FWU && !otherBots.length
        ? "🤖 **Commandes de FWU**"
        : `🤖 **Commandes de ${BOT_LABEL}**${otherBots.length ? `\nAutres bots FWU : ${otherBots.map((profile) => `**${profile.label}** (${profile.summary})`).join(" · ")}` : ""}`.slice(0, 2000),
      embeds,
      ephemeral: true,
    });
    return true;
  }

  if (command === "salut") {
    await interaction.reply({ content: `👋 Salut ${interaction.user} ! Ravi de te voir !` });
    return true;
  }

  if (command === "sondage") {
    if (!isServerStaff(interaction.member, settings[interaction.guildId])) {
      await interaction.reply({ content: STAFF_ONLY_MESSAGE, ephemeral: true });
      return true;
    }
    const question = interaction.options.getString("question", true);
    const options = [1, 2, 3, 4, 5]
      .map((n) => interaction.options.getString(`option_${n}`))
      .filter(Boolean);
    const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];

    const content = `📊 **${question}**\n\n${options.map((option, i) => `${emojis[i]} ${option}`).join("\n")}\n\nVote avec les réactions ci-dessus !`;
    await interaction.reply({ content, allowedMentions: { parse: [] } });

    try {
      const message = await interaction.fetchReply();
      for (let i = 0; i < options.length; i++) {
        await message.react(emojis[i]);
      }
    } catch {
      // Enrich the poll message itself rather than posting a separate notice under it.
      await interaction.editReply({
        content: "⚠️ Sondage publié sans réactions : vérifie ma permission « Ajouter des réactions ».",
      }).catch(() => {});
    }
    return true;
  }

  if (command === "info-serveur") {
    if (!interaction.guild) {
      await interaction.reply({ content: "Cette commande doit être utilisée sur un serveur.", ephemeral: true });
      return true;
    }

    const guild = interaction.guild;
    const owner = await guild.fetchOwner().catch(() => null);

    await interaction.reply({
      content: `📊 **Informations du serveur : ${guild.name}**\n👑 Propriétaire : ${owner?.user.tag ?? "Inconnu"}\n👥 Membres : ${guild.memberCount}\n💬 Salons : ${guild.channels.cache.size}\n🎭 Rôles : ${guild.roles.cache.size}\n📅 Créé le : ${guild.createdAt.toLocaleDateString("fr-FR")}`,
      allowedMentions: { parse: [] },
    });
    return true;
  }

  if (command === "nettoyer") {
    if (!interaction.guild || !interaction.channel || typeof interaction.channel.bulkDelete !== "function") {
      await interaction.reply({ content: "Cette commande doit être utilisée dans un salon textuel d'un serveur.", ephemeral: true });
      return true;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({ content: "🔒 Tu dois avoir la permission Gérer les messages.", ephemeral: true });
      return true;
    }

    const botMember = interaction.guild.members.me;
    if (!botMember?.permissionsIn(interaction.channel).has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({ content: "Je n'ai pas la permission Gérer les messages dans ce salon.", ephemeral: true });
      return true;
    }

    const amount = interaction.options.getInteger("nombre", true);
    await interaction.deferReply({ ephemeral: true });

    try {
      let deletedCount = 0;

      if (amount === 1) {
        const messages = await interaction.channel.messages.fetch({ limit: 1 });
        const latest = messages.first();
        if (latest) {
          await latest.delete();
          deletedCount = 1;
        }
      } else {
        const deleted = await interaction.channel.bulkDelete(amount, true);
        deletedCount = deleted.size;
      }

      await interaction.editReply(`🧹 ${deletedCount} message(s) supprimé(s). Les messages datant de plus de 14 jours ne peuvent pas être supprimés en masse.`);
    } catch {
      await interaction.editReply("Impossible de supprimer les messages. Vérifie mes permissions et réessaie.");
    }
    return true;
  }

  return false;
}

/** Dashboard-created slash commands are answered from the shared server table. */
async function handleSavedSlashCommand(interaction) {
  if (!interaction.isChatInputCommand() || interaction.replied || interaction.deferred) return false;
  let data;
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        action: "custom-command",
        applicationId: client.application.id,
        name: interaction.commandName,
        permissions: interaction.memberPermissions?.bitfield.toString() ?? "0",
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch {
    record("interaction_error");
    return false;
  }
  if (!data?.found) {
    await interaction.reply({
      content: "Commande inconnue. Mets à jour les commandes depuis le panneau de configuration.",
      ephemeral: true,
    }).catch(() => {});
    return true;
  }
  if (!data.allowed) {
    await interaction.reply({ content: "Tu n’as pas la permission d’utiliser cette commande.", ephemeral: true }).catch(() => {});
    return true;
  }
  await interaction.reply({
    content: String(data.content ?? "").slice(0, 2000),
    allowedMentions: { parse: [] },
    ephemeral: !!data.ephemeral,
  }).catch(() => {});
  return true;
}

/** Every answer to a slash command points to slash commands, never to the former "=" ones. */
function slashifyInteractionReplies(interaction) {
  for (const method of ["reply", "editReply", "followUp", "update"]) {
    const original = interaction[method];
    if (typeof original !== "function") continue;
    interaction[method] = (payload, ...rest) => original.call(interaction, slashifyPayload(payload), ...rest);
  }
}

client.on("interactionCreate", (interaction) => {
  armSlowCommandWatchdog(interaction);
  slashifyInteractionReplies(interaction);
  runAsActor(interaction.user?.id, async () => {
    if (interaction.guildId && (!guildAllowed(interaction.guildId, ALLOWED_GUILDS)
      || (isLogsHub(interaction.guildId) && !interaction.customId?.startsWith("moderation:appeal-review:")))) return;
    // A slash command is handled only by the bot that owns its domain. Buttons
    // and menus always come back to the bot that posted them: no filter needed.
    // Gel d'urgence du staff : commandes du staff refusées (sauf owner), sur les 5 bots.
    if (interaction.isChatInputCommand?.() && interaction.guildId) {
      const definition = SLASH_COMMANDS.find((c) => c.name === interaction.commandName);
      const refusal = await freezeRefusal({ guildId: interaction.guildId, member: interaction.member, commandName: interaction.commandName, category: definition?.category ?? "", settings });
      if (refusal) { await interaction.reply({ content: refusal, ephemeral: true }).catch(() => {}); return; }
    }
    if (interaction.isChatInputCommand?.() || interaction.isAutocomplete?.()) {
      const owner = slashCommandOwner(interaction.commandName);
      if (owner && owner !== RUNTIME.profile) {
        if (interaction.isChatInputCommand()) {
          await interaction.reply({ content: `Cette commande est désormais gérée par **${BOT_PROFILES[owner].label}**.`, ephemeral: true }).catch(() => {});
        }
        return;
      }
    }
    // Autocomplete (sanction types, embeds) answers before the hierarchy check: no target is acted upon.
    if (interaction.isAutocomplete?.()) {
      if (STAFF_COMMANDS.has(interaction.commandName)) await handleStaffModerationInteraction(interaction, settings[interaction.guildId], { bot: RUNTIME.profile });
      else if (EMBED_COMMANDS.has(interaction.commandName)) await handleEmbedInteraction(interaction, settings[interaction.guildId], { bot: RUNTIME.profile, audit: auditLog });
      return;
    }
    // Hierarchy: a member can only be targeted by someone ranked above them (OWNER: full access).
    const hierarchyRefusal = await checkInteractionHierarchy(interaction).catch(() => "⛔ Hiérarchie des rôles illisible : action refusée par sécurité.");
    if (hierarchyRefusal) {
      record("hierarchy_refused");
      await interaction.reply({ content: hierarchyRefusal, ephemeral: true, allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }
    if (await handleResumeInteraction(interaction, settings[interaction.guildId])) { auditSlashUsage(interaction, "RESUME"); return; }
    if (await handleDmAllInteraction(interaction, settings[interaction.guildId])) return;
    if (await handleUndogAllInteraction(interaction, settings[interaction.guildId])) return;
    if (await handleBlacklistInteraction(interaction, settings[interaction.guildId])) return;
    if (await handleGuardInteraction(interaction, settings[interaction.guildId], { report: guardReport })) { auditSlashUsage(interaction, "GUARD"); return; }
    if (await handleCommunityInteraction(interaction, settings[interaction.guildId])) { auditSlashUsage(interaction, "Communauté"); return; }
    if (await handleFiscInteraction(interaction)) { auditSlashUsage(interaction, "LE FISC"); return; }
    if (await handleSelfUpdateInteraction(interaction)) { auditSlashUsage(interaction, "SUCK ME"); return; }
    if (await handleSuckmeInteraction(interaction, settings[interaction.guildId])) { auditSlashUsage(interaction, "SUCK ME"); return; }
    if (await handleMusicExtrasInteraction(interaction)) { auditSlashUsage(interaction, "Musique & radio"); return; }
    if (await handleLiveInteraction(interaction, settings, { apiUrl: API, secret: BOT_SYNC_SECRET })) { auditSlashUsage(interaction, "Alertes LIVE"); return; }
    if (interaction.isChatInputCommand?.() && interaction.commandName === "ia" && ["demande", "historique"].includes(interaction.options.getSubcommand(false))) {
      // PND Intelligence (former =pndia): same engine, preview then confirmation button.
      const sub = interaction.options.getSubcommand();
      await runPrefixFromSlash(interaction, sub === "historique" ? "=pndia history" : `=pndia ${interaction.options.getString("texte", true)}`,
        (message) => handlePndIntelligenceMessage(message, { apiUrl: API, secret: BOT_SYNC_SECRET, instructions: settings[interaction.guildId]?.ai?.instructions ?? "", settings, ownerIds: getPndPrivilegedIds(process.env.PND_OWNER_DISCORD_ID, process.env.PND_COFOUNDER_DISCORD_IDS) }),
        { ephemeral: false });
      auditSlashUsage(interaction, "PND Intelligence");
      return;
    }
    if (await handleAiMemoryInteraction(interaction)) return;
    if (await handlePndIntelligenceInteraction(interaction, { settings, ownerIds: getPndPrivilegedIds(process.env.PND_OWNER_DISCORD_ID, process.env.PND_COFOUNDER_DISCORD_IDS) })) { auditSlashUsage(interaction, "PND Intelligence"); return; }
    if (await handlePackInteraction(interaction, { configuredOwners: process.env.PND_OWNER_DISCORD_ID })) return;
    if (await handleMarketInteraction(interaction, { roleId: settings[interaction.guildId]?.sysPlus?.roleId ?? null, configuredOwners: process.env.PND_OWNER_DISCORD_ID })) return;
    if (await handleWhitelistInteraction(interaction, settings, { audit: (guild, title, description) => auditLog(guild, settings[guild?.id], title, description) })) return;
    if (await handleLocknameInteraction(interaction, settings[interaction.guildId])) { auditSlashUsage(interaction, "LOCKNAME"); return; }
    if (await handleWaoufInteraction(interaction, settings[interaction.guildId], record)) { auditSlashUsage(interaction, "WAOUF"); return; }
    if (await handleSysPlusInteraction(interaction, settings, {
      apiUrl: API,
      secret: BOT_SYNC_SECRET,
      record,
      // Les handlers SYS+ appellent audit(guild, titre, description) : on ajoute les réglages du serveur.
      audit: (guild, title, description) => auditLog(guild, settings[guild?.id], title, description),
    })) return;
    if (await handleCustomRolesInteraction(interaction, settings[interaction.guildId])) return;
    if (await handleRoleInteraction(interaction, settings[interaction.guildId])) return;

    if (await handlePanelSetupInteraction(interaction, settings, {
      apiUrl: API,
      secret: BOT_SYNC_SECRET,
      record,
      audit: auditLog,
      commandGroups: commandGroupsForThisBot(),
    })) {
      if (interaction.isChatInputCommand?.() || interaction.isButton?.() || interaction.isStringSelectMenu?.()) {
        auditSlashUsage(interaction, "Centre de contrôle");
      }
      return;
    }

    if (await handleCoreSlashInteraction(interaction)) return;
    if (await handleGuildGuardInteraction(interaction, settings[interaction.guildId], {
      apiUrl: API,
      secret: BOT_SYNC_SECRET,
      record,
    })) return;
    if (await handleStaffModerationInteraction(interaction, settings[interaction.guildId], { bot: RUNTIME.profile })) { auditSlashUsage(interaction, "Modération staff"); return; }
    if (await handleEmbedInteraction(interaction, settings[interaction.guildId], { bot: RUNTIME.profile, audit: auditLog })) return;
    if (await handleModerationInteraction(interaction, settings[interaction.guildId], { apiUrl: API, secret: BOT_SYNC_SECRET, bot: RUNTIME.profile })) return;
    if (await handleVoiceV2Interaction(interaction, settings[interaction.guildId])) { auditSlashUsage(interaction, "Vocal temporaire"); return; }
    // Commandes et boutons : une commande slash n'arrive qu'à son bot propriétaire (filtre en tête),
    // un bouton revient toujours au bot qui l'a publié. Aucune condition de domaine ici.
    if (await handleShieldInteraction(interaction)) { auditSlashUsage(interaction, "Bouclier"); return; }
    if (await handleQuestInteraction(interaction)) { auditSlashUsage(interaction, "Quêtes"); return; }
    if (await handleClanInteraction(interaction)) { auditSlashUsage(interaction, "Clans & saisons"); return; }
    if (await handleOverviewInteraction(interaction)) { auditSlashUsage(interaction, "Profil FWU"); return; }
    if (await handleConfessionInteraction(interaction)) { auditSlashUsage(interaction, "Confessions"); return; }
    if (await handleAnimationInteraction(interaction)) { auditSlashUsage(interaction, "Animation"); return; }
    if (await handleCasinoInteraction(interaction)) { auditSlashUsage(interaction, "PND Casino"); return; }
    if (await handlePerkInteraction(interaction)) { auditSlashUsage(interaction, "Avantages"); return; }
    if (await handleGamesInteraction(interaction, settings[interaction.guildId], record)) { auditSlashUsage(interaction, "Jeux & événements"); return; }
    if (await handleKnowledgeInteraction(interaction)) return;
    if (await handleTicketsInteraction(interaction, settings[interaction.guildId], {
      apiUrl: API,
      secret: BOT_SYNC_SECRET,
      record,
    })) return;
    if (await handleWebhookInteraction(interaction, settings[interaction.guildId], record)) return;
    if (await handleAutomationInteraction(interaction, settings[interaction.guildId], {
      apiUrl: API,
      secret: BOT_SYNC_SECRET,
      record,
    })) { auditSlashUsage(interaction, "Automatisation"); return; }
    if (await handleV4SlashInteraction(interaction, settings[interaction.guildId])) {
      const category = ECONOMY_V4_COMMANDS.has(interaction.commandName)
        ? "Économie PND"
        : "Commande V4";
      auditSlashUsage(interaction, category);
      return;
    }
    if (await handleEconomyInteraction(interaction)) { auditSlashUsage(interaction, "Économie PND"); return; }
    if (await handleMusicInteraction(interaction)) { auditSlashUsage(interaction, "Musique & radio"); return; }
    await handleVoiceInteraction(interaction, settings[interaction.guildId]);
    await handleSavedSlashCommand(interaction);
  }).catch(async (error) => {
    if (error?.code === "OWNER_PROTECTED") {
      const payload = { content: error.message, ephemeral: true, allowedMentions: { parse: [] } };
      await (interaction.deferred || interaction.replied ? interaction.followUp(payload) : interaction.reply(payload)).catch(() => {});
      return;
    }
    console.error("[bot] interaction_error:", error?.message ?? "Unknown error");
    record("interaction_error");
    await reportInteractionFailure(interaction);
  });
});

// Base centrale (quotas, sanctions, journaux) : jamais bloquante au démarrage.
// Seul FWU prévient (Logs Hub de chaque serveur source + MP à l'owner), pour éviter 5 alertes identiques.
async function notifySharedDb(kind) {
  const alert = SHARED_DB_ALERTS[kind];
  if (!alert) return;
  if (!client.isReady()) await new Promise((resolve) => client.once("clientReady", resolve)); // l'alerte peut précéder la connexion
  for (const guild of client.guilds.cache.values()) {
    if (isLogsHub(guild.id) || !guildAllowed(guild.id, ALLOWED_GUILDS)) continue;
    auditLog(guild, settings[guild.id], alert.title, alert.description, alert.color);
  }
  const ownerId = String(process.env.PND_OWNER_DISCORD_ID ?? "").trim();
  if (/^\d{17,20}$/.test(ownerId)) {
    const owner = await client.users.fetch(ownerId).catch(() => null);
    await owner?.send(`${alert.title}\n${alert.description}`).catch(() => {});
  }
}
await startSharedLayer({ record, notify: IS_FWU ? notifySharedDb : null });
if (IS_FWU) startUsageRetention({ record });
startFreezeRefresh(() => ALLOWED_GUILDS.filter((guildId) => !isLogsHub(guildId)));
if (IS_FWU) startFreezeExpiry({ client, bot: RUNTIME.profile, record, audit: (guild, title, description) => auditLog(guild, settings[guild.id], title, description, 0x38bdf8) });
startStaffAbuseAlerts({ client, bot: RUNTIME.profile, getSettings: (guildId) => settings[guildId], record, audit: (guild, title, description) => auditLog(guild, settings[guild.id], title, description, 0xef4444) });
await sync();
setInterval(sync, 60_000);
setInterval(reportStatus, 20_000);
startGamesScheduler(client, record, () => serves("fwu"));
startAutomationScheduler(client, record, () => serves("suckme"));
// Silent-crash guard: a failed login or a long disconnection stops the process with an
// error, so PM2 restarts it and counts it instead of showing a dead bot as "online".
// Each failure waits longer before restarting (30 s → 8 min); after 6 failures in a row the
// bot stops for good (exit code ignored by PM2) and the diagnostic shows it in red.
let stoppingOffline = false;
function stopOffline(reason) {
  if (stoppingOffline) return;
  stoppingOffline = true;
  let plan = { failures: 1, stop: false, delayMs: 30_000, exitCode: 1 };
  try { plan = recordGatewayFailure(db, RUNTIME.profile, reason); } catch { /* keep the default pause */ }
  console.error(`❌ ${BOT_LABEL} : pas de connexion à Discord (${reason}, échec ${plan.failures}). Vérifie le token et les intents « Server Members » et « Message Content ».`);
  console.error(plan.stop
    ? `⛔ ${BOT_LABEL} s'arrête définitivement après ${plan.failures} échecs. Corrige puis relance : pm2 restart ${process.env.name ?? "<processus>"}`
    : `↻ Nouvel essai dans ${Math.round(plan.delayMs / 1000)} s.`);
  record("gateway_error");
  clearConnectedMarker();
  try { gate.release(); } catch { /* the lease expires on its own */ }
  try { client.destroy(); } catch { /* already closed */ }
  setTimeout(() => process.exit(plan.exitCode), Math.max(1_000, plan.delayMs));
}
clearConnectedMarker();
const gatewayWatchdog = createGatewayWatchdog({ isReady: () => client.isReady(), exit: stopOffline });
setInterval(() => gatewayWatchdog.check(), 15_000).unref?.();
client.login(DISCORD_TOKEN).catch((error) => stopOffline(error?.code ?? error?.name ?? "login_failed"));
