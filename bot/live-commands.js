// FWU — LIVE alerts configured from Discord (/live, =live), on FWU.
// The dashboard stays the source of truth: every change goes through bot-sync
// (validated and merged there), then the returned settings refresh the cache.
// Access: the OWNER and SYS+.
import { randomUUID } from "node:crypto";
import { validatePublicFeedUrl } from "./live-alerts.js";
import { updateModuleSettings } from "./module-settings.js";
import { parsePndOwnerId } from "./pnd-owner-policy.js";
import { recordSysPlusAudit } from "./systems/sysplus/audit.js";
import { isSysPlus } from "./systems/sysplus/permissions.js";

export const LIVE_DENIED = "⛔ Le réglage des alertes LIVE est réservé à l'OWNER et aux SYS+.";
export const LIVE_PLATFORMS = Object.freeze(["youtube", "tiktok", "twitch", "other"]);
const MAX_CREATORS = 30;
const DEFAULTS = { enabled: false, channelId: null, animated: true, mentionRoleId: null, creators: [] };

export function canConfigureLive(member, guildSettings) {
  if (!member?.id) return false;
  if (parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID) === member.id) return true;
  return isSysPlus(member, guildSettings?.sysPlus?.roleId ?? null);
}

export function describeLive(live) {
  const cfg = { ...DEFAULTS, ...(live ?? {}) };
  const creators = Array.isArray(cfg.creators) ? cfg.creators : [];
  return [
    `🔴 **Alertes LIVE** : ${cfg.enabled ? "activées" : "désactivées"}`,
    `Salon : ${cfg.channelId ? `<#${cfg.channelId}>` : "non choisi"}`,
    `Rôle mentionné : ${cfg.mentionRoleId ? `<@&${cfg.mentionRoleId}>` : "aucun"}`,
    `Créateurs (${creators.length}/${MAX_CREATORS}) :${creators.length ? `\n${creators.map((c) => `• **${c.displayName}** (${c.platform})`).join("\n")}` : " aucun"}`,
    cfg.enabled && !cfg.channelId ? "⚠️ Choisis un salon pour que les alertes soient publiées." : null,
  ].filter(Boolean).join("\n");
}

/**
 * Pure change planner: returns the next liveAlerts object and the reply text.
 * Throws user-facing errors; `validateFeed` is injected for tests.
 */
export async function planLiveChange(current, action, args = {}, { validateFeed = validatePublicFeedUrl, guildId = null } = {}) {
  const cfg = { ...DEFAULTS, ...(current ?? {}), creators: [...(current?.creators ?? [])] };
  switch (action) {
    case "on":
      return { next: { ...cfg, enabled: true }, text: `✅ Alertes LIVE activées.${cfg.channelId ? "" : " Choisis maintenant un salon : `/live salon`."}` };
    case "off":
      return { next: { ...cfg, enabled: false }, text: "🛑 Alertes LIVE désactivées." };
    case "channel": {
      if (!/^\d{5,25}$/.test(String(args.channelId ?? ""))) throw new Error("Indique un salon textuel.");
      return { next: { ...cfg, channelId: args.channelId }, text: `✅ Les alertes LIVE seront publiées dans <#${args.channelId}>.` };
    }
    case "role": {
      if (!args.roleId) return { next: { ...cfg, mentionRoleId: null }, text: "✅ Plus aucun rôle ne sera mentionné." };
      if (!/^\d{5,25}$/.test(String(args.roleId)) || args.roleId === guildId) throw new Error("Choisis un rôle (pas @everyone).");
      return { next: { ...cfg, mentionRoleId: args.roleId }, text: `✅ Le rôle <@&${args.roleId}> sera mentionné à chaque LIVE.` };
    }
    case "add": {
      const platform = String(args.platform ?? "").toLowerCase();
      if (!LIVE_PLATFORMS.includes(platform)) throw new Error(`Plateforme : ${LIVE_PLATFORMS.join(", ")}.`);
      const displayName = String(args.name ?? "").trim().slice(0, 80);
      if (!displayName) throw new Error("Indique le nom du créateur.");
      if (cfg.creators.length >= MAX_CREATORS) throw new Error(`Maximum ${MAX_CREATORS} créateurs par serveur.`);
      if (cfg.creators.some((c) => c.displayName.toLowerCase() === displayName.toLowerCase())) throw new Error("Ce créateur est déjà suivi.");
      let url;
      try { url = await validateFeed(String(args.feedUrl ?? "").trim()); }
      catch { throw new Error("Flux refusé : il faut une adresse HTTPS publique de flux RSS/Atom."); }
      const creator = { id: `creator-${randomUUID().slice(0, 8)}`, platform, displayName, feedUrl: url.toString() };
      return { next: { ...cfg, creators: [...cfg.creators, creator] }, text: `✅ **${displayName}** (${platform}) est maintenant suivi.${cfg.enabled ? "" : " Les alertes sont désactivées : `/live activer`."}` };
    }
    case "remove": {
      const needle = String(args.name ?? "").trim().toLowerCase();
      const kept = cfg.creators.filter((c) => c.displayName.toLowerCase() !== needle && c.id !== needle);
      if (kept.length === cfg.creators.length) throw new Error("Créateur introuvable. `/live etat` affiche la liste.");
      return { next: { ...cfg, creators: kept }, text: "🗑️ Créateur retiré des alertes LIVE." };
    }
    default:
      return { next: null, text: describeLive(cfg) };
  }
}

