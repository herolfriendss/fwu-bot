// FWU V2 — GUARD : /piege, /raid, /scan, /panic et leurs formes à préfixe (+piege, +raid, +scan, +panic).
// Administrateur Discord, propriétaire du serveur ou OWNER.
import { addTrapChannel, isGuardAdmin, panic, raidConfig, removeTrapChannel, saveRaidSettings, scanGuild, setRaidMode, trapChannels } from "./raid-protection.js";

export const RAID_COMMANDS = new Set(["piege", "raid", "scan", "panic"]);
const REFUSAL = "⛔ Réservé aux administrateurs du serveur.";

function scanPayload(guild) {
  const result = scanGuild(guild);
  const level = result.score >= 80 ? "🟢 bon" : result.score >= 50 ? "🟠 moyen" : "🔴 faible";
  return {
    visibility: "private",
    embeds: [{
      title: `🔍 Audit de sécurité — ${result.score}/100 (${level})`,
      description: result.findings.length ? result.findings.join("\n").slice(0, 4000) : "Aucun point faible détecté.",
    }],
  };
}

function raidText(guildId) {
  const c = raidConfig(guildId);
  return `**Mode raid** : ${c.active ? `🚨 actif${c.manual ? " (manuel)" : ""} depuis <t:${Math.floor((c.since ?? Date.now()) / 1000)}:R>` : "⚪ inactif"}\nSeuil : ${c.threshold} arrivées en ${c.windowSeconds} s • sortie après ${c.calmMinutes} min de calme`;
}

/** Cœur commun. `request` = { guild, member, sub, action, channelId, reason, threshold, windowSeconds, calmMinutes, settings }. */
export async function runRaidCommand(request, { env = process.env } = {}) {
  const { guild, member, sub, settings } = request;
  if (!isGuardAdmin(member, env)) return { content: REFUSAL };
  try {
    switch (sub) {
      case "piege configurer":
        if (!request.channelId) return { content: "⚠️ Indique le salon appât." };
        addTrapChannel(guild.id, request.channelId, member.id);
        return { content: `✅ Salon piège ajouté : <#${request.channelId}>. Quiconque (hors staff, SYS+, ADMIN+, WHITELIST, bots) y écrit passe en BLR.` };
      case "piege retirer":
        return { content: removeTrapChannel(guild.id, request.channelId) ? `✅ <#${request.channelId}> n'est plus un piège.` : "ℹ️ Ce salon n'était pas un piège." };
      case "piege liste": {
        const list = trapChannels(guild.id);
        return { visibility: "private", content: list.length ? `🪤 Salons pièges : ${list.map((id) => `<#${id}>`).join(", ")}` : "ℹ️ Aucun salon piège." };
      }
      case "raid on": await setRaidMode(guild, true, { manual: true, actorId: member.id, settings, reason: request.reason }); return { content: `🚨 Mode raid activé.\n${raidText(guild.id)}` };
      case "raid off": await setRaidMode(guild, false, { manual: true, actorId: member.id, settings, reason: request.reason }); return { content: `✅ Mode raid coupé.\n${raidText(guild.id)}` };
      case "raid etat": return { visibility: "private", content: raidText(guild.id) };
      case "raid seuils": saveRaidSettings(guild.id, request); return { content: `✅ Seuils enregistrés.\n${raidText(guild.id)}` };
      case "scan": return scanPayload(guild);
      case "panic": {
        const { locked } = await panic(guild, { actorId: member.id, settings, reason: request.reason ?? "Verrouillage d'urgence" });
        return { content: `🚨 Verrouillage d'urgence : ${locked} salon(s) fermé(s), mode raid actif. Rouvre avec \`/bouclier deverrouiller\` puis \`/raid off\`.` };
      }
      default: return { content: "⚠️ Sous-commande inconnue." };
    }
  } catch (error) {
    return { content: `❌ ${error?.message ?? "Action impossible."}` };
  }
}

export async function handleRaidInteraction(interaction, settings) {
  if (!interaction?.isChatInputCommand?.() || !interaction.guild) return false;
  if (interaction.commandName !== "piege" && interaction.commandName !== "raid" && interaction.commandName !== "scan" && interaction.commandName !== "panic") return false;
  const o = interaction.options;
  const name = interaction.commandName;
  const sub = name === "scan" || name === "panic" ? name : `${name} ${o.getSubcommand()}`;
  await interaction.deferReply();
  const payload = await runRaidCommand({
    guild: interaction.guild, member: interaction.member, sub, settings,
    channelId: o.getChannel?.("salon", false)?.id ?? null, reason: o.getString?.("raison", false) ?? null,
    threshold: o.getInteger?.("arrivees", false), windowSeconds: o.getInteger?.("secondes", false), calmMinutes: o.getInteger?.("calme", false),
  });
  await interaction.editReply({ ...payload, allowedMentions: { parse: [] } });
  return true;
}

/** +piege configurer #salon · +piege retirer #salon · +piege liste · +raid on|off|etat · +scan · +panic [raison] */
export async function handleRaidPrefix(message, settings) {
  const match = String(message?.content ?? "").trim().match(/^=(piege|raid|scan|panic)\b\s*(.*)$/i);
  if (!match || !message.guild) return false;
  const name = match[1].toLowerCase();
  const words = match[2].split(/\s+/).filter(Boolean);
  const channelId = match[2].match(/<#(\d+)>/)?.[1] ?? null;
  let sub = name;
  if (name === "piege") sub = `piege ${(words[0] ?? "liste").toLowerCase()}`;
  if (name === "raid") sub = `raid ${(words[0] ?? "etat").toLowerCase()}`;
  const reason = name === "panic" ? match[2] || null : words.slice(1).join(" ") || null;
  const payload = await runRaidCommand({ guild: message.guild, member: message.member, sub, settings, channelId, reason });
  const { visibility, ...data } = payload;
  if (visibility === "private") {
    const sent = await message.author.send(data).then(() => true).catch(() => false);
    await message.reply({ content: sent ? "📬 Réponse envoyée en message privé." : "❌ MP fermés : impossible d'envoyer la réponse.", allowedMentions: { parse: [] } }).catch(() => {});
  } else {
    await message.reply({ ...data, allowedMentions: { parse: [] } }).catch(() => {});
  }
  return true;
}
