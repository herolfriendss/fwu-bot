import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChannelType } from "discord.js";

const directory = mkdtempSync(join(tmpdir(), "fwu-stats-"));
process.env.HER_DB_PATH = join(directory, "runtime.sqlite");
const S = await import("./stat-channels.js");
const { db } = await import("../database.js");
after(() => { db.close(); delete process.env.HER_DB_PATH; rmSync(directory, { recursive: true, force: true }); });

const member = (bot = false) => ({ user: { bot } });
function fakeGuild({ memberCount = 1234, boosts = 7 } = {}) {
  const renames = [];
  const statChannels = new Map();
  const voice = { type: ChannelType.GuildVoice, members: new Map([["a", member()], ["b", member()], ["bot", member(true)]]) };
  const stage = { type: ChannelType.GuildStageVoice, members: new Map([["c", member()]]) };
  const text = { type: ChannelType.GuildText, members: new Map([["d", member()]]) };
  const cache = new Map([["v", voice], ["s", stage], ["t", text]]);
  const guild = {
    id: `g${Math.random()}`, memberCount, premiumSubscriptionCount: boosts, renames, statChannels,
    channels: { cache, fetch: async (id) => cache.get(id) ?? null },
    addStat(id) {
      const channel = { id, name: "ancien", type: ChannelType.GuildVoice, members: new Map(), setName: async (name) => { renames.push([id, name]); channel.name = name; } };
      cache.set(id, channel);
      return channel;
    },
  };
  return guild;
}

test("valeurs : membres, personnes en vocal (bots exclus, salons texte ignorés), boosts", () => {
  assert.deepEqual(S.statValues(fakeGuild()), { membres: 1234, vocal: 3, boosts: 7 });
  assert.equal(S.statName("membres", 1234), `👥 Membres : ${(1234).toLocaleString("fr-FR")}`);
  assert.equal(S.statName("vocal", 0), "🔊 En vocal : 0");
});

test("rafraîchissement : seulement si le nombre change, au plus toutes les 10 min (sauf forcé)", async () => {
  const guild = fakeGuild();
  guild.addStat("c1"); guild.addStat("c2");
  S.saveStatChannel(guild.id, "membres", "c1", "cat");
  S.saveStatChannel(guild.id, "boosts", "c2", "cat");
  assert.equal(await S.refreshGuildStats(guild, { now: 1_000_000 }), 2);
  assert.equal(await S.refreshGuildStats(guild, { now: 1_000_001 }), 0, "rien n'a changé");
  guild.memberCount = 1300;
  assert.equal(await S.refreshGuildStats(guild, { now: 1_000_002 }), 0, "moins de 10 min");
  assert.equal(await S.refreshGuildStats(guild, { now: 1_000_002, force: true }), 1);
  guild.memberCount = 1301;
  assert.equal(await S.refreshGuildStats(guild, { now: 1_000_002 + S.STAT_REFRESH_MS }), 1);
  assert.equal(guild.renames.at(-1)[1], S.statName("membres", 1301));
});

test("salon supprimé à la main : oublié", async () => {
  const guild = fakeGuild();
  S.saveStatChannel(guild.id, "vocal", "disparu", null);
  assert.equal(await S.refreshGuildStats(guild, { now: S.STAT_REFRESH_MS }), 0);
  assert.deepEqual(S.statRows(guild.id), []);
  S.saveStatChannel(guild.id, "vocal", "x", null);
  assert.equal(S.forgetStatChannel("x"), true);
  assert.equal(S.forgetStatChannel("x"), false);
});

test("passage planifié : seulement les serveurs autorisés et connus", async () => {
  const guild = fakeGuild();
  guild.addStat("z1");
  S.saveStatChannel(guild.id, "membres", "z1", null);
  await S.runStatChannels({ guilds: { cache: new Map([[guild.id, guild]]) } }, { isAllowedGuild: () => false, now: S.STAT_REFRESH_MS });
  assert.equal(guild.renames.length, 0);
  await S.runStatChannels({ guilds: { cache: new Map([[guild.id, guild]]) } }, { now: S.STAT_REFRESH_MS });
  assert.equal(guild.renames.length, 1);
});
