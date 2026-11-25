import assert from "node:assert/strict";
import { test } from "node:test";
import { devilField } from "../src/cards.js";
import { buildDevilPrompt, runDevil } from "../src/devil.js";
import { Supervisor } from "../src/supervisor.js";

const OWNER = "333333333333333333";
const P = (titre) => ({ type: "fonctionnalite", titre, description: "d", pourquoi: "p", bot_concerne: "LE FISC", priorite: "moyenne", effort: "petit" });

class FakeStore {
  constructor() {
    this.state = new Map();
    this.proposals = [];
    this.journalEntries = [];
    this.usage = [];
  }
  async purgeOldExcerpts() { return 0; }
  async getState(k, f = null) { return this.state.has(k) ? this.state.get(k) : f; }
  async setState(k, v) { this.state.set(k, v); }
  async journal(agent, action, detail) { this.journalEntries.push({ agent, action, detail }); }
  async observationWindow() { return { channels: [], commands: [], flow: [], excerpts: [] }; }
  async recentProposalTitles() { return []; }
  async monthSpendUsd() { return this.usage.reduce((s, u) => s + u.costUsd, 0); }
  async recordUsage(u) { this.usage.push(u); }
  async insertProposal({ agent, kind, title, details, dedupKey }) {
    if (this.proposals.some((p) => p.dedup_key === dedupKey)) return null;
    const p = { id: this.proposals.length + 1, agent, kind, title, details, dedup_key: dedupKey, status: "en_attente" };
    this.proposals.push(p);
    return p.id;
  }
  async getProposal(id) { return this.proposals.find((p) => p.id === id) ?? null; }
  async setProposalMessage() {}
  async setProposalIssue(id, url) { (await this.getProposal(id)).issue_url = url; }
  async pendingProposals() { return this.proposals.filter((p) => ["en_attente", "plus_tard"].includes(p.status)); }
  async decideProposal(id, status) {
    const p = await this.getProposal(id);
    if (!p || !["en_attente", "plus_tard"].includes(p.status)) return null;
    p.status = status;
    return { ...p };
  }
}

function fakeAnthropic({ propositions, critiques, devilThrows = false }) {
  const usage = { input_tokens: 1000, output_tokens: 500 };
  return {
    messages: { parse: async () => ({ stop_reason: "end_turn", usage, parsed_output: { resume: "Semaine calme.", propositions } }) },
    beta: {
      messages: {
        parse: async (params) => {
          assert.equal(params.fallbacks, "default");
          if (devilThrows) throw new Error("réseau");
          return { stop_reason: "end_turn", usage, model: "claude-sonnet-5-5", parsed_output: { critiques } };
        },
      },
    },
  };
}

function makeSupervisor(store, anthropic, extra = {}) {
  const posted = [];
  const sup = new Supervisor({
    config: { ownerId: OWNER, monthlyBudgetUsd: 10, readChannelIds: new Set(["1"]), githubToken: "", ...extra },
    store,
    anthropic,
    postToAgents: async (payload) => { posted.push(payload); return { id: String(posted.length) }; },
    channelNames: () => new Map(),
    log: { warn() {} },
  });
  return { sup, posted };
}

test("runDaily : propositions relues par l'Avocat du diable, doublons ignorés, coûts enregistrés", async () => {
  const store = new FakeStore();
  await store.insertProposal({ agent: "Observateur", kind: "fonctionnalite", title: "Déjà vu", details: {}, dedupKey: "deja vu" });
  const critiques = [{ numero: 1, objections: "o", risques: "r", question_cle: "q", verdict: "revoir" }];
  const { sup, posted } = makeSupervisor(store, fakeAnthropic({ propositions: [P("Boutique de rôles"), P("Déjà vu !")], critiques }));
  const r = await sup.runDaily({ trigger: "test" });
  assert.deepEqual(r, { ok: true, created: 1, skipped: 1 });
  const p = await store.getProposal(2);
  assert.equal(p.details.avocat.verdict, "revoir");
  assert.equal(posted.length, 2); // résumé + 1 carte
  assert.deepEqual(store.usage.map((u) => u.agent), ["Observateur", "Avocat du diable"]);
});

