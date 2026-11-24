// FWU — rôle 0 % intouchable (SUCK ME, repris par FWU si SUCK ME est arrêté).
//
// Discord applique tout de suite un clic droit (rendre muet, mettre en sourdine,
// exclure temporairement, renommer, déplacer, bannir) : aucun bot ne peut
// l'empêcher. Ce module l'ANNULE dans la seconde pour toute personne protégée :
//   • micro coupé par le serveur  → rétabli        • casque coupé → rétabli
//   • exclusion temporaire        → levée          • pseudo changé par un autre → remis
//   • rôle 0 % retiré             → remis          • déplacé de force → ramené (Anti-Move forcé)
//   • banni                       → débanni        • expulsé / déconnecté → journalisé (impossible à annuler)
//
// Protégés : l'owner (PND_OWNER_DISCORD_ID), les rôles associés au palier 0 par
// l'owner (/quota palier) et les rôles nommés « 0% » / « 0 % ».
// Micro, casque, exclusion, bannissement : annulés INSTANTANÉMENT, quel que soit l'auteur
// (l'auteur est retrouvé ensuite dans le journal d'audit pour les logs).
// Pseudo et rôle : laissés passer si c'est la personne elle-même, l'owner ou ce bot.
// Anti-boucle : au plus 8 annulations par minute et par membre et par type, puis alerte.
// Désactivable : PND_TIER0_PROTECTION=off.
import { AuditLogEvent } from "discord.js";
import { runAsActor, ownerId } from "./owner-shield.js";
import { loadRoleTiers } from "./shared/tiers.js";

const ZERO_ROLE = /(?:^|[\s|·\-[(])0\s?%(?=$|[\s|·\-\])])/u;
const REVERT_MAX = 8;
const REVERT_WINDOW_MS = 60_000;
const AUDIT_MAX_AGE_MS = 20_000;
const history = new Map();
const knownProtected = new Map(); // guildId → Set(memberId), pour reconnaître un banni
let auditWaits = [0, 500, 1200]; // le journal d'audit arrive parfois après l'événement Discord

/** Tests : lectures du journal d'audit sans attente. */
export function setTier0AuditWaitsForTests(waits) {
  auditWaits = waits;
}

export function tier0ProtectionEnabled(env = process.env) {
  return String(env.PND_TIER0_PROTECTION ?? "").trim().toLowerCase() !== "off";
}

/** Rôle 0 % : association explicite (palier 0) ou nom « 0% ». */
export function isTier0Role(role, explicit = new Map()) {
  if (!role) return false;
  if (explicit.has(role.id)) return explicit.get(role.id) === 0;
  return ZERO_ROLE.test(String(role.name ?? "").trim());
}

/** Rôles 0 % portés par un membre (liste vide si aucun). */
export async function tier0RolesOf(member) {
  if (!member?.guild || !member.roles?.cache) return [];
  const explicit = await loadRoleTiers(member.guild.id).catch(() => new Map());
  return [...member.roles.cache.values()].filter((role) => isTier0Role(role, explicit));
}

export async function isTier0Protected(member, env = process.env) {
  if (!member?.id || !tier0ProtectionEnabled(env)) return false;
  const owner = ownerId();
  const protectedNow = (owner && member.id === owner) || (await tier0RolesOf(member)).length > 0;
  if (member.guild?.id) {
    const set = knownProtected.get(member.guild.id) ?? new Set();
    if (protectedNow) set.add(member.id); else set.delete(member.id);
    knownProtected.set(member.guild.id, set);
  }
  return Boolean(protectedNow);
}

/** Tests et redémarrage : oublie les compteurs anti-boucle. */
export function resetTier0State() {
  history.clear();
  knownProtected.clear();
}

function takeSlot(key, now = Date.now()) {
  const recent = (history.get(key) ?? []).filter((at) => now - at < REVERT_WINDOW_MS);
  if (recent.length >= REVERT_MAX) {
    history.set(key, recent);
    return false;
  }
  recent.push(now);
  history.set(key, recent);
  return true;
}

/**
 * Auteur d'une modification de membre d'après le journal d'audit (null si
 * introuvable). Le journal peut arriver après l'événement : 3 lectures.
 */
export async function findMemberUpdateActor(guild, targetId, keys, { type = AuditLogEvent.MemberUpdate, waits = auditWaits } = {}) {
  for (const wait of waits) {
    if (wait) await new Promise((resolve) => { setTimeout(resolve, wait); });
    const logs = await guild.fetchAuditLogs?.({ type, limit: 10 }).catch(() => null);
    if (!logs) continue;
    const entry = [...logs.entries.values()].find((item) => item?.target?.id === targetId
      && Date.now() - Number(item.createdTimestamp ?? 0) < AUDIT_MAX_AGE_MS
      && (!keys || (item.changes ?? []).some((change) => keys.includes(change.key))));
    if (entry?.executor?.id ?? entry?.executorId) return entry.executor?.id ?? entry.executorId;
  }
  return null;
}

