import { dataPath } from "./data-dir.js";
import { readFile, writeFile, rename, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PermissionFlagsBits } from "discord.js";
import { isSysPlus } from "./systems/sysplus/permissions.js";
import { isWhitelistMember } from "./systems/sysplus/whitelist-policy.js";
import { recordSysPlusAudit } from "./systems/sysplus/audit.js";
import { db } from "./database.js";
import { evaluateTargetHierarchy } from "./target-hierarchy-policy.js";
import { parsePndOwnerId } from "./pnd-owner-policy.js";
import { systemLogEmbed, sendCentralLog } from "./logs.js";
import {
  canCreateLeash,
  findLeashRole,
  isLeashRoleName,
  isOwnerLeashRoleName,
  leashRoleName,
  leashQuotaStatus,
  resolveMaxActiveLeashes,
} from "./dog-policy.js";

const stateFile = process.env.PND_DOG_STATE_PATH
  ? resolve(process.env.PND_DOG_STATE_PATH)
  : dataPath("dog-state.json");
const stateTempFile = process.env.PND_DOG_STATE_PATH
  ? `${stateFile}.tmp`
  : dataPath("dog-state.tmp");
let state;
let pendingWrite = Promise.resolve();
const enforcingMembers = new Map();
const enforcingVoiceMembers = new Map();
const leashRolePromises = new Map();
const commandLocks = new Map();

/**
 * Rôle « En laisse (Pseudo du maître) » : un seul par maître, partagé par ses laisses.
 * Cherché d'abord via les laisses actives de ce maître (le pseudo a pu changer : le rôle
 * est alors renommé), puis par son nom, sinon créé (création sérialisée par maître).
 */
async function getLeashRole(guild, ownerId, ownerName, records = null) {
  const botMember = await guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error("Le bot doit avoir la permission Gérer les rôles pour protéger la laisse DOG.");
  }
  const expectedName = leashRoleName(ownerName);
  let role = null;
  for (const record of Object.values(records ?? {})) {
    if (record?.guildId !== guild.id || record.ownerId !== ownerId || record.releasing || !record.leashRoleId) continue;
    const candidate = await fetchRole(guild, record.leashRoleId);
    if (candidate && isOwnerLeashRoleName(candidate.name)) { role = candidate; break; }
  }
  role ??= findLeashRole(guild.roles.cache, botMember.roles.highest.position, ownerName);
  // Retrouvé par son nom : on ne réutilise qu'un rôle sans AUCUNE permission, sinon un rôle
  // nommé « En laisse (…) » à la main pourrait être donné au membre tenu en laisse.
  if (role && !leashRoleIsHarmless(role)) role = null;
  if (!role) {
    const key = `${guild.id}:${ownerId}`;
    if (!leashRolePromises.has(key)) {
      const pending = guild.roles
        .create({
          name: expectedName,
          color: 0x8b5cf6,
          permissions: [],
          mentionable: false,
          hoist: false,
          reason: `Rôle système FWU DOG — laisse de ${String(ownerName ?? ownerId).slice(0, 60)}`,
        })
        .finally(() => {
          leashRolePromises.delete(key);
        });
      leashRolePromises.set(key, pending);
    }
    role = await leashRolePromises.get(key);
  }
  if (role.position >= botMember.roles.highest.position) {
    throw new Error("Le rôle DOG doit être placé sous le rôle le plus élevé du bot.");
  }
  if (role.name !== expectedName && typeof role.setName === "function") {
    role = await role.setName(expectedName, "DOG : pseudo du maître mis à jour").catch(() => role);
  }
  return role;
}

function leashRoleIsHarmless(role) {
  if (!role || role.managed) return false;
  try { return BigInt(role.permissions?.bitfield ?? role.permissions ?? 0) === 0n; } catch { return false; }
}

async function fetchRole(guild, roleId) {
  if (!roleId) return null;
  const cached = guild.roles?.cache?.get?.(roleId);
  if (cached) return cached;
  try { return (await guild.roles?.fetch?.(roleId)) ?? null; } catch { return null; }
}

