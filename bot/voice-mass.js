// FWU V2 — FDPDLAVOC : actions vocales de masse.
//   =mvall <source> <cible>  · =mvrole @rôle <cible> · =pull @membre · =swap @a @b
//   =muteall [salon] · =unmuteall [salon] · =vclear [salon] · =undo
// (et /mvall, /mvrole, /pull, /swap, /muteall, /unmuteall, /vclear, /undo — préfixe « ; » sur FDPDLAVOC)
// Aperçu (nombre de membres) puis confirmation par bouton réservé à l'auteur pour les
// actions de masse ; respect de la hiérarchie (les membres au-dessus de l'auteur sont
// ignorés), de l'Anti-Move (membres protégés ignorés) et du verrou de salon ; la dernière
// action de masse du serveur s'annule avec =undo (30 min).
import { ChannelType, PermissionFlagsBits as P } from "discord.js";
import { randomUUID } from "node:crypto";
import { db } from "./database.js";
import { parsePndOwnerId } from "./pnd-owner-policy.js";
import { isAntiMoveProtected } from "./anti-move.js";
import { withVoiceChannelLock } from "./voice-channel-lock.js";
import { logEvent } from "./log-events.js";

db.exec(`CREATE TABLE IF NOT EXISTS voice_mass_undo (
  guild_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL
)`);

export const MASS_COMMANDS = new Set(["mvall", "mvrole", "pull", "swap", "muteall", "unmuteall", "vclear", "undo"]);
export const UNDO_WINDOW_MS = 30 * 60_000;
const PREVIEW_TTL_MS = 2 * 60_000;
const pending = new Map();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** OWNER, propriétaire, ou « Déplacer des membres » (mute : « Rendre muet », vclear : « Déplacer »). */
export function canUseMassVoice(member, kind, env = process.env) {
  if (!member?.id) return false;
  if (member.id === parsePndOwnerId(env.PND_OWNER_DISCORD_ID) || member.id === member.guild?.ownerId) return true;
  const need = kind === "muteall" || kind === "unmuteall" ? P.MuteMembers : P.MoveMembers;
  return Boolean(member.permissions?.has?.(P.Administrator) || member.permissions?.has?.(need));
}

/** Membres qu'une action de masse peut toucher : pas de bot, pas l'auteur, en dessous de lui, pas protégé Anti-Move. */
export function eligibleMembers(members, actor, { guildId, env = process.env, protectedCheck = isAntiMoveProtected } = {}) {
  const full = actor.id === parsePndOwnerId(env.PND_OWNER_DISCORD_ID) || actor.id === actor.guild?.ownerId;
  const actorPosition = actor.roles?.highest?.position ?? 0;
  const skipped = { higher: 0, protected: 0, bots: 0 };
  const eligible = [];
  for (const member of members) {
    if (member.user?.bot) { skipped.bots += 1; continue; }
    if (member.id === actor.id) continue;
    if (!full && (member.id === parsePndOwnerId(env.PND_OWNER_DISCORD_ID) || member.id === actor.guild?.ownerId || (member.roles?.highest?.position ?? 0) >= actorPosition)) { skipped.higher += 1; continue; }
    if (protectedCheck(guildId, member.id)) { skipped.protected += 1; continue; }
    eligible.push(member);
  }
  return { eligible, skipped };
}

function saveUndo(guildId, actorId, kind, payload, now = Date.now()) {
  db.prepare(`INSERT INTO voice_mass_undo(guild_id, actor_id, kind, payload, created_at) VALUES (?,?,?,?,?)
    ON CONFLICT(guild_id) DO UPDATE SET actor_id = excluded.actor_id, kind = excluded.kind, payload = excluded.payload, created_at = excluded.created_at`)
    .run(String(guildId), actorId, kind, JSON.stringify(payload), now);
}

export function lastUndo(guildId, now = Date.now()) {
  const row = db.prepare("SELECT * FROM voice_mass_undo WHERE guild_id = ?").get(String(guildId));
  if (!row || now - row.created_at > UNDO_WINDOW_MS) return null;
  return { actorId: row.actor_id, kind: row.kind, payload: JSON.parse(row.payload), createdAt: row.created_at };
}

