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
import { roleGrantRefusal } from "../../role-grant-guard.js";
import { updateModuleSettings } from "../../module-settings.js";

// Rôles que le bot DONNE à des membres (vérification, rôles automatiques, quarantaine) :
// jamais de rôle d'accès, de palier ou à permissions sensibles.
const GRANTED_ROLE_FIELDS = new Set(["roleId", "autoRoleIds", "quarantineRoleId"]);
import {
  SETUP_MODULES,
  parseSetupModule,
  setupChangedKeys,
  setupFormFields,
  setupHasToggle,
  setupRequirementError,
} from "./policy.js";

const MODULE_NAMES = Object.keys(SETUP_MODULES);
const PANEL_SECTIONS = {
  home: {
    label: "Accueil",
    description: "Administration Discord First des bots.",
    commands:
      "`/setup` — activer, désactiver et régler les modules\n`/panel` — revenir à ce centre\n`/voc vocal-panel` — ouvrir le panneau vocal historique",
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
          || (GRANTED_ROLE_FIELDS.has(field.key) && await roleGrantRefusal(interaction.guild, role, { automatic: true }))
        ) {
          return `Le rôle configuré pour « ${field.label} » n’existe plus ou ne peut plus être utilisé (rôle protégé : accès, palier ou permissions sensibles).`;
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
  if (field.kind === "boolean" && typeof value === "boolean") return value ? "oui" : "non";
  if (field.kind === "enum" && field.aliases && value != null) {
    const alias = Object.entries(field.aliases).find(([, target]) => target === value)?.[0];
    if (alias) return alias;
  }
  // A stored value always wins; the field default only fills an absent (null/undefined) value.
  if (value != null) return String(value);
  return field.default == null ? "" : String(field.default);
}

const COLOR_ON = 0x2ecc71;
const COLOR_OFF = 0x95a5a6;
const COLOR_HOME = 0xe21d2f;

function moduleState(module, current) {
  if (!setupHasToggle(module)) return { emoji: "⚙️", text: "Toujours actif" };
  return current?.enabled === true
    ? { emoji: "🟢", text: "Activé" }
    : { emoji: "🔴", text: "Désactivé" };
}

/** Libellé lisible : retire les indications techniques « (ID) », « (oui/non) »… */
function displayLabel(field) {
  return field.label.replace(/\s*\((?:ID|oui\/non|ID ou mention|IDs séparés par virgule)\)/gi, "").trim();
}

function displayValue(field, current) {
  const value = current?.[field.key] ?? field.default ?? null;
  const none = "*Non défini*";
  switch (field.kind) {
    case "boolean":
      return value === true ? "✅ Oui" : value === false ? "❌ Non" : none;
    case "role":
      return value ? `<@&${value}>` : none;
    case "roleList":
      return Array.isArray(value) && value.length ? value.map((id) => `<@&${id}>`).join(" ") : none;
    case "textChannel":
    case "category":
    case "voiceChannel":
      return value ? `<#${value}>` : none;
    case "enum":
      return value ? (field.choices?.[value] ?? String(value)) : none;
    case "liveCreators":
      return Array.isArray(value) && value.length
        ? `${value.length} créateur(s) : ${value.map((creator) => creator.displayName).join(", ")}`
        : "Aucun créateur";
    case "text":
      return value ? `« ${String(value).slice(0, 200)} »` : none;
    default:
      return value == null || value === "" ? none : String(value);
  }
}

function moduleSelect(actorId, guildSettings, selected) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`pndsetup:module:${actorId}`)
      .setPlaceholder("Choisir un module à régler")
      .addOptions(
        MODULE_NAMES.map((value) => {
          const state = moduleState(value, guildSettings?.[value]);
          return {
            label: SETUP_MODULES[value].label.slice(0, 100),
            description: state.text,
            emoji: state.emoji,
            value,
            default: value === selected,
          };
        }),
      ),
  );
}

