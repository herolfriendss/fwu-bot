// Bot Discord 24h/24 — à lancer sur ton VPS. Les réglages viennent du site (onglet « Bot 24h/24 »).
import { ActivityType, Client, GatewayIntentBits, Partials, PermissionFlagsBits, REST } from "discord.js";
import { existsSync } from "node:fs";
// The dashboard and the Oracle bot share one command definition file. In the
// repository it lives in ../src/lib; the public source archive ships a copy at
// the bot root so an isolated installation also works.
const sharedSlashCommands = new URL("../src/lib/slash-commands.ts", import.meta.url);
const localSlashCommands = new URL("./slash-commands.ts", import.meta.url);
const slashCommandsModule = await import((existsSync(sharedSlashCommands) ? sharedSlashCommands : localSlashCommands).href);
const { SLASH_COMMANDS, slashCommandsByCategory, toDiscordCommand } = slashCommandsModule;
import { normalizePrefixAlias, resolvePrefixCommand } from "./prefix-commands.js";
import { handleVoiceMessage, handleVoiceInteraction } from "./voice-commands.js";
import { handleAntiMoveInteraction, handleAntiMoveMessage, handleAntiMoveVoiceState } from "./anti-move.js";
import { handleVoiceAccessRequestInteraction } from "./voice-access-requests.js";
import { handleSysPlusMessage, handleSysPlusInteraction } from "./systems/sysplus/commands.js";
import { handleSysPlusBroadcastInteraction, startSysPlusDmScheduler } from "./systems/sysplus/broadcast.js";
import { enforceLeashNickname, handleDogCommand, handleLeashVoiceState, reconcileLeashedMembers } from "./dog-commands.js";
import { handleMusicMessage, handleMusicInteraction, handleRadioMessage, startConfiguredRadios } from "./music/music.js";
import { economySnapshot, handleEconomyMessage, handleEconomyInteraction, recoverBlackjackGames } from "./economy.js";
import { handleV4SlashInteraction } from "./v4-commands.js";
import { handleSocialMessage } from "./social.js";
import { handleCardsMessage } from "./cards.js";
import { handleGuildGuardInteraction, handleGuildGuardMessage } from "./guild-guard-commands.js";
import { handleGuildCreate, handleGuildGuardJoin, restrictGuildSettings } from "./guild-guard.js";
import { handleModerationInteraction, handleModerationMessage } from "./moderation.js";
import { handleVoiceV2Interaction, handleVoiceV2Message, handleVoiceV2State, forgetGuildTempVoices, forgetTempVoice } from "./voice-v2.js";
import { handleGamesInteraction, handleGamesMessage, startGamesScheduler } from "./games.js";
import { handleTicketChannelDelete, handleTicketsInteraction, handleTicketsMessage } from "./tickets.js";
import { handleAutomationInteraction, handleAutomationJoin, handleAutomationMessage, startAutomationScheduler } from "./automation.js";
import { getPndPresenceFrame, PND_PRESENCE_INTERVAL_MS } from "./rich-presence-policy.js";

