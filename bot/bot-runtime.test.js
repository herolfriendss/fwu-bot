import assert from "node:assert/strict";
import test from "node:test";
import {
  BOT_PROFILE_IDS,
  BOT_PROFILES,
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
  requeueRelayedLog,
  relayedLogLosses,
  formatRelayLossLine,
  pendingRelayedLogs,
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

test("owner decisions of 2026-11-24 are encoded (FWU = staff + embeds, GUARD = ban/kick)", () => {
  for (const name of ["tempmute", "unmute", "warn", "warnings", "sanction", "sanction-type", "quota", "embed", "reglement", "screening"]) assert.equal(slashCommandOwner(name), "fwu", name);
  for (const name of ["ban", "kick", "blacklist", "guildguard", "purge", "nettoyer", "lock", "unlock", "verify"]) assert.equal(slashCommandOwner(name), "guard", name);
  for (const name of ["afk", "ticket", "ia", "live", "giveaway", "profil", "sondage"]) assert.equal(slashCommandOwner(name), "suckme", name);
  for (const name of ["dice", "coinflip", "trivia", "cards", "pack", "trade"]) assert.equal(slashCommandOwner(name), "fisc", name);
  assert.equal(slashCommandOwner("music"), "fdpdlavoc");
  assert.equal(slashCommandOwner("play"), null, "/play est regroupée sous /music player play");
  assert.equal(slashCommandOwner("resume"), null, "/resume est regroupée sous /music player resume");
  assert.equal(slashCommandOwner("voice"), "fdpdlavoc");
  for (const retired of ["access", "unaccess", "pv"]) assert.equal(slashCommandOwner(retired), null, retired);
  assert.equal(slashCommandOwner("voc"), "fdpdlavoc");
  for (const name of ["sysp", "dog", "menotte", "wakeup", "anti-moove", "rankall", "lockname"]) assert.equal(slashCommandOwner(name), "suckme", name);
  for (const name of ["balance", "pay", "shop", "casino", "invest", "business"]) assert.equal(slashCommandOwner(name), "fisc", name);
  assert.equal(slashCommandOwner("mute"), null, "/mute est remplacée par /tempmute");
  assert.equal(slashCommandOwner("aide"), null);
});

test("every bot registers all its commands (no more skipped /afk) and retires the others' commands", () => {
  for (const id of BOT_PROFILE_IDS) {
    const plan = slashRegistrationPlan({ profile: id, delegated: [] }, SLASH_COMMANDS, EXTRA_SLASH_COMMANDS);
    assert.deepEqual(plan.skipped, [], `${id} : commandes ignorées (limite Discord de 100)`);
    assert.ok(plan.register.length <= 100, id);
    const registered = new Set(plan.register.map((c) => c.name));
    for (const name of plan.retire) assert.ok(!registered.has(name), `${id} enregistre et retire ${name}`);
    assert.ok(plan.retire.includes("mute"), `${id} retire l'ancienne /mute`);
  }
  // Régression du bug AFK : /afk était la 105e commande de FWU, jamais enregistrée.
  const suckme = slashRegistrationPlan({ profile: "suckme", delegated: [] }, SLASH_COMMANDS, EXTRA_SLASH_COMMANDS);
  assert.ok(suckme.register.some((c) => c.name === "afk"));
  const fwu = slashRegistrationPlan({ profile: "fwu", delegated: ["guard"] }, SLASH_COMMANDS, EXTRA_SLASH_COMMANDS);
  assert.deepEqual(fwu.register.map((c) => c.name).sort(), ["aide", "status", "tempmute", "unmute", "warn", "warnings", "sanction", "sanction-type", "quota", "embed", "reglement", "screening"].sort());
  assert.ok(fwu.retire.includes("afk") && fwu.retire.includes("ban") && fwu.retire.includes("play"), "FWU retire les commandes des autres bots");
  const guard = slashRegistrationPlan({ profile: "guard", delegated: [] }, SLASH_COMMANDS, EXTRA_SLASH_COMMANDS);
  assert.deepEqual(guard.register.map((c) => c.name).sort(), ["aide", "status", "guildguard", "kick", "ban", "blacklist", "purge", "nettoyer", "slowmode", "lock", "unlock", "verify", "antinuke", "automod", "casier", "quarantaine", "bouclier"].sort());
});

test("prefix ownership follows the first word only (canonical = form)", () => {
  assert.equal(prefixCommandOwner("=play lofi"), "fdpdlavoc");
  assert.equal(prefixCommandOwner("=P lofi"), "fdpdlavoc");
  assert.equal(prefixCommandOwner("=resume"), "fdpdlavoc");
  assert.equal(prefixCommandOwner("=afk on réunion"), "suckme");
  assert.equal(prefixCommandOwner("=menotte @x"), "suckme");
  assert.equal(prefixCommandOwner("=mv 123"), "fdpdlavoc");
  assert.equal(prefixCommandOwner("=accessall"), "fdpdlavoc");
  assert.equal(prefixCommandOwner("=ban @x"), "guard");
  assert.equal(prefixCommandOwner("=unban 1"), "guard");
  assert.equal(prefixCommandOwner("=dice"), "fisc");
  assert.equal(prefixCommandOwner("=pv"), "fdpdlavoc");
  assert.equal(prefixCommandOwner("=pay @x 10"), "fisc");
  assert.equal(prefixCommandOwner("=guardian-review list"), "guard");
  assert.equal(prefixCommandOwner("=playlist"), null, "pas de correspondance partielle");
  assert.equal(prefixCommandOwner("bonjour"), null);
  assert.equal(prefixCommandOwner("=macommande"), null, "commandes personnalisées : aucun propriétaire intégré");
});

test("prefix ownership matches the handler that really answers each command", async () => {
  // Snapshot of the smoke harness (npm run smoke with SMOKE_PREFIX_MAP): handler → bot(s).
  const handlerOwner = {
    economy: ["fisc"], casino: ["fisc"], business: ["fisc"],
    music: ["fdpdlavoc"], radio: ["fdpdlavoc"],
    social: ["suckme"], cards: ["fisc"], games: ["suckme", "fisc"], organization: ["suckme"], tickets: ["suckme"],
    dog: ["suckme"], lockname: ["suckme"], roles: ["suckme"], "staff-audit": ["suckme"], automation: ["suckme"],
    autorules: ["suckme"], sysplus: ["suckme"],
  };
  const { readFileSync } = await import("node:fs");
  const snapshot = JSON.parse(readFileSync(new URL("./fixtures/prefix-handlers.json", import.meta.url), "utf8"));
  for (const [token, handlers] of Object.entries(snapshot)) {
    const owner = prefixCommandOwner(token);
    assert.ok(owner, `${token} sans propriétaire`);
    for (const handler of handlers) {
      if (handler === "voice") assert.ok(["fdpdlavoc", "suckme"].includes(owner), `${token} (module vocal mixte) → ${owner}`);
      else assert.ok(handlerOwner[handler]?.includes(owner), `${token} traité par ${handler} mais attribué à ${owner}`);
    }
  }
  // Each handler domain label in index.js must match the bot that owns its commands.
  const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(source, /runCmd\("suckme"\) && await handleResumeMessage/);
  assert.match(source, /runCmd\("guard"\) && await handleBlacklistMessage/);
  assert.match(source, /runCmd\("suckme"\) && await handleTicketsMessage/);
  assert.match(source, /runCmd\("fisc"\) && await handleCardsMessage/);
  assert.match(source, /runCmd\("suckme", "fisc"\) && await handleGamesMessage/);
  assert.match(source, /runCmd\("guard"\) && await handleGuardPrefixCommand/);
  assert.match(source, /runCmd\("fdpdlavoc"\) && await handleVoiceMoveCommand/);
  assert.doesNotMatch(source, /runCmd\("fwu"\)/, "FWU n'a plus aucune commande préfixe");
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
  db.exec("DELETE FROM bot_log_relay_losses");
  enqueueRelayedLog({ guildId: "g", sourceProfile: "guard", embed }, 0);
  enqueueRelayedLog({ guildId: "g", sourceProfile: "guard", embed }, 25 * 60 * 60_000);
  assert.equal(takeRelayedLogs(10, 25 * 60 * 60_000).length, 1, "les logs de plus de 24 h sont abandonnés");
  assert.deepEqual(relayedLogLosses().map((r) => [r.reason, r.count]), [["trop_vieux", 1]], "et comptés comme perdus");
});

test("un log relayé non publié est remis en file, avec délai, puis compté perdu au 3e échec", () => {
  db.exec("DELETE FROM bot_log_outbox; DELETE FROM bot_log_relay_losses;");
  const embed = { title: "⛔ Membre banni" };
  enqueueRelayedLog({ guildId: "g", sourceProfile: "guard", embed }, 1_000);
  const [first] = takeRelayedLogs(10, 1_000);
  assert.equal(first.attempts, 0);
  assert.equal(requeueRelayedLog(first, 2_000), true);
  assert.deepEqual(takeRelayedLogs(10, 2_000), [], "pas de nouvel essai immédiat");
  const [second] = takeRelayedLogs(10, 2_000 + 30_000);
  assert.equal(second.attempts, 1);
  assert.equal(second.embed.title, "⛔ Membre banni");
  assert.equal(second.createdAt, 1_000, "l'heure d'origine est gardée");
  assert.equal(requeueRelayedLog(second, 40_000), true);
  assert.deepEqual(takeRelayedLogs(10, 40_000 + 59_000), []);
  const [third] = takeRelayedLogs(10, 40_000 + 60_000);
  assert.equal(third.attempts, 2);
  assert.equal(requeueRelayedLog(third, 200_000), false);
  assert.equal(pendingRelayedLogs(), 0);
  assert.match(formatRelayLossLine(), /Logs relayés perdus : 1 \(1 non publiés après 3 essais\)/);
  db.exec("DELETE FROM bot_log_relay_losses");
  assert.match(formatRelayLossLine(), /perdus : 0/);
});

test("bots diagnostic shows who handles each domain", () => {
  db.exec("DELETE FROM bot_domain_leases; DELETE FROM bot_log_outbox;");
  claimDomainLease("guard", "guard:1", 1_000_000, 60_000);
  const text = formatBotsDiagnostic(1_010_000);
  assert.match(text, /🟢 \*\*GUARD\*\* — en ligne/);
  assert.match(text, /⚪ \*\*LE FISC\*\* — non démarré ou arrêté : \*\*FWU reprend les événements de ce domaine\*\*/);
  assert.match(text, /⚪ \*\*Invest \+\*\* \(facultatif\) — non démarré : aucun domaine Invest \+ actif/);
  assert.match(text, /Logs relayés en attente : 0/);
  assert.match(formatBotsDiagnostic(2_000_000), /⚪ \*\*GUARD\*\*.*dernier signe/);
  db.exec("DELETE FROM bot_domain_leases");
});

test("bots diagnostic shows connection failures and definitive stops", async () => {
  const { recordGatewayFailure, clearGatewayFailures } = await import("./gateway-watchdog.js");
  for (let i = 0; i < 6; i++) recordGatewayFailure(db, "guard", "TokenInvalid", 1_000_000);
  recordGatewayFailure(db, "fisc", "startup_timeout", 1_000_000);
  const text = formatBotsDiagnostic(1_010_000);
  assert.match(text, /🔴 \*\*GUARD\*\* — arrêté après 6 échecs de connexion à Discord \(TokenInvalid\)/);
  assert.match(text, /🟠 \*\*LE FISC\*\* — 1 échec\(s\) de connexion/);
  clearGatewayFailures(db, "guard"); clearGatewayFailures(db, "fisc");
  assert.doesNotMatch(formatBotsDiagnostic(1_010_000), /échec/);
});

test("every dedicated profile, including optional Invest+, can claim only its own domain", () => {
  db.exec("DELETE FROM bot_domain_leases");
  let clock = 5_000_000;
  const now = () => clock;
  const fwu = createDomainGate({ profile: "fwu", holder: "fwu:matrix", now, cacheMs: 0 });

  for (const profile of BOT_PROFILE_IDS.filter((id) => id !== "fwu")) {
    const gate = createDomainGate({
      profile,
      holder: `${profile}:matrix`,
      now,
      ttlMs: 60_000,
      cacheMs: 0,
    });

    assert.equal(fwu.serves(profile), true, `FWU doit reprendre ${profile} avant le démarrage`);
    assert.equal(gate.serves(profile), false, `${profile} ne doit rien traiter avant son verrou`);
    assert.equal(gate.tick(), true, `${profile} doit pouvoir prendre son domaine`);
    assert.equal(gate.serves(profile), true);
    assert.equal(fwu.serves(profile), false, `FWU doit céder ${profile}`);

    for (const other of BOT_PROFILE_IDS.filter((id) => id !== profile && id !== "fwu")) {
      assert.equal(gate.serves(other), false, `${profile} ne doit jamais traiter ${other}`);
    }

    gate.release();
    assert.equal(fwu.serves(profile), true, `FWU doit reprendre ${profile} après libération`);
    assert.equal(gate.serves(profile), false);
    clock += 1_000;
  }

  db.exec("DELETE FROM bot_domain_leases");
});

test("every dedicated application resolves its own unique token, including optional Invest+", () => {
  const seenTokens = new Set(["main-token"]);
  for (const profile of BOT_PROFILE_IDS.filter((id) => id !== "fwu")) {
    const token = `token-${profile}`;
    assert.equal(seenTokens.has(token), false);
    seenTokens.add(token);
    const runtime = resolveBotRuntime({
      DISCORD_TOKEN: "main-token",
      PND_BOT_PROFILE: profile,
      [BOT_PROFILES[profile].tokenEnv]: token,
    });
    assert.equal(runtime.profile, profile);
    assert.equal(runtime.token, token);
  }

  assert.throws(() => resolveBotRuntime({
    DISCORD_TOKEN: "main-token",
    PND_BOT_PROFILE: "investplus",
  }), /PND_INVESTPLUS_TOKEN/);
});