/** Supprime un rôle « En laisse (…) » que plus personne ne porte et qu'aucune laisse n'utilise. */
async function releaseLeashRoleIfUnused(guild, roleId, records) {
  if (!guild || !roleId) return false;
  if (Object.values(records ?? {}).some((record) => record?.guildId === guild.id && record.leashRoleId === roleId && !record.releasing)) return false;
  const role = await fetchRole(guild, roleId);
  if (!role || role.managed || !isOwnerLeashRoleName(role.name)) return false;
  if ((role.members?.size ?? 0) > 0) return false;
  return Boolean(await role.delete("DOG : plus aucune laisse pour ce maître").catch(() => null));
}

let stateMtimeMs = null;
async function fileMtime() {
  try { return (await stat(stateFile)).mtimeMs; } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

// Several FWU bots share this file (shared data folder): reload it when another
// process changed it, so every bot sees the same leashes.
async function loadState() {
  const mtime = await fileMtime();
  if (state && mtime === stateMtimeMs) return state;
  try {
    state = JSON.parse(await readFile(stateFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    state = {};
  }
  stateMtimeMs = mtime;
  return state;
}

async function saveState() {
  const snapshot = JSON.stringify(state, null, 2);
  const write = pendingWrite.catch(() => {}).then(async () => {
    await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
    await writeFile(stateTempFile, snapshot, { mode: 0o600 });
    await rename(stateTempFile, stateFile);
    stateMtimeMs = await fileMtime();
  });
  pendingWrite = write;
  await write;
}

function key(guildId, memberId) {
  return `${guildId}:${memberId}`;
}

function dogNickname(ownerName) {
  // Discord limits nicknames to 32 characters.
  return `🦮 de ${ownerName}`.slice(0, 32);
}

async function withCommandLock(lockKey, action) {
  const previous = commandLocks.get(lockKey) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  commandLocks.set(lockKey, current);
  await previous.catch(() => {});
  try { return await action(); }
  finally {
    release();
    if (commandLocks.get(lockKey) === current) commandLocks.delete(lockKey);
  }
}

export async function isMemberDogged(guildId, memberId) {
  if (!guildId || !memberId) return false;
  const records = await loadState();
  const record = records[key(guildId, memberId)];
  return Boolean(record && !record.releasing);
}

/** Reapply the persistent leash role and nickname after any member update. */
export async function enforceLeashNickname(member) {
  if (!member?.guild || !member.id) return false;
  const id = key(member.guild.id, member.id);
  const activeEnforcement = enforcingMembers.get(id);
  if (activeEnforcement) {
    activeEnforcement.latestMember = member;
    activeEnforcement.rerun = true;
    return false;
  }

  const run = { latestMember: member, rerun: false };
  enforcingMembers.set(id, run);
  let restored = false;

  try {
    do {
      run.rerun = false;
      const eventMember = run.latestMember;
      const record = (await loadState())[id];
      if (!record || record.releasing) return restored;

      // Fetch current state instead of trusting a possibly stale event snapshot.
      const currentMember = await eventMember.guild.members.fetch(eventMember.id).catch(() => eventMember);

      let leashRole = record.leashRoleId
        ? (currentMember.guild.roles.cache.get(record.leashRoleId)
          ?? await currentMember.guild.roles.fetch(record.leashRoleId).catch(() => null))
        : null;
      // Absent, ou ancien rôle commun « En laisse » : passage au rôle « En laisse (Maître) ».
      if (!leashRole || !isOwnerLeashRoleName(leashRole.name)) {
        const previousRole = leashRole;
        leashRole = await getLeashRole(currentMember.guild, record.ownerId, record.ownerName, await loadState());
        record.leashRoleId = leashRole.id;
        await saveState();
        if (previousRole && previousRole.id !== leashRole.id && currentMember.roles.cache.has(previousRole.id)) {
          await currentMember.roles.remove(previousRole, "DOG : passage au rôle du maître").catch(() => {});
        }
      }
      if (!currentMember.roles.cache.has(leashRole.id)) {
        const botMember = await currentMember.guild.members.fetchMe();
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles) || leashRole.position >= botMember.roles.highest.position) {
          throw new Error("Le rôle DOG n'est pas gérable dans la hiérarchie Discord.");
        }
        await currentMember.roles.add(leashRole, "DOG : maintien du rôle de laisse");
        restored = true;
      }

      const expectedNickname = dogNickname(record.ownerName || "son propriétaire");
      if (currentMember.nickname === expectedNickname) continue;

      const botMember = await currentMember.guild.members.fetchMe();
      if (!botMember.permissions.has(PermissionFlagsBits.ManageNicknames)) return restored;
      if (currentMember.id === currentMember.guild.ownerId || currentMember.roles.highest.position >= botMember.roles.highest.position) return restored;

      try {
        await currentMember.setNickname(expectedNickname, "DOG : rétablissement du surnom de laisse");
        restored = true;
      } catch {
        // The marker role still keeps the leash active if nickname editing is unavailable.
      }
    } while (run.rerun);

    return restored;
  } finally {
    enforcingMembers.delete(id);
  }
}

/** Restore active DOG nicknames after the bot reconnects. */
export async function reconcileLeashedMembers(client) {
  const records = await loadState();
  let restored = 0;
  for (const record of Object.values(records)) {
    if (!record || record.releasing || !record.guildId || !record.memberId) continue;
    const guild = client.guilds.cache.get(record.guildId);
    if (!guild) continue;
    const member = await guild.members.fetch(record.memberId).catch(() => null);
    if (member && await enforceLeashNickname(member)) restored++;
    if (member && await enforceLeashVoice(guild, record.memberId)) restored++;
  }
  return restored;
}

// Anti-boucle : au plus LEASH_FOLLOW_MAX déplacements par minute et par membre
// (un autre bot ou un modérateur qui la remet sans cesse ailleurs, rate limits Discord).
const LEASH_FOLLOW_MAX = 6;
const LEASH_FOLLOW_WINDOW_MS = 60_000;
const leashFollowHistory = new Map();

/** Tests only: reset the anti-loop counters. */
export function forgetLeashFollowHistory() {
  leashFollowHistory.clear();
}

function takeLeashFollowSlot(id, now = Date.now()) {
  const recent = (leashFollowHistory.get(id) ?? []).filter((at) => now - at < LEASH_FOLLOW_WINDOW_MS);
  if (recent.length >= LEASH_FOLLOW_MAX) {
    leashFollowHistory.set(id, recent);
    return false;
  }
  recent.push(now);
  leashFollowHistory.set(id, recent);
  if (leashFollowHistory.size > 5_000) {
    for (const [entry, times] of leashFollowHistory) if (!times.some((at) => now - at < LEASH_FOLLOW_WINDOW_MS)) leashFollowHistory.delete(entry);
  }
  return true;
}

/**
 * Move a connected leashed member to their owner's current voice channel.
 * Only the BOT needs Move Members (source) and View + Connect (destination):
 * Discord lets a mover place a member in a locked or full channel, so the
 * leashed member's own Connect permission is deliberately not required.
 * Never throws: a refused or failed move returns false.
 */
export async function enforceLeashVoice(guild, memberId) {
  if (!guild || !memberId) return false;
  const id = key(guild.id, memberId);
  const activeRun = enforcingVoiceMembers.get(id);
  if (activeRun) {
    activeRun.rerun = true;
    return false;
  }

  const run = { rerun: false };
  enforcingVoiceMembers.set(id, run);
  let moved = false;

  try {
    do {
      run.rerun = false;
      const record = (await loadState())[id];
      if (!record || record.releasing || !record.ownerId || record.ownerId === memberId) return moved;

      const target = guild.members.cache.get(memberId) ?? await guild.members.fetch(memberId).catch(() => null);
      const owner = guild.members.cache.get(record.ownerId) ?? await guild.members.fetch(record.ownerId).catch(() => null);
      const targetChannel = target?.voice.channel;
      const ownerChannel = owner?.voice.channel;
      // Cible ou maître hors vocal, ou déjà ensemble : rien à faire.
      if (!target || !targetChannel || !ownerChannel || targetChannel.id === ownerChannel.id) continue;

      const botMember = await guild.members.fetchMe().catch(() => null);
      if (!botMember) return moved;
      const sourcePermissions = targetChannel.permissionsFor(botMember);
      const destinationPermissions = ownerChannel.permissionsFor(botMember);
      if (!sourcePermissions?.has(PermissionFlagsBits.MoveMembers) ||
          !destinationPermissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect])) return moved;
      if (!takeLeashFollowSlot(id)) return moved;

      try {
        await target.voice.setChannel(ownerChannel, "DOG : retour dans le vocal du propriétaire");
        moved = true;
      } catch {
        return moved; // permissions retirées entre-temps, membre parti, rate limit : on n'insiste pas
      }
    } while (run.rerun);

    return moved;
  } finally {
    enforcingVoiceMembers.delete(id);
  }
}

