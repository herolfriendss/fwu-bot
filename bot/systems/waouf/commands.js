import { ChannelType, PermissionFlagsBits } from "discord.js";
import { db } from "../../database.js";
import { sendCentralLog, systemLogEmbed } from "../../logs.js";
import { recordSysPlusAudit } from "../sysplus/audit.js";
import { isSysPlus } from "../sysplus/permissions.js";
import {
  DEFAULT_WAOUF_PHRASES,
  isWaoufExpired,
  parseWaoufDuration,
  sanitizeWaoufPhrase,
  waoufResponse,
  formatWaoufAnnouncement,
} from "./policy.js";

const P = PermissionFlagsBits;
const messageCooldowns = new Map();

function readArray(value, maximum) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === "string").slice(0, maximum)
      : [];
  } catch {
    return [];
  }
}

function getConfig(guildId) {
  const row = db.prepare("SELECT * FROM waouf_config WHERE guild_id=?").get(guildId);
  return {
    channelIds: readArray(row?.channel_ids ?? "[]", 20),
    phrases: readArray(row?.phrases ?? "[]", 20),
    durationMinutes: Number(row?.duration_minutes) || 10,
    repeatAfter: Number(row?.repeat_after) || 3,
    cooldownSeconds: Number(row?.cooldown_seconds) || 15,
  };
}

function saveConfig(guildId, actorId, config) {
  db.prepare(
    `INSERT INTO waouf_config(guild_id,channel_ids,phrases,duration_minutes,repeat_after,cooldown_seconds,updated_by,updated_at)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET
      channel_ids=excluded.channel_ids, phrases=excluded.phrases, duration_minutes=excluded.duration_minutes,
      repeat_after=excluded.repeat_after, cooldown_seconds=excluded.cooldown_seconds,
      updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
  ).run(
    guildId,
    JSON.stringify(config.channelIds),
    JSON.stringify(config.phrases),
    config.durationMinutes,
    config.repeatAfter,
    config.cooldownSeconds,
    actorId,
    Date.now(),
  );
}

async function logWaouf(guild, settings, title, description) {
  await sendCentralLog(
    guild,
    settings,
    systemLogEmbed({ title, description, color: 0x6d28d9 }),
  ).catch(() => {});
}

async function requireSysPlus(interaction, guildSettings) {
  const actor = await interaction.guild.members
    .fetch({ user: interaction.user.id, force: true })
    .catch(() => null);
  if (!actor || !isSysPlus(actor, guildSettings?.sysPlus?.roleId ?? null)) {
    throw new Error("WAOUF est réservé aux membres SYS+.");
  }
  if (!actor.permissions.has(P.ManageMessages)) {
    throw new Error("La permission Discord « Gérer les messages » est requise pour WAOUF.");
  }
  return actor;
}

async function requireChannelAccess(guild, actor, channelId) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText)
    throw new Error("Choisis un salon textuel classique de ce serveur.");
  const bot = await guild.members.fetchMe();
  if (!channel.permissionsFor(actor)?.has(P.ManageMessages)) {
    throw new Error(`Tu dois avoir « Gérer les messages » dans <#${channel.id}>.`);
  }
  const permissions = channel.permissionsFor(bot);
  if (!permissions?.has(P.ManageMessages) || !permissions?.has(P.SendMessages)) {
    throw new Error(
      `Le bot doit avoir « Gérer les messages » et « Envoyer des messages » dans <#${channel.id}>.`,
    );
  }
  return channel;
}

function parseTarget(interaction) {
  return interaction.options.getUser("membre", true);
}

async function expireOne(guild, row, actorId, settings) {
  const result = db
    .prepare("DELETE FROM waouf_active WHERE guild_id=? AND member_id=? AND expires_at<=?")
    .run(guild.id, row.member_id, Date.now());
  if (!result.changes) return false;
  recordSysPlusAudit(guild.id, actorId, "waouf.expire", row.member_id, {
    deletedCount: row.deleted_count,
  });
  await logWaouf(
    guild,
    settings,
    "🐶 WAOUF — activation expirée",
    `Membre : <@${row.member_id}>\nMessages remplacés : **${row.deleted_count}**.`,
  );
  return true;
}

