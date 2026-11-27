// MALUS vocaux, rôle et jeux : sourdine folle, exil, bouffon, roulette vocale, patate chaude,
// tribunal, interrogatoire. Mêmes garde-fous que les autres malus (commands.js).
import { PermissionFlagsBits } from "discord.js";
import { db } from "../../database.js";
import { assertRoleGrantable } from "../../role-grant-guard.js";
import { isTier0Protected } from "../../tier0-shield.js";
import { parsePndOwnerId } from "../../pnd-owner-policy.js";
import { isSysPlus } from "../sysplus/permissions.js";
import { KIND_LABELS, parseMinutes } from "./policy.js";
import { MalusError, activeMalus, registerMalusKind, registerMalusSubcommand, requireMalusTarget, startMalus } from "./commands.js";

const P = PermissionFlagsBits;
const timers = new Map(); // guild:member:kind -> interval/timeout
const key = (guildId, memberId, kind) => `${guildId}:${memberId}:${kind}`;
const clearTimer = (k) => { const t = timers.get(k); if (t) { clearInterval(t); clearTimeout(t); timers.delete(k); } };

export const BOUFFON_ROLE_NAME = "Bouffon du serveur";
export const SOURDINE_MAX_MINUTES = 5;
export const PATATE_TURN_MS = 30_000;
export const PATATE_GAME_MS = 2 * 60_000;
export const TRIBUNAL_MS = 60_000;
export const QUESTION_MS = 30_000;
export const PENALTY_SECONDS = 60;

export const QUESTIONS = Object.freeze([
  "Quelle est la capitale de l'Australie ?", "Combien font 7 × 8 ?", "Cite trois couleurs de l'arc-en-ciel.", "Quel est ton plat préféré et pourquoi ?",
  "Quel animal ferait le meilleur président ?", "Dis un compliment au SYS+ qui t'interroge.", "Combien de pattes a une araignée ?",
  "Écris un mot qui rime avec « chaussette ».", "Quelle est la planète la plus proche du Soleil ?", "Raconte ta pire honte en une phrase.",
  "Combien de minutes dans 3 heures ?", "Quel est le contraire de « chaud » ?", "Cite un film que tout le monde aime sauf toi.",
]);

const pick = (list, random = Math.random) => list[Math.floor(random() * list.length) % list.length];

/** Is this member a fair target for a random game pick (not protected, below the actor)? */
export async function eligibleForGame(member, actor) {
  if (!member || member.user?.bot || member.id === actor.id) return false;
  const pndOwnerId = parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);
  if (member.id === member.guild?.ownerId || (pndOwnerId && member.id === pndOwnerId)) return false;
  if (await isTier0Protected(member).catch(() => true)) return false;
  return Number(member.roles?.highest?.position ?? 0) < Number(actor.roles?.highest?.position ?? 0);
}

/** Penalty for games: 1 min server mute when in voice, otherwise 1 min of MIME. */
export async function punish(member, { reason, seconds = PENALTY_SECONDS, actorId }) {
  if (member.voice?.channelId && !member.voice.serverMute) {
    try {
      await member.voice.setMute(true, reason);
      setTimeout(() => { if (member.voice?.serverMute) void member.voice.setMute(false, "Fin de la pénalité").catch(() => {}); }, seconds * 1000).unref?.();
      return "muet en vocal 1 min";
    } catch { /* falls back to MIME */ }
  }
  const now = Date.now();
  db.prepare(`INSERT INTO malus_active(guild_id, member_id, kind, started_by, started_at, expires_at, data) VALUES (?,?,?,?,?,?,NULL)
    ON CONFLICT(guild_id, member_id, kind) DO UPDATE SET expires_at=max(expires_at, excluded.expires_at)`).run(member.guild.id, member.id, "mime", actorId ?? "bot", now, now + seconds * 1000);
  return "en MIME 1 min (émojis seulement)";
}

