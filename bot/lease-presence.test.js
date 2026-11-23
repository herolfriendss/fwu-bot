import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");

test("a dedicated bot claims its domain only when present on every protected server", () => {
  assert.match(source, /function dedicatedBotReady\(\) \{[\s\S]*?servers\.every\(\(guildId\) => client\.guilds\.cache\.has\(guildId\)\)/);
  assert.match(source, /if \(dedicatedBotReady\(\)\) return gate\.tick\(\);/);
  assert.match(source, /if \(gate\.held\) gate\.release\(\);/);
  assert.match(source, /setInterval\(\(\) => \{ tickDomainLease\(\); \}, LEASE_RENEW_MS\)/);
  assert.doesNotMatch(source, /\ngate\.tick\(\);\nif \(!IS_FWU\)/, "no unconditional claim at startup");
  assert.match(source, /client\.on\("guildDelete", \(guild\) => \{[^\n]*tickDomainLease\(\)/);
});