const { DISCORD_TOKEN, SITE_URL, BOT_SYNC_SECRET } = process.env;
if (!DISCORD_TOKEN || !SITE_URL || !BOT_SYNC_SECRET) {
  console.error("❌ Remplis DISCORD_TOKEN, SITE_URL et BOT_SYNC_SECRET dans le fichier .env");
  process.exit(1);
}
const API = `${SITE_URL.replace(/\/$/, "")}/api/public/bot-sync`;
const AUTH = { Authorization: `Bearer ${BOT_SYNC_SECRET}` };
const STATUS_API = `${SITE_URL.replace(/\/$/, "")}/api/public/bot-status`;
const ECONOMY_API = `${SITE_URL.replace(/\/$/, "")}/api/public/economy-snapshot`;
// V5 is private to the PND server. Fail closed: the single PND guild ID must
// be configured explicitly before the gateway process is allowed to start.
const PND_GUILD_ID = String(process.env.PND_ALLOWED_GUILD_ID ?? "").trim();
if (!/^\d{5,25}$/.test(PND_GUILD_ID)) {
  console.error("❌ PND_ALLOWED_GUILD_ID doit contenir l’identifiant Discord du serveur PND.");
  process.exit(1);
}
const ALLOWED_GUILDS = [PND_GUILD_ID];
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
async function reportStatus() {
  if (reporting) return;
  reporting = true;
  try {
    const res = await fetch(STATUS_API, {
      method: "POST", headers: { ...AUTH, "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        connected: client.isReady(),
        startedAt,
        lastSync,
        events,
        guilds: client.guilds.cache.filter((guild) => ALLOWED_GUILDS.includes(guild.id)).map((guild) => ({
          id: guild.id,
          name: guild.name,
          icon: guild.icon,
        })),
      }),
    });
    if (!res.ok) console.error("Envoi du statut impossible.");
  } catch { console.error("Envoi du statut impossible."); }
  finally { reporting = false; }
}
record("started");
recoverBlackjackGames(ALLOWED_GUILDS);

let settings = {}; // { [guildId]: BotSettings }