async function executeWaouf(interaction, guildSettings) {
  const guild = interaction.guild;
  const actor = await requireSysPlus(interaction, guildSettings);
  const subcommand = interaction.options.getSubcommand();
  const config = getConfig(guild.id);

  if (subcommand === "canal-ajouter" || subcommand === "canal-retirer") {
    const channel = interaction.options.getChannel("salon", true);
    const fetched =
      subcommand === "canal-ajouter"
        ? await requireChannelAccess(guild, actor, channel.id)
        : await guild.channels.fetch(channel.id).catch(() => null);
    if (!fetched || fetched.type !== ChannelType.GuildText)
      throw new Error("Choisis un salon textuel classique de ce serveur.");
    if (subcommand === "canal-ajouter") {
      if (config.channelIds.includes(fetched.id))
        throw new Error("Ce salon est déjà autorisé pour WAOUF.");
      if (config.channelIds.length >= 20)
        throw new Error("WAOUF accepte au maximum 20 salons par serveur.");
      config.channelIds.push(fetched.id);
    } else {
      if (!config.channelIds.includes(fetched.id))
        throw new Error("Ce salon n’est pas configuré pour WAOUF.");
      config.channelIds = config.channelIds.filter((id) => id !== fetched.id);
    }
    saveConfig(guild.id, actor.id, config);
    const action = subcommand === "canal-ajouter" ? "channel_add" : "channel_remove";
    recordSysPlusAudit(guild.id, actor.id, `waouf.${action}`, fetched.id);
    await logWaouf(
      guild,
      guildSettings,
      "🐶 WAOUF — configuration des salons",
      `Acteur : <@${actor.id}>\nSalon : <#${fetched.id}>\nAction : ${subcommand}.`,
    );
    return `✅ <#${fetched.id}> ${subcommand === "canal-ajouter" ? "est autorisé" : "n’est plus autorisé"} pour WAOUF.`;
  }

  if (subcommand === "phrase-ajouter") {
    const phrase = sanitizeWaoufPhrase(interaction.options.getString("phrase", true));
    if (config.phrases.length >= 20)
      throw new Error("WAOUF accepte au maximum 20 phrases personnalisées.");
    config.phrases.push(phrase);
    saveConfig(guild.id, actor.id, config);
    recordSysPlusAudit(guild.id, actor.id, "waouf.phrase_add", null, {
      phraseCount: config.phrases.length,
    });
    return "✅ Phrase WAOUF ajoutée. Les mentions globales ne seront jamais déclenchées.";
  }

  if (subcommand === "phrase-retirer") {
    const index = interaction.options.getInteger("numero", true) - 1;
    if (index < 0 || index >= config.phrases.length)
      throw new Error("Numéro de phrase introuvable. Consulte `/wouaf statut`.");
    config.phrases.splice(index, 1);
    saveConfig(guild.id, actor.id, config);
    recordSysPlusAudit(guild.id, actor.id, "waouf.phrase_remove", null, {
      phraseCount: config.phrases.length,
    });
    return "✅ Phrase WAOUF retirée.";
  }

  if (subcommand === "duree") {
    config.durationMinutes = parseWaoufDuration(interaction.options.getInteger("minutes", true));
    saveConfig(guild.id, actor.id, config);
    recordSysPlusAudit(guild.id, actor.id, "waouf.duration", null, {
      minutes: config.durationMinutes,
    });
    return `✅ Durée WAOUF par défaut : **${config.durationMinutes} minute(s)**.`;
  }

  if (subcommand === "repetitions") {
    config.repeatAfter = Math.max(2, Math.min(20, interaction.options.getInteger("nombre", true)));
    saveConfig(guild.id, actor.id, config);
    recordSysPlusAudit(guild.id, actor.id, "waouf.repeat_after", null, {
      count: config.repeatAfter,
    });
    return `✅ Les phrases personnalisées commencent après **${config.repeatAfter} messages**.`;
  }

  if (subcommand === "cooldown") {
    config.cooldownSeconds = Math.max(
      5,
      Math.min(300, interaction.options.getInteger("secondes", true)),
    );
    saveConfig(guild.id, actor.id, config);
    recordSysPlusAudit(guild.id, actor.id, "waouf.cooldown", null, {
      seconds: config.cooldownSeconds,
    });
    return `✅ Une réponse WAOUF sera publiée au plus toutes les **${config.cooldownSeconds} secondes** par membre.`;
  }

  if (subcommand === "activer") {
    if (!config.channelIds.length)
      throw new Error("Configure au moins un salon avec `/wouaf canal-ajouter`.");
    for (const channelId of config.channelIds) await requireChannelAccess(guild, actor, channelId);
    const targetUser = parseTarget(interaction);
    const target = await guild.members
      .fetch({ user: targetUser.id, force: true })
      .catch(() => null);
    if (!target || target.user.bot || target.id === guild.ownerId)
      throw new Error("Cette cible ne peut pas être activée pour WAOUF.");
    const duration =
      interaction.options.getInteger("duree_minutes") == null
        ? config.durationMinutes
        : parseWaoufDuration(interaction.options.getInteger("duree_minutes"));
    const startedAt = Date.now();
    const expiresAt = startedAt + duration * 60_000;
    db.prepare(
      `INSERT INTO waouf_active(guild_id,member_id,started_by,started_at,expires_at,deleted_count)
      VALUES(?,?,?,?,?,0) ON CONFLICT(guild_id,member_id) DO UPDATE SET
      started_by=excluded.started_by,started_at=excluded.started_at,expires_at=excluded.expires_at,deleted_count=0`,
    ).run(guild.id, target.id, actor.id, startedAt, expiresAt);
    recordSysPlusAudit(guild.id, actor.id, "waouf.activate", target.id, {
      durationMinutes: duration,
      channelCount: config.channelIds.length,
    });
    await logWaouf(
      guild,
      guildSettings,
      "🐶 WAOUF — membre activé",
      `Acteur SYS+ : <@${actor.id}>\nMembre : <@${target.id}>\nDurée : **${duration} minute(s)**.`,
    );
    return `🐶 WAOUF est actif pour <@${target.id}> dans les salons configurés jusqu’à <t:${Math.floor(expiresAt / 1000)}:R>.`;
  }

  if (subcommand === "stop") {
    const target = parseTarget(interaction);
    const row = db
      .prepare("SELECT deleted_count FROM waouf_active WHERE guild_id=? AND member_id=?")
      .get(guild.id, target.id);
    if (!row) throw new Error("WAOUF n’est pas actif pour ce membre.");
    db.prepare("DELETE FROM waouf_active WHERE guild_id=? AND member_id=?").run(
      guild.id,
      target.id,
    );
    recordSysPlusAudit(guild.id, actor.id, "waouf.stop", target.id, {
      deletedCount: row.deleted_count,
    });
    await logWaouf(
      guild,
      guildSettings,
      "🛑 WAOUF — arrêt immédiat",
      `Acteur SYS+ : <@${actor.id}>\nMembre : <@${target.id}>\nMessages remplacés : **${row.deleted_count}**.`,
    );
    return `🛑 WAOUF est arrêté immédiatement pour <@${target.id}>.`;
  }

  if (subcommand === "stop-tout") {
    const rows = db
      .prepare("SELECT member_id,deleted_count FROM waouf_active WHERE guild_id=?")
      .all(guild.id);
    db.prepare("DELETE FROM waouf_active WHERE guild_id=?").run(guild.id);
    recordSysPlusAudit(guild.id, actor.id, "waouf.stop_all", null, { stoppedCount: rows.length });
    await logWaouf(
      guild,
      guildSettings,
      "🛑 WAOUF — arrêt général",
      `Acteur SYS+ : <@${actor.id}>\nActivations arrêtées : **${rows.length}**.`,
    );
    return `🛑 WAOUF est arrêté pour tout le serveur (${rows.length} activation(s)).`;
  }

  if (subcommand === "statut") {
    const now = Date.now();
    const active = db
      .prepare(
        "SELECT member_id,expires_at,deleted_count FROM waouf_active WHERE guild_id=? AND expires_at>? ORDER BY expires_at LIMIT 50",
      )
      .all(guild.id, now);
    const channels = config.channelIds.length
      ? config.channelIds.map((id) => `<#${id}>`).join(", ")
      : "Aucun";
    const phrases = config.phrases.length
      ? config.phrases
          .map((phrase, index) => `${index + 1}. ${phrase}`)
          .join("\n")
          .slice(0, 1_500)
      : "Phrases par défaut";
    const activations =
      active
        .map(
          (row) =>
            `• <@${row.member_id}> — <t:${Math.floor(row.expires_at / 1000)}:R>, ${row.deleted_count} message(s) remplacé(s)`,
        )
        .join("\n") || "Aucune";
    return `**Salons autorisés :** ${channels}\n**Durée par défaut :** ${config.durationMinutes} min\n**Phrases après :** ${config.repeatAfter} messages\n**Cooldown :** ${config.cooldownSeconds} s\n**Phrases :**\n${phrases}\n**Activations :**\n${activations}`;
  }

  throw new Error("Sous-commande WAOUF inconnue.");
}

