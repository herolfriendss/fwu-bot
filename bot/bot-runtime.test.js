import assert from "node:assert/strict";
import test from "node:test";
import {
  BOT_PROFILE_IDS,
  SHARED_SLASH_COMMANDS,
  claimDomainLease,
  createDomainGate,
  enqueueRelayedLog,
  formatBotsDiagnostic,
  listDomainLeases,
  parseDelegatedProfiles,
  prefixCommandOwner,
  releaseDomainLease,
  resolveBotRuntime,
  slashCommandNamesForProfile,
  slashCommandOwner,
  slashRegistrationPlan,
  takeRelayedLogs,
} from "./bot-runtime.js";
import { db } from "./database.js";

const { existsSync } = await import("node:fs");
const sharedCatalogue = new URL("../src/lib/slash-commands.ts", import.meta.url);
const { SLASH_COMMANDS, EXTRA_SLASH_COMMANDS } = await import((existsSync(sharedCatalogue) ? sharedCatalogue : new URL("./slash-commands.ts", import.meta.url)).href);

test("every catalogue command has exactly one owner (or is shared by all bots)", () => {
  for (const command of [...SLASH_COMMANDS, ...EXTRA_SLASH_COMMANDS]) {
    const owner = slashCommandOwner(command.name);
    assert.ok(owner || SHARED_SLASH_COMMANDS.includes(command.name), `/${command.name} sans propriétaire`);
  }
  const others = BOT_PROFILE_IDS.filter((id) => id !== "fwu");
  const perProfile = BOT_PROFILE_IDS.map((id) => slashCommandNamesForProfile(id, id === "fwu" ? others : []).filter((n) => !SHARED_SLASH_COMMANDS.includes(n)));
  const all = perProfile.flat();
  assert.equal(new Set(all).size, all.length, "commande attribuée à deux bots");
  assert.equal(all.length + SHARED_SLASH_COMMANDS.length, SLASH_COMMANDS.length + EXTRA_SLASH_COMMANDS.length);
});

test("owner decisions of 2026-11-23 are encoded", () => {
  assert.equal(slashCommandOwner("ban"), "fwu");
  assert.equal(slashCommandOwner("afk"), "fwu");
  assert.equal(slashCommandOwner("ticket"), "fwu");
  assert.equal(slashCommandOwner("guildguard"), "guard");
  assert.equal(slashCommandOwner("warn"), "guard");
  assert.equal(slashCommandOwner("play"), "fdpdlavoc");
  assert.equal(slashCommandOwner("resume"), "fdpdlavoc", "/resume reste la musique");
  assert.equal(slashCommandOwner("voc"), "fdpdlavoc");
  for (const name of ["sysp", "dog", "menotte", "wakeup", "anti-moove", "rankall", "lockname"]) assert.equal(slashCommandOwner(name), "suckme", name);
  for (const name of ["balance", "pay", "shop", "casino", "invest", "business"]) assert.equal(slashCommandOwner(name), "fisc", name);
  assert.equal(slashCommandOwner("aide"), null);
});

test("every bot keeps at most 100 root commands, FWU included before any delegation", () => {
  for (const id of BOT_PROFILE_IDS) {
    if (id === "fwu") continue;
    assert.ok(slashCommandNamesForProfile(id).length <= 100, id);
  }
  // Historical mode: FWU wants 103 names (100 + 3 extras): the plan registers the historical 100 and skips the extras.
  const legacy = slashRegistrationPlan({ profile: "fwu", delegated: [] }, SLASH_COMMANDS, EXTRA_SLASH_COMMANDS);
  assert.equal(legacy.register.length, 100);
  assert.deepEqual(legacy.skipped, EXTRA_SLASH_COMMANDS.map((c) => c.name));
  assert.deepEqual(legacy.register.map((c) => c.name), SLASH_COMMANDS.map((c) => c.name), "mode historique identique");
  assert.deepEqual(legacy.retire, []);
  // Once GUARD is delegated, /afk fits and the GUARD commands leave FWU.
  const afterGuard = slashRegistrationPlan({ profile: "fwu", delegated: ["guard"] }, SLASH_COMMANDS, EXTRA_SLASH_COMMANDS);
  assert.ok(afterGuard.register.some((c) => c.name === "afk"));
  assert.ok(!afterGuard.register.some((c) => c.name === "warn"));
  assert.ok(afterGuard.retire.includes("warn") && afterGuard.retire.includes("guildguard"));
  assert.ok(!afterGuard.skipped.includes("afk"), "RESUME always fits first");
  // Normal production: every specialised bot runs, FWU keeps far fewer than 100 commands.
  const allDelegated = slashRegistrationPlan({ profile: "fwu", delegated: ["guard", "fdpdlavoc", "suckme", "fisc"] }, SLASH_COMMANDS, EXTRA_SLASH_COMMANDS);
  assert.deepEqual(allDelegated.skipped, []);
  for (const id of ["guard", "fdpdlavoc", "suckme", "fisc"]) assert.deepEqual(slashRegistrationPlan({ profile: id, delegated: [] }, SLASH_COMMANDS, EXTRA_SLASH_COMMANDS).skipped, [], id);
  const guard = slashRegistrationPlan({ profile: "guard", delegated: [] }, SLASH_COMMANDS, EXTRA_SLASH_COMMANDS);
  assert.deepEqual(guard.register.map((c) => c.name).sort(), ["aide", "status", "guildguard", "warn", "warnings", "mute", "unmute", "kick", "purge", "slowmode", "lock", "unlock", "verify", "antinuke", "automod", "casier", "quarantaine"].sort());
  assert.deepEqual(guard.retire, []);
});