function actorAllowed(actorId, memberId, botId) {
  const owner = ownerId();
  return Boolean(actorId) && (actorId === memberId || actorId === owner || actorId === botId);
}

/** audit(guild, titre, description, couleur) : même forme que auditLog d'index.js. */
async function report(guild, audit, title, lines, color = 0xdc2626) {
  try {
    await audit(guild, `🛡️ Rôle 0 % — ${title}`, lines.filter(Boolean).join("\n"), color);
  } catch { /* un journal ne bloque jamais une protection */ }
}

/**
 * Run a revert. Nos propres annulations passent le bouclier de l'owner.
 * `actor` : identifiant connu, ou fonction async qui le cherche APRÈS l'annulation
 * (annulation instantanée, auteur retrouvé ensuite pour le journal).
 */
async function revert(guild, member, kind, actor, action, { audit, record }) {
  const key = `${guild.id}:${member.id}:${kind}`;
  const resolveActor = async () => (typeof actor === "function" ? actor().catch(() => null) : actor);
  if (!takeSlot(key)) {
    record("tier0_loop_stopped");
    const actorId = await resolveActor();
    await report(guild, audit, "annulation suspendue", [`Membre protégé : <@${member.id}>`, `Action répétée : **${kind}**${actorId ? ` par <@${actorId}>` : ""}`, "Plus de 8 annulations en 1 minute : intervention humaine requise."]);
    return false;
  }
  try {
    await runAsActor(ownerId(), action);
  } catch (error) {
    record("tier0_revert_error");
    const actorId = await resolveActor();
    await report(guild, audit, `${kind} impossible à annuler`, [`Membre protégé : <@${member.id}>`, `Auteur : ${actorId ? `<@${actorId}>` : "inconnu"}`, error?.code === 50013 ? "Permission manquante ou rôle du bot trop bas." : "Discord a refusé l'annulation."]);
    return false;
  }
  record("tier0_reverted");
  const actorId = await resolveActor();
  await report(guild, audit, `${kind} annulé`, [`Membre protégé : <@${member.id}>`, `Auteur : ${actorId ? `<@${actorId}>` : "inconnu (journal d'audit indisponible)"}`], 0xf59e0b);
  return true;
}

/**
 * voiceStateUpdate : micro / casque coupés par le serveur.
 * Retourne { isProtected } pour que l'appelant force aussi l'Anti-Move.
 */
export async function handleTier0VoiceState(oldState, newState, { audit = () => {}, record = () => {} } = {}) {
  const guild = newState?.guild ?? oldState?.guild;
  const member = newState?.member ?? oldState?.member;
  if (!guild || !member || member.user?.bot || !(await isTier0Protected(member))) return { isProtected: false, reverted: 0 };
  let reverted = 0;
  const changes = [];
  if (newState.serverMute && !oldState.serverMute) changes.push({ kind: "micro coupé", key: "mute", action: () => newState.setMute(false, "Rôle 0 % : intouchable") });
  if (newState.serverDeaf && !oldState.serverDeaf) changes.push({ kind: "casque coupé", key: "deaf", action: () => newState.setDeaf(false, "Rôle 0 % : intouchable") });
  if (!changes.length) return { isProtected: true, reverted };
  // Instantané : on rétablit d'abord, l'auteur est retrouvé ensuite pour le journal.
  for (const change of changes) {
    if (!newState.channelId) continue; // sorti du vocal entre-temps : Discord rétablira à la prochaine connexion
    const lookup = () => findMemberUpdateActor(guild, member.id, [change.key]);
    if (await revert(guild, member, change.kind, lookup, change.action, { audit, record })) reverted++;
  }
  return { isProtected: true, reverted };
}

