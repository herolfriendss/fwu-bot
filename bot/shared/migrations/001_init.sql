-- FWU — base centrale partagée : schéma initial.
-- Toutes les données sont isolées par guild_id. guild_id = '*' désigne une
-- valeur par défaut, utilisée tant qu'un serveur n'a pas sa propre valeur.

-- Paliers de rôles : 0 = owner, 1 = All Access, 5 = Administrateur,
-- 10 = Modérateur, 50 = Modérateur test, 70/80/100 = membres sans modération.
CREATE TABLE role_tiers (
  guild_id    TEXT        NOT NULL,
  role_id     TEXT        NOT NULL,
  tier        SMALLINT    NOT NULL CHECK (tier IN (0, 1, 5, 10, 50, 70, 80, 100)),
  updated_by  TEXT        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, role_id)
);

-- Sanctions prédéfinies de /tempmute (modifiables par les admins).
CREATE TABLE sanction_types (
  id                BIGSERIAL   PRIMARY KEY,
  guild_id          TEXT        NOT NULL,
  name              TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  duration_seconds  INTEGER     NOT NULL CHECK (duration_seconds BETWEEN 60 AND 2419200),
  created_by        TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sanction_types_name_idx ON sanction_types (guild_id, lower(name));

-- Historique complet des sanctions, tous bots confondus.
CREATE TABLE sanctions (
  id                BIGSERIAL   PRIMARY KEY,
  guild_id          TEXT        NOT NULL,
  target_id         TEXT        NOT NULL,
  moderator_id      TEXT        NOT NULL,
  action            TEXT        NOT NULL CHECK (action IN ('tempmute', 'unmute', 'warn', 'kick', 'ban', 'unban', 'blacklist')),
  sanction_type_id  BIGINT      REFERENCES sanction_types(id) ON DELETE SET NULL,
  sanction_label    TEXT,
  reason            TEXT        NOT NULL DEFAULT '',
  duration_seconds  INTEGER,
  bot               TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sanctions_target_idx ON sanctions (guild_id, target_id, created_at DESC);
CREATE INDEX sanctions_moderator_idx ON sanctions (guild_id, moderator_id, created_at DESC);

-- Quotas : max_uses NULL = illimité, 0 = aucun accès.
CREATE TABLE quotas (
  guild_id        TEXT        NOT NULL,
  command         TEXT        NOT NULL CHECK (command ~ '^[a-z][a-z0-9-]{0,31}$'),
  tier            SMALLINT    NOT NULL CHECK (tier IN (1, 5, 10, 50)),
  max_uses        INTEGER     CHECK (max_uses IS NULL OR max_uses >= 0),
  window_seconds  INTEGER     NOT NULL CHECK (window_seconds BETWEEN 60 AND 2592000),
  updated_by      TEXT        NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, command, tier)
);

-- Un enregistrement par usage consommé (fenêtre glissante).
CREATE TABLE quota_usage (
  id        BIGSERIAL   PRIMARY KEY,
  guild_id  TEXT        NOT NULL,
  user_id   TEXT        NOT NULL,
  command   TEXT        NOT NULL,
  bot       TEXT        NOT NULL,
  used_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  refunded  BOOLEAN     NOT NULL DEFAULT false
);
CREATE INDEX quota_usage_window_idx ON quota_usage (guild_id, user_id, command, used_at DESC);

CREATE TABLE quota_exemptions (
  guild_id  TEXT        NOT NULL,
  user_id   TEXT        NOT NULL,
  reason    TEXT        NOT NULL DEFAULT '',
  added_by  TEXT        NOT NULL,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE bot_whitelist (
  guild_id  TEXT        NOT NULL,
  bot_id    TEXT        NOT NULL,
  added_by  TEXT        NOT NULL,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, bot_id)
);

-- Journaux.
CREATE TABLE command_usage (
  id          BIGSERIAL   PRIMARY KEY,
  guild_id    TEXT        NOT NULL,
  user_id     TEXT        NOT NULL,
  bot         TEXT        NOT NULL,
  command     TEXT        NOT NULL,
  target_id   TEXT,
  outcome     TEXT        NOT NULL CHECK (outcome IN ('ok', 'denied', 'quota', 'error', 'unavailable')),
  detail      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX command_usage_guild_idx ON command_usage (guild_id, created_at DESC);
CREATE INDEX command_usage_user_idx ON command_usage (guild_id, user_id, created_at DESC);

CREATE TABLE quota_violations (
  id                   BIGSERIAL   PRIMARY KEY,
  guild_id             TEXT        NOT NULL,
  user_id              TEXT        NOT NULL,
  bot                  TEXT        NOT NULL,
  command              TEXT        NOT NULL,
  tier                 SMALLINT,
  max_uses             INTEGER,
  window_seconds       INTEGER,
  retry_after_seconds  INTEGER,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX quota_violations_guild_idx ON quota_violations (guild_id, created_at DESC);

CREATE TABLE config_changes (
  id          BIGSERIAL   PRIMARY KEY,
  guild_id    TEXT        NOT NULL,
  actor_id    TEXT        NOT NULL,
  bot         TEXT        NOT NULL,
  entity      TEXT        NOT NULL,
  entity_key  TEXT        NOT NULL,
  before      JSONB,
  after       JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX config_changes_guild_idx ON config_changes (guild_id, created_at DESC);

-- Embeds gérés par FWU.
CREATE TABLE embeds (
  id          BIGSERIAL   PRIMARY KEY,
  guild_id    TEXT        NOT NULL,
  name        TEXT        NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  data        JSONB       NOT NULL,
  channel_id  TEXT,
  message_id  TEXT,
  created_by  TEXT        NOT NULL,
  updated_by  TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guild_id, name)
);

-- Règlements générés par l'IA, validés par un admin avant publication.
CREATE TABLE rules_drafts (
  id                    BIGSERIAL   PRIMARY KEY,
  guild_id              TEXT        NOT NULL,
  rules                 JSONB       NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'published', 'rejected')),
  created_by            TEXT        NOT NULL,
  reviewed_by           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at           TIMESTAMPTZ,
  published_channel_id  TEXT,
  published_message_id  TEXT
);
CREATE INDEX rules_drafts_guild_idx ON rules_drafts (guild_id, created_at DESC);

-- Initialisations faites une seule fois par serveur (sanctions par défaut…).
CREATE TABLE guild_bootstrap (
  guild_id  TEXT        NOT NULL,
  key       TEXT        NOT NULL,
  done_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, key)
);

