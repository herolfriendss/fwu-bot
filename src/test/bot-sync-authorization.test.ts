import { describe, expect, it } from "vitest";
import { canConfigureGuildModuleSettings, isConfiguredPndOwner } from "../lib/bot-sync-authorization";

const GUILD = "100000000000000001";
const OWNER = "200000000000000002";
const MANAGER = "300000000000000003";
const MEMBER = "400000000000000004";

describe("bot-sync actor authorization", () => {
  it("recognizes only the configured PND Owner for owner-only actions", () => {
    expect(isConfiguredPndOwner(OWNER, OWNER)).toBe(true);
    expect(isConfiguredPndOwner(MANAGER, OWNER)).toBe(false);
    expect(isConfiguredPndOwner(OWNER, "invalid")).toBe(false);
    expect(isConfiguredPndOwner(" ", OWNER)).toBe(false);
  });

  it("allows the guild owner to configure modules", () => {
    expect(canConfigureGuildModuleSettings({
      guildId: GUILD,
      actorId: OWNER,
      guildOwnerId: OWNER,
      memberRoleIds: [],
      roles: [],
    })).toBe(true);
  });

  it("allows members with ManageGuild or Administrator from their actual roles", () => {
    expect(canConfigureGuildModuleSettings({
      guildId: GUILD,
      actorId: MANAGER,
      guildOwnerId: OWNER,
      memberRoleIds: ["manager-role"],
      roles: [
        { id: GUILD, permissions: "0" },
        { id: "manager-role", permissions: String(1n << 5n) },
      ],
    })).toBe(true);
    expect(canConfigureGuildModuleSettings({
      guildId: GUILD,
      actorId: MANAGER,
      guildOwnerId: OWNER,
      memberRoleIds: ["admin-role"],
      roles: [{ id: "admin-role", permissions: String(1n << 3n) }],
    })).toBe(true);
  });

  it("does not trust a claimed actor ID or permissions that are not on held roles", () => {
    expect(canConfigureGuildModuleSettings({
      guildId: GUILD,
      actorId: MEMBER,
      guildOwnerId: OWNER,
      memberRoleIds: ["member-role"],
      roles: [
        { id: "member-role", permissions: "0" },
        { id: "unheld-manager-role", permissions: String(1n << 5n) },
      ],
    })).toBe(false);
    expect(canConfigureGuildModuleSettings({
      guildId: GUILD,
      actorId: "not-a-snowflake",
      guildOwnerId: OWNER,
      memberRoleIds: ["manager-role"],
      roles: [{ id: "manager-role", permissions: String(1n << 5n) }],
    })).toBe(false);
  });
});