/** Enforce the voice leash when either the leashed member or their owner moves. */
export async function handleLeashVoiceState(oldState, newState) {
  if (oldState.channelId === newState.channelId) return 0;
  const guild = newState.guild;
  if (!guild) return 0;
  const records = await loadState();
  const changedMemberId = newState.id;
  const targets = [];
  if (records[key(guild.id, changedMemberId)] && !records[key(guild.id, changedMemberId)].releasing) {
    targets.push(changedMemberId);
  }
  for (const record of Object.values(records)) {
    if (record?.guildId === guild.id && record.ownerId === changedMemberId && !record.releasing) {
      targets.push(record.memberId);
    }
  }

  let moved = 0;
  for (const targetId of new Set(targets)) {
    if (await enforceLeashVoice(guild, targetId)) moved++;
  }
  return moved;
}

export async function handleDogCommand(message, guildSettings = null) {
  const parts = message.content.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase();
  if (!["=dog", "=undog", "=doginfo", "=doglist"].includes(command)) return false;

  if (!message.guild || !message.member) return true;
  const actor = await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!actor || !isSysPlus(actor, guildSettings?.sysPlus?.roleId ?? null)) {
    await message.reply({
      content: "⛔ Cette commande est réservée aux membres SYS+.",
      allowedMentions: { parse: [] },
    });
    return true;
  }

  if (command === "=doglist") {
    const active = Object.values(await loadState())
      .filter((record) => record?.guildId === message.guild.id && record.memberId && !record.releasing)
      .sort((a, b) => Number(a.since || 0) - Number(b.since || 0));
    const lines = active.slice(0, 20).map((record, index) =>
      `${index + 1}. <@${record.memberId}> · par **${String(record.ownerName || "SYS+").slice(0, 64)}** · depuis <t:${Math.floor(Number(record.since || 0) / 1000)}:R>`,
    );
    await message.reply({
      content: `🐾 **Laisses actives · ${message.guild.name}** (${active.length})\n${lines.length ? lines.join("\n") : "Aucune laisse active."}${active.length > lines.length ? `\n… et ${active.length - lines.length} autre(s).` : ""}`,
      allowedMentions: { parse: [] },
    });
    return true;
  }

  const targetId = message.mentions.members.first()?.id ?? parts[1]?.match(/^<@!?(\d+)>$/)?.[1];
  if (!targetId) {
    await message.reply({
      content: `Utilisation : \`${command} @membre\``,
      allowedMentions: { parse: [] },
    });
    return true;
  }

  const target = await message.guild.members.fetch(targetId).catch(() => null);
  if (!target) {
    // A leash on someone who left the server can always be cleared (nothing to restore on Discord).
    const records = await loadState();
    if (command === "=undog" && records[key(message.guild.id, targetId)]) {
      delete records[key(message.guild.id, targetId)];
      await saveState();
      await message.reply({ content: "🦴 Laisse supprimée : ce membre n'est plus sur le serveur.", allowedMentions: { parse: [] } });
      return true;
    }
    await message.reply({ content: "❌ Je ne trouve pas ce membre sur le serveur.", allowedMentions: { parse: [] } });
    return true;
  }

  if (target.id === message.author.id && command !== "=doginfo") {
    await message.reply({ content: "Tu ne peux pas appliquer cette action sur toi-même.", allowedMentions: { parse: [] } });
    return true;
  }

  const botMember = await message.guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageNicknames)) {
    await message.reply({ content: "❌ Il me manque la permission **Gérer les surnoms**.", allowedMentions: { parse: [] } });
    return true;
  }

  // Hierarchy guard, before any mutation. Applying a leash also requires the actor to outrank the target;
  // releasing one (=undog) and reading it (=doginfo) only need the bot-side and owner protections.
  const hierarchy = evaluateTargetHierarchy({
    actor,
    target,
    bot: botMember,
    guildOwnerId: message.guild.ownerId,
    pndOwnerId: parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID),
    enforceActorRank: command === "=dog",
    allowSelf: true, // self-target is refused earlier, except for =doginfo
  });
  if (!hierarchy.allowed) {
    await message.reply({ content: `❌ ${hierarchy.reason}`, allowedMentions: { parse: [] } });
    return true;
  }

  const records = await loadState();
  const id = key(message.guild.id, target.id);
  const existing = records[id];

  if (command === "=doginfo") {
    if (!existing) {
      await message.reply({ content: `🐾 **${target.displayName}** n'est actuellement pas en laisse.`, allowedMentions: { parse: [] } });
    } else {
      const since = Math.floor(existing.since / 1000);
      await message.reply({
        content: `🦮 **${target.user.username}** est en laisse par **${existing.ownerName}** depuis <t:${since}:R>.`,
        allowedMentions: { parse: [] },
      });
    }
    return true;
  }

  if (command === "=dog") {
    return withCommandLock(`${message.guild.id}:dog-state`, async () => {
      await pruneDepartedLeashes(message.guild);
      const freshRecords = await loadState();
      const freshExisting = freshRecords[id];
      if (freshExisting && !freshExisting.releasing) {
        await message.reply({
          content: `🦮 Ce membre est déjà en laisse par **${freshExisting.ownerName}**. Utilise \`=undog @membre\` pour retirer la laisse.`,
          allowedMentions: { parse: [] },
        });
        return true;
      }

      const whitelisted = isWhitelistMember(actor, guildSettings?.sysPlus?.whitelistRoleId ?? null);
      // Per-guild limit from /setup (dog.maxActiveLeashes); historical default 3 when unset.
      const maxLeashes = resolveMaxActiveLeashes(guildSettings?.dog?.maxActiveLeashes);
      const quota = leashQuotaStatus(freshRecords, message.guild.id, message.author.id, maxLeashes, whitelisted);
      const activeCount = quota.activeCount;
      if (!canCreateLeash(freshRecords, message.guild.id, message.author.id, maxLeashes, whitelisted)) {
        await message.reply({
          content: `⛔ Tu as déjà **${activeCount}/${maxLeashes}** laisses actives. Libère-en une avec \`=undog @membre\` avant d'en ajouter une autre.`,
          allowedMentions: { parse: [] },
        });
        return true;
      }

      const menotte = db.prepare("SELECT channel_id FROM voice_menottes WHERE guild_id=? AND member_id=?").get(message.guild.id, target.id);
      if (menotte) {
        await message.reply({ content: "⛔ Ce membre est déjà soumis au système MENOTTE. Libère d'abord cette restriction.", allowedMentions: { parse: [] } });
        return true;
      }
      const nicknameLock = db.prepare("SELECT 1 FROM protected_nicknames WHERE guild_id=? AND member_id=?").get(message.guild.id, target.id);
      if (nicknameLock) {
        await message.reply({ content: "⛔ Retire d’abord LOCKNAME avant de modifier le pseudonyme avec DOG.", allowedMentions: { parse: [] } });
        return true;
      }

      const previousNickname = target.nickname;
      const ownerName = actor.displayName || message.author.username;
      let leashRole;
      try {
        leashRole = await getLeashRole(message.guild, message.author.id, ownerName, freshRecords);
      } catch (error) {
        await message.reply({
          content: `❌ ${error.message} Vérifie les permissions et la position des rôles du bot.`,
          allowedMentions: { parse: [] },
        });
        return true;
      }
      freshRecords[id] = {
        guildId: message.guild.id,
        memberId: target.id,
        previousNickname,
        ownerId: message.author.id,
        ownerName,
        leashRoleId: leashRole.id,
        since: Date.now(),
      };
      try {
        await saveState();
        await target.roles.add(leashRole, `Mis en laisse par ${message.author.tag}`);
        await target.setNickname(dogNickname(ownerName), `Mis en laisse par ${message.author.tag}`);
      } catch (error) {
        delete freshRecords[id];
        await saveState().catch(() => {});
        await target.roles.remove(leashRole, "Annulation de la laisse DOG échouée").catch(() => {});
        await releaseLeashRoleIfUnused(message.guild, leashRole.id, freshRecords).catch(() => {});
        console.error("DOG command failed:", error.message);
        await message.reply({
          content: "❌ Impossible de mettre ce membre en laisse. Vérifie la hiérarchie des rôles et mes permissions.",
          allowedMentions: { parse: [] },
        });
        return true;
      }
      const returnedToOwner = await enforceLeashVoice(message.guild, target.id).catch(() => false);
      const leashCount = quota.label;
      if (quota.exceptionUsed) {
        try {
          recordSysPlusAudit(message.guild.id, message.author.id, "dog.whitelist_quota_exception", target.id, {
            activeBefore: activeCount,
            configuredLimit: maxLeashes,
          });
        } catch (error) {
          console.error("DOG whitelist exception audit failed:", error.message);
        }
      }
      await sendCentralLog(message.guild, guildSettings, systemLogEmbed({ title: "🦮 DOG — laisse attribuée", description: `Acteur : <@${message.author.id}>\nCible : <@${target.id}>\nLaisses actives : ${leashCount}` })).catch(() => {});
      await message.reply({
        content: `🦮 **${target.user.username}** est maintenant en laisse par **${ownerName}** (${leashCount}).${returnedToOwner ? " Il a été ramené dans ton salon vocal." : ""}`,
        allowedMentions: { parse: [] },
      });
      return true;
    });
  }

  if (!existing) {
    // Leash left by the old bot (role or nickname, but nothing saved): clean it.
    if (orphanLeashParts(target).any) {
      try {
        await clearOrphanLeash(target, message.author.tag);
        await message.reply({ content: `🦴 Ancienne laisse retirée de **${target.user.username}** (rôle DOG et pseudo « 🦮 de … »).`, allowedMentions: { parse: [] } });
      } catch {
        await message.reply({ content: "❌ Impossible de retirer l'ancienne laisse : mon rôle doit être au-dessus du rôle DOG et de ce membre.", allowedMentions: { parse: [] } });
      }
      return true;
    }
    await message.reply({ content: "🐾 Ce membre n'est pas en laisse.", allowedMentions: { parse: [] } });
    return true;
  }

  // A SYS+ can release their own leash. Only the server owner / Discord
  // administrators may override another SYS+'s active leash.
  const canOverrideOwner = message.author.id === message.guild.ownerId
    || actor.permissions.has(PermissionFlagsBits.Administrator);
  if (existing.ownerId !== message.author.id && !canOverrideOwner) {
    await message.reply({
      content: "⛔ Seul le SYS+ qui a posé cette laisse peut la retirer. Le propriétaire du serveur ou un administrateur Discord peut intervenir en cas de besoin.",
      allowedMentions: { parse: [] },
    });
    return true;
  }

  return withCommandLock(`${message.guild.id}:dog-state`, async () => {
  // Re-read the record after acquiring the owner's lock to avoid racing another release.
  const current = await loadState();
  const latest = current[id];
  if (!latest || latest.releasing) {
    await message.reply({ content: "🐾 Cette laisse n'est plus active.", allowedMentions: { parse: [] } });
    return true;
  }

  try {
    // Mark release before changing the nickname so the update event won't reapply the leash.
    current[id] = { ...latest, releasing: true };
    await saveState();
    await target.setNickname(latest.previousNickname ?? null, `Laisse retirée par ${message.author.tag}`);
    if (latest.leashRoleId) {
      const role = message.guild.roles.cache.get(latest.leashRoleId)
        ?? await message.guild.roles.fetch(latest.leashRoleId).catch(() => null);
      if (role && target.roles.cache.has(role.id)) await target.roles.remove(role, `Laisse retirée par ${message.author.tag}`);
    }
    delete current[id];
    await saveState();
    await releaseLeashRoleIfUnused(message.guild, latest.leashRoleId, current).catch(() => {});
  } catch (error) {
    current[id] = latest;
    await saveState().catch(() => {});
    console.error("UNDOG command failed:", error.message);
    await message.reply({
      content: "❌ Impossible de retirer la laisse. Vérifie la hiérarchie des rôles et mes permissions.",
      allowedMentions: { parse: [] },
    });
    return true;
  }
  await sendCentralLog(message.guild, guildSettings, systemLogEmbed({ title: "🦴 DOG — laisse retirée", description: `Acteur : <@${message.author.id}>\nCible : <@${target.id}>` })).catch(() => {});
  await message.reply({
    content: `🦴 La laisse de **${target.user.username}** a été retirée. Son ancien surnom a été restauré.`,
    allowedMentions: { parse: [] },
  });
  return true;
  });
}

