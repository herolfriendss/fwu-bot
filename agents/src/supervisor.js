import { canSpend, costUsd, estimateTokens, priceModel } from "./budget.js";
import { DEVIL_MAX_TOKENS, DEVIL_MODEL, DEVIL_SYSTEM, buildDevilPrompt, runDevil } from "./devil.js";
import { digestEmbed, parseButton, proposalButtons, proposalEmbed } from "./cards.js";
import { createIssue } from "./github.js";
import {
  OBSERVER_MAX_TOKENS,
  OBSERVER_MODEL,
  SYSTEM_PROMPT,
  buildObservationPrompt,
  dedupKey,
  runObserver,
} from "./observer.js";

/**
 * Le Superviseur : seul point d'entrée vers #agents. Il vérifie la pause et
 * le budget avant chaque appel à l'IA, enlève les doublons, journalise tout,
 * et n'accepte les clics que du propriétaire.
 */
export class Supervisor {
  constructor({ config, store, anthropic, postToAgents, channelNames, fetchImpl = fetch, log = console }) {
    this.config = config;
    this.store = store;
    this.anthropic = anthropic;
    this.postToAgents = postToAgents; // (payload) => Promise<Message>
    this.channelNames = channelNames; // () => Map<id, nom>
    this.fetchImpl = fetchImpl;
    this.log = log;
    this.running = false;
  }

  async isPaused() {
    return (await this.store.getState("paused", false)) === true;
  }

  async setPaused(paused, by) {
    await this.store.setState("paused", paused);
    await this.store.journal("Superviseur", paused ? "pause" : "reprise", { by });
  }

  /** Analyse quotidienne : Observateur, puis résumé et cartes dans #agents. */
  async runDaily({ trigger }) {
    if (this.running) return { ok: false, reason: "une analyse est déjà en cours" };
    this.running = true;
    try {
      const purged = await this.store.purgeOldExcerpts();
      if (purged) await this.store.journal("Superviseur", "purge_extraits", { purged });

      if (await this.isPaused()) {
        await this.store.journal("Superviseur", "analyse_sautee", { trigger, reason: "pause" });
        return { ok: false, reason: "les agents sont en pause (/agents reprendre)" };
      }

      const window = await this.store.observationWindow(7);
      const recent = await this.store.recentProposalTitles(30);
      const prompt = buildObservationPrompt(window, recent, this.channelNames());

      const spentUsd = await this.store.monthSpendUsd();
      const check = canSpend({
        spentUsd,
        budgetUsd: this.config.monthlyBudgetUsd,
        model: OBSERVER_MODEL,
        estimatedInputTokens: estimateTokens(SYSTEM_PROMPT + prompt),
        maxOutputTokens: OBSERVER_MAX_TOKENS,
      });
      if (!check.allowed) {
        await this.store.journal("Superviseur", "budget_atteint", { spentUsd, limitUsd: check.limitUsd });
        await this.postToAgents({
          content: `⚠️ Budget IA presque atteint (${spentUsd.toFixed(2)} $ sur ${this.config.monthlyBudgetUsd} $). L'analyse est suspendue jusqu'au mois prochain, ou jusqu'à ce que tu augmentes AGENTS_MONTHLY_BUDGET_USD.`,
        });
        return { ok: false, reason: "budget atteint" };
      }

      const out = await runObserver({ client: this.anthropic, prompt });
      const cost = costUsd(OBSERVER_MODEL, out.usage.inputTokens, out.usage.outputTokens);
      await this.store.recordUsage({ agent: "Observateur", model: OBSERVER_MODEL, ...out.usage, costUsd: cost });
      if (!out.ok) {
        await this.store.journal("Observateur", "analyse_echouee", { reason: out.reason });
        await this.postToAgents({ content: `⚠️ L'Observateur n'a pas pu terminer son analyse : ${out.reason}.` });
        return { ok: false, reason: out.reason };
      }

      // L'Avocat du diable relit les propositions avant qu'elles n'arrivent dans #agents.
      const propositions = out.result.propositions;
      let critiques = propositions.map(() => null);
      let devilNote = null;
      let devilCost = 0;
      if (propositions.length) {
        const devilCheck = canSpend({
          spentUsd: spentUsd + cost,
          budgetUsd: this.config.monthlyBudgetUsd,
          model: DEVIL_MODEL,
          estimatedInputTokens: estimateTokens(DEVIL_SYSTEM + buildDevilPrompt(propositions, out.result.resume)),
          maxOutputTokens: DEVIL_MAX_TOKENS,
        });
        if (!devilCheck.allowed) devilNote = "budget presque atteint, propositions non relues";
        else {
          try {
            const d = await runDevil({ client: this.anthropic, propositions, contexte: out.result.resume });
            const model = priceModel(d.model, DEVIL_MODEL);
            devilCost = costUsd(model, d.usage.inputTokens, d.usage.outputTokens);
            await this.store.recordUsage({ agent: "Avocat du diable", model, ...d.usage, costUsd: devilCost });
            if (d.ok) critiques = d.critiques;
            else devilNote = d.reason;
          } catch (err) {
            devilNote = "indisponible";
            this.log.warn?.(`[agents] Avocat du diable : ${err.message}`);
          }
        }
        if (devilNote) await this.store.journal("Avocat du diable", "relecture_impossible", { reason: devilNote });
      }

      let created = 0;
      let skipped = 0;
      const cards = [];
      for (const [i, p] of propositions.entries()) {
        const id = await this.store.insertProposal({
          agent: "Observateur",
          kind: p.type,
          title: p.titre,
          details: { ...p, avocat: critiques[i], avocat_note: critiques[i] ? null : devilNote ?? "pas de critique" },
          dedupKey: dedupKey(p.titre),
        });
        if (id == null) {
          skipped += 1;
          continue;
        }
        created += 1;
        cards.push(await this.store.getProposal(id));
      }

      const pending = (await this.store.pendingProposals(100)).length;
      await this.postToAgents({
        embeds: [
          digestEmbed({
            resume: out.result.resume,
            created,
            skipped,
            spentUsd: spentUsd + cost + devilCost,
            budgetUsd: this.config.monthlyBudgetUsd,
            pending,
            purged,
          }),
        ],
      });
      for (const p of cards) {
        const msg = await this.postToAgents({ embeds: [proposalEmbed(p)], components: [proposalButtons(p.id)] });
        if (msg?.id) await this.store.setProposalMessage(p.id, msg.id);
      }
      await this.store.journal("Observateur", "analyse_terminee", { trigger, created, skipped, costUsd: cost + devilCost });
      return { ok: true, created, skipped };
    } finally {
      this.running = false;
    }
  }

