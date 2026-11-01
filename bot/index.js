// Bot Discord 24h/24 — à lancer sur ton VPS. Les réglages viennent du site (onglet « Bot 24h/24 »).
import { Client, GatewayIntentBits, Partials, PermissionFlagsBits, REST, Routes } from "discord.js";
import { SLASH_COMMANDS, toDiscordCommand } from "../src/lib/slash-commands.ts";
import { resolvePrefixCommand } from "./prefix-commands.js";
import { handleVoiceMessage, handleVoiceInteraction } from "./voice-commands.js";
import { handleSysPlusMessage, handleSysPlusInteraction } from "./systems/sysplus/commands.js";
import { enforceLeashNickname, handleDogCommand, handleLeashVoiceState, reconcileLeashedMembers } from "./dog-commands.js";
import { handleMusicMessage, handleMusicInteraction, handleRadioMessage, startConfiguredRadios } from "./music/music.js";
import { handleEconomyMessage, handleEconomyInteraction, recoverBlackjackGames } from "./economy.js";

const { DISCORD_TOKEN, SITE_URL, BOT_SYNC_SECRET } = process.env;
if (!DISCORD_TOKEN || !SITE_URL || !BOT_SYNC_SECRET) {
  console.error("❌ Remplis DISCORD_TOKEN, SITE_URL et BOT_SYNC_SECRET dans le fichier .env");
  process.exit(1);
}
const API = `${SITE_URL.replace(/\/$/, "")}/api/public/bot-sync`;
const AUTH = { Authorization: `Bearer ${BOT_SYNC_SECRET}` };
const STATUS_API = `${SITE_URL.replace(/\/$/, "")}/api/public/bot-status`;
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
      body: JSON.stringify({ connected: client.isReady(), startedAt, lastSync, events }),
    });
    if (!res.ok) console.error("Envoi du statut impossible.");
  } catch { console.error("Envoi du statut impossible."); }
  finally { reporting = false; }
}
record("started");
recoverBlackjackGames();

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

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel],
});

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
  try {
    if (await handleDogCommand(msg)) return;
    if (await handleRadioMessage(msg)) return;
    if (await handleMusicMessage(msg)) return;
    if (await handleVoiceMessage(msg, settings[msg.guild.id]?.voiceAccess)) return;
    if (await handleEconomyMessage(msg)) return;
  } catch { record("voice_error"); return; }
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
    if (await handleSysPlusMessage(msg, s, { apiUrl: API, secret: BOT_SYNC_SECRET, record })) return;
    // Message commands are checked before AI and keyword responses.
    const command = resolvePrefixCommand(s.prefixCommands ?? [], msg.content, msg.member?.permissions.bitfield.toString() ?? "0");
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
  const w = settings[member.guild.id]?.welcome;
  if (!w?.enabled || !w.channelId) return;
  const channel = await member.guild.channels.fetch(w.channelId).catch(() => null);
  if (channel?.isTextBased()) {
    await channel.send({ content: fill(w.message, { user: `<@${member.id}>`, server: member.guild.name }), allowedMentions: noMentions }).catch(() => record("welcome_error"));
  }
});

client.on("guildMemberUpdate", (oldMember, newMember) => {
  const nicknameChanged = oldMember.nickname !== newMember.nickname;
  const rolesChanged = oldMember.roles.cache.size !== newMember.roles.cache.size
    || oldMember.roles.cache.some((role) => !newMember.roles.cache.has(role.id));
  if (!nicknameChanged && !rolesChanged) return;
  enforceLeashNickname(newMember)
    .then((restored) => { if (restored) record("dog_nickname_restored"); })
    .catch(() => record("dog_enforcement_error"));
});

client.on("voiceStateUpdate", (oldState, newState) => {
  handleLeashVoiceState(oldState, newState)
    .then((moved) => { if (moved) record("dog_voice_returned"); })
    .catch(() => record("dog_voice_error"));
});

async function reconcileDogLeashes() {
  try {
    const restored = await reconcileLeashedMembers(client);
    if (restored) record("dog_leashes_restored");
  } catch {
    record("dog_reconcile_error");
  }
}

client.once("ready", () => {
  record("connected");

  const slashCommands = SLASH_COMMANDS
    .filter((command) => command.name === "sysp")
    .map(toDiscordCommand);

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  void rest.put(Routes.applicationCommands(client.application.id), { body: slashCommands })
    .then(() => record("slash_commands_registered"))
    .catch(() => record("slash_commands_registration_error"));

  void reportStatus();
  void reconcileDogLeashes();
  void startConfiguredRadios(client).then((started) => {
    if (started) record("radio_autostarted");
  }).catch(() => record("radio_autostart_error"));
});
client.on("shardDisconnect", () => { record("disconnected"); void reportStatus(); });
client.on("shardReconnecting", () => { record("reconnecting"); void reportStatus(); });
client.on("shardResume", () => { record("connected"); void reportStatus(); void reconcileDogLeashes(); });
client.on("error", () => record("gateway_error"));
client.on("shardError", () => record("gateway_error"));

client.on("interactionCreate", (interaction) => {
  (async () => {
    if (await handleSysPlusInteraction(interaction, settings, {
      apiUrl: API,
      secret: BOT_SYNC_SECRET,
      record,
    })) return;
    if (await handleEconomyInteraction(interaction)) return;
    if (await handleMusicInteraction(interaction)) return;
    await handleVoiceInteraction(interaction, settings[interaction.guildId]?.voiceAccess);
  })().catch(() => record("interaction_error"));
});

await sync();
setInterval(sync, 60_000);
setInterval(reportStatus, 20_000);
client.login(DISCORD_TOKEN).catch(() => { record("gateway_error"); process.exitCode = 1; });