function voiceChannel(guild, raw) {
  const id = String(raw ?? "").replace(/[<#>]/g, "");
  const channel = guild.channels?.cache?.get?.(id);
  return channel && (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) ? channel : null;
}

/** Construit le plan (sans rien modifier). Retourne { error } ou { plan }. */
export function planMassAction(guild, actor, request, { env = process.env, protectedCheck } = {}) {
  const { kind } = request;
  if (!canUseMassVoice(actor, kind, env)) return { error: "⛔ Il te faut la permission Discord adaptée (Déplacer / Rendre muet des membres)." };
  const own = actor.voice?.channel ?? null;
  const opts = { guildId: guild.id, env, protectedCheck };
  if (kind === "mvall") {
    const source = voiceChannel(guild, request.source);
    const target = voiceChannel(guild, request.target);
    if (!source || !target) return { error: "⚠️ Utilisation : `mvall #vocal-source #vocal-cible` (salons vocaux)." };
    if (source.id === target.id) return { error: "⚠️ La source et la cible sont le même salon." };
    const { eligible, skipped } = eligibleMembers([...source.members.values()], actor, opts);
    return { plan: { kind, members: eligible, skipped, source, target, lockId: source.id } };
  }
  if (kind === "mvrole") {
    const target = voiceChannel(guild, request.target);
    const roleId = String(request.roleId ?? "").replace(/[<@&>]/g, "");
    if (!target || !roleId) return { error: "⚠️ Utilisation : `mvrole @rôle #vocal-cible`." };
    const inVoice = [...(guild.voiceStates?.cache?.values?.() ?? [])].map((state) => state.member).filter((m) => m?.roles?.cache?.has?.(roleId) && m.voice?.channelId && m.voice.channelId !== target.id);
    const { eligible, skipped } = eligibleMembers(inVoice, actor, opts);
    return { plan: { kind, members: eligible, skipped, target, lockId: target.id } };
  }
  if (kind === "muteall" || kind === "unmuteall" || kind === "vclear") {
    const channel = request.source ? voiceChannel(guild, request.source) : own;
    if (!channel) return { error: "⚠️ Indique un salon vocal ou rejoins-en un." };
    const { eligible, skipped } = eligibleMembers([...channel.members.values()], actor, opts);
    return { plan: { kind, members: eligible, skipped, source: channel, lockId: channel.id } };
  }
  return { error: "⚠️ Action inconnue." };
}

/** Exécute un plan ; enregistre l'annulation. Retourne { done, failed }. */
export async function executeMassPlan(guild, actor, plan, { stepMs = 300, now = Date.now() } = {}) {
  const undo = [];
  let done = 0;
  let failed = 0;
  const reason = `${plan.kind} par ${actor.id}`;
  await withVoiceChannelLock(plan.lockId, async () => {
    for (const member of plan.members) {
      try {
        if (plan.kind === "mvall" || plan.kind === "mvrole") {
          undo.push({ memberId: member.id, channelId: member.voice?.channelId ?? null });
          await member.voice.setChannel(plan.target, reason);
        } else if (plan.kind === "muteall" || plan.kind === "unmuteall") {
          undo.push({ memberId: member.id, muted: Boolean(member.voice?.serverMute) });
          await member.voice.setMute(plan.kind === "muteall", reason);
        } else if (plan.kind === "vclear") {
          await member.voice.disconnect(reason);
        }
        done += 1;
      } catch {
        failed += 1;
      }
      if (stepMs) await pause(stepMs);
    }
  });
  if (plan.kind !== "vclear" && undo.length) saveUndo(guild.id, actor.id, plan.kind, undo, now);
  await logEvent(guild, null, { category: "voice", action: `voice_${plan.kind}`, severity: "notice", actorId: actor.id, details: `${done} membre(s), ${failed} échec(s)` }).catch(() => {});
  return { done, failed };
}

/** =undo : annule la dernière action de masse (déplacements remis, mutes rétablis). */
export async function undoLastMass(guild, actor, { env = process.env, now = Date.now(), stepMs = 300 } = {}) {
  const last = lastUndo(guild.id, now);
  if (!last) return "ℹ️ Aucune action de masse à annuler (30 minutes au plus).";
  if (!canUseMassVoice(actor, last.kind, env)) return "⛔ Permission insuffisante pour annuler.";
  let done = 0;
  for (const entry of last.payload) {
    const member = guild.members?.cache?.get?.(entry.memberId) ?? await guild.members?.fetch?.(entry.memberId).catch(() => null);
    if (!member?.voice?.channelId) continue;
    try {
      if (last.kind === "mvall" || last.kind === "mvrole" || last.kind === "swap") {
        const back = entry.channelId ? guild.channels.cache.get(entry.channelId) : null;
        if (back) { await member.voice.setChannel(back, `undo par ${actor.id}`); done += 1; }
      } else if (last.kind === "muteall" || last.kind === "unmuteall") {
        await member.voice.setMute(entry.muted, `undo par ${actor.id}`); done += 1;
      }
    } catch { /* membre parti ou permission retirée */ }
    if (stepMs) await pause(stepMs);
  }
  db.prepare("DELETE FROM voice_mass_undo WHERE guild_id = ?").run(String(guild.id));
  return `↩️ Annulation : ${done} membre(s) remis dans leur état précédent.`;
}

function previewText(plan) {
  const labels = { mvall: "déplacer vers", mvrole: "déplacer vers", muteall: "rendre muets dans", unmuteall: "rendre la parole dans", vclear: "déconnecter de" };
  const where = plan.target ?? plan.source;
  const skipped = [plan.skipped.higher ? `${plan.skipped.higher} au-dessus de toi` : null, plan.skipped.protected ? `${plan.skipped.protected} protégé(s) Anti-Move` : null].filter(Boolean).join(", ");
  return `⚠️ **Aperçu** : ${labels[plan.kind]} <#${where.id}> **${plan.members.length}** membre(s)${skipped ? ` (ignorés : ${skipped})` : ""}. Confirmer ?`;
}

/** Prépare l'aperçu et retourne le payload avec les boutons (réservés à l'auteur). */
export function previewPayload(guild, actor, plan, now = Date.now()) {
  const id = randomUUID().slice(0, 12);
  pending.set(id, { guildId: guild.id, actorId: actor.id, plan, expiresAt: now + PREVIEW_TTL_MS });
  return {
    content: previewText(plan),
    allowedMentions: { parse: [] },
    components: [{ type: 1, components: [
      { type: 2, style: 4, label: "Confirmer", custom_id: `vmass:confirm:${id}` },
      { type: 2, style: 2, label: "Annuler", custom_id: `vmass:cancel:${id}` },
    ] }],
  };
}

/** =swap @a @b : échange les salons de deux membres (pas d'aperçu, annulable). */
export async function swapMembers(guild, actor, aId, bId, { env = process.env, protectedCheck = isAntiMoveProtected, now = Date.now() } = {}) {
  if (!canUseMassVoice(actor, "swap", env)) return "⛔ Il te faut « Déplacer des membres ».";
  const [a, b] = await Promise.all([aId, bId].map((id) => guild.members.fetch(id).catch(() => null)));
  if (!a?.voice?.channel || !b?.voice?.channel) return "⚠️ Les deux membres doivent être en vocal.";
  const { eligible } = eligibleMembers([a, b], actor, { guildId: guild.id, env, protectedCheck });
  if (eligible.length !== 2) return "⛔ Un des membres est au-dessus de toi ou protégé par l'Anti-Move.";
  const [ca, cb] = [a.voice.channel, b.voice.channel];
  await a.voice.setChannel(cb, `swap par ${actor.id}`);
  await b.voice.setChannel(ca, `swap par ${actor.id}`);
  saveUndo(guild.id, actor.id, "swap", [{ memberId: a.id, channelId: ca.id }, { memberId: b.id, channelId: cb.id }], now);
  return `🔁 <@${a.id}> et <@${b.id}> ont échangé de salon.`;
}

/** =pull @membre : amène le membre dans ton salon vocal. */
export async function pullMember(guild, actor, targetId, { env = process.env, protectedCheck = isAntiMoveProtected } = {}) {
  if (!canUseMassVoice(actor, "pull", env)) return "⛔ Il te faut « Déplacer des membres ».";
  if (!actor.voice?.channel) return "⚠️ Rejoins d'abord un salon vocal.";
  const target = await guild.members.fetch(targetId).catch(() => null);
  if (!target?.voice?.channel) return "⚠️ Ce membre n'est pas en vocal.";
  if (!eligibleMembers([target], actor, { guildId: guild.id, env, protectedCheck }).eligible.length) return "⛔ Ce membre est au-dessus de toi ou protégé par l'Anti-Move.";
  await target.voice.setChannel(actor.voice.channel, `pull par ${actor.id}`);
  return `🧲 <@${target.id}> a été amené dans <#${actor.voice.channel.id}>.`;
}

/** Cœur commun slash / préfixe. Retourne un payload. */
export async function runMassCommand(guild, actor, request, options = {}) {
  if (request.kind === "undo") return { content: await undoLastMass(guild, actor, options) };
  if (request.kind === "swap") return { content: await swapMembers(guild, actor, request.a, request.b, options) };
  if (request.kind === "pull") return { content: await pullMember(guild, actor, request.target, options) };
  const { error, plan } = planMassAction(guild, actor, request, options);
  if (error) return { content: error };
  if (!plan.members.length) return { content: "ℹ️ Aucun membre concerné." };
  return previewPayload(guild, actor, plan);
}

/** Boutons d'aperçu (auteur seulement ; la permission est revérifiée au clic). */
export async function handleMassButton(interaction, { env = process.env } = {}) {
  if (!interaction?.isButton?.() || !String(interaction.customId ?? "").startsWith("vmass:")) return false;
  const [, action, id] = interaction.customId.split(":");
  const entry = pending.get(id);
  if (!entry || entry.expiresAt < Date.now()) { pending.delete(id); await interaction.update({ content: "⌛ Aperçu expiré.", components: [] }).catch(() => {}); return true; }
  if (interaction.user.id !== entry.actorId) { await interaction.reply({ content: "⛔ Ce bouton n'est pas pour toi.", ephemeral: true }).catch(() => {}); return true; }
  pending.delete(id);
  if (action === "cancel") { await interaction.update({ content: "❌ Action annulée.", components: [] }).catch(() => {}); return true; }
  const actor = await interaction.guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
  if (!actor || !canUseMassVoice(actor, entry.plan.kind, env)) { await interaction.update({ content: "⛔ Permission retirée entre-temps.", components: [] }).catch(() => {}); return true; }
  await interaction.update({ content: "⏳ En cours…", components: [] }).catch(() => {});
  const { done, failed } = await executeMassPlan(interaction.guild, actor, entry.plan);
  await interaction.editReply({ content: `✅ ${done} membre(s) traité(s)${failed ? `, ${failed} échec(s)` : ""}. Annulable avec \`/undo\` pendant 30 min.` }).catch(() => {});
  return true;
}

export async function handleMassInteraction(interaction) {
  if (!interaction?.isChatInputCommand?.() || !MASS_COMMANDS.has(interaction.commandName) || !interaction.guild) return false;
  const o = interaction.options;
  const actor = await interaction.guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => interaction.member);
  const payload = await runMassCommand(interaction.guild, actor, {
    kind: interaction.commandName,
    source: o.getChannel?.("source", false)?.id ?? o.getChannel?.("salon", false)?.id ?? null,
    target: interaction.commandName === "pull" ? o.getUser?.("membre", false)?.id : o.getChannel?.("cible", false)?.id ?? null,
    roleId: o.getRole?.("role", false)?.id ?? null,
    a: o.getUser?.("membre_a", false)?.id ?? null, b: o.getUser?.("membre_b", false)?.id ?? null,
  });
  await interaction.reply({ ...payload, allowedMentions: { parse: [] } });
  return true;
}

/** =mvall #a #b · =mvrole @r #b · =pull @m · =swap @a @b · =muteall [#s] · =unmuteall [#s] · =vclear [#s] · =undo */
export async function handleMassMessage(message) {
  const match = String(message?.content ?? "").trim().match(/^=(mvall|mvrole|pull|swap|muteall|unmuteall|vclear|undo)\b\s*(.*)$/i);
  if (!match || !message.guild || !message.member) return false;
  const kind = match[1].toLowerCase();
  const rest = match[2];
  const channels = [...rest.matchAll(/<#(\d+)>|\b(\d{17,20})\b/g)].map((m) => m[1] ?? m[2]);
  const users = [...rest.matchAll(/<@!?(\d{17,20})>/g)].map((m) => m[1]);
  const roleId = rest.match(/<@&(\d+)>/)?.[1] ?? null;
  const request = {
    kind,
    source: kind === "mvall" ? channels[0] : channels[0] ?? null,
    target: kind === "mvall" ? channels[1] : kind === "pull" ? users[0] : channels.at(-1) ?? null,
    roleId, a: users[0], b: users[1],
  };
  const actor = await message.guild.members.fetch({ user: message.author.id, force: true }).catch(() => message.member);
  await message.reply({ ...(await runMassCommand(message.guild, actor, request)), allowedMentions: { parse: [] } }).catch(() => {});
  return true;
}