// ── Sourdine folle : micro coupé puis rendu au hasard ───────────────────────
registerMalusKind("sourdine-folle", {
  async start({ guild, target, minutes }) {
    if (!target.voice?.channelId) throw new MalusError("🎙️ Ce membre doit être en vocal.");
    if (!guild.members.me?.permissions?.has?.(P.MuteMembers)) throw new MalusError("❌ Il me manque « Rendre muet des membres ».");
    const k = key(guild.id, target.id, "sourdine-folle");
    clearTimer(k);
    const until = Date.now() + Math.min(minutes, SOURDINE_MAX_MINUTES) * 60_000;
    const tick = async () => {
      const member = await guild.members.fetch(target.id).catch(() => null);
      if (!member?.voice?.channelId || Date.now() > until || !activeMalus(guild.id, target.id, "sourdine-folle")) {
        clearTimer(k);
        if (member?.voice?.serverMute) await member.voice.setMute(false, "Fin de la sourdine folle").catch(() => {});
        return;
      }
      await member.voice.setMute(Math.random() < 0.5, "Sourdine folle").catch(() => {});
    };
    timers.set(k, setInterval(() => void tick(), 4_000));
    timers.get(k).unref?.();
  },
  async stop({ guild, row }) {
    clearTimer(key(guild.id, row.member_id, "sourdine-folle"));
    const member = await guild.members.fetch(row.member_id).catch(() => null);
    if (member?.voice?.serverMute) await member.voice.setMute(false, "Fin de la sourdine folle").catch(() => {});
  },
});

// ── Exil : renvoyé dans le salon AFK à chaque connexion ────────────────────
registerMalusKind("exil", {
  async start({ target }) { if (target.voice?.channelId) await enforceExile(target).catch(() => {}); },
});
async function enforceExile(member) {
  const afk = member.guild.afkChannel ?? (member.guild.afkChannelId ? await member.guild.channels.fetch(member.guild.afkChannelId).catch(() => null) : null);
  if (afk && member.voice.channelId !== afk.id) return member.voice.setChannel(afk, "Malus EXIL");
  if (!afk) return member.voice.disconnect("Malus EXIL (aucun salon AFK)");
  return null;
}
/** voiceStateUpdate hook (SUCK ME): sends an exiled member back to AFK. */
export async function handleExileVoiceState(oldState, newState) {
  if (!newState.channelId || newState.channelId === oldState.channelId || !newState.member) return false;
  if (newState.guild.afkChannelId && newState.channelId === newState.guild.afkChannelId) return false;
  if (!activeMalus(newState.guild.id, newState.member.id, "exil")) return false;
  await enforceExile(newState.member);
  return true;
}

// ── Bouffon : rôle coloré, sans aucune permission ──────────────────────────
async function bouffonRole(guild) {
  const existing = guild.roles.cache.find((r) => r.name === BOUFFON_ROLE_NAME && !r.managed);
  if (existing) return existing;
  return guild.roles.create({ name: BOUFFON_ROLE_NAME, color: 0xf59e0b, hoist: true, mentionable: false, permissions: [], reason: "Malus BOUFFON" });
}
registerMalusKind("bouffon", {
  async start({ guild, target, guildSettings }) {
    const role = await bouffonRole(guild);
    if (role.permissions?.bitfield && BigInt(role.permissions.bitfield) !== 0n) throw new MalusError("⛔ Le rôle « Bouffon du serveur » porte des permissions : retire-les avant.");
    await assertRoleGrantable(guild, role, { automatic: true, settings: guildSettings, targetId: target.id });
    await target.roles.add(role, "Malus BOUFFON");
  },
  async stop({ guild, row }) {
    const role = guild.roles.cache.find((r) => r.name === BOUFFON_ROLE_NAME && !r.managed);
    if (!role) return;
    const member = await guild.members.fetch(row.member_id).catch(() => null);
    if (member?.roles?.cache?.has(role.id)) await member.roles.remove(role, "Fin du malus BOUFFON").catch(() => {});
    const stillUsed = db.prepare("SELECT 1 FROM malus_active WHERE guild_id=? AND kind='bouffon' AND expires_at>?").get(guild.id, Date.now());
    if (!stillUsed && role.members?.size === 0) await role.delete("Plus aucun bouffon").catch(() => {});
  },
});