test("runDaily : si l'Avocat du diable plante, les cartes partent quand même avec une note", async () => {
  const store = new FakeStore();
  const { sup } = makeSupervisor(store, fakeAnthropic({ propositions: [P("Idée")], critiques: [], devilThrows: true }));
  const r = await sup.runDaily({ trigger: "test" });
  assert.equal(r.ok, true);
  const p = await store.getProposal(1);
  assert.equal(p.details.avocat, null);
  assert.equal(p.details.avocat_note, "indisponible");
});

test("runDaily ne fait rien en pause ni au-delà du budget", async () => {
  const store = new FakeStore();
  const { sup } = makeSupervisor(store, fakeAnthropic({ propositions: [], critiques: [] }));
  await sup.setPaused(true, OWNER);
  assert.equal((await sup.runDaily({ trigger: "test" })).ok, false);
  await sup.setPaused(false, OWNER);
  store.usage.push({ costUsd: 9.5 });
  const r = await sup.runDaily({ trigger: "test" });
  assert.equal(r.reason, "budget atteint");
});

test("handleButton : seul le propriétaire décide, une seule fois", async () => {
  const store = new FakeStore();
  await store.insertProposal({ agent: "Observateur", kind: "correctif", title: "t", details: P("t"), dedupKey: "t" });
  const { sup } = makeSupervisor(store, fakeAnthropic({ propositions: [], critiques: [] }));
  const updates = [];
  const updateCard = async (x) => updates.push(x);
  const intrus = await sup.handleButton({ customId: "agents:valider:1", userId: "999999999999999999", updateCard });
  assert.match(intrus, /Seul le propriétaire/);
  assert.equal((await store.getProposal(1)).status, "en_attente");
  const ok = await sup.handleButton({ customId: "agents:valider:1", userId: OWNER, updateCard });
  assert.match(ok, /validée/);
  assert.equal(updates.length, 1);
  assert.match(await sup.handleButton({ customId: "agents:refuser:1", userId: OWNER, updateCard }), /déjà été traitée/);
  assert.equal(await sup.handleButton({ customId: "autre:x", userId: OWNER, updateCard }), null);
});

test("handleButton crée un ticket GitHub si un jeton est configuré", async () => {
  const store = new FakeStore();
  await store.insertProposal({ agent: "Observateur", kind: "correctif", title: "t", details: P("t"), dedupKey: "t" });
  let called = null;
  const fetchImpl = async (url, init) => { called = { url, body: JSON.parse(init.body) }; return { ok: true, json: async () => ({ html_url: "https://github.com/o/r/issues/1" }) }; };
  const { sup } = makeSupervisor(store, fakeAnthropic({ propositions: [], critiques: [] }), { githubToken: "tok", githubRepo: "o/r" });
  sup.fetchImpl = fetchImpl;
  const msg = await sup.handleButton({ customId: "agents:valider:1", userId: OWNER, updateCard: async () => {} });
  assert.equal(called.url, "https://api.github.com/repos/o/r/issues");
  assert.equal(called.body.title, "t");
  assert.match(msg, /issues\/1/);
});

test("Avocat du diable : prompt numéroté, critiques remises dans l'ordre", async () => {
  assert.match(buildDevilPrompt([P("A"), P("B")], "ctx"), /Proposition 2 : B/);
  const client = fakeAnthropic({ propositions: [], critiques: [{ numero: 2, objections: "o", risques: "r", question_cle: "q", verdict: "garder" }] });
  const d = await runDevil({ client, propositions: [P("A"), P("B")], contexte: "" });
  assert.equal(d.critiques[0], null);
  assert.equal(d.critiques[1].verdict, "garder");
  assert.match(devilField({ avocat: d.critiques[1] }).name, /garder/);
  assert.match(devilField({ avocat: null, avocat_note: "x" }).value, /Pas de relecture/);
});
