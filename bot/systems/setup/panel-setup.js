import { respondInPlace } from "../../interaction-reply.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { db } from "../../database.js";
import { updateModuleSettings } from "../../module-settings.js";
import { SETUP_MODULES, parseSetupModule, setupChangedKeys } from "./policy.js";

const MODULE_NAMES = Object.keys(SETUP_MODULES);
const PANEL_SECTIONS = {
  home: {
    label: "Accueil",
    description: "Administration Discord First de FWU.",
    commands:
      "`/setup` — configurer un module avec aperçu et validation\n`/panel` — revenir à ce centre\n`/voc vocal-panel` — ouvrir le panneau vocal historique",
  },
};
const CATEGORY_DESCRIPTIONS = {
  Général: "Commandes générales et accès aux outils Discord First.",
  Sécurité: "Protections et réglages de sécurité de ce serveur.",
  "Économie PND": "Commandes économiques propres à ce serveur.",
  Modération: "Outils de modération et protections disponibles.",
  "SYS+": "Commandes privilégiées soumises à leurs contrôles dédiés.",
  Automatisation: "Automatisations et intégrations déjà raccordées.",
  "Social & cartes": "Profils, réputation et cartes communautaires.",
  "Jeux & événements": "Jeux et événements disponibles sur ce serveur.",
  "Vocal & DOG": "Commandes vocales et systèmes DOG/MENOTTE.",
  "Musique & radio": "Commandes audio disponibles sur ce serveur.",
};

db.exec(`
  CREATE TABLE IF NOT EXISTS discord_setup_drafts (
    draft_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, actor_id TEXT NOT NULL,
    module TEXT NOT NULL, settings_json TEXT NOT NULL, previous_json TEXT NOT NULL DEFAULT '{}', changed_keys TEXT NOT NULL,
    expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, retained_until INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS discord_setup_drafts_expiry_idx ON discord_setup_drafts(expires_at);
`);
const draftColumns = db
  .prepare("PRAGMA table_info(discord_setup_drafts)")
  .all()
  .map((column) => column.name);
if (!draftColumns.includes("previous_json"))
  db.exec("ALTER TABLE discord_setup_drafts ADD COLUMN previous_json TEXT NOT NULL DEFAULT '{}'");
if (!draftColumns.includes("retained_until")) {
  db.exec("ALTER TABLE discord_setup_drafts ADD COLUMN retained_until INTEGER NOT NULL DEFAULT 0");
  db.exec(
    "UPDATE discord_setup_drafts SET retained_until=created_at+604800000 WHERE retained_until=0",
  );
}
db.exec(
  "CREATE INDEX IF NOT EXISTS discord_setup_drafts_retention_idx ON discord_setup_drafts(retained_until)",
);

const insertDraft = db.prepare(`INSERT INTO discord_setup_drafts
  (draft_id,guild_id,actor_id,module,settings_json,previous_json,changed_keys,expires_at,created_at,retained_until)
  VALUES(?,?,?,?,?,?,?,?,?,?)`);
const getDraft = db.prepare(
  "SELECT * FROM discord_setup_drafts WHERE draft_id=? AND guild_id=? AND actor_id=? AND expires_at>?",
);
const getRetainedDraft = db.prepare(
  "SELECT * FROM discord_setup_drafts WHERE draft_id=? AND guild_id=? AND actor_id=? AND retained_until>?",
);
const listRetainedDrafts = db.prepare(
  "SELECT * FROM discord_setup_drafts WHERE guild_id=? AND actor_id=? AND retained_until>? ORDER BY created_at DESC LIMIT 25",
);
const refreshDraftExpiry = db.prepare(
  "UPDATE discord_setup_drafts SET expires_at=? WHERE draft_id=? AND guild_id=? AND actor_id=? AND retained_until>?",
);
const deleteDraft = db.prepare(
  "DELETE FROM discord_setup_drafts WHERE draft_id=? AND guild_id=? AND actor_id=?",
);
db.prepare("DELETE FROM discord_setup_drafts WHERE retained_until<=?").run(Date.now());

function authorized(member, guild) {
  return (
    member?.id === guild.ownerId ||
    Boolean(member?.permissions?.has(PermissionFlagsBits.ManageGuild))
  );
}

async function freshAuthorized(interaction) {
  const member = await interaction.guild.members
    .fetch({ user: interaction.user.id, force: true })
    .catch(() => null);
  return member && authorized(member, interaction.guild) ? member : null;
}