/** guildMemberUpdate : exclusion temporaire, pseudo, rôle 0 % retiré. */
export async function handleTier0MemberUpdate(oldMember, newMember, { audit = () => {}, record = () => {} } = {}) {
  const guild = newMember?.guild;
  if (!guild || newMember.user?.bot || !tier0ProtectionEnabled()) return 0;
  // Le rôle 0 % vient d'être retiré : la personne était protégée AVANT la modification.
  const before = await tier0RolesOf(oldMember);
  const owner = ownerId();
  const wasProtected = before.length > 0 || newMember.id === owner;
  if (!wasProtected) {
    await isTier0Protected(newMember);
    return 0;
  }
  const botId = guild.client?.user?.id ?? null;
  const changes = [];
  const until = newMember.communicationDisabledUntilTimestamp ?? null;
  if (until && until > Date.now() && until !== (oldMember.communicationDisabledUntilTimestamp ?? null)) {
    changes.push({ kind: "exclusion temporaire", key: "communication_disabled_until", instant: true, action: () => newMember.timeout(null, "Rôle 0 % : intouchable") });
  }
  if (oldMember.nickname !== newMember.nickname) {
    changes.push({ kind: "pseudo modifié", key: "nick", action: () => newMember.setNickname(oldMember.nickname ?? null, "Rôle 0 % : intouchable") });
  }
  const removed = before.filter((role) => !newMember.roles?.cache?.has(role.id));
  if (removed.length) {
    changes.push({ kind: "rôle 0 % retiré", key: "$remove", action: () => newMember.roles.add(removed.map((role) => role.id), "Rôle 0 % : intouchable"), type: AuditLogEvent.MemberRoleUpdate });
  }
  if (!changes.length) {
    await isTier0Protected(newMember);
    return 0;
  }
  let reverted = 0;
  for (const change of changes) {
    const lookup = () => findMemberUpdateActor(guild, newMember.id, [change.key], change.type ? { type: change.type } : undefined);
    if (change.instant) {
      // Personne ne peut s'exclure soi-même : levée immédiate.
      if (await revert(guild, newMember, change.kind, lookup, change.action, { audit, record })) reverted++;
      continue;
    }
    // Pseudo et rôle : la personne peut les changer elle-même, on vérifie l'auteur avant.
    const actorId = await lookup();
    if (actorAllowed(actorId, newMember.id, botId)) continue;
    if (await revert(guild, newMember, change.kind, actorId, change.action, { audit, record })) reverted++;
  }
  await isTier0Protected(newMember);
  return reverted;
}

/** guildBanAdd : une personne protégée bannie est débannie aussitôt. */
export async function handleTier0Ban(ban, { audit = () => {}, record = () => {} } = {}) {
  const guild = ban?.guild;
  const userId = ban?.user?.id;
  if (!guild || !userId || !tier0ProtectionEnabled()) return false;
  const owner = ownerId();
  if (userId !== owner && !knownProtected.get(guild.id)?.has(userId)) return false;
  const member = { id: userId };
  const lookup = () => findMemberUpdateActor(guild, userId, null, { type: AuditLogEvent.MemberBanAdd });
  const done = await revert(guild, member, "bannissement", lookup, () => guild.bans.remove(userId, "Rôle 0 % : intouchable"), { audit, record });
  if (done) await report(guild, audit, "à réinviter", [`<@${userId}> a été débanni, mais Discord ne permet pas de le faire revenir automatiquement : renvoie-lui une invitation.`], 0xf59e0b);
  return done;
}

/** guildMemberRemove : une expulsion d'une personne protégée est signalée (impossible à annuler). */
export async function handleTier0Kick(member, { audit = () => {}, record = () => {} } = {}) {
  const guild = member?.guild;
  if (!guild || !tier0ProtectionEnabled() || !knownProtected.get(guild.id)?.has(member.id)) return false;
  const actorId = await findMemberUpdateActor(guild, member.id, null, { type: AuditLogEvent.MemberKick });
  knownProtected.get(guild.id)?.delete(member.id);
  if (!actorId || actorId === member.id) return false;
  record("tier0_kick_detected");
  await report(guild, audit, "expulsion", [`Membre protégé expulsé : <@${member.id}>`, `Auteur : <@${actorId}>`, "Discord ne permet pas d'annuler une expulsion : renvoie une invitation."]);
  return true;
}

/** Au démarrage : repère les membres protégés déjà présents (nécessaire pour le débannissement). */
export async function primeTier0Members(guild) {
  if (!guild?.roles?.cache || !tier0ProtectionEnabled()) return 0;
  await guild.members?.fetch?.().catch(() => null); // remplit role.members (intent Server Members)
  const explicit = await loadRoleTiers(guild.id).catch(() => new Map());
  const set = knownProtected.get(guild.id) ?? new Set();
  const owner = ownerId();
  if (owner) set.add(owner);
  for (const role of guild.roles.cache.values()) {
    if (!isTier0Role(role, explicit)) continue;
    for (const memberId of role.members?.keys?.() ?? []) set.add(memberId);
  }
  knownProtected.set(guild.id, set);
  return set.size;
}