async function applyLive({ guild, actor, settingsByGuild, action, args, api }) {
  const guildSettings = settingsByGuild?.[guild.id];
  const { next, text } = await planLiveChange(guildSettings?.liveAlerts, action, args, { guildId: guild.id });
  if (!next) return text;
  const saved = await updateModuleSettings({ apiUrl: api.apiUrl, secret: api.secret, guildId: guild.id, module: "liveAlerts", value: next, actorId: actor.id });
  if (settingsByGuild) settingsByGuild[guild.id] = saved;
  recordSysPlusAudit(guild.id, actor.id, `live.${action}`, null, {});
  return text;
}

const SLASH_ACTIONS = { etat: "status", activer: "on", desactiver: "off", salon: "channel", role: "role", ajouter: "add", retirer: "remove" };

export async function handleLiveInteraction(interaction, settingsByGuild, api) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== "live") return false;
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: "Cette commande s'utilise sur un serveur.", ephemeral: true });
    return true;
  }
  if (!canConfigureLive(interaction.member, settingsByGuild?.[interaction.guildId])) {
    await interaction.reply({ content: LIVE_DENIED, ephemeral: true });
    return true;
  }
  const action = SLASH_ACTIONS[interaction.options.getSubcommand(false) ?? "etat"] ?? "status";
  const o = interaction.options;
  const args = {
    channelId: o.getChannel?.("salon")?.id ?? null,
    roleId: o.getRole?.("role")?.id ?? null,
    platform: o.getString?.("plateforme") ?? null,
    name: o.getString?.("nom") ?? null,
    feedUrl: o.getString?.("flux") ?? null,
  };
  await interaction.deferReply({ ephemeral: true });
  try {
    const text = await applyLive({ guild: interaction.guild, actor: interaction.member, settingsByGuild, action, args, api });
    await interaction.editReply({ content: text, allowedMentions: { parse: [] } });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error instanceof Error ? error.message : "Réglage impossible pour le moment."}`, allowedMentions: { parse: [] } });
  }
  return true;
}

const PREFIX_ACTIONS = { etat: "status", status: "status", on: "on", activer: "on", off: "off", desactiver: "off", "désactiver": "off", salon: "channel", role: "role", "rôle": "role", ajouter: "add", add: "add", retirer: "remove", remove: "remove" };

export function parseLivePrefix(message) {
  const match = /^=live(?:\s+(\S+))?(?:\s+([\s\S]*))?$/i.exec(String(message?.content ?? "").trim());
  if (!match) return null;
  const action = PREFIX_ACTIONS[(match[1] ?? "etat").toLowerCase()] ?? "help";
  const rest = String(match[2] ?? "").trim();
  if (action === "add") {
    const [platform, feedUrl, ...name] = rest.split(/\s+/);
    return { action, args: { platform, feedUrl, name: name.join(" ") } };
  }
  if (action === "channel") return { action, args: { channelId: message.mentions?.channels?.first?.()?.id ?? /^<#(\d+)>/.exec(rest)?.[1] ?? null } };
  if (action === "role") return { action, args: { roleId: /^(aucun|none)$/i.test(rest) ? null : message.mentions?.roles?.first?.()?.id ?? /^<@&(\d+)>/.exec(rest)?.[1] ?? null } };
  if (action === "remove") return { action, args: { name: rest } };
  return { action, args: {} };
}

const LIVE_HELP = "Utilisation : `=live` (état) · `=live on|off` · `=live salon #salon` · `=live role @rôle|aucun` · `=live ajouter youtube|tiktok|twitch|other <flux https> <nom>` · `=live retirer <nom>`.";

export async function handleLiveMessage(message, settingsByGuild, api) {
  if (!message?.guild || !message.member) return false;
  const parsed = parseLivePrefix(message);
  if (!parsed) return false;
  const mentions = { parse: [] };
  if (!canConfigureLive(message.member, settingsByGuild?.[message.guild.id])) {
    await message.reply({ content: LIVE_DENIED, allowedMentions: mentions });
    return true;
  }
  if (parsed.action === "help") {
    await message.reply({ content: LIVE_HELP, allowedMentions: mentions });
    return true;
  }
  try {
    const text = await applyLive({ guild: message.guild, actor: message.member, settingsByGuild, action: parsed.action, args: parsed.args, api });
    await message.reply({ content: text, allowedMentions: mentions });
  } catch (error) {
    await message.reply({ content: `❌ ${error instanceof Error ? error.message : "Réglage impossible pour le moment."}\n${LIVE_HELP}`, allowedMentions: mentions });
  }
  return true;
}