async function setupCandidateError(interaction, module, candidate, guildId) {
  const botMember = await interaction.guild.members.fetchMe({ force: true }).catch(() => null);
  if (!botMember) return "Je ne peux pas vérifier les permissions actuelles du bot.";
  for (const field of SETUP_MODULES[module].fields) {
    const ids = field.kind === "roleList" ? candidate[field.key] : [candidate[field.key]];
    for (const id of ids.filter(Boolean)) {
      if (field.kind === "role" || field.kind === "roleList") {
        const role = await interaction.guild.roles.fetch(id, { force: true }).catch(() => null);
        if (
          !role ||
          role.managed ||
          role.id === guildId ||
          role.position >= botMember.roles.highest.position
        ) {
          return `Le rôle configuré pour « ${field.label} » n’existe plus ou ne peut plus être utilisé.`;
        }
      } else if (["textChannel", "category", "voiceChannel"].includes(field.kind)) {
        const channel = await interaction.guild.channels.fetch(id).catch(() => null);
        const valid =
          channel?.guildId === guildId &&
          (field.kind === "category"
            ? channel.type === ChannelType.GuildCategory
            : field.kind === "voiceChannel"
              ? channel.type === ChannelType.GuildVoice
              : [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type));
        if (!valid)
          return `Le salon configuré pour « ${field.label} » n’existe plus ou son type a changé.`;
        const permissions = channel.permissionsFor(botMember);
        const required =
          field.kind === "category"
            ? [PermissionFlagsBits.ViewChannel]
            : field.key === "hubChannelId"
              ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
              : [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
        if (!permissions || required.some((permission) => !permissions.has(permission))) {
          return `Les permissions du bot ne permettent plus d’utiliser le salon « ${field.label} ».`;
        }
      }
    }
  }
  if (
    ((module === "tickets" && candidate.enabled) ||
      (module === "tempVoice" && candidate.enabled)) &&
    !botMember.permissions.has(PermissionFlagsBits.ManageChannels)
  ) {
    return "Le bot doit avoir Gérer les salons pour activer ce module.";
  }
  const needsManageRoles =
    (module === "verification" && candidate.enabled) ||
    (module === "guildGuard" && candidate.quarantineRoleId) ||
    (module === "automation" && candidate.autoRoleIds?.length);
  if (needsManageRoles && !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return "Le bot doit avoir Gérer les rôles pour utiliser les rôles configurés.";
  }
  if (module === "spam" && candidate.enabled
    && (!botMember.permissions.has(PermissionFlagsBits.ManageMessages)
      || !botMember.permissions.has(PermissionFlagsBits.ModerateMembers))) {
    return "Le bot doit avoir Gérer les messages et Modérer les membres pour activer l’anti-spam.";
  }
  return null;
}

export function fieldValue(field, current) {
  const value = current?.[field.key];
  if (field.kind === "roleList") return Array.isArray(value) ? value.join(", ") : "";
  // A stored value always wins; the field default only fills an absent (null/undefined) value.
  if (value != null) return String(value);
  return field.default == null ? "" : String(field.default);
}

function moduleSelect(actorId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`pndsetup:module:${actorId}`)
      .setPlaceholder("Choisir un module à configurer")
      .addOptions(MODULE_NAMES.map((value) => ({ label: SETUP_MODULES[value].label, value }))),
  );
}

function draftActionRow(draftId, actorId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pndsetup:apply:${draftId}:${actorId}`)
      .setLabel("Appliquer")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`pndsetup:cancel:${draftId}:${actorId}`)
      .setLabel("Annuler")
      .setStyle(ButtonStyle.Secondary),
  );
}

function draftHomeButton(actorId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pndsetup:drafts:${actorId}`)
      .setLabel("Mes brouillons")
      .setStyle(ButtonStyle.Secondary),
  );
}