/**
 * Forget leashes of members who left this server: they no longer count in the
 * per-SYS+ quota. Only a definitive "unknown member" answer removes a record.
 */
export async function pruneDepartedLeashes(guild) {
  const records = await loadState();
  const ids = Object.values(records).filter((r) => r?.guildId === guild.id && r.memberId).map((r) => r.memberId);
  if (!ids.length) return 0;
  const present = new Set();
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const found = await guild.members.fetch({ user: ids.slice(i, i + 100) });
      if (!found || typeof found.keys !== "function") return 0;
      for (const id of found.keys()) present.add(id);
    }
  } catch {
    return 0; // transient error: keep everything
  }
  let removed = 0;
  const freedRoles = new Set();
  for (const memberId of ids) {
    if (present.has(memberId)) continue;
    const roleId = records[key(guild.id, memberId)]?.leashRoleId;
    if (roleId) freedRoles.add(roleId);
    delete records[key(guild.id, memberId)];
    removed += 1;
  }
  if (removed) await saveState();
  for (const roleId of freedRoles) await releaseLeashRoleIfUnused(guild, roleId, records).catch(() => {});
  return removed;
}

export const UNDOG_ALL_DENIED = "⛔ /undogall est réservé à l'OWNER, au propriétaire du serveur et aux administrateurs.";