  /** Clic sur un bouton d'une carte. Renvoie le texte à afficher au cliqueur. */
  async handleButton({ customId, userId, updateCard }) {
    const parsed = parseButton(customId);
    if (!parsed) return null;
    if (userId !== this.config.ownerId) {
      await this.store.journal("Superviseur", "clic_refuse", { proposal: parsed.id });
      return "Seul le propriétaire peut décider des propositions des agents.";
    }
    const p = await this.store.decideProposal(parsed.id, parsed.status);
    if (!p) return "Cette proposition a déjà été traitée.";
    await this.store.journal("Superviseur", "decision", { proposal: p.id, status: p.status });

    let note = "";
    if (p.status === "validee" && this.config.githubToken) {
      try {
        const url = await createIssue({
          token: this.config.githubToken,
          repo: this.config.githubRepo,
          proposal: p,
          fetchImpl: this.fetchImpl,
        });
        await this.store.setProposalIssue(p.id, url);
        p.issue_url = url;
        note = ` Ticket GitHub créé : ${url}`;
      } catch (err) {
        this.log.warn?.(`[agents] ticket GitHub impossible : ${err.message}`);
        note = " (Le ticket GitHub n'a pas pu être créé, la décision est quand même enregistrée.)";
      }
    }
    const stillOpen = p.status === "plus_tard";
    await updateCard({ embeds: [proposalEmbed(p)], components: [proposalButtons(p.id, !stillOpen)] });
    return `C'est noté : proposition #${p.id} ${{ validee: "validée", refusee: "refusée", plus_tard: "remise à plus tard" }[p.status]}.${note}`;
  }

  async status() {
    const [paused, spent, pending, lastRun] = await Promise.all([
      this.isPaused(),
      this.store.monthSpendUsd(),
      this.store.pendingProposals(100),
      this.store.getState("last_digest_day", null),
    ]);
    return [
      `**État** : ${paused ? "⏸️ en pause" : "▶️ actifs"}`,
      `**Budget IA du mois** : ${spent.toFixed(2)} $ / ${this.config.monthlyBudgetUsd} $`,
      `**Propositions en attente** : ${pending.length}`,
      `**Dernier résumé** : ${lastRun ?? "jamais"}`,
      `**Salons lus** : ${this.config.readChannelIds.size}`,
    ].join("\n");
  }
}