function setupModal(module, actorId, current) {
  const definition = SETUP_MODULES[module];
  const modal = new ModalBuilder()
    .setCustomId(`pndsetup:edit:${module}:${actorId}`)
    .setTitle(definition.label.slice(0, 45));
  for (const field of definition.fields) {
    const input = new TextInputBuilder()
      .setCustomId(field.key)
      .setLabel(field.label.slice(0, 45))
      .setStyle(
        ["text", "liveCreators"].includes(field.kind) && field.max > 100 ? TextInputStyle.Paragraph : TextInputStyle.Short,
      )
      .setRequired(field.required !== false)
      .setMaxLength(field.max ?? 100)
      .setPlaceholder(field.placeholder ?? "Valeur actuelle ou nouvelle valeur");
    const value = fieldValue(field, current);
    if (value) input.setValue(value.slice(0, field.max ?? 100));
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}

function moduleStatus(settings) {
  return MODULE_NAMES.map(
    (key) =>
      `${settings?.[key]?.enabled === false ? "⏸️" : "⚙️"} ${SETUP_MODULES[key].label} — ${settings?.[key] ? (settings[key].enabled === false ? "désactivé" : "configuré") : "valeurs par défaut"}`,
  ).join("\n");
}

function panelPayload(guild, settings, section = "home", commandGroups = []) {
  const [kind, category] = section.startsWith("catalog:")
    ? section.split(/:(.*)/s).slice(0, 2)
    : [];
  const group =
    kind === "catalog" ? commandGroups.find((item) => item.category === category) : null;
  const page = group
    ? {
        label: group.category,
        description:
          CATEGORY_DESCRIPTIONS[group.category] ?? "Commandes disponibles sur ce serveur.",
        commands: group.commands.map((command) => `/${command.name}`).join(" · "),
      }
    : (PANEL_SECTIONS[section] ?? PANEL_SECTIONS.home);
  const pages = {
    ...PANEL_SECTIONS,
    ...Object.fromEntries(
      commandGroups.map((item) => [
        `catalog:${item.category}`,
        {
          label: item.category,
          description:
            CATEGORY_DESCRIPTIONS[item.category] ?? "Commandes disponibles sur ce serveur.",
        },
      ]),
    ),
  };
  const embed = new EmbedBuilder()
    .setColor(0x6d28d9)
    .setTitle(`FWU • ${page.label}`)
    .setDescription(`${page.description}\n\n${page.commands}`)
    .addFields({
      name: `Modules configurables • ${guild.name}`,
      value: moduleStatus(settings).slice(0, 1024),
    })
    .setFooter({
      text: "Les réglages sont isolés par serveur. /setup présente un aperçu avant application.",
    });
  const select = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("pndpanel:section")
      .setPlaceholder("Naviguer dans les modules")
      .addOptions(
        Object.entries(pages).map(([value, item]) => ({
          label: item.label,
          value,
          default: section === value,
        })),
      ),
  );
  const refresh = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("pndpanel:refresh")
      .setLabel("Actualiser")
      .setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [select, refresh], allowedMentions: { parse: [] } };
}