async function sync() {
  try {
    const res = await fetch(API, { headers: AUTH, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    settings = restrictGuildSettings(payload.guilds, ALLOWED_GUILDS);
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

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel],
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
      .filter((guild) => ALLOWED_GUILDS.includes(guild.id))
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

// Both the historical "=" prefix and the requested "+" prefix use the same handlers.
function withPlusPrefixAlias(message) {
  const content = String(message.content ?? "");
  if (!/^\+[^\s]+/.test(content.trimStart())) return message;
  const normalized = normalizePrefixAlias(content);
  return new Proxy(message, {
    get(target, property) {
      if (property === "content") return normalized;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const recent = new Map(); // anti-spam : `${guild}:${user}` -> timestamps
let recentMessagesSinceCleanup = 0;

function pruneSpamState(now) {
  if (++recentMessagesSinceCleanup < 500) return;
  recentMessagesSinceCleanup = 0;
  for (const [key, timestamps] of recent) {
    const active = timestamps.filter((at) => now - at < 60_000);
    if (active.length) recent.set(key, active);
    else recent.delete(key);
  }
}

client.on("messageCreate", async (msg) => {
  if (msg.author.bot || !msg.guild) return;
  if (!ALLOWED_GUILDS.includes(msg.guild.id)) return;
  const s = settings[msg.guild.id];
  if (s?.spam?.enabled && !msg.member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
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
  const commandMessage = withPlusPrefixAlias(msg);
  const handlers = [
    ["anti_move", () => handleAntiMoveMessage(commandMessage, s, { record })],
    ["moderation", () => handleModerationMessage(commandMessage, s)],
    ["dog", () => handleDogCommand(commandMessage, s.sysPlus?.roleId)],
    ["radio", () => handleRadioMessage(commandMessage)],
    ["music", () => handleMusicMessage(commandMessage)],
    ["voice", () => handleVoiceMessage(commandMessage, settings[msg.guild.id]?.voiceAccess)],
    ["economy", () => handleEconomyMessage(commandMessage)],
    ["social", () => handleSocialMessage(commandMessage)],
    ["cards", () => handleCardsMessage(commandMessage)],
    ["games", () => handleGamesMessage(commandMessage, record)],
    ["automation", () => handleAutomationMessage(commandMessage, s, { apiUrl: API, secret: BOT_SYNC_SECRET, record })],
    ["guild_guard", () => handleGuildGuardMessage(commandMessage, s, { apiUrl: API, secret: BOT_SYNC_SECRET, record })],
    ["tickets", () => handleTicketsMessage(commandMessage, s, { apiUrl: API, secret: BOT_SYNC_SECRET, record })],
    ["temp_voice", () => handleVoiceV2Message(commandMessage, s)],
  ];
  for (const [moduleName, handler] of handlers) {
    try {
      if (await handler()) return;
    } catch {
      record(`${moduleName}_error`);
      return;
    }
  }
  if (!s) return;
  const text = msg.content.toLowerCase();
  const isMod = msg.member?.permissions.has(PermissionFlagsBits.ManageMessages);

  try {
    // 1. Filtre anti-insultes
    if (s.filter.enabled && !isMod && s.filter.words.some((w) => hasWord(text, w))) {
      if (s.filter.deleteMessage) await msg.delete().catch(() => {});
      if (s.filter.warn) await msg.channel.send({ content: fill(s.filter.warn, { user: `<@${msg.author.id}>` }), allowedMentions: noMentions });
      return;
    }
    // SYS+ commands are evaluated before user-defined prefix commands.
    if (await handleSysPlusMessage(commandMessage, s, { apiUrl: API, secret: BOT_SYNC_SECRET, record })) return;
    // Message commands are checked before AI and keyword responses.
    const command = resolvePrefixCommand(s.prefixCommands ?? [], commandMessage.content, msg.member?.permissions.bitfield.toString() ?? "0");
    if (command) {
      await msg.reply({ content: command.content, allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    // 3. IA quand on mentionne le bot
    if (s.ai.enabled && msg.mentions.users.has(client.user.id)) {
      const prompt = msg.content.replace(/<@!?\d+>/g, "").trim();
      if (!prompt) return;
      await msg.channel.sendTyping();
      const res = await fetch(API, {
        method: "POST",
        headers: { ...AUTH, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, instructions: s.ai.instructions, author: msg.member?.displayName ?? msg.author.username }),
      });
      const data = await res.json().catch(() => ({}));
      const reply = data.reply || (res.status === 429 ? "Trop de demandes, réessaie dans un instant." : res.status === 402 ? "Crédits IA épuisés." : "Je n’ai pas pu répondre.");
      await msg.reply({ content: reply, allowedMentions: { parse: [], repliedUser: true } });
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
});

client.on("guildMemberAdd", async (member) => {
  if (!ALLOWED_GUILDS.includes(member.guild.id)) return;
  const s = settings[member.guild.id];
  if (await handleGuildGuardJoin(member, s?.guildGuard, record)) return;
  await handleAutomationJoin(member, s, record).catch(() => record("automation_error"));
  const w = s?.welcome;
  if (!w?.enabled || !w.channelId) return;
  const channel = await member.guild.channels.fetch(w.channelId).catch(() => null);
  if (channel?.isTextBased()) {
    await channel.send({ content: fill(w.message, { user: `<@${member.id}>`, server: member.guild.name }), allowedMentions: noMentions }).catch(() => record("welcome_error"));
  }
});

client.on("guildMemberUpdate", (oldMember, newMember) => {
  if (!ALLOWED_GUILDS.includes(newMember.guild.id)) return;
  const nicknameChanged = oldMember.nickname !== newMember.nickname;
  const rolesChanged = oldMember.roles.cache.size !== newMember.roles.cache.size
    || oldMember.roles.cache.some((role) => !newMember.roles.cache.has(role.id));
  if (!nicknameChanged && !rolesChanged) return;
  enforceLeashNickname(newMember)
    .then((restored) => { if (restored) record("dog_nickname_restored"); })
    .catch(() => record("dog_enforcement_error"));
});

client.on("voiceStateUpdate", (oldState, newState) => {
  const guildId = newState.guild?.id ?? oldState.guild?.id;
  if (!guildId || !ALLOWED_GUILDS.includes(guildId)) return;
  handleLeashVoiceState(oldState, newState)
    .then((moved) => { if (moved) record("dog_voice_returned"); })
    .catch(() => record("dog_voice_error"));
  void handleAntiMoveVoiceState(oldState, newState, record)
    .catch(() => record("anti_move_error"));
  void handleVoiceV2State(oldState, newState, settings[newState.guild?.id ?? oldState.guild?.id], record)
    .catch(() => record("temp_voice_error"));
});

client.on("channelDelete", (channel) => {
  if (!channel.guildId || !ALLOWED_GUILDS.includes(channel.guildId)) return;
  forgetTempVoice(channel.id);
  handleTicketChannelDelete(channel, record);
});
client.on("guildDelete", (guild) => { forgetGuildTempVoices(guild.id); });

async function reconcileDogLeashes() {
  try {
    const restored = await reconcileLeashedMembers(client, ALLOWED_GUILDS);
    if (restored) record("dog_leashes_restored");
  } catch {
    record("dog_reconcile_error");
  }
}

let presenceIndex = 0;
let presenceTimer;
function applyPndPresence() {
  if (!client.user) return;
  const frame = getPndPresenceFrame(presenceIndex++);
  try {
    client.user.setPresence({
      activities: [{ name: frame.name, type: ActivityType[frame.type] }],
      status: "online",
    });
  } catch {
    record("presence_update_error");
  }
}

client.once("ready", async () => {
  record("connected");
  applyPndPresence();
  if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = setInterval(applyPndPresence, PND_PRESENCE_INTERVAL_MS);
  presenceTimer.unref?.();

  // Remove any server that was already present when the gateway connected.
  // This runs before telemetry, economy snapshots, schedulers or command setup.
  const foreignGuilds = client.guilds.cache.filter((guild) => !ALLOWED_GUILDS.includes(guild.id));
  for (const guild of foreignGuilds.values()) {
    await handleGuildCreate(guild, ALLOWED_GUILDS, record);
  }

  // Built-in PND commands belong to the single authorized guild, not the
  // application-wide command namespace. Remove only our known built-in names
  // from the global namespace; leave dashboard/custom commands untouched.
  // Then merge the built-ins one at a time in PND so no custom guild command
  // can be erased by a bulk PUT.
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  const globalCommandRoute = `/applications/${client.application.id}/commands`;
  const commandRoute = `/applications/${client.application.id}/guilds/${PND_GUILD_ID}/commands`;
  void (async () => {
    const builtInNames = new Set(SLASH_COMMANDS.map((command) => command.name));
    const globalCommands = await rest.get(globalCommandRoute);
    for (const command of Array.isArray(globalCommands) ? globalCommands : []) {
      if (command?.type === 1 && builtInNames.has(command.name) && typeof command.id === "string") {
        try {
          await rest.delete(`${globalCommandRoute}/${command.id}`);
        } catch {
          record("global_command_cleanup_error");
        }
      }
    }

    const existing = await rest.get(commandRoute);
    const byName = new Map(
      (Array.isArray(existing) ? existing : [])
        .filter((command) => command?.type === 1 && typeof command?.name === "string" && typeof command?.id === "string")
        .map((command) => [command.name, command]),
    );
    for (const command of SLASH_COMMANDS) {
      const current = byName.get(command.name);
      const body = toDiscordCommand(command);
      if (current) await rest.patch(`${commandRoute}/${current.id}`, { body });
      else await rest.post(commandRoute, { body });
    }
  })()
    .then(() => record("slash_commands_registered"))
    .catch(() => record("slash_commands_registration_error"));

  void reportStatus();
  void reportEconomy();
  const economyTimer = setInterval(() => { void reportEconomy(); }, 5 * 60_000);
  economyTimer.unref?.();
  void reconcileDogLeashes();
  void startConfiguredRadios(client, ALLOWED_GUILDS).then((started) => {
    if (started) record("radio_autostarted");
  }).catch(() => record("radio_autostart_error"));
});
client.on("shardDisconnect", () => { record("disconnected"); void reportStatus(); });
client.on("shardReconnecting", () => { record("reconnecting"); void reportStatus(); });
client.on("shardResume", () => { record("connected"); applyPndPresence(); void reportStatus(); void reconcileDogLeashes(); });
client.on("guildCreate", (guild) => { void handleGuildCreate(guild, ALLOWED_GUILDS, record); });
client.on("error", () => record("gateway_error"));
client.on("shardError", () => record("gateway_error"));

async function handleCoreSlashInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return false;

  const command = interaction.commandName;

  if (command === "status") {
    const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000));
    const uptime = `${Math.floor(seconds / 86400)}j ${Math.floor(seconds / 3600) % 24}h ${Math.floor(seconds / 60) % 60}min`;
    await interaction.reply({
      content: `🟢 **Her? est en ligne**\nConnexion Discord : ${client.isReady() ? "Connecté" : "Déconnecté"}\nSynchronisation : ${lastSync ? "Opérationnelle" : "En attente"}\nTemps de fonctionnement : ${uptime}`,
      ephemeral: true,
    });
    return true;
  }

  if (command === "aide") {
    const embeds = slashCommandsByCategory().map((group) => ({
      title: group.category,
      description: group.commands.map((c) => `**/${c.name}** — ${c.description}`).join("\n"),
    }));
    await interaction.reply({
      content: "🤖 **Commandes V4 de Her?**",
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
      await interaction.followUp({
        content: "Le sondage est publié, mais je n'ai pas pu ajouter les réactions. Vérifie ma permission « Ajouter des réactions ».",
        ephemeral: true,
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

client.on("interactionCreate", (interaction) => {
  if (!interaction.guildId || !ALLOWED_GUILDS.includes(interaction.guildId)) return;
  (async () => {
    if (await handleVoiceAccessRequestInteraction(interaction, settings[interaction.guildId])) return;

    if (await handleSysPlusInteraction(interaction, settings, {
      apiUrl: API,
      secret: BOT_SYNC_SECRET,
      record,
    })) return;

    if (await handleSysPlusBroadcastInteraction(interaction, settings[interaction.guildId], { record })) return;
    if (await handleAntiMoveInteraction(interaction, settings[interaction.guildId], { record })) return;

    if (await handleCoreSlashInteraction(interaction)) return;
    if (await handleGuildGuardInteraction(interaction, settings[interaction.guildId], {
      apiUrl: API,
      secret: BOT_SYNC_SECRET,
      record,
    })) return;
    if (await handleModerationInteraction(interaction, settings[interaction.guildId], { apiUrl: API, secret: BOT_SYNC_SECRET })) return;
    if (await handleVoiceV2Interaction(interaction, settings[interaction.guildId])) return;
    if (await handleGamesInteraction(interaction, settings[interaction.guildId], record)) return;
    if (await handleTicketsInteraction(interaction, settings[interaction.guildId], {
      apiUrl: API,
      secret: BOT_SYNC_SECRET,
      record,
    })) return;
    if (await handleAutomationInteraction(interaction, settings[interaction.guildId], {
      apiUrl: API,
      secret: BOT_SYNC_SECRET,
      record,
    })) return;
    if (await handleV4SlashInteraction(interaction, settings[interaction.guildId])) return;
    if (await handleEconomyInteraction(interaction)) return;
    if (await handleMusicInteraction(interaction)) return;
    await handleVoiceInteraction(interaction, settings[interaction.guildId]?.voiceAccess);
    await handleSavedSlashCommand(interaction);
  })().catch(async (error) => {
    console.error("[bot] interaction_error:", error?.message ?? "Unknown error");
    record("interaction_error");
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "Une erreur est survenue pendant le traitement de cette commande.",
        ephemeral: true,
      }).catch(() => {});
    }
  });
});

await sync();
setInterval(sync, 60_000);
setInterval(reportStatus, 20_000);
startGamesScheduler(client, record, ALLOWED_GUILDS);
startAutomationScheduler(client, record, ALLOWED_GUILDS);
startSysPlusDmScheduler(client, ALLOWED_GUILDS, record);
client.login(DISCORD_TOKEN).catch(() => { record("gateway_error"); process.exitCode = 1; });
