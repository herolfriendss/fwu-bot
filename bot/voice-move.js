// FDPDLAVOC — ;mv et ;accessall (forme canonique « =mv », « =accessall »).
//
// ;mv @membre | ;mv 123456789012345678
//   Déplace le membre dans le salon vocal de l'auteur. Commande de modération :
//   permission « Déplacer des membres » + palier + quota partagé « mv ».
// ;accessall
//   Donne à chaque membre présent dans le vocal de l'auteur un accès individuel
//   (Voir + Se connecter) : ils peuvent partir et revenir même s'il est verrouillé.
//   Même autorisation que ;access (owner, admin, SYS+, ou Gérer les salons).
import { PermissionFlagsBits } from "discord.js";
import { canUseVoiceCommand } from "./voice-permissions.js";
import { describeDiscordError } from "./moderation-actions.js";
import { openModerationGate } from "./shared/moderation-gate.js";
import { logCommandUsage } from "./shared/audit.js";
import { getAdminPlusRoleId } from "./systems/sysplus/role-config.js";
import { parsePndOwnerId } from "./pnd-owner-policy.js";

const P = PermissionFlagsBits;
const MV = /^=mv(?=$|\s)\s*(\S+)?/i;
const ACCESSALL = /^=accessall(?=$|\s)/i;
const ACCESSALL_MAX_MEMBERS = 99;

/** "=mv <@1…>" / "=mv 1…" → { targetId } ; { invalid: "texte" } ; { missing: true } ; null (pas ;mv). */
export function parseMoveCommand(content) {
  const match = MV.exec(String(content ?? "").trim());
  if (!match) return null;
  const raw = match[1];
  if (!raw) return { missing: true };
  const mention = /^<@!?(\d{17,20})>$/.exec(raw);
  if (mention) return { targetId: mention[1] };
  if (/^\d{17,20}$/.test(raw)) return { targetId: raw };
  return { invalid: raw.slice(0, 40) };
}

export function isAccessAllCommand(content) {
  return ACCESSALL.test(String(content ?? "").trim());
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); });

async function handleMove(message, parsed, { bot, audit }) {
  const say = (content) => message.reply({ content, allowedMentions: { parse: [], repliedUser: false } }).catch(() => null);
  if (parsed.missing) return say("Utilisation : `=mv @membre` ou `=mv 123456789012345678`.");
  if (parsed.invalid) return say(`❌ Identifiant invalide : \`${parsed.invalid}\`. Mentionne le membre ou donne son identifiant Discord (17 à 20 chiffres).`);
  const guild = message.guild;
  const author = message.member;
  const destination = author.voice?.channel;
  if (!destination) return say("❌ Rejoins d'abord un salon vocal : le membre y sera déplacé.");
  const target = await guild.members.fetch({ user: parsed.targetId, force: true }).catch(() => null);
  if (!target) return say("❌ Membre introuvable sur ce serveur.");
  const source = target.voice?.channel;
  if (!source) return say(`❌ <@${target.id}> n'est pas connecté en vocal.`);
  if (source.id === destination.id) return say(`ℹ️ <@${target.id}> est déjà dans **${destination.name}**.`);
  if (target.id === message.client.user?.id) return say("❌ Je ne me déplace pas moi-même avec cette commande.");

  // Auteur : Déplacer des membres dans le salon d'origine et accès au salon d'arrivée.
  if (!source.permissionsFor(author)?.has(P.MoveMembers)) return say(`⛔ Tu n'as pas la permission « Déplacer des membres » dans **${source.name}**.`);
  if (!destination.permissionsFor(author)?.has([P.ViewChannel, P.Connect])) return say(`⛔ Tu n'as pas accès à **${destination.name}**.`);
  // Bot : mêmes droits.
  const me = guild.members.me ?? await guild.members.fetchMe();
  if (!source.permissionsFor(me)?.has(P.MoveMembers) || !destination.permissionsFor(me)?.has([P.ViewChannel, P.Connect, P.MoveMembers])) {
    return say("⛔ Il me manque « Déplacer des membres », « Voir » ou « Se connecter » sur l'un des deux salons.");
  }
  // Règle FWU : on n'agit que sur un membre placé en dessous de soi (owner et propriétaire du serveur exceptés).
  const pndOwnerId = parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);
  if (target.id !== author.id) {
    if (target.id === pndOwnerId || target.id === guild.ownerId) {
      if (author.id !== pndOwnerId && author.id !== guild.ownerId) return say("⛔ Cette personne est protégée (propriétaire).");
    } else if (author.id !== pndOwnerId && author.id !== guild.ownerId
      && (author.roles?.highest?.position ?? 0) <= (target.roles?.highest?.position ?? 0)) {
      return say("⛔ Tu ne peux déplacer qu'un membre dont le rôle le plus élevé est en dessous du tien.");
    }
  }

  const gate = await openModerationGate({ member: author, command: "mv", bot, targetId: target.id });
  if (!gate.ok) return say(gate.message);
  try {
    await target.voice.setChannel(destination, `;mv par ${author.user?.tag ?? author.id}`);
  } catch (error) {
    await gate.fail(error);
    return say(`❌ Déplacement impossible : ${describeDiscordError(error)}`);
  }
  await gate.succeed(`${source.id}→${destination.id}`);
  audit("🔀 Membre déplacé (;mv)", `Par : <@${author.id}>\nMembre : <@${target.id}>\nDe : <#${source.id}>\nVers : <#${destination.id}>`);
  return say(`🔀 <@${target.id}> déplacé de **${source.name}** vers **${destination.name}**.`);
}