export function canUndogAll(member) {
  if (!member?.id || !member.guild) return false;
  if (member.id === parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID) || member.id === member.guild.ownerId) return true;
  return Boolean(member.permissions?.has?.(PermissionFlagsBits.Administrator));
}

/**
 * Release leashes in bulk. scope: "serveur" (this server), "anciens" (records of
 * servers this bot is no longer on, e.g. the old bot's servers), "tout" (both).
 * Members still here get their old nickname back and lose the DOG role.
 */
export async function undogAll({ guild, client, scope = "serveur", actorTag = "FWU" }) {
  const result = { released: 0, forgotten: 0, oldServers: 0, orphans: 0, failed: 0 };
  await withCommandLock(`${guild.id}:dog-state`, async () => {
    const records = await loadState();
    for (const [id, record] of Object.entries(records)) {
      if (!record?.guildId) { delete records[id]; result.oldServers += 1; continue; }
      if (record.guildId !== guild.id) {
        if ((scope === "anciens" || scope === "tout") && !client?.guilds?.cache?.has?.(record.guildId)) {
          delete records[id];
          result.oldServers += 1;
        }
        continue;
      }
      if (scope === "anciens") continue;
      const member = await guild.members.fetch({ user: record.memberId }).catch((error) => (error?.code === 10007 ? null : undefined));
      if (member === null) { delete records[id]; result.forgotten += 1; continue; }
      if (member === undefined) { result.failed += 1; continue; }
      try {
        records[id] = { ...record, releasing: true };
        await saveState();
        await member.setNickname(record.previousNickname ?? null, `Laisses retirées en masse par ${actorTag}`);
        if (record.leashRoleId && member.roles.cache.has(record.leashRoleId)) {
          await member.roles.remove(record.leashRoleId, `Laisses retirées en masse par ${actorTag}`);
        }
        delete records[id];
        result.released += 1;
        await releaseLeashRoleIfUnused(guild, record.leashRoleId, records).catch(() => {});
      } catch {
        records[id] = record;
        result.failed += 1;
      }
    }
    await saveState();
    if (scope !== "anciens") {
      // Leashes the old bot left on members (DOG role / "🦮 de …" or old "🐶 de …" nickname) with nothing saved.
      const members = await guild.members.fetch().catch(() => null);
      for (const member of members?.values?.() ?? []) {
        if (records[key(guild.id, member.id)]) continue;
        if (!orphanLeashParts(member).any) continue;
        try { if (await clearOrphanLeash(member, actorTag)) result.orphans += 1; } catch { result.failed += 1; }
      }
    }
  });
  return result;
}