export function homeView(guildSettings, actorId) {
  const lines = MODULE_NAMES.map((key) => {
    const state = moduleState(key, guildSettings?.[key]);
    return `${state.emoji} **${SETUP_MODULES[key].label}** — ${state.text}`;
  });
  const embed = new EmbedBuilder()
    .setColor(COLOR_HOME)
    .setTitle("⚙️ Réglages des modules")
    .setDescription(
      "Choisis un module dans le menu ci-dessous pour l’activer, le désactiver ou modifier ses réglages.\n" +
        "Chaque changement est enregistré **immédiatement**.\n\n" +
        lines.join("\n"),
    )
    .setFooter({ text: "Réglages propres à ce serveur • réservé aux gestionnaires du serveur" });
  return {
    content: "",
    embeds: [embed],
    components: [moduleSelect(actorId, guildSettings)],
    allowedMentions: { parse: [] },
  };
}

export function moduleView(module, guildSettings, actorId, notice = "") {
  const definition = SETUP_MODULES[module];
  const current = guildSettings?.[module] ?? {};
  const state = moduleState(module, current);
  const toggle = setupHasToggle(module);
  const embed = new EmbedBuilder()
    .setColor(toggle && current.enabled !== true ? COLOR_OFF : COLOR_ON)
    .setTitle(`${state.emoji} ${definition.label}`)
    .setDescription(`${definition.description ?? ""}\n\n**Statut :** ${state.text}`.trim())
    .addFields(
      setupFormFields(module).map((field) => ({
        name: displayLabel(field).slice(0, 256),
        value: displayValue(field, current).slice(0, 1024),
        inline: !["text", "liveCreators", "roleList"].includes(field.kind),
      })),
    )
    .setFooter({ text: "« Modifier les réglages » ouvre un formulaire pré-rempli." });
  const buttons = [];
  if (toggle) {
    const on = current.enabled === true;
    buttons.push(
      new ButtonBuilder()
        // L’état voulu est inscrit dans le bouton : un clic applique ce que
        // l’administrateur a vu, jamais l’inverse d’un cache périmé.
        .setCustomId(`pndsetup:toggle:${module}:${on ? "off" : "on"}:${actorId}`)
        .setLabel(on ? "Désactiver" : "Activer")
        .setEmoji(on ? "⏸️" : "▶️")
        .setStyle(on ? ButtonStyle.Danger : ButtonStyle.Success),
    );
  }
  buttons.push(
    new ButtonBuilder()
      .setCustomId(`pndsetup:form:${module}:${actorId}`)
      .setLabel("Modifier les réglages")
      .setEmoji("✏️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`pndsetup:home:${actorId}`)
      .setLabel("Retour à la liste")
      .setStyle(ButtonStyle.Secondary),
  );
  return {
    content: notice,
    embeds: [embed],
    components: [moduleSelect(actorId, guildSettings, module), new ActionRowBuilder().addComponents(...buttons)],
    allowedMentions: { parse: [] },
  };
}

function setupModal(module, actorId, current) {
  const definition = SETUP_MODULES[module];
  const modal = new ModalBuilder()
    .setCustomId(`pndsetup:save:${module}:${actorId}`)
    .setTitle(definition.label.slice(0, 45));
  for (const field of setupFormFields(module)) {
    const input = new TextInputBuilder()
      .setCustomId(field.key)
      .setLabel(field.label.slice(0, 45))
      .setStyle(
        ["text", "liveCreators"].includes(field.kind) && field.max > 100
          ? TextInputStyle.Paragraph
          : TextInputStyle.Short,
      )
      .setRequired(field.required !== false)
      .setMaxLength(field.max ?? 100)
      .setPlaceholder((field.placeholder ?? (field.kind === "boolean" ? "oui ou non" : "Laisse vide pour aucun")).slice(0, 100));
    const value = fieldValue(field, current);
    if (value) input.setValue(value.slice(0, field.max ?? 100));
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}

function moduleStatus(settings) {
  return MODULE_NAMES.map((key) => {
    const state = moduleState(key, settings?.[key]);
    return `${state.emoji} ${SETUP_MODULES[key].label} — ${state.text}`;
  }).join("\n");
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
    .setColor(0xe21d2f)
    .setTitle(`Centre de contrôle • ${page.label}`)
    .setDescription(`${page.description}\n\n${page.commands}`)
    .addFields({
      name: `Modules configurables • ${guild.name}`,
      value: moduleStatus(settings).slice(0, 1024),
    })
    .setFooter({
      text: "Les réglages sont propres à chaque serveur. Utilise /setup pour les modifier.",
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
    await interaction.reply({ ...homeView(guildSettings, interaction.user.id), ephemeral: true });
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
  const [, action, ...rest] = customId.split(":");
  const actorId = interaction.user.id;
  let module = ["toggle", "form", "save"].includes(action) ? rest[0] : null;
  if (module !== null && !SETUP_MODULES[module]) {
    await respondInPlace(interaction, { content: "Module inconnu. Relance `/setup`.", ephemeral: true });
    return true;
  }

  if (action === "home") {
    await interaction.update(homeView(guildSettings, actorId));
    return true;
  }
  if (action === "module") {
    const [selected] = interaction.values ?? [];
    if (!SETUP_MODULES[selected]) {
      await interaction.reply({ content: "Module inconnu.", ephemeral: true });
      return true;
    }
    await interaction.update(moduleView(selected, guildSettings, actorId));
    return true;
  }
  if (action === "toggle" && !["on", "off"].includes(rest[1])) module = null;
  if (action === "form") {
    rememberFormSnapshot(guildId, actorId, module, guildSettings[module]);
    await interaction.showModal(setupModal(module, actorId, guildSettings[module]));
    return true;
  }
  if (module && (action === "toggle" || action === "save")) {
    let patch;
    let base;
    if (action === "toggle") {
      const target = rest[1] === "on";
      patch = { enabled: target };
      base = { enabled: !target };
    } else {
      const raw = Object.fromEntries(
        setupFormFields(module).map((field) => [field.key, interaction.fields.getTextInputValue(field.key)]),
      );
      try {
        // Seuls les champs du formulaire sont relus ; `enabled` reste inchangé.
        // Comparaison avec ce que le formulaire affichait à l’ouverture : seuls les
        // champs réellement modifiés par l’administrateur sont envoyés.
        const shown = takeFormSnapshot(guildId, actorId, module) ?? guildSettings[module] ?? {};
        const parsed = parseSetupModule(module, raw, shown);
        const keys = setupChangedKeys(shown, parsed).filter((key) => setupFormFields(module).some((field) => field.key === key));
        patch = Object.fromEntries(keys.map((key) => [key, parsed[key]]));
        base = Object.fromEntries(keys.map((key) => [key, shown[key] ?? null]));
      } catch (error) {
        await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
        return true;
      }
      if (module === "liveAlerts") {
        const { validatePublicFeedUrl } = await import("../../live-alerts.js");
        for (const creator of patch.creators ?? []) {
          try {
            await validatePublicFeedUrl(creator.feedUrl);
          } catch {
            await interaction.reply({
              content: `❌ Le flux de **${creator.displayName}** doit être une URL HTTPS publique, résoluble et non privée.`,
              ephemeral: true,
            });
            return true;
          }
        }
      }
    }
    const fromMessage = action === "toggle" || interaction.isFromMessage?.() !== false;
    if (fromMessage) await interaction.deferUpdate();
    else await interaction.deferReply({ ephemeral: true });
    const result = await saveModule(interaction, module, patch, base, { apiUrl, secret, settings, audit, record });
    const latest = settings[guildId] ?? guildSettings;
    let notice;
    if (result.error) notice = `⚠️ ${result.error}`;
    else if (!result.changed.length && action === "toggle")
      notice = `ℹ️ **${SETUP_MODULES[module].label}** était déjà ${patch.enabled ? "activé" : "désactivé"}.`;
    else if (!result.changed.length) notice = "ℹ️ Aucun changement : les valeurs étaient déjà celles-ci.";
    else if (action === "toggle")
      notice = patch.enabled
        ? `✅ **${SETUP_MODULES[module].label}** est maintenant activé.`
        : `⏸️ **${SETUP_MODULES[module].label}** est maintenant désactivé.`;
    else notice = `✅ Réglages de **${SETUP_MODULES[module].label}** enregistrés.`;
    await interaction.editReply(moduleView(module, latest, actorId, notice));
    return true;
  }

  // Anciennes fenêtres (système de brouillons supprimé) ou contrôle inconnu.
  await respondInPlace(interaction, {
    content: "Cette fenêtre de réglages n’est plus valable. Relance `/setup` pour afficher la nouvelle version.",
    ephemeral: true,
  });
  return true;
}

// Valeurs affichées dans un formulaire ouvert, pour n’envoyer que les champs
// modifiés et repérer ce qui a changé ailleurs entre l’ouverture et l’envoi.
const formSnapshots = new Map();
const FORM_SNAPSHOT_TTL = 30 * 60_000;

function rememberFormSnapshot(guildId, actorId, module, current) {
  const now = Date.now();
  for (const [key, entry] of formSnapshots) if (entry.at + FORM_SNAPSHOT_TTL < now) formSnapshots.delete(key);
  formSnapshots.set(`${guildId}:${actorId}:${module}`, { at: now, values: structuredClone(current ?? {}) });
}

function takeFormSnapshot(guildId, actorId, module) {
  const key = `${guildId}:${actorId}:${module}`;
  const entry = formSnapshots.get(key);
  formSnapshots.delete(key);
  return entry && entry.at + FORM_SNAPSHOT_TTL >= Date.now() ? entry.values : null;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Enregistre directement un changement de module, sans brouillon.
 * `patch` ne contient que les champs modifiés et `base` leurs valeurs telles
 * que l’administrateur les a vues. Les réglages sont relus juste avant
 * l’écriture : un champ modifié ailleurs entre-temps n’est jamais écrasé.
 */
async function saveModule(interaction, module, patch, base, { apiUrl, secret, settings, audit, record }) {
  const guildId = interaction.guildId;
  let current;
  try {
    const response = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("settings refresh failed");
    const fresh = (await response.json())?.guilds?.[guildId];
    if (!fresh) throw new Error("guild settings unavailable");
    settings[guildId] = fresh;
    current = fresh[module] ?? {};
  } catch {
    record("discord_setup_apply_error");
    return { error: "Impossible de joindre le tableau de bord pour le moment. Rien n’a été modifié, réessaie dans un instant." };
  }
  const conflicts = Object.keys(patch).filter(
    (key) => !same(current[key], base[key]) && !same(current[key], patch[key]),
  );
  if (conflicts.length) {
    const labels = conflicts.map((key) => SETUP_MODULES[module].fields.find((field) => field.key === key)?.label ?? key);
    return {
      error: `Modifié ailleurs entre-temps (${labels.map((label) => `« ${label} »`).join(", ")}). Rien n’a été écrasé : voici les valeurs actuelles, recommence si besoin.`,
    };
  }
  const changes = Object.fromEntries(Object.entries(patch).filter(([key, value]) => !same(current[key], value)));
  const changed = Object.keys(changes);
  if (!changed.length) return { changed };
  const merged = { ...current, ...changes };
  const requirement = setupRequirementError(module, merged);
  if (requirement) return { error: `${requirement} Clique sur « Modifier les réglages » pour les compléter.` };
  // Désactiver doit toujours rester possible, même si un rôle ou salon a disparu.
  const disablingOnly = changed.length === 1 && changes.enabled === false;
  const invalid = disablingOnly ? null : await setupCandidateError(interaction, module, merged, guildId);
  if (invalid) return { error: invalid };
  try {
    const expected = Object.fromEntries(changed.map((key) => [key, current[key] ?? null]));
    const updated = await updateModuleSettings({
      apiUrl, secret, guildId, module, value: merged, changes, expected, actorId: interaction.user.id,
    });
    settings[guildId] = updated;
    audit(
      interaction.guild,
      updated,
      "Configuration Discord modifiée",
      `Module : **${SETUP_MODULES[module].label}**\nChamps : ${changed.map((key) => `\`${key}\``).join(", ")}\nAuteur : <@${interaction.user.id}>`,
    );
    record("discord_setup_applied");
    return { changed };
  } catch (error) {
    record("discord_setup_apply_error");
    if (error?.conflict) {
      if (error.settings) settings[guildId] = error.settings;
      const labels = error.conflicts.map((key) => SETUP_MODULES[module].fields.find((field) => field.key === key)?.label ?? key);
      const which = labels.length ? ` (${labels.map((label) => `« ${label} »`).join(", ")})` : "";
      return { error: `Modifié ailleurs entre-temps${which}. Rien n’a été écrasé : voici les valeurs actuelles, recommence si besoin.` };
    }
    return { error: "L’enregistrement a échoué. Rien n’a été modifié, réessaie dans un instant." };
  }
}
