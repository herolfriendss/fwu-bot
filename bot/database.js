// Her? V4 — base SQLite locale unique du bot Oracle.
//
// Une seule connexion et une seule transaction pour tous les modules (économie,
// modération, social, cartes, vocal, tickets, jeux). Toutes les tables sont
// indexées par `guild_id` : les données de deux serveurs ne se mélangent jamais.
// Ce fichier ne crée que des tables manquantes ; aucune donnée n’est supprimée.
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dataDir = new URL("./data/", import.meta.url);
mkdirSync(dataDir, { recursive: true, mode: 0o700 });

export const db = new DatabaseSync(new URL("./data/economy.sqlite", import.meta.url).pathname);

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
  CREATE TABLE IF NOT EXISTS moderation_warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL,
    expires_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS moderation_warnings_member_idx ON moderation_warnings(guild_id,user_id,created_at DESC);

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
    channel_id TEXT, notified INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );

  -- Automatisation -----------------------------------------------------------
  CREATE TABLE IF NOT EXISTS automation_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
    content TEXT NOT NULL, interval_minutes INTEGER NOT NULL CHECK(interval_minutes >= 5),
    next_run_at INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS automation_messages_due_idx ON automation_messages(enabled,next_run_at);
`);

// Migration additive de la V3 : la banque PND est ajoutée sans toucher aux soldes.
const walletColumns = db.prepare("PRAGMA table_info(wallets)").all().map((column) => column.name);
if (!walletColumns.includes("bank")) {
  db.exec("ALTER TABLE wallets ADD COLUMN bank INTEGER NOT NULL DEFAULT 0 CHECK(bank >= 0)");
}

// Migrations additives V4 : le canal et l’état de rappel des événements sont
// ajoutés aux bases existantes sans modifier les événements déjà enregistrés.
const eventColumns = db.prepare("PRAGMA table_info(events)").all().map((column) => column.name);
if (!eventColumns.includes("channel_id")) db.exec("ALTER TABLE events ADD COLUMN channel_id TEXT");
if (!eventColumns.includes("notified")) db.exec("ALTER TABLE events ADD COLUMN notified INTEGER NOT NULL DEFAULT 0");

export function transaction(action) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
