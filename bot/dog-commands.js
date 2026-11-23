import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
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
  LEASH_ROLE_NAME,
  leashQuotaStatus,
  resolveMaxActiveLeashes,
} from "./dog-policy.js";

const stateFile = process.env.PND_DOG_STATE_PATH
  ? resolve(process.env.PND_DOG_STATE_PATH)
  : fileURLToPath(new URL("./data/dog-state.json", import.meta.url));
const stateTempFile = process.env.PND_DOG_STATE_PATH
  ? `${stateFile}.tmp`
  : fileURLToPath(new URL("./data/dog-state.tmp", import.meta.url));
let state;
let pendingWrite = Promise.resolve();
const enforcingMembers = new Map();
const enforcingVoiceMembers = new Map();
const leashRolePromises = new Map();
const commandLocks = new Map();

async function getLeashRole(guild) {
  const botMember = await guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error("Le bot doit avoir la permission Gérer les rôles pour protéger la laisse DOG.");
  }
  let role = await findLeashRole(guild.roles.cache, botMember.roles.highest.position);
  if (role) return role;

  // Serialize creation so two simultaneous =dog commands cannot create duplicate marker roles.
  if (!leashRolePromises.has(guild.id)) {
    const pending = guild.roles
      .create({
        name: LEASH_ROLE_NAME,
        color: 0x8b5cf6,
        permissions: [],
        mentionable: false,
        hoist: false,
        reason: "Rôle système FWU DOG — marqueur persistant de laisse",
      })
      .finally(() => {
        leashRolePromises.delete(guild.id);
      });
    leashRolePromises.set(guild.id, pending);
  }
  role = await leashRolePromises.get(guild.id);
  if (role.position >= botMember.roles.highest.position) {
    throw new Error("Le rôle DOG doit être placé sous le rôle le plus élevé du bot.");
  }
  return role;
}

async function loadState() {
  if (state) return state;
  try {
    state = JSON.parse(await readFile(stateFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    state = {};
  }
  return state;
}

async function saveState() {
  const snapshot = JSON.stringify(state, null, 2);
  const write = pendingWrite.catch(() => {}).then(async () => {
    await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
    await writeFile(stateTempFile, snapshot, { mode: 0o600 });
    await rename(stateTempFile, stateFile);
  });
  pendingWrite = write;
  await write;
}

function key(guildId, memberId) {
  return `${guildId}:${memberId}`;
}

function dogNickname(ownerName) {
  // Discord limits nicknames to 32 characters.
  return `🐶 de ${ownerName}`.slice(0, 32);
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
      if (!leashRole) {
        leashRole = await getLeashRole(currentMember.guild);
        record.leashRoleId = leashRole.id;
        await saveState();
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

/** Move a connected leashed member to their owner's current voice channel. */
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
      if (!target || !targetChannel || !ownerChannel || targetChannel.id === ownerChannel.id) continue;

      const botMember = await guild.members.fetchMe();
      const sourcePermissions = targetChannel.permissionsFor(botMember);
      const destinationPermissions = ownerChannel.permissionsFor(botMember);
      const targetPermissions = ownerChannel.permissionsFor(target);
      if (!sourcePermissions?.has(PermissionFlagsBits.MoveMembers) ||
          !destinationPermissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]) ||
          !targetPermissions?.has(PermissionFlagsBits.Connect)) return moved;

      await target.voice.setChannel(ownerChannel, "DOG : retour dans le vocal du propriétaire");
      moved = true;
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
        content: `🐶 **${target.user.username}** est en laisse par **${existing.ownerName}** depuis <t:${since}:R>.`,
        allowedMentions: { parse: [] },
      });
    }
    return true;
  }

  if (command === "=dog") {
    return withCommandLock(`${message.guild.id}:dog-state`, async () => {
      const freshRecords = await loadState();
      const freshExisting = freshRecords[id];
      if (freshExisting && !freshExisting.releasing) {
        await message.reply({
          content: `🐶 Ce membre est déjà en laisse par **${freshExisting.ownerName}**. Utilise \`=undog @membre\` pour retirer la laisse.`,
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
        leashRole = await getLeashRole(message.guild);
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
      await sendCentralLog(message.guild, guildSettings, systemLogEmbed({ title: "🐶 DOG — laisse attribuée", description: `Acteur : <@${message.author.id}>\nCible : <@${target.id}>\nLaisses actives : ${leashCount}` })).catch(() => {});
      await message.reply({
        content: `🐶 **${target.user.username}** est maintenant en laisse par **${ownerName}** (${leashCount}).${returnedToOwner ? " Il a été ramené dans ton salon vocal." : ""}`,
        allowedMentions: { parse: [] },
      });
      return true;
    });
  }

  if (!existing) {
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
  const latest = (await loadState())[id];
  if (!latest || latest.releasing) {
    await message.reply({ content: "🐾 Cette laisse n'est plus active.", allowedMentions: { parse: [] } });
    return true;
  }

  try {
    // Mark release before changing the nickname so the update event won't reapply the leash.
    records[id] = { ...latest, releasing: true };
    await saveState();
    await target.setNickname(latest.previousNickname ?? null, `Laisse retirée par ${message.author.tag}`);
    if (latest.leashRoleId) {
      const role = message.guild.roles.cache.get(latest.leashRoleId)
        ?? await message.guild.roles.fetch(latest.leashRoleId).catch(() => null);
      if (role && target.roles.cache.has(role.id)) await target.roles.remove(role, `Laisse retirée par ${message.author.tag}`);
    }
    delete records[id];
    await saveState();
  } catch (error) {
    records[id] = latest;
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
