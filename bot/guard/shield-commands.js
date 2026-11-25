// /bouclier — trap channel, server snapshots and lockdown.
// Restoring and locking down are heavy, so both ask for a confirmation first.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits as P } from "discord.js";
import { applyBanner } from "../banners.js";
import { parsePndOwnerId } from "../pnd-owner-policy.js";
import { autoconfigValue } from "../autoconfig.js";
import * as S from "./shield.js";
import { autoIncidentNotice, recordGuardIncident, resolveGuardLockdownIncident } from "../systems/sysplus/auto-incidents.js";

export const SHIELD_COMMANDS = new Set(["bouclier"]);
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });

const isOwner = (member) =>
  member?.id === parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID) || member?.id === member?.guild?.ownerId;
const isAdmin = (member) => isOwner(member) || Boolean(member?.permissions?.has?.(P.Administrator));

const card = (title) => applyBanner(new EmbedBuilder().setColor(0xe21d2f).setTitle(title), "securite");

const TRAP_NOTICE = [
  "# ⛔ Ne poste rien dans ce salon",
  "",
  "Ce salon est un piège anti-robot. Les comptes compromis et les robots de spam écrivent dans tous les salons qu'ils voient : celui-ci sert à les repérer tout de suite.",
  "",
  "**Tout message posté ici déclenche une sanction automatique.** Le staff et les robots du serveur ne risquent rien.",
].join("\n");