export async function handleWaoufInteraction(interaction, guildSettings = {}, record = () => {}) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "wouaf") return false;
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "WAOUF fonctionne uniquement dans un serveur.",
      ephemeral: true,
    });
    return true;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    await interaction.editReply(await executeWaouf(interaction, guildSettings));
  } catch (error) {
    record("waouf_error");
    await interaction.editReply(error.message);
  }
  return true;
}

export async function handleWaoufMessage(message, settingsByGuild, record = () => {}) {
  if (!message.guild || message.author.bot) return false;
  const row = db
    .prepare(
      "SELECT started_by,expires_at,deleted_count FROM waouf_active WHERE guild_id=? AND member_id=?",
    )
    .get(message.guild.id, message.author.id);
  if (!row) return false;
  if (isWaoufExpired(row.expires_at)) {
    const settings = settingsByGuild?.[message.guild.id] ?? {};
    await expireOne(
      message.guild,
      { ...row, member_id: message.author.id },
      message.guild.client.user?.id ?? row.started_by,
      settings,
    );
    return false;
  }

  const config = getConfig(message.guild.id);
  if (!config.channelIds.includes(message.channel.id)) return false;
  const bot = await message.guild.members.fetchMe();
  const permissions = message.channel.permissionsFor(bot);
  if (!permissions?.has(P.ManageMessages) || !permissions?.has(P.SendMessages)) {
    record("waouf_permission_error");
    return false;
  }

  const current = db
    .prepare("SELECT expires_at FROM waouf_active WHERE guild_id=? AND member_id=?")
    .get(message.guild.id, message.author.id);
  if (!current || isWaoufExpired(current.expires_at)) return false;

  await message.delete();
  const updated = db
    .prepare(
      `UPDATE waouf_active SET deleted_count=deleted_count+1
    WHERE guild_id=? AND member_id=? AND expires_at>? RETURNING deleted_count`,
    )
    .get(message.guild.id, message.author.id, Date.now());
  if (!updated) return true;
  const cooldownKey = `${message.guild.id}:${message.author.id}`;
  const lastResponse = messageCooldowns.get(cooldownKey) ?? 0;
  if (Date.now() - lastResponse >= config.cooldownSeconds * 1000) {
    const response = waoufResponse(
      Number(updated.deleted_count),
      config.repeatAfter,
      config.phrases,
      message.author.id,
    );
    messageCooldowns.set(cooldownKey, Date.now());
    const authorLabel = message.member?.displayName || message.author.globalName || message.author.username;
    await message.channel.send({
      content: formatWaoufAnnouncement(authorLabel, response),
      allowedMentions: { parse: [] },
    });
  }
  if (messageCooldowns.size > 5_000) {
    const cutoff = Date.now() - 60 * 60_000;
    for (const [key, at] of messageCooldowns) if (at < cutoff) messageCooldowns.delete(key);
  }
  return true;
}

export async function expireWaoufActions(client, settingsByGuild = {}) {
  const rows = db
    .prepare(
      "SELECT guild_id,member_id,started_by,expires_at,deleted_count FROM waouf_active WHERE expires_at<=? ORDER BY expires_at",
    )
    .all(Date.now());
  let expired = 0;
  for (const row of rows) {
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) {
      const result = db
        .prepare("DELETE FROM waouf_active WHERE guild_id=? AND member_id=? AND expires_at<=?")
        .run(row.guild_id, row.member_id, Date.now());
      if (result.changes)
        recordSysPlusAudit(row.guild_id, row.started_by, "waouf.expire", row.member_id, {
          deletedCount: row.deleted_count,
        });
      expired += Number(result.changes);
      continue;
    }
    if (
      await expireOne(
        guild,
        row,
        client.user?.id ?? row.started_by,
        settingsByGuild[row.guild_id] ?? {},
      )
    )
      expired++;
  }
  return expired;
}
