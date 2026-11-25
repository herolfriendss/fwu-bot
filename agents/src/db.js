import pg from "pg";
import { EXCERPT_RETENTION_DAYS } from "./privacy.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_daily_stats (
  day date NOT NULL, channel_id text NOT NULL,
  messages integer NOT NULL DEFAULT 0, authors integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, channel_id));
CREATE TABLE IF NOT EXISTS agent_command_usage (
  day date NOT NULL, bot text NOT NULL, command text NOT NULL,
  uses integer NOT NULL DEFAULT 0, errors integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, bot, command));
CREATE TABLE IF NOT EXISTS agent_member_flow (
  day date PRIMARY KEY, joins integer NOT NULL DEFAULT 0, leaves integer NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS agent_excerpts (
  id bigserial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
  day date NOT NULL, channel_id text NOT NULL, kind text NOT NULL,
  author_hash text, content text NOT NULL);
CREATE INDEX IF NOT EXISTS agent_excerpts_created ON agent_excerpts (created_at);
CREATE TABLE IF NOT EXISTS agent_proposals (
  id bigserial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
  agent text NOT NULL, kind text NOT NULL, title text NOT NULL, details jsonb NOT NULL,
  dedup_key text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'en_attente',
  decided_at timestamptz, message_id text, issue_url text);
CREATE TABLE IF NOT EXISTS agent_journal (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
  agent text NOT NULL, action text NOT NULL, detail jsonb NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS agent_usage (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
  agent text NOT NULL, model text NOT NULL,
  input_tokens integer NOT NULL, output_tokens integer NOT NULL, cost_usd numeric(10,4) NOT NULL);
CREATE TABLE IF NOT EXISTS agent_state (key text PRIMARY KEY, value jsonb NOT NULL);
`;

export class Store {
  constructor(databaseUrl) {
    this.pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  }

  async migrate() {
    await this.pool.query(SCHEMA);
  }

  async close() {
    await this.pool.end();
  }

  async saveCollected({ messages, commands, flow, excerpts }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const m of messages)
        await client.query(
          `INSERT INTO agent_daily_stats (day, channel_id, messages, authors) VALUES ($1,$2,$3,$4)
           ON CONFLICT (day, channel_id) DO UPDATE SET messages = agent_daily_stats.messages + EXCLUDED.messages,
           authors = GREATEST(agent_daily_stats.authors, EXCLUDED.authors)`,
          [m.day, m.channelId, m.count, m.authors],
        );
      for (const c of commands)
        await client.query(
          `INSERT INTO agent_command_usage (day, bot, command, uses, errors) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (day, bot, command) DO UPDATE SET uses = agent_command_usage.uses + EXCLUDED.uses,
           errors = agent_command_usage.errors + EXCLUDED.errors`,
          [c.day, c.bot, c.command, c.uses, c.errors],
        );
      for (const f of flow)
        await client.query(
          `INSERT INTO agent_member_flow (day, joins, leaves) VALUES ($1,$2,$3)
           ON CONFLICT (day) DO UPDATE SET joins = agent_member_flow.joins + EXCLUDED.joins,
           leaves = agent_member_flow.leaves + EXCLUDED.leaves`,
          [f.day, f.joins, f.leaves],
        );
      for (const e of excerpts)
        await client.query(
          `INSERT INTO agent_excerpts (day, channel_id, kind, author_hash, content) VALUES ($1,$2,$3,$4,$5)`,
          [e.day, e.channelId, e.kind, e.authorHash, e.content],
        );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async purgeOldExcerpts() {
    const r = await this.pool.query(
      `DELETE FROM agent_excerpts WHERE created_at < now() - make_interval(days => $1)`,
      [EXCERPT_RETENTION_DAYS],
    );
    return r.rowCount;
  }

  /** Ce que l'Observateur analyse : les N derniers jours (chiffres) et les extraits récents. */
  async observationWindow(days = 7) {
    const q = (sql) => this.pool.query(sql, [days]).then((r) => r.rows);
    const [channels, commands, flow, excerpts] = await Promise.all([
      q(`SELECT channel_id, SUM(messages)::int AS messages, MAX(authors)::int AS max_authors_per_day,
           COUNT(*)::int AS active_days
         FROM agent_daily_stats WHERE day > current_date - $1::int GROUP BY channel_id ORDER BY messages DESC`),
      q(`SELECT bot, command, SUM(uses)::int AS uses, SUM(errors)::int AS errors
         FROM agent_command_usage WHERE day > current_date - $1::int GROUP BY bot, command ORDER BY uses DESC LIMIT 60`),
      q(`SELECT day::text, joins, leaves FROM agent_member_flow WHERE day > current_date - $1::int ORDER BY day`),
      q(`SELECT day::text, channel_id, kind, author_hash, content FROM agent_excerpts
         WHERE day > current_date - $1::int ORDER BY created_at DESC LIMIT 300`),
    ]);
    return { channels, commands, flow, excerpts };
  }

  async recentProposalTitles(days = 30) {
    const r = await this.pool.query(
      `SELECT title, status FROM agent_proposals WHERE created_at > now() - make_interval(days => $1)
       ORDER BY created_at DESC LIMIT 60`,
      [days],
    );
    return r.rows;
  }

  /** Enregistre une proposition ; renvoie null si un doublon existe déjà. */
  async insertProposal({ agent, kind, title, details, dedupKey }) {
    const r = await this.pool.query(
      `INSERT INTO agent_proposals (agent, kind, title, details, dedup_key) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (dedup_key) DO NOTHING RETURNING id`,
      [agent, kind, title, details, dedupKey],
    );
    return r.rows[0]?.id ?? null;
  }

  async setProposalMessage(id, messageId) {
    await this.pool.query(`UPDATE agent_proposals SET message_id = $2 WHERE id = $1`, [id, messageId]);
  }

  async getProposal(id) {
    const r = await this.pool.query(`SELECT * FROM agent_proposals WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }

  /** Change le statut seulement si la proposition attend encore une décision. */
  async decideProposal(id, status) {
    const r = await this.pool.query(
      `UPDATE agent_proposals SET status = $2, decided_at = now()
       WHERE id = $1 AND status IN ('en_attente', 'plus_tard') RETURNING *`,
      [id, status],
    );
    return r.rows[0] ?? null;
  }

  async setProposalIssue(id, url) {
    await this.pool.query(`UPDATE agent_proposals SET issue_url = $2 WHERE id = $1`, [id, url]);
  }

  async pendingProposals(limit = 15) {
    const r = await this.pool.query(
      `SELECT id, kind, title, status, created_at FROM agent_proposals
       WHERE status IN ('en_attente', 'plus_tard') ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return r.rows;
  }

  async journal(agent, action, detail = {}) {
    await this.pool.query(`INSERT INTO agent_journal (agent, action, detail) VALUES ($1,$2,$3)`, [agent, action, detail]);
  }

  async recordUsage({ agent, model, inputTokens, outputTokens, costUsd }) {
    await this.pool.query(
      `INSERT INTO agent_usage (agent, model, input_tokens, output_tokens, cost_usd) VALUES ($1,$2,$3,$4,$5)`,
      [agent, model, inputTokens, outputTokens, costUsd],
    );
  }

  async monthSpendUsd() {
    const r = await this.pool.query(
      `SELECT COALESCE(SUM(cost_usd), 0)::float AS total FROM agent_usage
       WHERE at >= date_trunc('month', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'`,
    );
    return r.rows[0].total;
  }

  async getState(key, fallback = null) {
    const r = await this.pool.query(`SELECT value FROM agent_state WHERE key = $1`, [key]);
    return r.rows[0] ? r.rows[0].value : fallback;
  }

  async setState(key, value) {
    await this.pool.query(
      `INSERT INTO agent_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value)],
    );
  }
}
