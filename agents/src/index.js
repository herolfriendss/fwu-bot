import Anthropic from "@anthropic-ai/sdk";
import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { Collector, parisDay } from "./collector.js";
import { agentsCommand } from "./commands.js";
import { loadConfig } from "./config.js";
import { Store } from "./db.js";
import { shouldRunDigest } from "./scheduler.js";
import { Supervisor } from "./supervisor.js";

const FLUSH_EVERY_MS = 10 * 60_000;
const TICK_EVERY_MS = 60_000;

const { config, errors } = loadConfig();
if (errors.length || !config.anthropicKeyPresent) {
  console.error("[agents] configuration incomplète :");
  for (const e of errors) console.error(`  - ${e}`);
  if (!config.anthropicKeyPresent) console.error("  - ANTHROPIC_API_KEY manquant");
  process.exit(1);
}

const store = new Store(config.databaseUrl);
await store.migrate();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const collector = new Collector({
  readChannelIds: config.readChannelIds,
  watchedBotIds: config.watchedBotIds,
  pseudonymSecret: config.pseudonymSecret,
});

async function agentsChannel() {
  const ch = await client.channels.fetch(config.channelId);
  if (!ch?.isTextBased()) throw new Error("le salon #agents est introuvable ou n'est pas un salon texte");
  return ch;
}

const supervisor = new Supervisor({
  config,
  store,
  anthropic: new Anthropic(),
  postToAgents: async (payload) => (await agentsChannel()).send({ ...payload, allowedMentions: { parse: [] } }),
  channelNames: () => {
    const guild = client.guilds.cache.get(config.guildId);
    const names = new Map();
    for (const id of config.readChannelIds) names.set(id, guild?.channels.cache.get(id)?.name ?? "salon");
    return names;
  },
});

client.on(Events.MessageCreate, (message) => {
  try {
    collector.onMessage({
      guildMatches: message.guildId === config.guildId,
      channelId: message.channelId,
      authorId: message.author.id,
      authorIsBot: message.author.bot,
      content: message.content,
      slashCommand: message.interaction?.commandName ?? (message.interactionMetadata ? "commande-slash" : null),
    });
  } catch (err) {
    console.error("[agents] collecte :", err.message);
  }
});
client.on(Events.GuildMemberAdd, (m) => collector.onMemberFlow(m.guild.id === config.guildId, "join"));
client.on(Events.GuildMemberRemove, (m) => collector.onMemberFlow(m.guild.id === config.guildId, "leave"));

async function flush() {
  const batch = collector.flush();
  try {
    await store.saveCollected(batch);
  } catch (err) {
    console.error("[agents] écriture en base impossible :", err.message);
  }
}

async function tick() {
  const last = await store.getState("last_digest_day", null);
  if (!shouldRunDigest(new Date(), config.digestHour, last)) return;
  await store.setState("last_digest_day", parisDay());
  await flush();
  const r = await supervisor.runDaily({ trigger: "quotidien" });
  if (!r.ok) console.warn("[agents] résumé quotidien :", r.reason);
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) {
      const reply = await supervisor.handleButton({
        customId: interaction.customId,
        userId: interaction.user.id,
        updateCard: (payload) => interaction.message.edit(payload),
      });
      if (reply) await interaction.reply({ content: reply, flags: MessageFlags.Ephemeral });
      return;
    }
    if (!interaction.isChatInputCommand() || interaction.commandName !== "agents") return;
    if (interaction.user.id !== config.ownerId) {
      await interaction.reply({ content: "Commande réservée au propriétaire.", flags: MessageFlags.Ephemeral });
      return;
    }
    const sub = interaction.options.getSubcommand();
    if (sub === "statut") {
      await interaction.reply({ content: await supervisor.status(), flags: MessageFlags.Ephemeral });
    } else if (sub === "pause" || sub === "reprendre") {
      await supervisor.setPaused(sub === "pause", interaction.user.id);
      await interaction.reply({
        content: sub === "pause" ? "⏸️ Agents en pause. Plus aucun appel à l'IA." : "▶️ Agents relancés.",
        flags: MessageFlags.Ephemeral,
      });
    } else if (sub === "analyser") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await flush();
      const r = await supervisor.runDaily({ trigger: "manuel" });
      await interaction.editReply(
        r.ok ? `Analyse terminée : ${r.created} nouvelle(s) proposition(s) dans #agents.` : `Analyse non lancée : ${r.reason}.`,
      );
    } else if (sub === "propositions") {
      const rows = await store.pendingProposals(15);
      await interaction.reply({
        content: rows.length
          ? rows.map((p) => `#${p.id} · ${p.title} (${p.status === "plus_tard" ? "plus tard" : "en attente"})`).join("\n")
          : "Aucune proposition en attente.",
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (err) {
    console.error("[agents] interaction :", err.message);
    const msg = { content: "Une erreur est survenue, regarde les logs de her-agents.", flags: MessageFlags.Ephemeral };
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) await interaction.editReply(msg.content).catch(() => {});
      else await interaction.reply(msg).catch(() => {});
    }
  }
});

client.once(Events.ClientReady, async () => {
  const guild = await client.guilds.fetch(config.guildId);
  // Application dédiée aux agents : on ne touche qu'à sa propre commande /agents.
  await guild.commands.set([agentsCommand.toJSON()]);
  await store.journal("Superviseur", "demarrage", { readChannels: config.readChannelIds.size });
  console.log(`[agents] connecté en tant que ${client.user.tag}, ${config.readChannelIds.size} salon(s) lu(s).`);
  setInterval(flush, FLUSH_EVERY_MS).unref();
  setInterval(() => tick().catch((e) => console.error("[agents] calendrier :", e.message)), TICK_EVERY_MS).unref();
});

async function shutdown() {
  await flush();
  await client.destroy();
  await store.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await client.login(config.discordToken);
