import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LOG_EVENT_MATRIX,
  formatCoverageSummary,
  verifyGatewayWiring,
  verifyMatrixRouting,
} from "./logs-coverage.js";

test("every journaled event of the matrix lands in its expected Logs Hub channel", () => {
  assert.deepEqual(verifyMatrixRouting(), []);
});

test("every covered gateway event has a listener and its intent in index.js", () => {
  const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.deepEqual(verifyGatewayWiring(source), []);
});

test("bans need the GuildModeration intent (regression: listeners never fired without it)", () => {
  const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.ok(source.includes("GatewayIntentBits.GuildModeration"));
  assert.ok(
    LOG_EVENT_MATRIX.some(
      (row) => row.event === "guildBanAdd" && row.intent === "GuildModeration",
    ),
  );
});

test("every matrix sample title is actually emitted somewhere in the bot", () => {
  const files = [
    "index.js",
    "anti-move.js",
    "role-commands.js",
    "voice-commands.js",
    "dog-commands.js",
    "guardian-risk.js",
    "casino.js",
    "ai-memory-preferences.js",
    "webhooks.js",
    "live-alerts.js",
    "tickets.js",
  ]
    .map((file) => {
      try {
        return readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
  const dynamic = new Set([
    "🎙️ Join-to-Create — Salon vocal temporaire créé",
    "🎭 Rôle attribué",
    "🤖 IA — demande traitée",
    "⏰ WAKEUP — séquence terminée",
    "🎫 Ticket — opened",
    "🎫 Ticket — claimed",
    "🎫 Ticket — assigned",
    "🎫 Ticket — member_added",
    "🎫 Ticket — member_removed",
    "🎫 Ticket — closed",
  ]);
  const missing = LOG_EVENT_MATRIX.filter(
    (row) => row.title && !dynamic.has(row.title) && !files.includes(row.title),
  ).map((row) => row.title);
  assert.deepEqual(missing, []);
});

test("summary lists the non-covered events with a reason", () => {
  const summary = formatCoverageSummary();
  assert.match(summary, /non couverts/);
  assert.match(summary, /messageCreate/);
});

test("V2: every central log call declares its category (title routing only for the generic audit log)", async () => {
  const { readdirSync, statSync } = await import("node:fs");
  const { join, relative } = await import("node:path");
  const { untypedLogCalls } = await import("./logs-coverage.js");
  const root = new URL(".", import.meta.url).pathname;
  const sources = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (["node_modules", "data", "fixtures", "scripts"].includes(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".js") && !name.endsWith(".test.js") && !["logs.js", "logs-hub.js", "logs-coverage.js"].includes(name)) sources[relative(root, path)] = readFileSync(path, "utf8");
    }
  };
  walk(root);
  const untyped = untypedLogCalls(sources);
  // index.js : auditLog (titres variables, routage par titre transitoire).
  assert.deepEqual(untyped.filter((call) => !call.startsWith("index.js:")), []);
  assert.ok(untyped.length <= 1, untyped.join(", "));
});
