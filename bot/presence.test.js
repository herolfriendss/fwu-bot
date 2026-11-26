import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityType } from "discord.js";
import { DEFAULT_PRESENCES, loadPresence, presenceAt, presenceStats, renderPresenceText, startPresence, validatePresence } from "./presence.js";
import { BOT_PROFILE_IDS } from "./bot-runtime.js";

const configFile = (content) => {
  const dir = mkdtempSync(join(tmpdir(), "fwu-presence-"));
  const path = join(dir, "bots.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return { PND_BOTS_CONFIG: path };
};

test("every bot profile has valid default presences", () => {
  for (const id of BOT_PROFILE_IDS) assert.ok(DEFAULT_PRESENCES[id], `${id} sans statut par défaut`);
  for (const [id, config] of Object.entries(DEFAULT_PRESENCES)) assert.deepEqual(validatePresence(config), config, id);
});

test("validation explains what is wrong", () => {
  const ok = { activities: [{ type: "watching", text: "{membres} membres" }] };
  assert.deepEqual(validatePresence(ok), { status: "online", interval: 60, activities: ok.activities });
  assert.throws(() => validatePresence({ ...ok, status: "invisible" }), /statut inconnu/);
  assert.throws(() => validatePresence({ ...ok, interval: 5 }), /trop court/);
  assert.throws(() => validatePresence({ activities: [] }), /entre 1 et 10/);
  assert.throws(() => validatePresence({ activities: [{ type: "streaming", text: "x" }] }), /type d'activité inconnu/);
  assert.throws(() => validatePresence({ activities: [{ type: "playing", text: "{argent}" }] }), /variable inconnue \{argent\}/);
  assert.throws(() => validatePresence({ activities: [{ type: "playing", text: "x".repeat(121) }] }), /trop long/);
});

test("bots.json overrides one profile; a bad file never blocks the bot", () => {
  const env = configFile({ prefixes: {}, presence: { guard: { status: "idle", interval: 120, activities: [{ type: "playing", text: "Salut" }] } } });
  assert.deepEqual(loadPresence("guard", { env }), { status: "idle", interval: 120, activities: [{ type: "playing", text: "Salut" }] });
  assert.deepEqual(loadPresence("fisc", { env }), DEFAULT_PRESENCES.fisc, "les autres bots gardent leurs défauts");
  const warnings = [];
  assert.deepEqual(loadPresence("guard", { env: configFile("{pas du json"), warn: (m) => warnings.push(m) }), DEFAULT_PRESENCES.guard);
  assert.deepEqual(loadPresence("guard", { env: configFile({ presence: { guard: { activities: [] } } }), warn: (m) => warnings.push(m) }), DEFAULT_PRESENCES.guard);
  assert.equal(warnings.length, 2);
  assert.equal(loadPresence("inconnu", { env: { PND_BOTS_CONFIG: "/nulle/part.json" } }).activities.length, 2, "profil inconnu : statut générique");
});

test("counters come from the Discord cache, bots excluded from the voice count", () => {
  const voice = (states) => ({ cache: { filter: (fn) => ({ size: states.filter(fn).length }) } });
  const stats = presenceStats([
    { memberCount: 1200, voiceStates: voice([{ channelId: "1", member: { user: { bot: false } } }, { channelId: "1", member: { user: { bot: true } } }, { channelId: null }]) },
    { memberCount: 34 },
  ]);
  assert.deepEqual(stats, { membres: 1234, serveurs: 2, vocal: 1 });
  assert.equal(renderPresenceText("{membres} membres · {prefixe}aide · {x}", { membres: 1234, prefixe: "+" }), "1 234 membres · +aide · {x}");
});

test("the rotation cycles through activities; custom statuses use the state field", () => {
  const config = { status: "dnd", interval: 60, activities: [{ type: "watching", text: "{serveurs} serveur(s)" }, { type: "custom", text: "🔒 {bot}" }] };
  const values = { serveurs: 2, bot: "GUARD" };
  assert.deepEqual(presenceAt(config, 0, values), { status: "dnd", activities: [{ name: "2 serveur(s)", type: ActivityType.Watching }] });
  assert.deepEqual(presenceAt(config, 1, values), { status: "dnd", activities: [{ name: "Statut", state: "🔒 GUARD", type: ActivityType.Custom }] });
  assert.deepEqual(presenceAt(config, 2, values), presenceAt(config, 0, values));
});

test("startPresence applies a status right away and survives an error", () => {
  const applied = [];
  const client = { user: { setPresence: (p) => applied.push(p) } };
  const stop = startPresence(client, { profile: "fisc", label: "LE FISC", prefix: "-", guilds: () => [{ memberCount: 10 }], env: { PND_BOTS_CONFIG: "/nulle/part.json" } });
  stop();
  assert.equal(applied.length, 1);
  assert.match(applied[0].activities[0].name, /10 membres/);
  let errors = 0;
  const stop2 = startPresence({ user: { setPresence: () => { throw new Error("x"); } } }, { profile: "fisc", label: "F", guilds: () => [], env: {}, onError: () => errors++ });
  stop2();
  assert.equal(errors, 1);
});

test("V2: event-driven presence: maintenance > /presence > raid (GUARD) > music (FDPDLAVOC) > jackpot (LE FISC)", async () => {
  const { eventPresence, seasonalActivity } = await import("./presence.js");
  assert.match(eventPresence("guard", { raidActive: true }).activity.text, /Mode raid/);
  assert.equal(eventPresence("guard", { raidActive: true }).status, "dnd");
  assert.equal(eventPresence("fwu", { raidActive: true }), null, "only GUARD shows the raid");
  assert.deepEqual(eventPresence("fdpdlavoc", { nowPlaying: "Lofi" }).activity, { type: "listening", text: "Lofi" });
  assert.match(eventPresence("fisc", { jackpot: 12345 }).activity.text, /Cagnotte : 12\s345/);
  assert.match(eventPresence("guard", { raidActive: true, override: { type: "custom", text: "Hello", status: "online" } }).activity.text, /Hello/);
  assert.match(eventPresence("guard", { raidActive: true, maintenance: "mise à jour" }).activity.text, /Maintenance : mise à jour/);
  assert.match(seasonalActivity(new Date(2026, 11, 25)).text, /Noël/);
  assert.equal(seasonalActivity(new Date(2026, 4, 3)), null);
});

test("V2: /presence sets an override without touching any file, admins only", async () => {
  const { runPresenceCommand, presenceOverride } = await import("./presence.js");
  const admin = { id: "1", guild: { ownerId: "2" }, permissions: { has: () => true } };
  const nobody = { id: "3", guild: { ownerId: "2" }, permissions: { has: () => false } };
  assert.match(await runPresenceCommand({ member: nobody, sub: "definir", bot: "guard", text: "x" }, { env: {} }), /Réservé/);
  assert.match(await runPresenceCommand({ member: admin, sub: "definir", bot: "guard", text: "Tournoi ce soir", type: "playing", duration: "2h" }, { env: {} }), /✅/);
  assert.deepEqual(presenceOverride("guard"), { type: "playing", text: "Tournoi ce soir", status: "online" });
  assert.match(await runPresenceCommand({ member: admin, sub: "retirer", bot: "guard" }, { env: {} }), /automatique/);
  assert.equal(presenceOverride("guard"), null);
  assert.match(await runPresenceCommand({ member: admin, sub: "definir", bot: "guard", text: "{inconnu}" }, { env: {} }), /variable inconnue/);
});