-- Quotas par défaut (fenêtres en secondes : 1800 = 30 min, 86400 = 1 jour).
INSERT INTO quotas (guild_id, command, tier, max_uses, window_seconds, updated_by) VALUES
  ('*', 'tempmute', 50,  2, 1800, 'migration'),
  ('*', 'tempmute', 10,  4, 1800, 'migration'),
  ('*', 'tempmute',  5,  8, 1800, 'migration'),
  ('*', 'tempmute',  1, 15, 1800, 'migration'),
  ('*', 'kick',     50,  1, 86400, 'migration'),
  ('*', 'kick',     10,  2, 86400, 'migration'),
  ('*', 'kick',      5,  4, 86400, 'migration'),
  ('*', 'kick',      1,  8, 86400, 'migration'),
  ('*', 'ban',      50,  0, 86400, 'migration'),
  ('*', 'ban',      10,  1, 86400, 'migration'),
  ('*', 'ban',       5,  2, 86400, 'migration'),
  ('*', 'ban',       1,  4, 86400, 'migration'),
  -- Commandes de modération sans valeur imposée : alignées sur la logique ci-dessus.
  ('*', 'warn',     50,  3, 1800, 'migration'),
  ('*', 'warn',     10,  6, 1800, 'migration'),
  ('*', 'warn',      5, 12, 1800, 'migration'),
  ('*', 'warn',      1, 20, 1800, 'migration'),
  ('*', 'unmute',   50,  4, 1800, 'migration'),
  ('*', 'unmute',   10,  8, 1800, 'migration'),
  ('*', 'unmute',    5, 16, 1800, 'migration'),
  ('*', 'unmute',    1, 30, 1800, 'migration'),
  ('*', 'unban',    50,  0, 86400, 'migration'),
  ('*', 'unban',    10,  1, 86400, 'migration'),
  ('*', 'unban',     5,  2, 86400, 'migration'),
  ('*', 'unban',     1,  4, 86400, 'migration'),
  ('*', 'blacklist', 50, 0, 86400, 'migration'),
  ('*', 'blacklist', 10, 0, 86400, 'migration'),
  ('*', 'blacklist',  5, 1, 86400, 'migration'),
  ('*', 'blacklist',  1, 4, 86400, 'migration'),
  ('*', 'mv',       50,  5, 600, 'migration'),
  ('*', 'mv',       10, 10, 600, 'migration'),
  ('*', 'mv',        5, 20, 600, 'migration'),
  ('*', 'mv',        1, 40, 600, 'migration');