test("prefix ownership follows the first word only", () => {
  assert.equal(prefixCommandOwner("=play lofi"), "fdpdlavoc");
  assert.equal(prefixCommandOwner("=P lofi"), "fdpdlavoc");
  assert.equal(prefixCommandOwner("=resume"), "fdpdlavoc");
  assert.equal(prefixCommandOwner("=afk on réunion"), "fwu");
  assert.equal(prefixCommandOwner("=menotte @x"), "suckme");
  assert.equal(prefixCommandOwner("=pv"), "fdpdlavoc");
  assert.equal(prefixCommandOwner("=pay @x 10"), "fisc");
  assert.equal(prefixCommandOwner("=guardian-review list"), "guard");
  assert.equal(prefixCommandOwner("=playlist"), null, "pas de correspondance partielle");
  assert.equal(prefixCommandOwner("bonjour"), null);
  assert.equal(prefixCommandOwner("=macommande"), null, "commandes personnalisées : FWU par défaut");
});

test("prefix ownership matches the handler that really answers each command", async () => {
  // Snapshot of the smoke harness (npm run smoke with SMOKE_PREFIX_MAP): handler → bot.
  const handlerOwner = {
    economy: "fisc", casino: "fisc", business: "fisc",
    music: "fdpdlavoc", radio: "fdpdlavoc",
    social: "fwu", cards: "fwu", games: "fwu", organization: "fwu", tickets: "fwu",
    dog: "suckme", lockname: "suckme", roles: "suckme", "staff-audit": "suckme", automation: "suckme",
    autorules: "suckme", sysplus: "suckme",
  };
  const { readFileSync } = await import("node:fs");
  const snapshot = JSON.parse(readFileSync(new URL("./fixtures/prefix-handlers.json", import.meta.url), "utf8"));
  for (const [token, handlers] of Object.entries(snapshot)) {
    const owner = prefixCommandOwner(token);
    assert.ok(owner, `${token} sans propriétaire`);
    for (const handler of handlers) {
      if (handler === "voice") assert.ok(["fdpdlavoc", "suckme"].includes(owner), `${token} (module vocal mixte) → ${owner}`);
      else assert.equal(owner, handlerOwner[handler], `${token} traité par ${handler}`);
    }
  }
});

test("runtime resolution: FWU by default, dedicated bots need their own token", () => {
  const legacy = resolveBotRuntime({ DISCORD_TOKEN: "a" });
  assert.equal(legacy.profile, "fwu");
  assert.equal(legacy.token, "a");
  assert.deepEqual(legacy.delegated, []);
  assert.deepEqual(resolveBotRuntime({ DISCORD_TOKEN: "a", PND_FWU_DELEGATED: "guard, fisc" }).delegated, ["guard", "fisc"]);
  assert.throws(() => resolveBotRuntime({ PND_FWU_DELEGATED: "fwu" }));
  assert.throws(() => resolveBotRuntime({ PND_BOT_PROFILE: "core" }), /PND_BOT_PROFILE/);
  assert.throws(() => resolveBotRuntime({ PND_BOT_PROFILE: "guard", DISCORD_TOKEN: "a" }), /PND_GUARD_TOKEN/);
  assert.throws(() => resolveBotRuntime({ PND_BOT_PROFILE: "guard", DISCORD_TOKEN: "a", PND_GUARD_TOKEN: "a" }), /autre application/);
  const guard = resolveBotRuntime({ PND_BOT_PROFILE: "GUARD", DISCORD_TOKEN: "a", PND_GUARD_TOKEN: "b", V4_ALLOWED_GUILD_IDS: "1" });
  assert.equal(guard.profile, "guard");
  assert.equal(guard.token, "b");
  assert.equal(guard.guildAllowlist, "1");
  assert.deepEqual(parseDelegatedProfiles(""), []);
});

