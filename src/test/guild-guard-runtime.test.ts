// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import {
  enforceGuildAllowlist, guildAllowed, handleGuildCreate, handleGuildGuardJoin, resetGuildGuardState,
} from "../../bot/guild-guard.js";

const G1 = "111111111111111111";
const G2 = "222222222222222222";
const G3 = "333333333333333333";

const allowlist = [G1, G2];

function events() {
  const codes: string[] = [];
  return { codes, record: (code: string) => codes.push(code) };
}

function fakeGuild(id: string, leave: () => Promise<unknown> = async () => {}) {
  return {
    id,
    name: `Guild ${id.slice(-1)}`,
    leave,
    channels: { fetch: async () => null },
    roles: { fetch: async () => null },
  };
}

function fakeClient(ids: string[], failing: string[] = []) {
  const left: string[] = [];
  const cache = new Map(ids.map((id) => [id, fakeGuild(id, async () => {
    if (failing.includes(id)) throw new Error("missing access");
    left.push(id);
  })]));
  return { client: { guilds: { cache } }, left };
}

afterEach(() => resetGuildGuardState());

describe("GuildGuard allowlist runtime", () => {
  it("treats an empty allowlist as permissive and a list as exclusive", () => {
    expect(guildAllowed(G1, [])).toBe(true);
    expect(guildAllowed(G1, undefined)).toBe(true);
    expect(guildAllowed(G1, allowlist)).toBe(true);
    expect(guildAllowed(G3, allowlist)).toBe(false);
  });

  it("leaves an unlisted guild on join and records the block", async () => {
    const { codes, record } = events();
    let left = 0;
    const blocked = await handleGuildCreate(fakeGuild(G3, async () => { left++; }), allowlist, record);
    expect(blocked).toBe(true);
    expect(left).toBe(1);
    expect(codes).toEqual(["guild_blocked"]);
  });

  it("keeps an allowed guild on join without logging", async () => {
    const { codes, record } = events();
    let left = 0;
    const blocked = await handleGuildCreate(fakeGuild(G1, async () => { left++; }), allowlist, record);
    expect(blocked).toBe(false);
    expect(left).toBe(0);
    expect(codes).toEqual([]);
  });

  it("does not touch any guild while the allowlist is empty", async () => {
    const { client, left } = fakeClient([G1, G2, G3]);
    const { codes, record } = events();
    expect(await enforceGuildAllowlist(client, [], record)).toBe(0);
    expect(left).toEqual([]);
    expect(codes).toEqual([]);
  });

  it("removes the third guild on startup and keeps the two allowed ones", async () => {
    const { client, left } = fakeClient([G1, G2, G3]);
    const { codes, record } = events();
    expect(await enforceGuildAllowlist(client, allowlist, record)).toBe(1);
    expect(left).toEqual([G3]);
    expect(codes).toEqual(["guild_blocked"]);
  });

  it("records an error when Discord refuses to leave a guild", async () => {
    const { client } = fakeClient([G1, G3], [G3]);
    const { codes, record } = events();
    expect(await enforceGuildAllowlist(client, allowlist, record)).toBe(0);
    expect(codes).toEqual(["guild_blocked", "guild_guard_error"]);
  });

  it("kicks a young account through the real join handler", async () => {
    const { codes, record } = events();
    const kicked: string[] = [];
    const guild = fakeGuild(G1);
    const member = {
      id: "444444444444444444",
      user: { bot: false, tag: "jeune#0001", createdAt: new Date(Date.now() - 86_400_000) },
      guild,
      kick: async (reason: string) => { kicked.push(reason); },
    };
    const guard = {
      enabled: true, minAccountAgeDays: 7, youngAccountAction: "kick" as const,
      quarantineRoleId: null, logChannelId: null, raidJoinThreshold: 0,
      raidWindowSeconds: 60, lockdown: false,
    };
    expect(await handleGuildGuardJoin(member, guard, record)).toBe(true);
    expect(kicked).toHaveLength(1);
    expect(kicked[0]).toContain("7 jour");
    expect(codes).toEqual(["guild_guard_kick"]);
  });

  it("ignores bots and disabled guards", async () => {
    const { codes, record } = events();
    const guild = fakeGuild(G1);
    const guard = {
      enabled: true, minAccountAgeDays: 7, youngAccountAction: "kick" as const,
      quarantineRoleId: null, logChannelId: null, raidJoinThreshold: 0,
      raidWindowSeconds: 60, lockdown: false,
    };
    const bot = {
      id: "444444444444444444",
      user: { bot: true, tag: "bot#0001", createdAt: new Date() },
      guild,
      kick: async () => { throw new Error("should not kick"); },
    };
    expect(await handleGuildGuardJoin(bot, guard, record)).toBe(false);
    const human = {
      id: "555555555555555555",
      user: { bot: false, tag: "humain#0001", createdAt: new Date(Date.now() - 100 * 86_400_000) },
      guild,
      kick: async () => { throw new Error("should not kick"); },
    };
    expect(await handleGuildGuardJoin(human, { ...guard, enabled: false }, record)).toBe(false);
    expect(codes).toEqual([]);
  });
});
