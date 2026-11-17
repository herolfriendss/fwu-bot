import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { PermissionFlagsBits } from "discord.js";
import { canApplyDogAction, canRemoveDogLeash, isBotAboveDogTarget } from "./dog-hierarchy-policy.js";

const stateFile = new URL("./data/dog-state.json", import.meta.url);
let state;
let pendingWrite = Promise.resolve();
const enforcingMembers = new Map();
const enforcingVoiceMembers = new Map();
const leashRolePromises = new Map();

const LEASH_ROLE_NAME = "🐶 En laisse · Her?";

async function getLeashRole(guild) {
  const botMember = await guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error("Le bot doit avoir la permission Gérer les rôles pour protéger la laisse DOG.");
  }
  let role = guild.roles.cache.find((item) => item.name === LEASH_ROLE_NAME && !item.managed);
  if (role && role.position >= botMember.roles.highest.position) {
    throw new Error("Le rôle DOG doit être placé sous le rôle le plus élevé du bot.");
  }
  if (role) return role;

  // Serialize creation so two simultaneous =dog commands cannot create duplicate marker roles.
  if (!leashRolePromises.has(guild.id)) {
    const pending = guild.roles.create({
      name: LEASH_ROLE_NAME,
      color: 0x8b5cf6,
      permissions: [],
      mentionable: false,
      hoist: false,
      reason: "Rôle système Her? DOG — marqueur persistant de laisse",
    }).finally(() => { leashRolePromises.delete(guild.id); });
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
    await mkdir(new URL("./data/", import.meta.url), { recursive: true });
    await writeFile(new URL("./data/dog-state.tmp", import.meta.url), snapshot, { mode: 0o600 });
    await rename(new URL("./data/dog-state.tmp", import.meta.url), stateFile);
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

function isAuthorized(member, sysPlusRoleId = null) {
  const isSysPlus = typeof sysPlusRoleId === "string"
    && sysPlusRoleId !== member.guild?.id
    && member.roles.cache.has(sysPlusRoleId);
  return member.id === member.guild?.ownerId
    || isSysPlus
    || member.permissions.has(PermissionFlagsBits.ManageNicknames)
    || member.permissions.has(PermissionFlagsBits.Administrator);
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

      if (record.leashRoleId) {
        const leashRole = currentMember.guild.roles.cache.get(record.leashRoleId)
          ?? await currentMember.guild.roles.fetch(record.leashRoleId).catch(() => null);
        if (leashRole && !currentMember.roles.cache.has(leashRole.id)) {
          const botMember = await currentMember.guild.members.fetchMe();
          if (botMember.permissions.has(PermissionFlagsBits.ManageRoles) && leashRole.position < botMember.roles.highest.position) {
            await currentMember.roles.add(leashRole, "DOG : maintien du rôle de laisse");
            restored = true;
          }
        }
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
export async function reconcileLeashedMembers(client, allowedGuildIds = []) {
  const allowed = new Set((Array.isArray(allowedGuildIds) ? allowedGuildIds : []).filter((id) => typeof id === "string" && /^\\d{5,25}$/.test(id)));
  if (!allowed.size) return 0;
  const records = await loadState();
  let restored = 0;
  for (const record of Object.values(records)) {
    if (!record || record.releasing || !record.guildId || !allowed.has(record.guildId) || !record.memberId) continue;
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

export async function handleDogCommand(message, sysPlusRoleId = null) {
  const parts = message.content.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase();
  if (!["=dog", "=undog", "=doginfo", "=rank"].includes(command)) return false;

  if (!message.guild || !message.member) return true;

  if (command === "=rank") {
    const isSysPlus = typeof sysPlusRoleId === "string"
      && /^\\d{5,25}$/.test(sysPlusRoleId)
      && sysPlusRoleId !== message.guild.id
      && message.member.roles.cache.has(sysPlusRoleId);
    if (!isSysPlus) {
      await message.reply({ content: "⛔ Cette commande est réservée au rôle **Perm SYS+**.", allowedMentions: { parse: [] } });
      return true;
    }

    const targetId = message.mentions.members.first()?.id ?? parts[1]?.match(/^<@!?(\\d+)>$/)?.[1];
    const role = message.mentions.roles.first();
    if (!targetId || !role) {
      await message.reply({ content: "Utilisation : `=rank @membre @rôle`", allowedMentions: { parse: [] } });
      return true;
    }
    const target = await message.guild.members.fetch(targetId).catch(() => null);
    if (!target) {
      await message.reply({ content: "❌ Je ne trouve pas ce membre sur le serveur.", allowedMentions: { parse: [] } });
      return true;
    }
    const botMember = await message.guild.members.fetchMe();
    if (target.id === message.guild.ownerId || !isBotAboveDogTarget(botMember, target)) {
      await message.reply({ content: "❌ Je ne peux pas modifier ce membre : son rôle le plus élevé est égal ou supérieur à celui du bot, ou il est propriétaire du serveur.", allowedMentions: { parse: [] } });
      return true;
    }
    if (role.id === message.guild.id || role.managed || role.position >= botMember.roles.highest.position) {
      await message.reply({ content: "❌ Ce rôle ne peut pas être attribué : @everyone, les rôles gérés et les rôles au-dessus du bot sont interdits.", allowedMentions: { parse: [] } });
      return true;
    }
    if (target.roles.cache.has(role.id)) {
      await message.reply({ content: `ℹ️ **${target.user.username}** possède déjà le rôle ${role}.`, allowedMentions: { parse: [] } });
      return true;
    }
    try {
      await target.roles.add(role, `Rôle attribué par Perm SYS+ : ${message.author.tag}`);
      await message.reply({ content: `✅ Le rôle ${role} a été attribué à **${target.user.username}**.`, allowedMentions: { parse: [] } });
    } catch (error) {
      console.error("[DOG rank] Attribution impossible:", error.message);
      await message.reply({ content: "❌ Impossible d'attribuer ce rôle. Vérifie les permissions et la hiérarchie du bot.", allowedMentions: { parse: [] } });
    }
    return true;
  }

  if (!isAuthorized(message.member, sysPlusRoleId)) {
    await message.reply({
      content: "⛔ Tu dois avoir la permission **Gérer les surnoms** pour utiliser cette commande.",
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

  const records = await loadState();
  const id = key(message.guild.id, target.id);
  const existing = records[id];

  if (command === "=undog" && !canRemoveDogLeash(message.member, message.guild.ownerId, sysPlusRoleId)) {
    await message.reply({
      content: "⛔ Seul le rôle **Perm SYS+** (ou le propriétaire du serveur) peut retirer une laisse DOG.",
      allowedMentions: { parse: [] },
    });
    return true;
  }

  // DOG info is read-only. Ignore the system leash marker when comparing the
  // target's real role hierarchy so the original owner can still use =undog.
  if (command !== "=doginfo" && !canApplyDogAction(message.member, target, message.guild.ownerId, existing?.leashRoleId)) {
    await message.reply({
      content: "⛔ Tu ne peux pas utiliser DOG sur ce membre : son rôle le plus élevé doit être strictement inférieur au tien. Les membres de même niveau ou au-dessus sont protégés.",
      allowedMentions: { parse: [] },
    });
    return true;
  }

  if (command !== "=doginfo") {
    const botMember = await message.guild.members.fetchMe();
    if (!botMember.permissions.has(PermissionFlagsBits.ManageNicknames)) {
      await message.reply({ content: "❌ Il me manque la permission **Gérer les surnoms**.", allowedMentions: { parse: [] } });
      return true;
    }
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await message.reply({ content: "❌ Il me manque la permission **Gérer les rôles**.", allowedMentions: { parse: [] } });
      return true;
    }

    if (target.id === message.guild.ownerId || !isBotAboveDogTarget(botMember, target)) {
      await message.reply({
        content: "❌ Je ne peux pas modifier ce membre : son rôle le plus élevé est égal ou supérieur à celui du bot, ou il est propriétaire du serveur.",
        allowedMentions: { parse: [] },
      });
      return true;
    }
  }

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
    if (existing) {
      await message.reply({
        content: `🐶 Ce membre est déjà en laisse par **${existing.ownerName}**. Utilise \`=undog @membre\` pour retirer la laisse.`,
        allowedMentions: { parse: [] },
      });
      return true;
    }

    const previousNickname = target.nickname;
    const ownerName = message.member.displayName || message.author.username;
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
    records[id] = {
      guildId: message.guild.id,
      memberId: target.id,
      previousNickname,
      ownerId: message.author.id,
      ownerName,
      leashRoleId: leashRole.id,
      since: Date.now(),
    };
    try {
      // Persist the leash first so a nickname-change event cannot race the save.
      await saveState();
      await target.roles.add(leashRole, `Mis en laisse par ${message.author.tag}`);
      await target.setNickname(dogNickname(ownerName), `Mis en laisse par ${message.author.tag}`);
    } catch (error) {
      delete records[id];
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
    await message.reply({
      content: `🐶 **${target.user.username}** est maintenant en laisse par **${ownerName}** !${returnedToOwner ? " Il a été ramené dans ton salon vocal." : ""}`,
      allowedMentions: { parse: [] },
    });
    return true;
  }

  if (!existing) {
    await message.reply({ content: "🐾 Ce membre n'est pas en laisse.", allowedMentions: { parse: [] } });
    return true;
  }

  try {
    // Mark release before changing the nickname so the update event won't reapply the leash.
    records[id] = { ...existing, releasing: true };
    await saveState();
    await target.setNickname(existing.previousNickname ?? null, `Laisse retirée par ${message.author.tag}`);
    if (existing.leashRoleId) {
      const role = message.guild.roles.cache.get(existing.leashRoleId)
        ?? await message.guild.roles.fetch(existing.leashRoleId).catch(() => null);
      if (role && target.roles.cache.has(role.id)) await target.roles.remove(role, `Laisse retirée par ${message.author.tag}`);
    }
    delete records[id];
    await saveState();
  } catch (error) {
    records[id] = existing;
    await saveState().catch(() => {});
    console.error("UNDOG command failed:", error.message);
    await message.reply({
      content: "❌ Impossible de retirer la laisse. Vérifie la hiérarchie des rôles et mes permissions.",
      allowedMentions: { parse: [] },
    });
    return true;
  }
  await message.reply({
    content: `🦴 La laisse de **${target.user.username}** a été retirée. Son ancien surnom a été restauré.`,
    allowedMentions: { parse: [] },
  });
  return true;
}
