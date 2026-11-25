-- FWU — gel d'urgence du staff (idée SYS+ n°1) : quotas de modération à 0 sur les 5 bots.
CREATE TABLE staff_freeze (
  guild_id          TEXT        PRIMARY KEY,
  until             TIMESTAMPTZ NOT NULL,
  reason            TEXT        NOT NULL DEFAULT '',
  created_by        TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_admin_plus JSONB      NOT NULL DEFAULT '[]'::jsonb
);