export async function handlePanelSetupInteraction(
  interaction,
  settings,
  { apiUrl, secret, record = () => {}, audit = () => {}, commandGroups = [] },
) {
  const isPanelCommand = interaction.isChatInputCommand?.() && interaction.commandName === "panel";
  const isSetupCommand = interaction.isChatInputCommand?.() && interaction.commandName === "setup";
  const customId = interaction.customId ?? "";
  const isPanelComponent = customId.startsWith("pndpanel:");
  const isSetupComponent = customId.startsWith("pndsetup:");
  if (!isPanelCommand && !isSetupCommand && !isPanelComponent && !isSetupComponent) return false;
  if (!interaction.inGuild?.() || !interaction.guild) {
    const reply = {
      content: "Cette commande doit être utilisée dans un serveur.",
      ephemeral: true,
    };
    await respondInPlace(interaction, reply);
    return true;
  }

  if (
    isPanelCommand ||
    isSetupCommand ||
    isSetupComponent ||
    (isPanelComponent && customId !== "pndpanel:refresh" && customId !== "pndpanel:section")
  ) {
    if (
      isSetupComponent &&
      !customId.endsWith(`:${interaction.user.id}`) &&
      !customId.includes(`:${interaction.user.id}:`)
    ) {
      await interaction.reply({
        content: "Ce contrôle appartient à une autre personne.",
        ephemeral: true,
      });
      return true;
    }
    if (!(await freshAuthorized(interaction))) {
      const reply = {
        content:
          "Configuration réservée au propriétaire du serveur ou à un membre disposant de Gérer le serveur.",
        ephemeral: true,
      };
      await respondInPlace(interaction, reply);
      return true;
    }
  } else if (isPanelComponent) {
    if (!(await freshAuthorized(interaction))) {
      await interaction.reply({
        content:
          "Navigation réservée au propriétaire du serveur ou à un membre disposant de Gérer le serveur.",
        ephemeral: true,
      });
      return true;
    }
  }

  const guildId = interaction.guildId;
  const guildSettings = settings[guildId] ?? {};
  if (isPanelCommand) {
    await interaction.reply({
      ...panelPayload(interaction.guild, guildSettings, "home", commandGroups),
      ephemeral: true,
    });
    return true;
  }
  if (isSetupCommand) {
    await interaction.reply({
      content:
        "Choisis un module. Tu verras un aperçu et devras appliquer explicitement les changements.",
      components: [moduleSelect(interaction.user.id), draftHomeButton(interaction.user.id)],
      ephemeral: true,
    });
    return true;
  }
  if (isPanelComponent) {
    if (customId === "pndpanel:refresh") {
      await interaction.update(panelPayload(interaction.guild, guildSettings));
      return true;
    }
    if (customId === "pndpanel:section") {
      await interaction.update(
        panelPayload(interaction.guild, guildSettings, interaction.values[0], commandGroups),
      );
      return true;
    }
  }
  if (customId.startsWith("pndsetup:drafts:")) {
    const drafts = listRetainedDrafts.all(guildId, interaction.user.id, Date.now());
    if (!drafts.length) {
      await interaction.reply({
        content: "Aucun brouillon conservé pour ce serveur.",
        ephemeral: true,
      });
      return true;
    }
    const select = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`pndsetup:resume:${interaction.user.id}`)
        .setPlaceholder("Reprendre un aperçu enregistré")
        .addOptions(
          drafts.map((draft) => ({
            label:
              `${SETUP_MODULES[draft.module]?.label ?? draft.module} · ${new Date(draft.created_at).toLocaleDateString("fr-FR")}`.slice(
                0,
                100,
              ),
            description: `${JSON.parse(draft.changed_keys).length} réglage(s) modifié(s)`.slice(
              0,
              100,
            ),
            value: draft.draft_id,
          })),
        ),
    );
    await interaction.reply({
      content:
        "Les brouillons sont privés à leur auteur et à ce serveur. Choisis celui à reprendre.",
      components: [select],
      ephemeral: true,
    });
    return true;
  }
  if (customId.startsWith("pndsetup:resume:")) {
    const [draftId] = interaction.values ?? [];
    const draft = draftId
      ? getRetainedDraft.get(draftId, guildId, interaction.user.id, Date.now())
      : null;
    if (!draft || !SETUP_MODULES[draft.module]) {
      await interaction.reply({
        content: "Ce brouillon n’existe plus ou appartient à un autre contexte.",
        ephemeral: true,
      });
      return true;
    }
    refreshDraftExpiry.run(
      Date.now() + 15 * 60_000,
      draftId,
      guildId,
      interaction.user.id,
      Date.now(),
    );
    const changed = JSON.parse(draft.changed_keys);
    await interaction.update({
      content: `**Aperçu repris — ${SETUP_MODULES[draft.module].label}**\nChamps modifiés :\n${changed.map((key) => `• \`${key}\``).join("\n") || "Aucune différence détectée."}\n\nCet aperçu est réactivé 15 minutes. Les conflits seront revérifiés avant application.`,
      components: [draftActionRow(draftId, interaction.user.id)],
    });
    return true;
  }
  if (customId.startsWith("pndsetup:module:")) {
    if (interaction.values.length !== 1 || !SETUP_MODULES[interaction.values[0]]) {
      await interaction.reply({ content: "Module inconnu.", ephemeral: true });
      return true;
    }
    await interaction.showModal(
      setupModal(interaction.values[0], interaction.user.id, guildSettings[interaction.values[0]]),
    );
    return true;
  }
  if (customId.startsWith("pndsetup:edit:")) {
    const [, , module, actorId] = customId.split(":");
    if (!SETUP_MODULES[module] || actorId !== interaction.user.id) {
      await interaction.reply({ content: "Formulaire invalide ou expiré.", ephemeral: true });
      return true;
    }
    const raw = Object.fromEntries(
      SETUP_MODULES[module].fields.map((field) => [
        field.key,
        interaction.fields.getTextInputValue(field.key),
      ]),
    );
    let candidate;
    try {
      candidate = parseSetupModule(module, raw, guildSettings[module] ?? {});
    } catch (error) {
      await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
      return true;
    }
    if (module === "liveAlerts") {
      const { validatePublicFeedUrl } = await import("../../live-alerts.js");
      for (const creator of candidate.creators ?? []) {
        try { await validatePublicFeedUrl(creator.feedUrl); }
        catch { await interaction.reply({ content: `❌ Le flux de **${creator.displayName}** doit être une URL HTTPS publique, résoluble et non privée.`, ephemeral: true }); return true; }
      }
    }
    for (const field of SETUP_MODULES[module].fields) {
      const ids = field.kind === "roleList" ? candidate[field.key] : [candidate[field.key]];
      for (const id of ids.filter(Boolean)) {
        if (field.kind === "role" || field.kind === "roleList") {
          const role = await interaction.guild.roles.fetch(id, { force: true }).catch(() => null);
          const botMember = await interaction.guild.members
            .fetchMe({ force: true })
            .catch(() => null);
          if (
            !role ||
            role.managed ||
            role.id === guildId ||
            !botMember ||
            role.position >= botMember.roles.highest.position
          ) {
            await interaction.reply({
              content: `❌ Le rôle indiqué pour « ${field.label} » n’existe pas ou ne peut pas être utilisé.`,
              ephemeral: true,
            });
            return true;
          }
        } else if (["textChannel", "category", "voiceChannel"].includes(field.kind)) {
          const channel = await interaction.guild.channels.fetch(id).catch(() => null);
          const valid =
            channel?.guildId === guildId &&
            (field.kind === "category"
              ? channel.type === ChannelType.GuildCategory
              : field.kind === "voiceChannel"
                ? channel.type === ChannelType.GuildVoice
                : [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type));
          if (!valid) {
            await interaction.reply({
              content: `❌ Le salon indiqué pour « ${field.label} » n’existe pas ou son type est incompatible.`,
              ephemeral: true,
            });
            return true;
          }
          const botMember = await interaction.guild.members
            .fetchMe({ force: true })
            .catch(() => null);
          if (!botMember) {
            await interaction.reply({
              content: "❌ Je ne peux pas vérifier les permissions du bot pour ce salon.",
              ephemeral: true,
            });
            return true;
          }
          const permissions = channel.permissionsFor(botMember);
          const required =
            field.kind === "category"
              ? [PermissionFlagsBits.ViewChannel]
              : field.key === "hubChannelId"
                ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
                : [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
          if (!permissions || required.some((permission) => !permissions.has(permission))) {
            await interaction.reply({
              content: `❌ Le bot n’a pas les permissions nécessaires dans le salon indiqué pour « ${field.label} ».`,
              ephemeral: true,
            });
            return true;
          }
        }
      }
    }
    const botMember = await interaction.guild.members.fetchMe({ force: true }).catch(() => null);
    if (!botMember) {
      await interaction.reply({
        content: "❌ Je ne peux pas vérifier les permissions du bot pour appliquer ce réglage.",
        ephemeral: true,
      });
      return true;
    }
    if (
      ((module === "tickets" && candidate.enabled) ||
        (module === "tempVoice" && candidate.enabled)) &&
      !botMember.permissions.has(PermissionFlagsBits.ManageChannels)
    ) {
      await interaction.reply({
        content:
          "❌ Pour activer ce module, le bot doit avoir la permission Gérer les salons sur ce serveur.",
        ephemeral: true,
      });
      return true;
    }
    const needsManageRoles =
      (module === "verification" && candidate.enabled) ||
      (module === "guildGuard" && candidate.quarantineRoleId) ||
      (module === "automation" && candidate.autoRoleIds?.length);
    if (needsManageRoles && !botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.reply({
        content:
          "❌ Pour utiliser ces rôles, le bot doit avoir la permission Gérer les rôles sur ce serveur.",
        ephemeral: true,
      });
      return true;
    }
    if (module === "spam" && candidate.enabled
      && (!botMember.permissions.has(PermissionFlagsBits.ManageMessages)
        || !botMember.permissions.has(PermissionFlagsBits.ModerateMembers))) {
      await interaction.reply({
        content: "❌ Pour activer l’anti-spam, le bot doit avoir Gérer les messages et Modérer les membres.",
        ephemeral: true,
      });
      return true;
    }
    const previous = guildSettings[module] ?? {};
    const changed = setupChangedKeys(previous, candidate);
    const draftId = `${interaction.id}`;
    const expiresAt = Date.now() + 15 * 60_000;
    insertDraft.run(
      draftId,
      guildId,
      interaction.user.id,
      module,
      JSON.stringify(candidate),
      JSON.stringify(previous),
      JSON.stringify(changed),
      expiresAt,
      Date.now(),
      Date.now() + 7 * 24 * 60 * 60_000,
    );
    const rows = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pndsetup:apply:${draftId}:${interaction.user.id}`)
        .setLabel("Appliquer")
        .setStyle(ButtonStyle.Success)
        .setDisabled(changed.length === 0),
      new ButtonBuilder()
        .setCustomId(`pndsetup:cancel:${draftId}:${interaction.user.id}`)
        .setLabel("Annuler")
        .setStyle(ButtonStyle.Secondary),
    );
    const summary = changed.length
      ? changed.map((key) => `• \`${key}\``).join("\n")
      : "Aucune différence détectée.";
    await interaction.reply({
      content: `**Aperçu — ${SETUP_MODULES[module].label}**\nServeur : **${interaction.guild.name}**\nChamps modifiés :\n${summary}\n\nCe brouillon expire dans 15 minutes. Aucun réglage n’a encore été appliqué.`,
      components: [rows],
      ephemeral: true,
    });
    return true;
  }
  if (customId.startsWith("pndsetup:cancel:")) {
    const [, , , draftId, actorId] = customId.split(":");
    if (actorId !== interaction.user.id) return true;
    deleteDraft.run(draftId, guildId, actorId);
    await interaction.update({
      content: "Configuration annulée. Aucun réglage n’a été modifié.",
      components: [],
      embeds: [],
    });
    return true;
  }
  if (customId.startsWith("pndsetup:apply:")) {
    const [, , , draftId, actorId] = customId.split(":");
    const draft =
      actorId === interaction.user.id ? getDraft.get(draftId, guildId, actorId, Date.now()) : null;
    if (!draft) {
      await interaction.update({
        content: "Ce brouillon a expiré ou n’est plus disponible. Aucun réglage n’a été modifié.",
        components: [],
        embeds: [],
      });
      return true;
    }
    await interaction.deferUpdate();
    try {
      const value = JSON.parse(draft.settings_json);
      const previous = JSON.parse(draft.previous_json);
      const changedKeys = JSON.parse(draft.changed_keys);
      const freshResponse = await fetch(apiUrl, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!freshResponse.ok) throw new Error("settings refresh failed");
      const freshSettings = (await freshResponse.json())?.guilds?.[guildId];
      if (!freshSettings) throw new Error("guild settings unavailable");
      const current = freshSettings[draft.module] ?? {};
      const conflict = changedKeys.some(
        (key) => JSON.stringify(current[key] ?? null) !== JSON.stringify(previous[key] ?? null),
      );
      if (conflict) {
        deleteDraft.run(draftId, guildId, actorId);
        await interaction.editReply({
          content:
            "⚠️ Un autre administrateur a modifié ces réglages depuis l’aperçu. Relance `/setup` pour consulter la version actuelle.",
          components: [],
        });
        return true;
      }
      const merged = {
        ...current,
        ...Object.fromEntries(changedKeys.map((key) => [key, value[key]])),
      };
      const invalid = await setupCandidateError(interaction, draft.module, merged, guildId);
      if (invalid) {
        deleteDraft.run(draftId, guildId, actorId);
        await interaction.editReply({
          content: `⚠️ ${invalid} Relance /setup pour créer un aperçu à jour.`,
          components: [],
        });
        return true;
      }
      const updated = await updateModuleSettings({
        apiUrl,
        secret,
        guildId,
        module: draft.module,
        value: merged,
        actorId,
      });
      settings[guildId] = updated;
      deleteDraft.run(draftId, guildId, actorId);
      const keys = changedKeys;
      audit(
        interaction.guild,
        updated,
        "Configuration Discord appliquée",
        `Module : **${SETUP_MODULES[draft.module].label}**\nChamps : ${keys.map((key) => `\`${key}\``).join(", ") || "aucun"}\nAuteur : <@${actorId}>`,
      );
      record("discord_setup_applied");
      await interaction.editReply({
        content: `✅ **${SETUP_MODULES[draft.module].label}** mis à jour sur **${interaction.guild.name}**.`,
        components: [],
        embeds: [],
      });
    } catch {
      record("discord_setup_apply_error");
      await interaction.editReply({
        content:
          "❌ Enregistrement indisponible. Le brouillon est conservé quelques minutes ; réessaie ou annule-le.",
        components: [],
      });
    }
    return true;
  }
  return false;
}
