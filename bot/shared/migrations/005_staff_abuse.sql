-- FWU — alerte d'abus du staff (idée SYS+ n°2) : seuils par serveur et alertes déjà envoyées.
CREATE TABLE staff_abuse_thresholds (
  guild_id       TEXT        PRIMARY KEY,
  burst_count    INTEGER     NOT NULL CHECK (burst_count BETWEEN 2 AND 100),
  burst_minutes  INTEGER     NOT NULL CHECK (burst_minutes BETWEEN 1 AND 1440),
  repeat_count   INTEGER     NOT NULL CHECK (repeat_count BETWEEN 2 AND 50),
  repeat_hours   INTEGER     NOT NULL CHECK (repeat_hours BETWEEN 1 AND 720),
  enabled        BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_by     TEXT        NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Une alerte par membre du staff, par type (et par cible pour "cible répétée"), au plus toutes les 30 min, tous bots confondus.
CREATE TABLE staff_abuse_alerts (
  id            BIGSERIAL   PRIMARY KEY,
  guild_id      TEXT        NOT NULL,
  moderator_id  TEXT        NOT NULL,
  kind          TEXT        NOT NULL CHECK (kind IN ('burst', 'repeat')),
  target_id     TEXT        NOT NULL DEFAULT '',
  count         INTEGER     NOT NULL,
  bot           TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX staff_abuse_alerts_idx ON staff_abuse_alerts (guild_id, moderator_id, kind, target_id, created_at DESC);
