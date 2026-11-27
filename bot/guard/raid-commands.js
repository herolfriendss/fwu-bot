// FWU V2 — GUARD : /piege, /raid, /scan, /panic et leurs formes à préfixe (+piege, +raid, +scan, +panic).
// Administrateur Discord, propriétaire du serveur ou OWNER.
import { addTrapChannel, isGuardAdmin, panic, raidConfig, removeTrapChannel, saveRaidSettings, scanGuild, setRaidMode, trapChannels } from "./raid-protection.js";

export const RAID_COMMANDS = new Set(["piege", "raid", "scan", "panic"]);
const REFUSAL = "⛔ Réservé aux administrateurs du serveur.";

async function scanPayload(guild) {
  // Only counted when Discord answered (needs "Gérer le serveur"); otherwise not judged.
  const rules = await guild.autoModerationRules?.fetch?.().catch(() => null);
  const result = scanGuild(guild, { automodRuleCount: rules ? rules.size : null });
  const level = result.score >= 80 ? "🟢 bon" : result.score >= 50 ? "🟠 moyen" : "🔴 faible";
  return {
    visibility: "private",
    embeds: [{
      title: `🔍 Audit de sécurité — ${result.score}/100 (${level})`,
      description: result.findings.length ? result.findings.join("\n").slice(0, 4000) : "Aucun point faible détecté.",
    }],
  };
}

export const PURGE_MAX = 100;
/** Pure: which members a raid purge would hit. */
export function purgeCandidates(members, { now = Date.now(), minutes = 10, accountDays = 7, isProtected = () => false } = {}) {
  return members.filter((m) => !m.user?.bot && !isProtected(m)
    && Number(m.joinedTimestamp ?? 0) >= now - minutes * 60_000
    && Number(m.user?.createdTimestamp ?? 0) >= now - accountDays * 86_400_000).slice(0, PURGE_MAX);
}

async function purgeRaid(request) {
  const { guild, member, settings } = request;
  const minutes = Math.min(60, Math.max(1, request.purgeMinutes ?? 10));
  const accountDays = Math.min(30, Math.max(0, request.purgeAccountDays ?? 7));
  const action = request.purgeAction === "expulsion" ? "expulsion" : "quarantaine";
  const ownerId = String(process.env.PND_OWNER_DISCORD_ID ?? "").trim();
  const isProtected = (m) => m.id === guild.ownerId || m.id === ownerId || m.permissions?.has?.("ManageMessages") || m.permissions?.has?.("Administrator");
  const members = [...(guild.members?.cache?.values?.() ?? [])];
  const targets = purgeCandidates(members, { minutes, accountDays, isProtected });
  if (!targets.length) return { visibility: "private", content: `Aucun compte de moins de ${accountDays} jour(s) arrivé dans les ${minutes} dernières minutes.` };
  if (!request.confirm) return { visibility: "private", content: `⚠️ ${targets.length} membre(s) seraient touchés (${action}) : ${targets.slice(0, 20).map((m) => `<@${m.id}>`).join(", ")}${targets.length > 20 ? "…" : ""}\nRelance avec \`confirmer: vrai\` pour exécuter.` };
  const { quarantineMember } = await import("./commands.js");
  let done = 0;
  for (const target of targets) {
    try {
      if (action === "expulsion") { await target.kick(`Purge de raid par ${member.id}`); done++; }
      else if ((await quarantineMember(guild, target, { reason: "Purge de raid", actorId: member.id, settings })).ok) done++;
    } catch { /* member left or above the bot */ }
  }
  return { content: `🧹 Purge de raid : ${done}/${targets.length} membre(s) ${action === "expulsion" ? "expulsé(s)" : "mis en quarantaine"}.` };
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
      case "raid purge": return await purgeRaid(request);
      case "raid seuils": saveRaidSettings(guild.id, request); return { content: `✅ Seuils enregistrés.\n${raidText(guild.id)}` };
      case "scan": return await scanPayload(guild);
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
    purgeMinutes: o.getInteger?.("minutes", false), purgeAccountDays: o.getInteger?.("anciennete_jours", false), purgeAction: o.getString?.("action", false), confirm: o.getBoolean?.("confirmer", false),
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