export async function handleUndogAllInteraction(interaction, guildSettings = null) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== "undogall") return false;
  if (!interaction.guild) {
    await interaction.reply({ content: "Cette commande s'utilise sur un serveur.", ephemeral: true });
    return true;
  }
  // Acknowledge Discord immediately (3-second limit), then check and work.
  await interaction.deferReply({ ephemeral: true });
  const member = interaction.member?.permissions?.has ? interaction.member : await interaction.guild.members.fetch({ user: interaction.user.id }).catch(() => null);
  if (!canUndogAll(member)) {
    await interaction.editReply({ content: UNDOG_ALL_DENIED });
    return true;
  }
  const scope = interaction.options.getString?.("portee") ?? "serveur";
  let r;
  try {
    r = await undogAll({ guild: interaction.guild, client: interaction.client, scope, actorTag: interaction.user.tag ?? interaction.user.id });
  } catch (error) {
    console.error("[dog] undogall:", error?.message ?? error);
    await interaction.editReply({ content: "❌ Le nettoyage a échoué. Vérifie que mon rôle est au-dessus du rôle DOG et des membres concernés, puis relance." }).catch(() => {});
    return true;
  }
  try { recordSysPlusAudit(interaction.guild.id, interaction.user.id, "dog.undog_all", null, { scope, ...r }); } catch { /* audit is best effort */ }
  await sendCentralLog(interaction.guild, guildSettings, systemLogEmbed({ title: "🦴 DOG — laisses retirées en masse", description: `Acteur : <@${interaction.user.id}>\nPortée : ${scope}\nLibérées : ${r.released} · membres partis : ${r.forgotten} · anciennes laisses : ${r.orphans} · anciens serveurs : ${r.oldServers} · échecs : ${r.failed}` })).catch(() => {});
  const lines = [
    "🦴 **Laisses DOG retirées**",
    scope !== "anciens" ? `• Sur ce serveur : **${r.released}** libérée(s), **${r.forgotten}** supprimée(s) (membres partis).` : null,
    scope !== "anciens" ? `• Anciennes laisses laissées par l'ancien bot : **${r.orphans}** retirée(s).` : null,
    scope !== "serveur" ? `• Anciens serveurs : **${r.oldServers}** laisse(s) supprimée(s).` : null,
    r.failed ? `⚠️ ${r.failed} échec(s) : vérifie que le rôle du bot est au-dessus des membres concernés, puis relance.` : null,
  ].filter(Boolean);
  await interaction.editReply({ content: lines.join("\n"), allowedMentions: { parse: [] } });
  return true;
}

// 🦮 depuis le 24/11/2026 ; 🐶 = ancien pseudo, encore reconnu pour le nettoyage.
const LEASH_NICKNAME = /^(?:🦮|🐶)\s*de\s/u;

/** A member who still shows a leash (DOG role or "🦮 de …" / old "🐶 de …" nickname) without any saved leash. */
export function orphanLeashParts(member) {
  const roles = [...(member?.roles?.cache?.values?.() ?? [])].filter((role) => isLeashRoleName(role?.name) && !role.managed);
  const nickname = LEASH_NICKNAME.test(String(member?.nickname ?? ""));
  return { roles, nickname, any: roles.length > 0 || nickname };
}

/** Remove what an old bot left behind: DOG role(s) and the leash nickname (reset to the member's own name). */
export async function clearOrphanLeash(member, actorTag = "FWU") {
  const { roles, nickname, any } = orphanLeashParts(member);
  if (!any) return false;
  for (const role of roles) await member.roles.remove(role, `Ancienne laisse DOG retirée par ${actorTag}`);
  if (nickname) await member.setNickname(null, `Ancienne laisse DOG retirée par ${actorTag}`);
  return true;
}
