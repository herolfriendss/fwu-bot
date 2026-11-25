// Her? V4 — base SQLite locale unique du bot Oracle.
//
// Une seule connexion et une seule transaction pour tous les modules (économie,
// modération, social, cartes, vocal, tickets, jeux). Toutes les tables sont
// indexées par `guild_id` : les données de deux serveurs ne se mélangent jamais.
// Ce fichier ne crée que des tables manquantes ; aucune donnée n’est supprimée.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { DATA_DIR as dataDir } from "./data-dir.js";

// HER_DB_PATH lets integration tests use a disposable database. Production
// keeps the documented bot/data/economy.sqlite location.
const dbPath = process.env["HER_DB_PATH"] || join(dataDir, "economy.sqlite");
mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });

export const db = new DatabaseSync(dbPath);

// Several FWU bots share this file: wait for a concurrent writer instead of
// failing with SQLITE_BUSY. Must be set before the first write below.
db.exec("PRAGMA busy_timeout = 5000;");

// Several bots can start at the same time on the same file and run the same
// additive migration: "check then ALTER" is not atomic across processes. A
// column added by another bot in between is the expected result, not an error.
function addColumnOnce(sql) {
  try {
    db.exec(sql);
  } catch (error) {
    if (!/duplicate column name/i.test(String(error?.message ?? ""))) throw error;
  }
}

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS wallets (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS economy_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
    delta INTEGER NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS economy_ledger_member_idx ON economy_ledger(guild_id,user_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS economy_operations (
    guild_id TEXT NOT NULL, operation_id TEXT NOT NULL, reason TEXT NOT NULL,
    created_at INTEGER NOT NULL, PRIMARY KEY(guild_id,operation_id)
  );
  CREATE TABLE IF NOT EXISTS businesses (
    id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, owner_id TEXT NOT NULL,
    name TEXT NOT NULL, treasury INTEGER NOT NULL DEFAULT 0 CHECK(treasury >= 0),
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    UNIQUE(guild_id,id), UNIQUE(guild_id,name)
  );
  CREATE INDEX IF NOT EXISTS businesses_owner_idx ON businesses(guild_id,owner_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS business_members (
    guild_id TEXT NOT NULL, business_id TEXT NOT NULL, user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner','employee')),
    salary INTEGER NOT NULL DEFAULT 0 CHECK(salary >= 0), joined_at INTEGER NOT NULL,
    PRIMARY KEY(guild_id,business_id,user_id),
    FOREIGN KEY(guild_id,business_id) REFERENCES businesses(guild_id,id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS business_members_business_idx ON business_members(guild_id,business_id,joined_at);
  CREATE TABLE IF NOT EXISTS investments (
    id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
    principal INTEGER NOT NULL CHECK(principal > 0), current_value INTEGER NOT NULL CHECK(current_value >= 0),
    risk_bps INTEGER NOT NULL CHECK(risk_bps BETWEEN 1 AND 1000), seed TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active','closed')),
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, closed_at INTEGER,
    UNIQUE(guild_id,id)
  );
  CREATE INDEX IF NOT EXISTS investments_member_idx ON investments(guild_id,user_id,status,created_at DESC);
  CREATE TABLE IF NOT EXISTS guild_investment_policy (
    guild_id TEXT PRIMARY KEY, default_risk_bps INTEGER NOT NULL DEFAULT 500 CHECK(default_risk_bps BETWEEN 1 AND 1000),
    max_risk_bps INTEGER NOT NULL DEFAULT 1000 CHECK(max_risk_bps BETWEEN 1 AND 1000),
    updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL,
    CHECK(default_risk_bps <= max_risk_bps)
  );
  CREATE TABLE IF NOT EXISTS investment_ticks (
    investment_id TEXT NOT NULL, tick_key TEXT NOT NULL, seed_hash TEXT NOT NULL,
    return_bps INTEGER NOT NULL, before_value INTEGER NOT NULL, after_value INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(investment_id,tick_key),
    FOREIGN KEY(investment_id) REFERENCES investments(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS daily_claims (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, claimed_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS shop_items (
    guild_id TEXT NOT NULL, role_id TEXT NOT NULL, price INTEGER NOT NULL CHECK(price > 0),
    PRIMARY KEY (guild_id, role_id)
  );
  CREATE TABLE IF NOT EXISTS active_blackjack (
    game_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
    bet INTEGER NOT NULL CHECK(bet > 0), player_cards TEXT NOT NULL, dealer_cards TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- Économie V2 ---------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS economy_cooldowns (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, action TEXT NOT NULL, ready_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, action)
  );
  CREATE TABLE IF NOT EXISTS economy_job_profiles (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, job_key TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 1 CHECK(level BETWEEN 1 AND 10),
    experience INTEGER NOT NULL DEFAULT 0 CHECK(experience BETWEEN 0 AND 99),
    updated_at INTEGER NOT NULL, PRIMARY KEY (guild_id,user_id,job_key)
  );
  CREATE TABLE IF NOT EXISTS economy_member_jobs (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, job_key TEXT NOT NULL, changed_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id,user_id)
  );
  CREATE TABLE IF NOT EXISTS economy_daily_missions (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, mission_date TEXT NOT NULL,
    mission_key TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0, target INTEGER NOT NULL,
    reward INTEGER NOT NULL, claimed INTEGER NOT NULL DEFAULT 0 CHECK(claimed IN (0,1)),
    PRIMARY KEY (guild_id,user_id,mission_date,mission_key)
  );
  CREATE INDEX IF NOT EXISTS economy_daily_missions_member_idx ON economy_daily_missions(guild_id,user_id,mission_date);
  CREATE TABLE IF NOT EXISTS economy_contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL,
    creator_id TEXT NOT NULL, claimant_id TEXT, title TEXT NOT NULL,
    description TEXT NOT NULL, submission TEXT, reward INTEGER NOT NULL CHECK(reward > 0),
    status TEXT NOT NULL CHECK(status IN ('open','claimed','submitted','completed','cancelled')),
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS economy_contracts_guild_status_idx ON economy_contracts(guild_id,status,id DESC);
  CREATE INDEX IF NOT EXISTS economy_contracts_claimant_idx ON economy_contracts(guild_id,claimant_id,status);
  CREATE TABLE IF NOT EXISTS economy_market_listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL,
    seller_id TEXT NOT NULL, role_id TEXT NOT NULL, price INTEGER NOT NULL CHECK(price > 0),
    status TEXT NOT NULL CHECK(status IN ('open','pending','sold','cancelled','failed')),
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS economy_market_open_idx ON economy_market_listings(guild_id,status,id DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS economy_market_seller_role_open_idx
    ON economy_market_listings(guild_id,seller_id,role_id) WHERE status IN ('open','pending');
  CREATE TABLE IF NOT EXISTS economy_auctions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL,
    seller_id TEXT NOT NULL, role_id TEXT NOT NULL, start_price INTEGER NOT NULL CHECK(start_price > 0),
    highest_bid INTEGER NOT NULL DEFAULT 0 CHECK(highest_bid >= 0), highest_bidder_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('open','pending','sold','expired','cancelled','failed')),
    ends_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS economy_auctions_due_idx ON economy_auctions(status,ends_at);
  CREATE INDEX IF NOT EXISTS economy_auctions_guild_idx ON economy_auctions(guild_id,status,id DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS economy_auctions_seller_role_open_idx
    ON economy_auctions(guild_id,seller_id,role_id) WHERE status IN ('open','pending');
  CREATE TABLE IF NOT EXISTS lottery_draws (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL,
    pot INTEGER NOT NULL, winner_id TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS lottery_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
    draw_id INTEGER, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS lottery_tickets_guild_idx ON lottery_tickets(guild_id, draw_id);

  -- Modération ---------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS verification_challenges (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, answer_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS verification_challenges_expiry_idx ON verification_challenges(expires_at);
  CREATE TABLE IF NOT EXISTS moderation_warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL,
    expires_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS moderation_warnings_member_idx ON moderation_warnings(guild_id,user_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS moderation_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL,
    details_json TEXT, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS moderation_cases_member_idx ON moderation_cases(guild_id,user_id,id DESC);
  CREATE TABLE IF NOT EXISTS moderation_appeals (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, case_id INTEGER NOT NULL UNIQUE,
    appellant_id TEXT NOT NULL, body TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected')),
    submitted_at INTEGER NOT NULL, reviewed_by TEXT, reviewed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS moderation_appeals_member_idx ON moderation_appeals(guild_id,appellant_id,status,id DESC);

  -- Guardian P2 : signaux comportementaux agrégés et file de revue humaine.
  -- Aucun contenu de message, URL ou pièce jointe n'est conservé.
  CREATE TABLE IF NOT EXISTS guardian_risk_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
    event_key TEXT NOT NULL, signal TEXT NOT NULL CHECK(signal IN ('mention_flood','link_flood','rapid_messages')),
    observed INTEGER NOT NULL CHECK(observed BETWEEN 1 AND 100), occurred_at INTEGER NOT NULL,
    UNIQUE(guild_id,event_key,signal)
  );
  CREATE INDEX IF NOT EXISTS guardian_risk_member_idx
    ON guardian_risk_signals(guild_id,user_id,occurred_at DESC);
  CREATE TABLE IF NOT EXISTS guardian_review_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
    score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100), severity TEXT NOT NULL CHECK(severity IN ('review','high')),
    status TEXT NOT NULL CHECK(status IN ('pending','reviewed','cleared')),
    signals_json TEXT NOT NULL, first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
    reviewed_by TEXT, reviewed_at INTEGER, review_note TEXT
  );
  CREATE INDEX IF NOT EXISTS guardian_review_pending_idx
    ON guardian_review_queue(guild_id,status,score DESC,last_seen_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS guardian_review_one_pending_per_member_idx
    ON guardian_review_queue(guild_id,user_id) WHERE status='pending';

  -- Social -------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS profiles (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '',
    color TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS reputation (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, giver_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL, reason TEXT, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS reputation_receiver_idx ON reputation(guild_id,receiver_id,created_at DESC);

  -- Cartes -------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS user_cards (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, card_id TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0), acquired_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, card_id)
  );
  CREATE TABLE IF NOT EXISTS card_trades (
    trade_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
    offer_card_id TEXT NOT NULL, request_card_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS card_trades_target_idx ON card_trades(guild_id,to_id,status);

  -- Vocal V2 -----------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS temp_voice (
    channel_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL
  );

  -- Staff / tickets ----------------------------------------------------------
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL, subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
    claimed_by TEXT, created_at INTEGER NOT NULL, closed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS tickets_guild_status_idx ON tickets(guild_id,status,created_at DESC);
  CREATE TABLE IF NOT EXISTS sysplus_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, actor_id TEXT NOT NULL,
    action TEXT NOT NULL, target_id TEXT, details TEXT, created_at INTEGER NOT NULL
  );

  -- Hiérarchie du staff : un responsable direct par membre et par serveur.
  CREATE TABLE IF NOT EXISTS staff_supervisors (
    guild_id TEXT NOT NULL, staff_user_id TEXT NOT NULL, supervisor_user_id TEXT NOT NULL,
    updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, staff_user_id),
    CHECK (staff_user_id <> supervisor_user_id)
  );
  CREATE INDEX IF NOT EXISTS staff_supervisors_supervisor_idx
    ON staff_supervisors(guild_id, supervisor_user_id);

  -- Her? V5 permissions / vocal moderation ----------------------------------
  CREATE TABLE IF NOT EXISTS guild_permission_roles (
    guild_id TEXT PRIMARY KEY, admin_plus_role_id TEXT, updated_by TEXT, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_plus_scope_permissions (
    guild_id TEXT NOT NULL, scope TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
    updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (guild_id,scope)
  );
  -- 1942 Anti-Move individuel : protection par membre et exceptions d’acteurs.
  CREATE TABLE IF NOT EXISTS anti_move_config (
    guild_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS anti_move_protected_members (
    guild_id TEXT NOT NULL, member_id TEXT NOT NULL, protected_by TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY(guild_id,member_id)
  );
  CREATE INDEX IF NOT EXISTS anti_move_protected_guild_idx
    ON anti_move_protected_members(guild_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS anti_move_exemptions (
    guild_id TEXT NOT NULL, member_id TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY(guild_id,member_id)
  );
  CREATE INDEX IF NOT EXISTS anti_move_exemptions_guild_idx
    ON anti_move_exemptions(guild_id,created_at DESC);

  CREATE TABLE IF NOT EXISTS voice_panels (
    panel_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
    created_by TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS voice_panels_channel_idx ON voice_panels(guild_id,channel_id);
  CREATE TABLE IF NOT EXISTS voice_menottes (
    guild_id TEXT NOT NULL, member_id TEXT NOT NULL, channel_id TEXT NOT NULL,
    owner_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER,
    PRIMARY KEY (guild_id, member_id)
  );
  CREATE INDEX IF NOT EXISTS voice_menottes_channel_idx ON voice_menottes(guild_id,channel_id);
  CREATE TABLE IF NOT EXISTS protected_nicknames (
    guild_id TEXT NOT NULL, member_id TEXT NOT NULL, nickname TEXT,
    owner_id TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, member_id)
  );
  CREATE INDEX IF NOT EXISTS protected_nicknames_guild_idx ON protected_nicknames(guild_id,created_at DESC);

  CREATE TABLE IF NOT EXISTS waouf_config (
    guild_id TEXT PRIMARY KEY, channel_ids TEXT NOT NULL DEFAULT '[]', phrases TEXT NOT NULL DEFAULT '[]',
    duration_minutes INTEGER NOT NULL DEFAULT 10, repeat_after INTEGER NOT NULL DEFAULT 3,
    cooldown_seconds INTEGER NOT NULL DEFAULT 15, updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS waouf_active (
    guild_id TEXT NOT NULL, member_id TEXT NOT NULL, started_by TEXT NOT NULL,
    started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, deleted_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id,member_id)
  );
  CREATE INDEX IF NOT EXISTS waouf_active_expiry_idx ON waouf_active(guild_id,expires_at);

  -- Jeux / événements --------------------------------------------------------
  CREATE TABLE IF NOT EXISTS giveaways (
    giveaway_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
    message_id TEXT, prize TEXT NOT NULL, host_id TEXT NOT NULL, ends_at INTEGER NOT NULL,
    winner_count INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS giveaways_due_idx ON giveaways(status,ends_at);
  CREATE TABLE IF NOT EXISTS giveaway_entries (
    giveaway_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (giveaway_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '', starts_at INTEGER NOT NULL, host_id TEXT NOT NULL,
    channel_id TEXT, notified INTEGER NOT NULL DEFAULT 0, cancelled_at INTEGER, created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS event_signups (
    guild_id TEXT NOT NULL, event_id INTEGER NOT NULL, user_id TEXT NOT NULL,
    signed_up_at INTEGER NOT NULL, PRIMARY KEY(guild_id,event_id,user_id)
  );
  CREATE INDEX IF NOT EXISTS event_signups_event_idx ON event_signups(guild_id,event_id,signed_up_at);
  CREATE TABLE IF NOT EXISTS academy_tracks (
    track_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, title TEXT NOT NULL,
    steps_json TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
    UNIQUE(guild_id,track_id)
  );
  CREATE TABLE IF NOT EXISTS academy_progress (
    guild_id TEXT NOT NULL, track_id TEXT NOT NULL, user_id TEXT NOT NULL,
    completed_steps_json TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL,
    PRIMARY KEY(guild_id,track_id,user_id),
    FOREIGN KEY(guild_id,track_id) REFERENCES academy_tracks(guild_id,track_id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS award_campaigns (
    campaign_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, title TEXT NOT NULL,
    options_json TEXT NOT NULL, ends_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open'
      CHECK(status IN ('open','closed','cancelled')),
    created_by TEXT NOT NULL, created_at INTEGER NOT NULL, closed_at INTEGER, results_json TEXT,
    UNIQUE(guild_id,campaign_id)
  );
  CREATE TABLE IF NOT EXISTS award_votes (
    guild_id TEXT NOT NULL, campaign_id TEXT NOT NULL, user_id TEXT NOT NULL,
    option_id TEXT NOT NULL, voted_at INTEGER NOT NULL,
    PRIMARY KEY(guild_id,campaign_id,user_id),
    FOREIGN KEY(guild_id,campaign_id) REFERENCES award_campaigns(guild_id,campaign_id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS stories (
    story_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, author_id TEXT NOT NULL,
    title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft'
      CHECK(status IN ('draft','approved','published')),
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    approved_by TEXT, published_at INTEGER,
    UNIQUE(guild_id,story_id)
  );
  CREATE INDEX IF NOT EXISTS stories_expiry_idx ON stories(guild_id,expires_at);
  CREATE TABLE IF NOT EXISTS recruitment_applications (
    application_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, applicant_id TEXT NOT NULL,
    answers_json TEXT NOT NULL, questions_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','review','accepted','rejected')),
    reviewer_id TEXT, decision_note TEXT, submitted_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    UNIQUE(guild_id,application_id)
  );
  CREATE INDEX IF NOT EXISTS recruitment_review_idx ON recruitment_applications(guild_id,status,submitted_at DESC);
  CREATE TABLE IF NOT EXISTS recruitment_questions (
    guild_id TEXT NOT NULL, position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 10),
    prompt TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY(guild_id,position)
  );
  CREATE TABLE IF NOT EXISTS recruitment_assignments (
    guild_id TEXT NOT NULL, application_id TEXT NOT NULL, assignee_id TEXT NOT NULL,
    assigned_by TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(guild_id,application_id),
    FOREIGN KEY(guild_id,application_id) REFERENCES recruitment_applications(guild_id,application_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS recruitment_assignments_assignee_idx ON recruitment_assignments(guild_id,assignee_id,updated_at DESC);
  CREATE TABLE IF NOT EXISTS recruitment_interviews (
    interview_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, application_id TEXT NOT NULL,
    interviewer_id TEXT NOT NULL, starts_at INTEGER NOT NULL, channel_id TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled')),
    score INTEGER CHECK(score IS NULL OR score BETWEEN 1 AND 5), notes TEXT NOT NULL DEFAULT '',
    reminder_claimed_at INTEGER, reminded_at INTEGER,
    created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    UNIQUE(guild_id,interview_id),
    FOREIGN KEY(guild_id,application_id) REFERENCES recruitment_applications(guild_id,application_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS recruitment_interviews_upcoming_idx ON recruitment_interviews(guild_id,status,starts_at);
  CREATE TABLE IF NOT EXISTS recruitment_interview_reminder_deliveries (
    guild_id TEXT NOT NULL, interview_id TEXT NOT NULL, recipient_id TEXT NOT NULL, delivered_at INTEGER NOT NULL,
    PRIMARY KEY(guild_id,interview_id,recipient_id),
    FOREIGN KEY(guild_id,interview_id) REFERENCES recruitment_interviews(guild_id,interview_id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS analytics_daily (
    guild_id TEXT NOT NULL, day_key TEXT NOT NULL, metric TEXT NOT NULL,
    metric_value INTEGER NOT NULL DEFAULT 0 CHECK(metric_value >= 0), updated_at INTEGER NOT NULL,
    PRIMARY KEY(guild_id,day_key,metric)
  );

  -- Automatisation -----------------------------------------------------------
  CREATE TABLE IF NOT EXISTS live_alert_seen (
    guild_id TEXT NOT NULL, creator_id TEXT NOT NULL, item_id TEXT NOT NULL,
    seen_at INTEGER NOT NULL, PRIMARY KEY (guild_id, creator_id, item_id)
  );
  CREATE INDEX IF NOT EXISTS live_alert_seen_cleanup_idx ON live_alert_seen(seen_at);

  -- Préférences de consentement mémoire IA par membre et par serveur.
  CREATE TABLE IF NOT EXISTS ai_memory_consent (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    updated_at INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id)
  );

  -- Webhooks : tokens chiffrés par WEBHOOK_ENCRYPTION_KEY, jamais stockés en clair.
  CREATE TABLE IF NOT EXISTS managed_webhooks (
    id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
    name TEXT NOT NULL, encrypted_token TEXT NOT NULL, created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL, last_message_id TEXT,
    animation_enabled INTEGER NOT NULL DEFAULT 1 CHECK(animation_enabled IN (0,1))
  );
  CREATE INDEX IF NOT EXISTS managed_webhooks_guild_idx ON managed_webhooks(guild_id,created_at DESC);

  CREATE TABLE IF NOT EXISTS automation_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
    content TEXT NOT NULL, interval_minutes INTEGER NOT NULL CHECK(interval_minutes >= 5),
    next_run_at INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS automation_messages_due_idx ON automation_messages(enabled,next_run_at);

  CREATE TABLE IF NOT EXISTS automation_rules (
    rule_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, name TEXT NOT NULL,
    trigger_type TEXT NOT NULL CHECK(trigger_type IN ('member_join','member_leave','message_created','voice_join','voice_leave','scheduled')),
    conditions_json TEXT NOT NULL, actions_json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
    created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    UNIQUE(guild_id,rule_id)
  );
  CREATE INDEX IF NOT EXISTS automation_rules_active_idx ON automation_rules(guild_id,enabled,trigger_type);
  CREATE TABLE IF NOT EXISTS automation_runs (
    run_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, rule_id TEXT NOT NULL,
    event_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('skipped','previewed','confirmed','executing','executed','failed')),
    requires_confirmation INTEGER NOT NULL DEFAULT 1 CHECK(requires_confirmation IN (0,1)),
    preview_json TEXT NOT NULL, result_json TEXT, requested_by TEXT,
    confirmed_by TEXT, created_at INTEGER NOT NULL, executed_at INTEGER,
    UNIQUE(guild_id,rule_id,event_id),
    FOREIGN KEY(guild_id,rule_id) REFERENCES automation_rules(guild_id,rule_id)
  );
  CREATE INDEX IF NOT EXISTS automation_runs_history_idx ON automation_runs(guild_id,rule_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS automation_rule_settings (
    guild_id TEXT PRIMARY KEY, approval_channel_id TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL
  );

  -- PND Intelligence : demandes d'actions avec aperçu, approbation et exécution vérifiée.
  CREATE TABLE IF NOT EXISTS pnd_intelligence_actions (
    action_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, requester_id TEXT NOT NULL,
    source_channel_id TEXT NOT NULL, source_message_id TEXT, action_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','processing','executed','cancelled','expired','failed')),
    expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, decided_by TEXT, decided_at INTEGER,
    result_json TEXT
  );
  CREATE INDEX IF NOT EXISTS pnd_intelligence_pending_idx
    ON pnd_intelligence_actions(guild_id,status,expires_at);

  -- PND Voice Access Requests -----------------------------------------------
  CREATE TABLE IF NOT EXISTS voice_private_channels (
    guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'pv', active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY(guild_id, channel_id)
  );
  CREATE INDEX IF NOT EXISTS voice_private_owner_idx ON voice_private_channels(guild_id,owner_user_id,active);
  CREATE TABLE IF NOT EXISTS voice_access_requests (
    request_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
    requester_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','processing','accepted','rejected','blocked','expired','cancelled')),
    request_channel_id TEXT NOT NULL, message_id TEXT,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    decided_by TEXT, decided_at INTEGER, decision_note TEXT
  );
  CREATE INDEX IF NOT EXISTS voice_access_requests_member_idx
    ON voice_access_requests(guild_id,channel_id,requester_id,created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS voice_access_one_pending_idx
    ON voice_access_requests(guild_id,channel_id,requester_id) WHERE status IN ('pending','processing');
  CREATE TABLE IF NOT EXISTS voice_access_blocks (
    guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, user_id TEXT NOT NULL,
    blocked_by TEXT NOT NULL, reason TEXT, created_at INTEGER NOT NULL,
    PRIMARY KEY(guild_id,channel_id,user_id)
  );
  CREATE TABLE IF NOT EXISTS sysplus_incidents (
    incident_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('low','medium','high','critical')),
    status TEXT NOT NULL CHECK(status IN ('open','in_progress','resolved')),
    created_by TEXT NOT NULL, assigned_to TEXT, resolved_by TEXT, resolution TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, resolved_at INTEGER,
    UNIQUE(guild_id,incident_id)
  );
  CREATE INDEX IF NOT EXISTS sysplus_incidents_status_idx ON sysplus_incidents(guild_id,status,severity,updated_at DESC);
  CREATE TABLE IF NOT EXISTS sysplus_commandbooks (
    book_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, name TEXT NOT NULL,
    description TEXT NOT NULL, body TEXT NOT NULL, created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    UNIQUE(guild_id, name)
  );
  CREATE INDEX IF NOT EXISTS sysplus_commandbooks_recent_idx ON sysplus_commandbooks(guild_id,updated_at DESC);
  CREATE TABLE IF NOT EXISTS guild_blueprints (
    blueprint_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, name TEXT NOT NULL,
    snapshot_json TEXT NOT NULL, checksum TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
    UNIQUE(guild_id,blueprint_id)
  );
  CREATE INDEX IF NOT EXISTS guild_blueprints_recent_idx ON guild_blueprints(guild_id,created_at DESC);
  -- Entitlements: manual grants by the two configured PND owners, per guild and pack.
  CREATE TABLE IF NOT EXISTS guild_entitlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, pack_key TEXT NOT NULL,
    granted_by TEXT NOT NULL, granted_at INTEGER NOT NULL, expires_at INTEGER,
    revoked_by TEXT, revoked_at INTEGER, note TEXT
  );
  CREATE INDEX IF NOT EXISTS guild_entitlements_lookup_idx ON guild_entitlements(guild_id,pack_key);
  -- Creator Studio: drafts of announcements, stories and events, with review state.
  CREATE TABLE IF NOT EXISTS creator_drafts (
    draft_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, kind TEXT NOT NULL,
    title TEXT NOT NULL, body TEXT NOT NULL, payload_json TEXT NOT NULL,
    status TEXT NOT NULL, author_id TEXT NOT NULL, reviewer_id TEXT, review_note TEXT,
    channel_id TEXT, scheduled_at INTEGER, published_message_id TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS creator_drafts_guild_idx ON creator_drafts(guild_id,updated_at DESC);
  CREATE INDEX IF NOT EXISTS creator_drafts_due_idx ON creator_drafts(status,scheduled_at);
  CREATE TABLE IF NOT EXISTS creator_templates (
    template_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
    payload_json TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
    UNIQUE(guild_id,name)
  );
  CREATE TABLE IF NOT EXISTS creator_favorites (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, draft_id TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY(guild_id,user_id,draft_id)
  );
  CREATE TABLE IF NOT EXISTS creator_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, draft_id TEXT NOT NULL,
    actor_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS creator_history_draft_idx ON creator_history(guild_id,draft_id,id);
  -- Marketplace (disabled by default): catalogue, validated versions, per-guild installs.
  CREATE TABLE IF NOT EXISTS market_extensions (
    extension_id TEXT PRIMARY KEY, name TEXT NOT NULL, summary TEXT NOT NULL, publisher TEXT NOT NULL,
    status TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS market_versions (
    extension_id TEXT NOT NULL, version TEXT NOT NULL, manifest_json TEXT NOT NULL,
    manifest_sha256 TEXT NOT NULL, status TEXT NOT NULL, reviewed_by TEXT, created_at INTEGER NOT NULL,
    PRIMARY KEY(extension_id,version)
  );
  CREATE TABLE IF NOT EXISTS market_installs (
    guild_id TEXT NOT NULL, extension_id TEXT NOT NULL, version TEXT NOT NULL,
    previous_version TEXT, status TEXT NOT NULL, granted_permissions_json TEXT NOT NULL,
    installed_by TEXT NOT NULL, installed_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY(guild_id,extension_id)
  );
  -- PV/UNPV : instantané des overwrites d'origine d'un salon privatisé.
  CREATE TABLE IF NOT EXISTS voice_lock_snapshots (
    channel_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, owner_id TEXT,
    overwrites_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS voice_lock_snapshots_guild_idx ON voice_lock_snapshots(guild_id);
  CREATE TABLE IF NOT EXISTS guild_invite_snapshots (
    guild_id TEXT NOT NULL, code TEXT NOT NULL, uses INTEGER NOT NULL DEFAULT 0 CHECK(uses>=0),
    inviter_id TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY(guild_id,code)
  );
  CREATE INDEX IF NOT EXISTS guild_invite_snapshots_updated_idx ON guild_invite_snapshots(guild_id,updated_at);

  -- PND Casino : chaque round est lié à une clé d'idempotence Discord.
  CREATE TABLE IF NOT EXISTS casino_rounds (
    idempotency_key TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
    game TEXT NOT NULL, bet INTEGER NOT NULL CHECK(bet > 0), payout INTEGER NOT NULL CHECK(payout >= 0),
    outcome_json TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS casino_rounds_member_idx
    ON casino_rounds(guild_id,user_id,created_at DESC);
  CREATE INDEX IF NOT EXISTS casino_rounds_guild_idx
    ON casino_rounds(guild_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS casino_controls (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
    self_excluded_until INTEGER,
    daily_wager_limit INTEGER CHECK(daily_wager_limit IS NULL OR daily_wager_limit BETWEEN 1 AND 1000000000),
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY(guild_id,user_id)
  );
  CREATE INDEX IF NOT EXISTS casino_controls_exclusion_idx
    ON casino_controls(self_excluded_until) WHERE self_excluded_until IS NOT NULL;

  -- Audit & présence vocale : aucune donnée audio n'est enregistrée.
  CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, event_key TEXT,
    category TEXT NOT NULL, action TEXT NOT NULL, actor_id TEXT, target_id TEXT,
    channel_id TEXT, details_json TEXT NOT NULL DEFAULT '{}', occurred_at INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'gateway'
  );
  CREATE UNIQUE INDEX IF NOT EXISTS audit_events_event_key_idx
    ON audit_events(guild_id,event_key) WHERE event_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS audit_events_category_idx
    ON audit_events(guild_id,category,occurred_at DESC);
  CREATE TABLE IF NOT EXISTS voice_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
    channel_id TEXT NOT NULL, joined_at INTEGER NOT NULL, left_at INTEGER,
    duration_ms INTEGER, start_precision TEXT NOT NULL DEFAULT 'exact'
      CHECK(start_precision IN ('exact','approximate')),
    end_precision TEXT NOT NULL DEFAULT 'exact' CHECK(end_precision IN ('exact','approximate')),
    end_reason TEXT
  );
  CREATE INDEX IF NOT EXISTS voice_sessions_member_idx
    ON voice_sessions(guild_id,user_id,joined_at DESC);
  CREATE INDEX IF NOT EXISTS voice_sessions_channel_idx
    ON voice_sessions(guild_id,channel_id,joined_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS voice_sessions_one_open_idx
    ON voice_sessions(guild_id,user_id) WHERE left_at IS NULL;
`);

// Migration additive : les menottes existantes restent permanentes jusqu’à
// libération manuelle ; seules les nouvelles peuvent recevoir une échéance.
const menotteColumns = db.prepare("PRAGMA table_info(voice_menottes)").all().map((column) => column.name);
if (!menotteColumns.includes("expires_at")) {
  addColumnOnce("ALTER TABLE voice_menottes ADD COLUMN expires_at INTEGER");
}
db.exec("CREATE INDEX IF NOT EXISTS voice_menottes_expiration_idx ON voice_menottes(expires_at)");

// PND V5: the economy ledger is append-only. Reconciliation must report drift;
// no cleanup job or administrative command may rewrite financial history.
db.exec(`
  CREATE TRIGGER IF NOT EXISTS economy_ledger_no_update
  BEFORE UPDATE ON economy_ledger BEGIN
    SELECT RAISE(ABORT, 'economy_ledger_is_append_only');
  END;
  CREATE TRIGGER IF NOT EXISTS economy_ledger_no_delete
  BEFORE DELETE ON economy_ledger BEGIN
    SELECT RAISE(ABORT, 'economy_ledger_is_append_only');
  END;
`);

// Migration additive PND V5 : la précision de fin des sessions distingue
// les déconnexions observées des fins estimées après une coupure du bot.
const voiceSessionColumns = db.prepare("PRAGMA table_info(voice_sessions)").all().map((column) => column.name);
if (!voiceSessionColumns.includes("end_precision")) {
  addColumnOnce("ALTER TABLE voice_sessions ADD COLUMN end_precision TEXT NOT NULL DEFAULT 'exact' CHECK(end_precision IN ('exact','approximate'))");
}

// Migration additive de la V3 : la banque PND est ajoutée sans toucher aux soldes.
const walletColumns = db.prepare("PRAGMA table_info(wallets)").all().map((column) => column.name);
if (!walletColumns.includes("bank")) {
  addColumnOnce("ALTER TABLE wallets ADD COLUMN bank INTEGER NOT NULL DEFAULT 0 CHECK(bank >= 0)");
}

// Migrations additives V4 : le canal et l’état de rappel des événements sont
// ajoutés aux bases existantes sans modifier les événements déjà enregistrés.
const eventColumns = db.prepare("PRAGMA table_info(events)").all().map((column) => column.name);
if (!eventColumns.includes("channel_id")) addColumnOnce("ALTER TABLE events ADD COLUMN channel_id TEXT");
if (!eventColumns.includes("notified")) addColumnOnce("ALTER TABLE events ADD COLUMN notified INTEGER NOT NULL DEFAULT 0");
const marketColumns = db.prepare("PRAGMA table_info(economy_market_listings)").all().map((column) => column.name);
// Buyer is persisted at claim time so a "pending" purchase can be reconciled after a crash.
if (!marketColumns.includes("buyer_id")) addColumnOnce("ALTER TABLE economy_market_listings ADD COLUMN buyer_id TEXT");
db.exec(`CREATE TABLE IF NOT EXISTS economy_reconciliation_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, kind TEXT NOT NULL, ref_id INTEGER NOT NULL,
  reason TEXT NOT NULL, created_at INTEGER NOT NULL, resolved INTEGER NOT NULL DEFAULT 0,
  UNIQUE(kind, ref_id)
)`);
if (!eventColumns.includes("cancelled_at")) addColumnOnce("ALTER TABLE events ADD COLUMN cancelled_at INTEGER");

const interviewColumns = db.prepare("PRAGMA table_info(recruitment_interviews)").all().map((column) => column.name);
if (!interviewColumns.includes("reminder_claimed_at")) addColumnOnce("ALTER TABLE recruitment_interviews ADD COLUMN reminder_claimed_at INTEGER");
if (!interviewColumns.includes("reminded_at")) addColumnOnce("ALTER TABLE recruitment_interviews ADD COLUMN reminded_at INTEGER");

const recruitmentApplicationColumns = db.prepare("PRAGMA table_info(recruitment_applications)").all().map((column) => column.name);
if (!recruitmentApplicationColumns.includes("questions_json")) addColumnOnce("ALTER TABLE recruitment_applications ADD COLUMN questions_json TEXT NOT NULL DEFAULT '[]'");

// Migration additive Webhooks V5 : active l'animation des publications par défaut.
const webhookColumns = db.prepare("PRAGMA table_info(managed_webhooks)").all().map((column) => column.name);
if (!webhookColumns.includes("animation_enabled")) {
  addColumnOnce("ALTER TABLE managed_webhooks ADD COLUMN animation_enabled INTEGER NOT NULL DEFAULT 1 CHECK(animation_enabled IN (0,1))");
}

let transactionDepth = 0;

/**
 * Exécute une action atomiquement. Les appels imbriqués (par exemple un module
 * qui appelle `grantPnd` dans sa propre transaction) utilisent un SAVEPOINT au
 * lieu d’ouvrir une seconde transaction SQLite, ce qui échouerait avec
 * « cannot start a transaction within a transaction ».
 */
/**
 * Each bot loads a different set of modules, so a table one bot creates may be
 * absent in another process. Readers that span domains check first.
 */
export const tableExists = (name) =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));

export function transaction(action) {
  if (transactionDepth > 0) {
    const savepoint = `her_sp_${transactionDepth}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    transactionDepth++;
    try {
      const result = action();
      db.exec(`RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      db.exec(`ROLLBACK TO ${savepoint}`);
      db.exec(`RELEASE ${savepoint}`);
      throw error;
    } finally {
      transactionDepth--;
    }
  }

  db.exec("BEGIN IMMEDIATE");
  transactionDepth = 1;
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    transactionDepth = 0;
  }
}