// ── Jeux ────────────────────────────────────────────────────────────────────
async function requireSysPlusActor(interaction, guildSettings) {
  const actor = await interaction.guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
  if (!actor || !isSysPlus(actor, guildSettings?.sysPlus?.roleId ?? null)) throw new MalusError("⛔ Réservé aux membres SYS+.");
  return actor;
}

registerMalusSubcommand("roulette-vocale", async (interaction, guildSettings) => {
  const actor = await requireSysPlusActor(interaction, guildSettings);
  const channel = actor.voice?.channel;
  if (!channel) throw new MalusError("🎧 Rejoins un salon vocal pour lancer la roulette.");
  const candidates = [];
  for (const member of channel.members.values()) if (await eligibleForGame(member, actor)) candidates.push(member);
  if (!candidates.length) throw new MalusError("Personne dans ton salon ne peut être tiré au sort.");
  const loser = pick(candidates);
  const outcome = await punish(loser, { reason: "Roulette vocale", actorId: actor.id });
  await interaction.channel?.send?.({ content: `🔫 Roulette vocale dans <#${channel.id}>… le barillet tourne… **<@${loser.id}>** perd : ${outcome} !`, allowedMentions: { parse: [] } }).catch(() => {});
  return `🔫 Roulette lancée : <@${loser.id}> a perdu.`;
});

const patateGames = new Map(); // channelId -> { holderId, actorId, turnTimer, endsAt }
registerMalusSubcommand("patate", async (interaction, guildSettings) => {
  const { actor, target } = await requireMalusTarget(interaction, guildSettings);
  const channel = interaction.channel;
  if (!channel?.send) throw new MalusError("Lance la patate dans un salon textuel.");
  if (patateGames.has(channel.id)) throw new MalusError("🥔 Une patate chaude circule déjà dans ce salon.");
  const game = { holderId: target.id, actorId: actor.id, endsAt: Date.now() + PATATE_GAME_MS, turnTimer: null, guild: interaction.guild, channel };
  patateGames.set(channel.id, game);
  armPatate(game);
  await channel.send({ content: `🥔🔥 <@${target.id}> a la **patate chaude** ! Passe-la en mentionnant quelqu'un dans les 30 s. Celui qui l'a à la fin perd.`, allowedMentions: { users: [target.id] } });
  return "🥔 Patate chaude lancée.";
});
function armPatate(game) {
  clearTimeout(game.turnTimer);
  const wait = Math.max(1_000, Math.min(PATATE_TURN_MS, game.endsAt - Date.now()));
  game.turnTimer = setTimeout(() => void endPatate(game), wait);
  game.turnTimer.unref?.();
}
async function endPatate(game) {
  patateGames.delete(game.channel.id);
  const loser = await game.guild.members.fetch(game.holderId).catch(() => null);
  if (!loser) return;
  const outcome = await punish(loser, { reason: "Patate chaude", actorId: game.actorId });
  await game.channel.send({ content: `💥 La patate a explosé dans les mains de <@${loser.id}> : ${outcome} !`, allowedMentions: { parse: [] } }).catch(() => {});
}
/** messageCreate hook: the holder passes the potato by mentioning someone. */
export async function handlePatateMessage(message) {
  const game = message.channel ? patateGames.get(message.channel.id) : null;
  if (!game || message.author?.id !== game.holderId) return false;
  const next = message.mentions?.members?.find?.((m) => !m.user.bot && m.id !== game.holderId);
  if (!next) return false;
  const actor = await game.guild.members.fetch(game.actorId).catch(() => null);
  if (!actor || !(await eligibleForGame(next, actor))) {
    await message.reply({ content: "🛡️ Ce membre est protégé : passe la patate à quelqu'un d'autre !", allowedMentions: { parse: [] } }).catch(() => {});
    return true;
  }
  game.holderId = next.id;
  if (Date.now() >= game.endsAt) { await endPatate(game); return true; }
  armPatate(game);
  await message.channel.send({ content: `🥔🔥 <@${next.id}> a la patate ! 30 s pour la passer.`, allowedMentions: { users: [next.id] } }).catch(() => {});
  return true;
}