test("domain leases: one holder at a time, FWU takes the domain back when the lease expires", () => {
  db.exec("DELETE FROM bot_domain_leases");
  let clock = 1_000_000;
  const now = () => clock;
  const fwu = createDomainGate({ profile: "fwu", holder: "fwu:1", now, cacheMs: 0 });
  const guard = createDomainGate({ profile: "guard", holder: "guard:1", now, ttlMs: 60_000, cacheMs: 0 });
  const guardTwin = createDomainGate({ profile: "guard", holder: "guard:2", now, ttlMs: 60_000, cacheMs: 0 });

  // Before GUARD starts, FWU handles everything: historical mode.
  assert.equal(fwu.servesAll(), true);
  assert.equal(fwu.serves("guard"), true);
  assert.equal(guard.serves("guard"), false);

  assert.equal(guard.tick(), true);
  assert.equal(guardTwin.tick(), false, "un second GUARD ne traite rien");
  assert.equal(guard.serves("guard"), true);
  assert.equal(guard.serves("fisc"), false);
  assert.equal(guardTwin.serves("guard"), false);
  assert.equal(fwu.serves("guard"), false, "FWU s'efface");
  assert.equal(fwu.serves("fisc"), true);
  assert.equal(fwu.serves("fwu"), true);
  assert.equal(fwu.servesAll(), false);

  // At any instant exactly one process handles each domain.
  for (const domain of BOT_PROFILE_IDS) {
    const handlers = [fwu, guard, guardTwin].filter((gate) => gate.serves(domain));
    assert.equal(handlers.length, 1, domain);
  }

  // GUARD crashes (no renewal): after the TTL, FWU takes over again.
  clock += 61_000;
  assert.equal(fwu.serves("guard"), true);
  assert.equal(guardTwin.tick(), true, "un GUARD relancé reprend le verrou");
  assert.equal(fwu.serves("guard"), false);
  guardTwin.release();
  assert.equal(fwu.serves("guard"), true);
  assert.equal(listDomainLeases(clock).filter((l) => l.live).length, 0);
});

test("lease helpers are idempotent for the holder", () => {
  db.exec("DELETE FROM bot_domain_leases");
  assert.equal(claimDomainLease("fisc", "a", 10, 100), true);
  assert.equal(claimDomainLease("fisc", "a", 50, 100), true);
  assert.equal(claimDomainLease("fisc", "b", 100, 100), false);
  assert.equal(claimDomainLease("fisc", "b", 151, 100), true);
  releaseDomainLease("fisc", "a");
  assert.equal(listDomainLeases(152)[0].holder, "b");
  releaseDomainLease("fisc", "b");
});

test("relayed logs are delivered once, in order, and bounded in age", () => {
  db.exec("DELETE FROM bot_log_outbox");
  const embed = { title: "⛔ Membre banni", description: "Membre : <@1>", color: 0xef4444, toJSON() { return { title: this.title, description: this.description, color: this.color }; } };
  assert.equal(enqueueRelayedLog({ guildId: "g", sourceProfile: "guard", embed }, 1_000), true);
  assert.equal(enqueueRelayedLog({ guildId: "g", sourceProfile: "fisc", embed: { title: "💰 Achat" } }, 2_000), true);
  assert.equal(enqueueRelayedLog({ guildId: "", sourceProfile: "fisc", embed }), false);
  const first = takeRelayedLogs(1);
  assert.equal(first.length, 1);
  assert.equal(first[0].sourceProfile, "guard");
  assert.deepEqual(first[0].embed, { title: "⛔ Membre banni", description: "Membre : <@1>", color: 0xef4444 });
  assert.equal(takeRelayedLogs(10)[0].embed.title, "💰 Achat");
  assert.deepEqual(takeRelayedLogs(10), []);
  enqueueRelayedLog({ guildId: "g", sourceProfile: "guard", embed }, 0);
  enqueueRelayedLog({ guildId: "g", sourceProfile: "guard", embed }, 2 * 60 * 60_000);
  assert.equal(takeRelayedLogs(10).length, 1, "les logs de plus d'une heure sont abandonnés");
});

test("bots diagnostic shows who handles each domain", () => {
  db.exec("DELETE FROM bot_domain_leases; DELETE FROM bot_log_outbox;");
  claimDomainLease("guard", "guard:1", 1_000_000, 60_000);
  const text = formatBotsDiagnostic(1_010_000);
  assert.match(text, /🟢 \*\*GUARD\*\* — en ligne/);
  assert.match(text, /⚪ \*\*LE FISC\*\* — non démarré ou arrêté : \*\*FWU traite ce domaine\*\*/);
  assert.match(text, /Logs relayés en attente : 0/);
  assert.match(formatBotsDiagnostic(2_000_000), /⚪ \*\*GUARD\*\*.*dernier signe/);
  db.exec("DELETE FROM bot_domain_leases");
});
