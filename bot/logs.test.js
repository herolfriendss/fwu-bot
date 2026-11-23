import test from "node:test";
import assert from "node:assert/strict";
import { buildLogAllowedMentions, sendCentralLog, systemLogEmbed } from "./logs.js";

test("central logger always prefers the single configured logs channel", async () => {
  const sends = [];
  const selected = {
    isTextBased: () => true,
    send: async (payload) => sends.push(payload),
  };
  const guild = { channels: { fetch: async (id) => id === "central" ? selected : null } };
  const sent = await sendCentralLog(guild, { logs: { channelId: "central" } }, { title: "ok" }, ["legacy-a", "legacy-b"]);
  assert.equal(sent, true);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].embeds[0].title, "ok");
});

test("central logger safely declines when no configured or compatible fallback channel exists", async () => {
  const guild = { channels: { fetch: async () => null } };
  assert.equal(await sendCentralLog(guild, {}, { title: "no channel" }), false);
  assert.equal(await sendCentralLog(guild, {}, { title: "no fallback" }, []), false);
});

test("system log embeds cap Discord fields and avoid accidental mention parsing", () => {
  const embed = systemLogEmbed({ title: "Action", description: "Résumé", fields: Array.from({ length: 30 }, (_, i) => ({ name: `N${i}`, value: "x".repeat(1200) })) });
  assert.equal(embed.color, 0x6d28d9);
  assert.equal(embed.fields.length, 25);
  assert.equal(embed.fields[0].value.length, 1024);
  assert.ok(embed.timestamp);
});


test("log mentions are explicit, validated, deduplicated, and never parse everyone or roles", () => {
  assert.deepEqual(buildLogAllowedMentions(["12345678901234567", "bad-id", "12345678901234567", "98765432109876543"]), {
    parse: [],
    users: ["12345678901234567", "98765432109876543"],
    roles: [],
    repliedUser: false,
  });
  assert.deepEqual(buildLogAllowedMentions(null), { parse: [], users: [], roles: [], repliedUser: false });
});

test("sanction category resolves to the dedicated PND sanctions log channel", async () => {
  const { logChannelForGuild } = await import("./logs-hub.js");
  const spec = logChannelForGuild("1562643485981544559", "Modération — sanction");
  assert.equal(spec?.key, "moderation");
  assert.equal(spec?.name, "logs-sanctions");
});

test("central logger pings only the explicitly allowed supervisor", async () => {
  const sends = [];
  const selected = {
    isTextBased: () => true,
    send: async (payload) => sends.push(payload),
  };
  const guild = { channels: { fetch: async () => selected } };
  await sendCentralLog(
    guild,
    { logs: { channelId: "central" } },
    { title: "sanction" },
    [],
    [],
    ["12345678901234567", "not-a-user-id"],
  );
  assert.deepEqual(sends[0].allowedMentions, {
    parse: [],
    users: ["12345678901234567"],
    roles: [],
    repliedUser: false,
  });
});
