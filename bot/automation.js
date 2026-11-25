// Her? V4 — automatisation : rôles automatiques, MP de bienvenue et messages planifiés.
import { EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { assertRoleGrantable, filterGrantableRoleIds } from "./role-grant-guard.js";
import { db } from "./database.js";
import { herBotAvatar, themePanelEmbed } from "./theme.js";
import { updateModuleSettings } from "./module-settings.js";
import {
  autoRolePlan, clampInterval, isDue, nextRunAt, renderAutomation, sanitizeAutomationContent,
} from "./automation-policy.js";

const P = PermissionFlagsBits;

function canManage(guild, member) {
  return guild.ownerId === member.id || member.permissions.has(P.ManageGuild) || member.permissions.has(P.Administrator);
}

/** Applique les rôles automatiques et le MP de bienvenue à une nouvelle arrivée. */
export async function handleAutomationJoin(member, settings, record = () => {}) {
  const automation = settings?.automation;
  if (!automation || member.user.bot) return false;
  let touched = false;

  if (Array.isArray(automation.autoRoleIds) && automation.autoRoleIds.length) {
    const bot = member.guild.members.me ?? await member.guild.members.fetchMe().catch(() => null);
    const botPosition = bot?.roles?.highest?.position ?? 0;
    const fetched = await Promise.all(
      automation.autoRoleIds.map((roleId) => member.guild.roles.fetch(roleId).catch(() => null)),
    );
    const rolePositions = Object.fromEntries(
      fetched.filter((role) => role && !role.managed).map((role) => [role.id, role.position]),
    );
    const plan = autoRolePlan(automation.autoRoleIds, {
      botPosition,
      rolePositions,
      memberRoleIds: [...member.roles.cache.keys()],
    });
    const grantable = await filterGrantableRoleIds(member.guild, plan.applicable, { settings, onRefused: () => record("automation_autorole_protected") });
    for (const roleId of grantable) {
      try {
        await member.roles.add(roleId, "Rôle automatique FWU");
        touched = true;
        record("automation_autorole_applied");
      } catch {
        record("automation_error");
      }
    }
  }

  if (automation.welcomeDm) {
    const content = renderAutomation(automation.welcomeDmMessage, {
      server: member.guild.name,
      user: member.user.username,
    });
    if (content) {
      await member.send({ content, allowedMentions: { parse: [] } })
        .then(() => record("automation_welcome_dm"))
        .catch(() => record("automation_error"));
    }
  }
  return touched;
}

export function runAutomationTick(client, record = () => {}) {
  const due = db.prepare("SELECT * FROM automation_messages WHERE enabled=1 AND next_run_at<=? ORDER BY next_run_at ASC LIMIT 20").all(Date.now());
  for (const row of due) {
    const interval = clampInterval(row.interval_minutes);
    db.prepare("UPDATE automation_messages SET next_run_at=? WHERE id=?").run(nextRunAt(Date.now(), interval), row.id);
    void (async () => {
      try {
        const channel = await client.channels.fetch(row.channel_id).catch(() => null);
        if (!channel?.isTextBased()) {
          record("automation_error");
          return;
        }
        const guild = channel.guild;
        await channel.send({
          content: renderAutomation(row.content, { server: guild?.name ?? "le serveur" }),
          allowedMentions: { parse: [] },
        });
        record("automation_message_sent");
      } catch {
        record("automation_error");
      }
    })();
  }
  return due.length;
}

export function startAutomationScheduler(client, record = () => {}, shouldRun = () => true) {
  const timer = setInterval(() => {
    if (!shouldRun()) return; runAutomationTick(client, record); }, 60_000);
  timer.unref?.();
  return timer;
}

function scheduleEmbed(guild) {
  const rows = db.prepare("SELECT * FROM automation_messages WHERE guild_id=? ORDER BY id ASC LIMIT 20").all(guild.id);
  const lines = rows.map((row) => `• \`#${row.id}\` <#${row.channel_id}> — toutes les **${row.interval_minutes} min** · ${row.enabled ? "actif" : "désactivé"} · prochain <t:${Math.floor(Number(row.next_run_at) / 1000)}:R>`);
  return themePanelEmbed(new EmbedBuilder()
    .setTitle("🌙 Messages planifiés")
    .setDescription(lines.length ? lines.join("\n") : "Aucun message planifié sur ce serveur."), { thumbnailUrl: herBotAvatar(guild) });
}

export async function handleAutomationInteraction(interaction, guildSettings = {}, { apiUrl, secret, record = () => {} } = {}) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "automation") return false;
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Cette commande doit être utilisée sur un serveur.", ephemeral: true });
    return true;
  }
  const member = interaction.member ?? await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member || !canManage(guild, member)) {
    await interaction.reply({ content: "⛔ Réservé au propriétaire ou aux membres ayant Gérer le serveur.", ephemeral: true });
    return true;
  }
  const settings = guildSettings ?? {};
  const automation = { ...(settings.automation ?? { autoRoleIds: [], welcomeDm: false, welcomeDmMessage: "" }) };
  const subcommand = interaction.options.getSubcommand();

  if (interaction.options.getSubcommandGroup(false) === "regles") {
    // Same engine as the former =autorule (preview + staff confirmation).
    const { runPrefixFromSlash } = await import("./v4-commands.js");
    const { handleAutomationRulesMessage } = await import("./automation-rules-commands.js");
    const o = interaction.options;
    const clean = (value) => String(value ?? "").replace(/\|/g, "¦").trim();
    let content = "=autorule list";
    if (subcommand === "salon") content = `=autorule channel <#${o.getChannel("salon", true).id}>`;
    else if (subcommand === "desactiver") content = `=autorule disable ${clean(o.getString("id", true))}`;
    else if (subcommand === "confirmer") content = `=autorule confirm ${clean(o.getString("run", true))}`;
    else if (subcommand === "creer") {
      const trigger = o.getString("declencheur", true);
      const action = o.getString("action", true);
      const channel = o.getChannel("salon");
      const role = o.getRole("role");
      const actionSpec = action === "message" ? `message ${channel ? `<#${channel.id}>` : ""}` : `${action} ${role ? `<@&${role.id}>` : ""}`;
      const fields = [trigger, clean(o.getString("nom", true))];
      if (trigger === "scheduled") fields.push(`every ${o.getInteger("intervalle") ?? 60}`);
      fields.push(actionSpec.trim());
      if (action === "message") fields.push(clean(o.getString("texte")));
      content = `=autorule create ${fields.join(" | ")}`;
    }
    return runPrefixFromSlash(interaction, content, (message) => handleAutomationRulesMessage(message));
  }

  try {
    if (subcommand === "status") {
      const schedules = db.prepare("SELECT COUNT(*) AS count FROM automation_messages WHERE guild_id=? AND enabled=1").get(guild.id).count;
      await interaction.reply({
        embeds: [themePanelEmbed(new EmbedBuilder()
          .setTitle("🌙 Automatisation")
          .addFields(
            { name: "Rôles automatiques", value: automation.autoRoleIds.length ? automation.autoRoleIds.map((id) => `<@&${id}>`).join(", ") : "Aucun", inline: false },
            { name: "MP de bienvenue", value: automation.welcomeDm ? "Activé" : "Désactivé", inline: true },
            { name: "Messages planifiés actifs", value: String(schedules), inline: true },
            { name: "Serveur", value: `${guild.name} (${guild.id})`, inline: false },
          ))],
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return true;
    }

    if (subcommand === "autorole-add" || subcommand === "autorole-remove") {
      const role = interaction.options.getRole("role", true);
      if (role.managed || role.id === guild.id) throw new Error("Choisis un rôle normal du serveur.");
      if (subcommand === "autorole-add") {
        const bot = guild.members.me ?? await guild.members.fetchMe();
        if (role.position >= bot.roles.highest.position) throw new Error("Le rôle doit être placé sous le rôle du bot.");
        // Donné à chaque arrivant : jamais de rôle d'accès, de palier ou à permissions sensibles.
        await assertRoleGrantable(guild, role, { automatic: true, settings });
      }
      const ids = subcommand === "autorole-add"
        ? [...new Set([...automation.autoRoleIds, role.id])].slice(0, 10)
        : automation.autoRoleIds.filter((id) => id !== role.id);
      const saved = await updateModuleSettings({ apiUrl, secret, guildId: guild.id, module: "automation", value: { ...automation, autoRoleIds: ids }, actorId: interaction.user.id });
      settings.automation = saved.automation;
      record("automation_updated");
      await interaction.reply({ content: subcommand === "autorole-add" ? `✅ Le rôle **${role.name}** sera attribué automatiquement.` : `🗑️ Le rôle **${role.name}** ne sera plus attribué automatiquement.`, ephemeral: true, allowedMentions: { parse: [] } });
      return true;
    }

    if (subcommand === "autorole-list") {
      const lines = automation.autoRoleIds.map((id) => `<@&${id}>`);
      await interaction.reply({ content: lines.length ? `Rôles automatiques : ${lines.join(", ")}` : "Aucun rôle automatique configuré.", ephemeral: true, allowedMentions: { parse: [] } });
      return true;
    }

    if (subcommand === "welcome") {
      const enabled = interaction.options.getString("etat", true) === "on";
      const message = interaction.options.getString("message");
      const content = message ? sanitizeAutomationContent(message) : automation.welcomeDmMessage;
      const saved = await updateModuleSettings({
        apiUrl, secret, guildId: guild.id, module: "automation",
        value: { ...automation, welcomeDm: enabled, welcomeDmMessage: content || automation.welcomeDmMessage },
        actorId: interaction.user.id,
      });
      settings.automation = saved.automation;
      record("automation_updated");
      await interaction.reply({
        content: enabled ? `✅ MP de bienvenue activé${content ? ` : ${content.slice(0, 200)}` : ""}.` : "✅ MP de bienvenue désactivé.",
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return true;
    }

    if (subcommand === "schedule-add") {
      const channel = interaction.options.getChannel("salon", true);
      if (!channel.isTextBased()) throw new Error("Choisis un salon textuel.");
      const interval = clampInterval(interaction.options.getInteger("intervalle", true));
      const content = sanitizeAutomationContent(interaction.options.getString("message", true));
      if (!content) throw new Error("Le message ne peut pas être vide.");
      const now = Date.now();
      const result = db.prepare("INSERT INTO automation_messages(guild_id,channel_id,content,interval_minutes,next_run_at,enabled,created_at) VALUES(?,?,?,?,?,1,?)")
        .run(guild.id, channel.id, content, interval, nextRunAt(now, interval), now);
      record("automation_schedule_created");
      await interaction.reply({ content: `✅ Message \`#${Number(result.lastInsertRowid)}\` planifié dans <#${channel.id}> toutes les ${interval} minutes.`, ephemeral: true, allowedMentions: { parse: [] } });
      return true;
    }

    if (subcommand === "schedule-remove") {
      const id = interaction.options.getInteger("id", true);
      const result = db.prepare("DELETE FROM automation_messages WHERE id=? AND guild_id=?").run(id, guild.id);
      if (!result.changes) throw new Error("Message planifié introuvable sur ce serveur.");
      record("automation_schedule_removed");
      await interaction.reply({ content: `🗑️ Message planifié \`#${id}\` supprimé.`, ephemeral: true });
      return true;
    }

    if (subcommand === "schedule-list") {
      await interaction.reply({ embeds: [scheduleEmbed(guild)], ephemeral: true });
      return true;
    }
  } catch (error) {
    const content = `❌ ${error instanceof Error ? error.message : "Action impossible."}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {});
    else await interaction.reply({ content, ephemeral: true }).catch(() => {});
    return true;
  }
  return true;
}

export async function handleAutomationMessage(message, guildSettings = {}, { apiUrl, secret, record = () => {} } = {}) {
  if (!message.guild || !message.member) return false;
  const parts = message.content.trim().split(/\s+/);
  if ((parts[0] ?? "").toLowerCase() !== "=automation") return false;
  if (!canManage(message.guild, message.member)) {
    await message.reply({ content: "⛔ Réservé au propriétaire ou aux membres ayant Gérer le serveur.", allowedMentions: { parse: [] } });
    return true;
  }
  const automation = { ...(guildSettings?.automation ?? { autoRoleIds: [], welcomeDm: false, welcomeDmMessage: "Bienvenue sur {server} !" }) };
  const action = (parts[1] ?? "status").toLowerCase();
  const gid = message.guild.id;
  try {
    if (action === "schedule") {
      const sub = (parts[2] ?? "list").toLowerCase();
      if (sub === "add") {
        const channel = message.mentions.channels.first();
        const interval = clampInterval(parts[4]);
        const content = sanitizeAutomationContent(parts.slice(5).join(" "));
        if (!channel || !content) throw new Error("Utilisation : `=automation schedule add #salon intervalle message`.");
        const now = Date.now();
        const result = db.prepare("INSERT INTO automation_messages(guild_id,channel_id,content,interval_minutes,next_run_at,enabled,created_at) VALUES(?,?,?,?,?,1,?)")
          .run(gid, channel.id, content, interval, nextRunAt(now, interval), now);
        record("automation_schedule_created");
        await message.reply({ content: `✅ Message \`#${Number(result.lastInsertRowid)}\` planifié dans <#${channel.id}> toutes les ${interval} minutes.`, allowedMentions: { parse: [] } });
      } else if (sub === "remove") {
        const id = Number(parts[3]);
        const result = db.prepare("DELETE FROM automation_messages WHERE id=? AND guild_id=?").run(id, gid);
        if (!result.changes) throw new Error("Message planifié introuvable sur ce serveur.");
        record("automation_schedule_removed");
        await message.reply({ content: `🗑️ Message planifié \`#${id}\` supprimé.`, allowedMentions: { parse: [] } });
      } else {
        await message.reply({ embeds: [scheduleEmbed(message.guild)], allowedMentions: { parse: [] } });
      }
      return true;
    }

    if (action === "welcome") {
      const enabled = (parts[2] ?? "off").toLowerCase() === "on";
      const text = sanitizeAutomationContent(parts.slice(3).join(" "));
      const saved = await updateModuleSettings({
        apiUrl, secret, guildId: gid, module: "automation",
        value: { ...automation, welcomeDm: enabled, welcomeDmMessage: text || automation.welcomeDmMessage },
        actorId: message.author.id,
      });
      guildSettings.automation = saved.automation;
      record("automation_updated");
      await message.reply({ content: `✅ MP de bienvenue ${enabled ? "activé" : "désactivé"}.`, allowedMentions: { parse: [] } });
      return true;
    }

    if (action === "autorole") {
      const sub = (parts[2] ?? "list").toLowerCase();
      const roleId = message.mentions.roles.first()?.id;
      if (sub === "add" && roleId) {
        automation.autoRoleIds = [...new Set([...automation.autoRoleIds, roleId])].slice(0, 10);
      } else if (sub === "remove" && roleId) {
        automation.autoRoleIds = automation.autoRoleIds.filter((id) => id !== roleId);
      } else if (sub !== "list") {
        throw new Error("Utilisation : `=automation autorole add|remove @Rôle` ou `=automation autorole list`.");
      }
      if (sub === "add" || sub === "remove") {
        const saved = await updateModuleSettings({ apiUrl, secret, guildId: gid, module: "automation", value: automation, actorId: message.author.id });
        guildSettings.automation = saved.automation;
        record("automation_updated");
      }
      const lines = automation.autoRoleIds.map((id) => `<@&${id}>`);
      await message.reply({ content: lines.length ? `Rôles automatiques : ${lines.join(", ")}` : "Aucun rôle automatique configuré.", allowedMentions: { parse: [] } });
      return true;
    }

    const schedules = db.prepare("SELECT COUNT(*) AS count FROM automation_messages WHERE guild_id=? AND enabled=1").get(gid).count;
    await message.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xe21d2f)
        .setTitle("🤖 Automatisation")
        .setDescription(`Messages planifiés actifs : **${schedules}**\nRôles automatiques : ${automation.autoRoleIds.length ? automation.autoRoleIds.map((id) => `<@&${id}>`).join(", ") : "aucun"}\nMP de bienvenue : **${automation.welcomeDm ? "activé" : "désactivé"}**`)],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    await message.reply({ content: `❌ ${error instanceof Error ? error.message : "Action impossible."}`, allowedMentions: { parse: [] } }).catch(() => {});
  }
  return true;
}