async function handleAccessAll(message, settings, { bot, audit }) {
  const say = (content) => message.reply({ content, allowedMentions: { parse: [], repliedUser: false } }).catch(() => null);
  const guild = message.guild;
  const author = message.member;
  const channel = author.voice?.channel;
  if (!channel) return say("❌ Rejoins d'abord le salon vocal concerné.");
  let adminPlusRoleId = null;
  try { adminPlusRoleId = getAdminPlusRoleId(guild.id); } catch { adminPlusRoleId = null; }
  const ownerId = String(process.env.PND_OWNER_DISCORD_ID ?? "").trim();
  const allowed = canUseVoiceCommand(
    "=access",
    channel.permissionsFor(author)?.bitfield ?? 0n,
    [...author.roles.cache.keys()],
    settings?.voiceAccess,
    guild.ownerId === author.id || ownerId === author.id,
    adminPlusRoleId,
    settings?.sysPlus?.roleId ?? null,
  );
  if (!allowed) {
    await logCommandUsage({ guildId: guild.id, userId: author.id, bot, command: "accessall", outcome: "denied" });
    return say("⛔ `=accessall` demande la permission « Gérer les salons » sur ce vocal (ou SYS+ / owner).");
  }
  const me = guild.members.me ?? await guild.members.fetchMe();
  if (!channel.permissionsFor(me)?.has(P.ManageRoles)) return say("⛔ Il me faut « Gérer les permissions » (Gérer les rôles) sur ce vocal.");

  const members = [...channel.members.values()].filter((member) => !member.user.bot).slice(0, ACCESSALL_MAX_MEMBERS);
  let granted = 0;
  let already = 0;
  const failed = [];
  for (const member of members) {
    const current = channel.permissionOverwrites.cache.get(member.id);
    if (current?.allow?.has?.(P.Connect) && current.allow.has(P.ViewChannel)) { already++; continue; }
    try {
      await channel.permissionOverwrites.edit(member, { ViewChannel: true, Connect: true }, `;accessall par ${author.user?.tag ?? author.id}`);
      granted++;
    } catch {
      failed.push(member.id);
    }
    await wait(250); // reste sous les limites de requêtes de Discord sur un même salon
  }
  await logCommandUsage({ guildId: guild.id, userId: author.id, bot, command: "accessall", outcome: failed.length && !granted ? "error" : "ok", detail: `${granted} accordé(s), ${already} déjà, ${failed.length} échec(s)` });
  audit("🔓 Accès vocal pour tous (;accessall)", `Par : <@${author.id}>\nSalon : <#${channel.id}>\nAccès accordés : **${granted}** · déjà présents : **${already}** · échecs : **${failed.length}**`);
  const extra = channel.members.size > ACCESSALL_MAX_MEMBERS ? ` (limité aux ${ACCESSALL_MAX_MEMBERS} premiers)` : "";
  return say(`🔓 **${channel.name}** : ${granted} accès accordé(s), ${already} déjà présent(s)${failed.length ? `, ${failed.length} échec(s)` : ""}${extra}. Ils peuvent quitter et revenir même si le salon est verrouillé.`);
}

export async function handleVoiceMoveCommand(message, settings = null, { bot = "fdpdlavoc", audit = () => {} } = {}) {
  if (!message?.guild || !message.member || message.author?.bot) return false;
  const parsed = parseMoveCommand(message.content);
  if (parsed) {
    await handleMove(message, parsed, { bot, audit });
    return true;
  }
  if (isAccessAllCommand(message.content)) {
    await handleAccessAll(message, settings, { bot, audit });
    return true;
  }
  return false;
}