registerMalusSubcommand("tribunal", async (interaction, guildSettings) => {
  const { actor, target } = await requireMalusTarget(interaction, guildSettings);
  const channel = interaction.channel;
  if (!channel?.send) throw new MalusError("Ouvre le tribunal dans un salon textuel.");
  const vote = await channel.send({ content: `⚖️ **Tribunal** : <@${target.id}> est-il coupable ? Votez en 60 s : ✅ coupable, ❌ innocent.`, allowedMentions: { parse: [] } });
  await vote.react("✅").catch(() => {});
  await vote.react("❌").catch(() => {});
  setTimeout(() => void closeTribunal({ vote, target, actor, channel }), TRIBUNAL_MS).unref?.();
  return "⚖️ Tribunal ouvert pour 60 s.";
});
export function tribunalVerdict(guilty, innocent) {
  return guilty > innocent ? "coupable" : "innocent";
}
async function closeTribunal({ vote, target, actor, channel }) {
  const fresh = await vote.fetch().catch(() => vote);
  const count = async (emoji) => {
    const reaction = fresh.reactions?.cache?.get(emoji);
    if (!reaction) return 0;
    const users = await reaction.users.fetch().catch(() => null);
    return users ? users.filter((u) => !u.bot && u.id !== target.id).size : Math.max(0, reaction.count - 1);
  };
  const guilty = await count("✅");
  const innocent = await count("❌");
  if (tribunalVerdict(guilty, innocent) === "coupable") {
    const member = await target.guild.members.fetch(target.id).catch(() => null);
    const outcome = member ? await punish(member, { reason: "Tribunal", seconds: 120, actorId: actor.id }) : "absent";
    await channel.send({ content: `⚖️ Verdict : **coupable** (${guilty} contre ${innocent}). <@${target.id}> : ${outcome.replace("1 min", "2 min")}.`, allowedMentions: { parse: [] } }).catch(() => {});
  } else {
    await channel.send({ content: `⚖️ Verdict : **innocent** (${guilty} contre ${innocent}). <@${target.id}> est libre.`, allowedMentions: { parse: [] } }).catch(() => {});
  }
}

registerMalusSubcommand("interrogatoire", async (interaction, guildSettings) => {
  const { actor, target } = await requireMalusTarget(interaction, guildSettings);
  const channel = interaction.channel;
  if (!channel?.awaitMessages) throw new MalusError("Lance l'interrogatoire dans un salon textuel.");
  void runInterrogation({ channel, target, actor });
  return "🕵️ Interrogatoire lancé.";
});
async function runInterrogation({ channel, target, actor, random = Math.random }) {
  const asked = new Set();
  for (let i = 1; i <= 3; i++) {
    let question = pick(QUESTIONS, random);
    while (asked.has(question) && asked.size < QUESTIONS.length) question = pick(QUESTIONS, random);
    asked.add(question);
    await channel.send({ content: `🕵️ Question ${i}/3 pour <@${target.id}> (30 s) : **${question}**`, allowedMentions: { users: [target.id] } }).catch(() => {});
    const answers = await channel.awaitMessages({ filter: (m) => m.author.id === target.id, max: 1, time: QUESTION_MS }).catch(() => null);
    if (!answers?.size) {
      const member = await target.guild.members.fetch(target.id).catch(() => null);
      const outcome = member ? await punish(member, { reason: "Interrogatoire", actorId: actor.id }) : "absent";
      await channel.send({ content: `⏰ Pas de réponse ! <@${target.id}> : ${outcome}.`, allowedMentions: { parse: [] } }).catch(() => {});
      return false;
    }
  }
  await channel.send({ content: `✅ <@${target.id}> a survécu à l'interrogatoire.`, allowedMentions: { parse: [] } }).catch(() => {});
  return true;
}

// Durations of these kinds come from the shared /malus option (sourdine folle capped at 5 min).
export const VOICE_GAME_LABELS = KIND_LABELS;
export { parseMinutes };