async function createTrap(interaction) {
  const action = interaction.options.getString("action") ?? "quarantaine";
  const existing = interaction.options.getChannel("salon");
  let channel = existing;

  if (!channel) {
    channel = await interaction.guild.channels.create({
      name: "🎁・cadeaux-gratuits",
      type: ChannelType.GuildText,
      topic: "Piège anti-robot — n'écris jamais ici.",
      reason: "GUARD : salon piège",
      permissionOverwrites: [{ id: interaction.guild.id, allow: [P.ViewChannel, P.SendMessages] }],
    }).catch(() => null);
    if (!channel) throw new Error("Création du salon impossible : vérifie la permission Gérer les salons.");
    const notice = await channel.send({ content: TRAP_NOTICE, allowedMentions: { parse: [] } }).catch(() => null);
    await notice?.pin().catch(() => {});
  }

  S.saveHoneypot(interaction.guildId, channel.id, action);
  await interaction.reply({
    embeds: [card("🪤 Salon piège armé").setDescription([
      `Salon : <#${channel.id}>`,
      `Sanction : **${action}**`,
      "",
      "Le staff, l'OWNER et les robots ne déclenchent jamais le piège.",
      existing ? "⚠️ Tu as désigné un salon existant : vérifie qu'il contient bien un avertissement visible." : "Un avertissement épinglé explique aux membres de ne rien y écrire.",
    ].join("\n"))],
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

async function snapshotNow(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const payload = S.captureGuild(interaction.guild);
  const id = S.saveSnapshot({
    guildId: interaction.guildId, label: interaction.options.getString("nom"),
    payload, createdBy: interaction.user.id,
  });
  await interaction.editReply({
    embeds: [card("💾 Sauvegarde enregistrée").setDescription(
      `Sauvegarde **#${id}** : ${payload.roles.length} rôle(s) et ${payload.channels.length} salon(s).\n`
      + `Les ${S.MAX_SNAPSHOTS} dernières sont conservées. Restaure avec \`/bouclier restaurer\`.`,
    )],
  });
  return true;
}

async function listSnapshots(interaction) {
  const rows = S.listSnapshots(interaction.guildId);
  await interaction.reply({
    embeds: [card("💾 Sauvegardes du serveur").setDescription(rows.length
      ? rows.map((row) => `**#${row.id}**${row.label ? ` — ${row.label}` : ""} · ${row.roles} rôles, ${row.channels} salons · <t:${Math.floor(row.createdAt / 1000)}:R> par <@${row.createdBy}>`).join("\n")
      : "Aucune sauvegarde. Crée-en une avec `/bouclier sauvegarder`.")],
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

async function previewRestore(interaction) {
  const id = interaction.options.getInteger("sauvegarde");
  const saved = S.loadSnapshot(interaction.guildId, id);
  if (!saved) throw new Error("Sauvegarde introuvable.");
  const plan = S.planRestore(saved.payload, S.captureGuild(interaction.guild));
  if (plan.empty) {
    await interaction.reply(ephemeral(`✅ Rien à restaurer : le serveur contient déjà tout ce que la sauvegarde #${id} connaît.`));
    return true;
  }
  const embed = card("♻️ Restauration — aperçu").setDescription([
    `Sauvegarde **#${id}** du <t:${Math.floor(saved.createdAt / 1000)}:f>.`,
    "",
    "**La restauration ne supprime rien.** Elle recrée seulement ce qui manque.",
  ].join("\n"));
  if (plan.missingRoles.length) {
    embed.addFields({ name: `Rôles à recréer (${plan.missingRoles.length})`, value: plan.missingRoles.slice(0, 20).map((r) => r.name).join(", ").slice(0, 1000) });
  }
  if (plan.missingChannels.length) {
    embed.addFields({ name: `Salons à recréer (${plan.missingChannels.length})`, value: plan.missingChannels.slice(0, 20).map((c) => c.name).join(", ").slice(0, 1000) });
  }
  if (plan.addedSinceSnapshot) {
    embed.addFields({ name: "Créés depuis la sauvegarde", value: `${plan.addedSinceSnapshot} salon(s) — ils ne seront pas touchés.` });
  }
  await interaction.reply({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`shield:restore:${id}`).setLabel("Restaurer maintenant").setStyle(ButtonStyle.Danger).setEmoji("♻️"),
    )],
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

async function runRestore(interaction, id) {
  if (!isAdmin(interaction.member)) return interaction.reply(ephemeral("⛔ Réservé aux administrateurs."));
  const saved = S.loadSnapshot(interaction.guildId, Number(id));
  if (!saved) return interaction.reply(ephemeral("Sauvegarde introuvable."));
  await interaction.deferUpdate();
  const plan = S.planRestore(saved.payload, S.captureGuild(interaction.guild));
  const result = await S.applyRestore(interaction.guild, plan, { reason: `GUARD : restauration #${id} par ${interaction.user.tag}` });
  await interaction.editReply({
    embeds: [card("♻️ Restauration terminée").setDescription([
      `${result.created.roles} rôle(s) et ${result.created.channels} salon(s) recréés.`,
      result.failed.length ? `\n⚠️ Échecs : ${result.failed.slice(0, 15).join(", ")}` : "",
      "\nLes permissions détaillées de chaque salon doivent être revues à la main : seules la structure et les permissions de rôle sont rétablies.",
    ].filter(Boolean).join("\n"))],
    components: [],
  });
  return true;
}

export async function handleShieldInteraction(interaction) {
  try {
    if (interaction.isButton?.() && interaction.customId?.startsWith("shield:restore:")) {
      return await runRestore(interaction, interaction.customId.split(":")[2]);
    }
    if (!interaction.isChatInputCommand?.() || !SHIELD_COMMANDS.has(interaction.commandName)) return false;
    if (!interaction.guildId) return false;
    if (!isAdmin(interaction.member)) {
      await interaction.reply(ephemeral("⛔ Réservé aux administrateurs."));
      return true;
    }

    switch (interaction.options.getSubcommand()) {
      case "piege": return await createTrap(interaction);
      case "piege-off": {
        S.disableHoneypot(interaction.guildId);
        await interaction.reply(ephemeral("🪤 Salon piège désarmé. Le salon reste en place."));
        return true;
      }
      case "sauvegarder": return await snapshotNow(interaction);
      case "sauvegardes": return await listSnapshots(interaction);
      case "restaurer": return await previewRestore(interaction);
      case "verrouiller": {
        await interaction.deferReply();
        const count = await S.startLockdown(interaction.guild, {
          reason: interaction.options.getString("raison") ?? "GUARD : verrouillage",
          startedBy: interaction.user.id,
        });
        const notice = autoIncidentNotice(recordGuardIncident({
          guildId: interaction.guildId, botId: interaction.client.user.id, kind: "lockdown",
          detail: `par ${interaction.user.id}, ${count} salon(s) fermés${interaction.options.getString("raison") ? `, raison : ${interaction.options.getString("raison")}` : ""}`,
        }));
        await interaction.editReply({
          embeds: [card("🔒 Serveur verrouillé").setDescription(
            `${count} salon(s) fermés à l'écriture. Les salons déjà fermés n'ont pas été touchés et resteront fermés après le déverrouillage.\n\nRouvre avec \`/bouclier deverrouiller\`.${notice ? `\n\n${notice}` : ""}`,
          )],
        });
        return true;
      }
      case "deverrouiller": {
        await interaction.deferReply();
        const count = await S.liftLockdown(interaction.guild);
        const resolved = resolveGuardLockdownIncident({ guildId: interaction.guildId, botId: interaction.client.user.id, actorId: interaction.user.id, reopenedChannels: count });
        await interaction.editReply({ embeds: [card("🔓 Serveur rouvert").setDescription(`${count} salon(s) rouverts, exactement ceux que le verrouillage avait fermés.${resolved ? `\n\n📋 Incident SYS+ automatique résolu, avec un résumé (\`${resolved.incidentId.slice(0, 8)}\`).` : ""}`)] });
        return true;
      }
      case "etat": {
        const trap = S.honeypotConfig(interaction.guildId);
        const lock = S.lockdownState(interaction.guildId);
        const snaps = S.listSnapshots(interaction.guildId);
        await interaction.reply({
          embeds: [card("🛡️ Bouclier").addFields(
            { name: "Salon piège", value: trap?.enabled ? `<#${trap.channelId}> · ${trap.action} · ${trap.caught} pris` : "désarmé", inline: true },
            { name: "Verrouillage", value: lock ? `actif depuis <t:${Math.floor(lock.startedAt / 1000)}:R>` : "inactif", inline: true },
            { name: "Sauvegardes", value: snaps.length ? `${snaps.length} · dernière <t:${Math.floor(snaps[0].createdAt / 1000)}:R>` : "aucune", inline: true },
          )],
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
      default: return false;
    }
  } catch (error) {
    const content = `❌ ${error instanceof Error ? error.message : "Action impossible."}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content, embeds: [], components: [] }).catch(() => {});
    else await interaction.reply(ephemeral(content)).catch(() => {});
    return true;
  }
}

/** messageCreate hook: returns a short log line when the trap caught someone. */
export async function checkHoneypotMessage(message, settings) {
  if (!message.guild || !message.author || message.webhookId) return null;
  const member = message.member;
  const staff = Boolean(member?.permissions?.has?.(P.ManageMessages) || member?.permissions?.has?.(P.Administrator));
  const result = await S.springHoneypot(message, {
    isStaff: staff,
    isOwner: isOwner(member),
    quarantineRoleId: settings?.guildGuard?.quarantineRoleId ?? autoconfigValue(message.guild.id, "guard:quarantine_role"),
  });
  return result ? `🪤 <@${result.userId}> a écrit dans le salon piège : ${result.applied}.` : null;
}
