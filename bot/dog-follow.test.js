// DOG — la personne en laisse suit son maître de salon vocal en salon vocal.
// Discord simulé : aucun token, aucun réseau.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PermissionFlagsBits as P } from "discord.js";

const directory = mkdtempSync(join(tmpdir(), "pnd-dog-follow-"));
const statePath = join(directory, "dog-state.json");
process.env.PND_DOG_STATE_PATH = statePath;
process.env.HER_DB_PATH = join(directory, "economy.sqlite");

function writeLeash(records) {
  writeFileSync(statePath, JSON.stringify(records));
}
writeLeash({
  "g:pet": { guildId: "g", memberId: "pet", ownerId: "master", ownerName: "Master", since: Date.now(), previousNickname: null, leashRoleId: "leash" },
});

const { enforceLeashVoice, handleLeashVoiceState, forgetLeashFollowHistory } = await import("./dog-commands.js");

/** Minimal guild: channels with per-member permissions, members with voice state. */
function fakeGuild({ botPerms = {}, memberPerms = {}, failMove = null } = {}) {
  const moves = [];
  const channels = new Map();
  const members = new Map();
  const channel = (id, name, extra = {}) => {
    const c = {
      id, name, userLimit: extra.userLimit ?? 0,
      permissionsFor(member) {
        const table = member.id === "bot" ? botPerms : memberPerms;
        const allowed = table[id] ?? [P.ViewChannel, P.Connect, P.MoveMembers];
        return { has: (bits) => (Array.isArray(bits) ? bits : [bits]).every((bit) => allowed.includes(bit)) };
      },
    };
    channels.set(id, c);
    return c;
  };
  const member = (id, channelId) => {
    const m = {
      id,
      voice: {
        get channel() { return channelId ? channels.get(m._channelId) : null; },
        get channelId() { return m._channelId; },
        async setChannel(target) {
          if (failMove) throw failMove;
          moves.push({ member: id, to: target.id });
          m._channelId = target.id;
        },
      },
      _channelId: channelId,
    };
    members.set(id, m);
    return m;
  };
  const guild = {
    id: "g",
    channels: { cache: channels },
    members: {
      cache: members,
      fetch: async (id) => members.get(typeof id === "object" ? id.user : id) ?? null,
      fetchMe: async () => members.get("bot"),
      get me() { return members.get("bot"); },
    },
  };
  return { guild, moves, channel, member };
}

function voiceEvent(guild, id, from, to) {
  return [{ id, guild, channelId: from }, { id, guild, channelId: to }];
}

test.beforeEach(() => {
  forgetLeashFollowHistory();
  writeLeash({
    "g:pet": { guildId: "g", memberId: "pet", ownerId: "master", ownerName: "Master", since: Date.now(), previousNickname: null, leashRoleId: "leash" },
  });
});

test("cause racine : le maître va dans un vocal verrouillé, la personne en laisse le suit quand même", async () => {
  // Avant le correctif, le bot exigeait « Se connecter » pour la CIBLE : ici elle ne l'a pas sur « privé ».
  const env = fakeGuild({ memberPerms: { prive: [P.ViewChannel] } });
  env.channel("general", "Général");
  env.channel("prive", "Privé");
  env.member("bot", null);
  env.member("pet", "general");
  env.member("master", "prive");
  const moved = await handleLeashVoiceState(...voiceEvent(env.guild, "master", "general", "prive"));
  assert.equal(moved, 1);
  assert.deepEqual(env.moves, [{ member: "pet", to: "prive" }]);
});

test("le maître change de salon : la personne en laisse suit ; elle ne peut pas s'échapper", async () => {
  const env = fakeGuild();
  env.channel("a", "A");
  env.channel("b", "B");
  env.member("bot", null);
  const pet = env.member("pet", "a");
  env.member("master", "b");
  await handleLeashVoiceState(...voiceEvent(env.guild, "master", "a", "b"));
  assert.equal(pet.voice.channelId, "b");
  // Elle tente de repartir dans A : ramenée vers le maître.
  pet._channelId = "a";
  await handleLeashVoiceState(...voiceEvent(env.guild, "pet", "b", "a"));
  assert.equal(pet.voice.channelId, "b");
});

test("cible non connectée en vocal : aucun déplacement, aucune erreur", async () => {
  const env = fakeGuild();
  env.channel("b", "B");
  env.member("bot", null);
  env.member("pet", null);
  env.member("master", "b");
  assert.equal(await enforceLeashVoice(env.guild, "pet"), false);
  assert.deepEqual(env.moves, []);
});

test("maître déconnecté : la personne en laisse reste où elle est", async () => {
  const env = fakeGuild();
  env.channel("a", "A");
  env.member("bot", null);
  env.member("pet", "a");
  env.member("master", null);
  assert.equal(await handleLeashVoiceState(...voiceEvent(env.guild, "master", "a", null)), 0);
  assert.deepEqual(env.moves, []);
});

test("permission manquante pour le bot : refus propre, aucun appel Discord", async () => {
  const env = fakeGuild({ botPerms: { a: [P.ViewChannel, P.Connect], b: [P.ViewChannel, P.Connect] } });
  env.channel("a", "A");
  env.channel("b", "B");
  env.member("bot", null);
  env.member("pet", "a");
  env.member("master", "b");
  assert.equal(await enforceLeashVoice(env.guild, "pet"), false);
  assert.deepEqual(env.moves, []);
});

test("salon inaccessible pour le bot : pas de déplacement", async () => {
  const env = fakeGuild({ botPerms: { b: [P.MoveMembers] } });
  env.channel("a", "A");
  env.channel("b", "B");
  env.member("bot", null);
  env.member("pet", "a");
  env.member("master", "b");
  assert.equal(await enforceLeashVoice(env.guild, "pet"), false);
});

test("salon plein : le bot (Déplacer des membres) passe outre la limite, comme Discord l'autorise", async () => {
  const env = fakeGuild();
  env.channel("a", "A");
  env.channel("b", "B", { userLimit: 1 });
  env.member("bot", null);
  env.member("pet", "a");
  env.member("master", "b");
  assert.equal(await enforceLeashVoice(env.guild, "pet"), true);
});

test("erreur Discord (permissions, rate limit) : avalée, signalée par false, pas de plantage", async () => {
  const env = fakeGuild({ failMove: Object.assign(new Error("Missing Permissions"), { code: 50013 }) });
  env.channel("a", "A");
  env.channel("b", "B");
  env.member("bot", null);
  env.member("pet", "a");
  env.member("master", "b");
  assert.equal(await enforceLeashVoice(env.guild, "pet"), false);
});

test("fin de la laisse : plus aucun suivi", async () => {
  writeLeash({});
  const env = fakeGuild();
  env.channel("a", "A");
  env.channel("b", "B");
  env.member("bot", null);
  env.member("pet", "a");
  env.member("master", "b");
  assert.equal(await handleLeashVoiceState(...voiceEvent(env.guild, "master", "a", "b")), 0);
  assert.deepEqual(env.moves, []);
});

test("boucle de déplacements (quelqu'un la remet sans cesse ailleurs) : suivi suspendu après 6 déplacements par minute", async () => {
  const env = fakeGuild();
  env.channel("a", "A");
  env.channel("b", "B");
  env.member("bot", null);
  const pet = env.member("pet", "a");
  env.member("master", "b");
  let moved = 0;
  for (let i = 0; i < 10; i++) {
    pet._channelId = "a"; // un autre bot / modérateur la renvoie dans A
    if (await enforceLeashVoice(env.guild, "pet")) moved++;
  }
  assert.equal(moved, 6);
});
