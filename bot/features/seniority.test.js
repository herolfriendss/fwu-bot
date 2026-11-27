import test from "node:test";
import assert from "node:assert/strict";
import { anniversaryYears, configureSeniority, earnedTier, runSeniority } from "./seniority.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 27, 10);

test("badge mérité : le plus haut seuil atteint", () => {
  assert.equal(earnedTier(NOW - 10 * DAY, NOW), null);
  assert.equal(earnedTier(NOW - 40 * DAY, NOW).kind, "m1");
  assert.equal(earnedTier(NOW - 200 * DAY, NOW).kind, "m6");
  assert.equal(earnedTier(NOW - 400 * DAY, NOW).kind, "y1");
  assert.equal(earnedTier(null, NOW), null);
});

test("anniversaire d'arrivée : même jour à Paris, au moins 1 an", () => {
  assert.equal(anniversaryYears(Date.UTC(2025, 10, 27, 8), NOW), 1);
  assert.equal(anniversaryYears(Date.UTC(2023, 10, 27, 8), NOW), 3);
  assert.equal(anniversaryYears(Date.UTC(2026, 10, 27, 8), NOW), 0, "arrivé aujourd'hui");
  assert.equal(anniversaryYears(Date.UTC(2025, 10, 26, 8), NOW), 0);
});

test("passage : badge remplacé par le plus haut, anniversaire annoncé une fois par an", async () => {
  configureSeniority("g", { enabled: true, m1: "rm1", m6: "rm6", y1: "ry1", channelId: "c" });
  const calls = [];
  const mk = (id, joined, roles = []) => ({ id, user: { bot: false }, joinedTimestamp: joined,
    roles: { cache: new Set(roles), add: async (r) => { calls.push(["add", id, r]); }, remove: async (r) => { calls.push(["remove", id, r]); } } });
  for (const m of [mk("old", NOW - 400 * DAY - 1, ["rm1"]), mk("young", NOW - 5 * DAY), mk("bday", Date.UTC(2025, 10, 27, 8))]) m.roles.cache.has = Set.prototype.has.bind(m.roles.cache);
  const members = [mk("old", NOW - 400 * DAY - 1, ["rm1"]), mk("young", NOW - 5 * DAY), mk("bday", Date.UTC(2025, 10, 27, 8))];
  for (const m of members) m.roles.cache.has = Set.prototype.has.bind(m.roles.cache);
  const role = (id) => ({ id, name: id, managed: false, permissions: { has: () => false, toArray: () => [] }, position: 1 });
  const guild = { id: "g", ownerId: "o", members: { fetch: async () => new Map(members.map((m) => [m.id, m])), cache: new Map(), me: { roles: { highest: { position: 10 } } } },
    roles: { cache: new Map(["rm1", "rm6", "ry1"].map((id) => [id, role(id)])), everyone: { id: "g" } } };
  const client = { guilds: { cache: new Map([["g", guild]]) } };
  const posts = [];
  const announce = async (_g, c, text, u) => posts.push([c, u, text]);
  const first = await runSeniority(client, { now: NOW, announce });
  assert.equal(first.birthdays, 1);
  assert.match(posts[0][2], /<@bday>.*1 an/);
  const second = await runSeniority(client, { now: NOW + 3_600_000, announce });
  assert.equal(second.birthdays, 0, "une fois par an");
  assert.ok(!calls.some(([, id]) => id === "young"), "trop jeune : rien");
  assert.ok(calls.some(([kind, id, r]) => kind === "remove" && id === "old" && r === "rm1") || first.badges === 0, "ancien badge retiré si le garde des rôles l'autorise");
});
