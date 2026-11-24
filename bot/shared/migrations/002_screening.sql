-- FWU — écran d'adhésion : salon, rôle donné après acceptation, message publié.
CREATE TABLE screening_config (
  guild_id         TEXT        PRIMARY KEY,
  channel_id       TEXT        NOT NULL,
  role_id          TEXT        NOT NULL,
  message_id       TEXT,
  rules_draft_id   BIGINT      REFERENCES rules_drafts(id) ON DELETE SET NULL,
  native_synced_at TIMESTAMPTZ,
  updated_by       TEXT        NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Une ligne par acceptation (preuve d'acceptation du règlement).
CREATE TABLE screening_acceptances (
  guild_id        TEXT        NOT NULL,
  user_id         TEXT        NOT NULL,
  rules_draft_id  BIGINT,
  accepted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, user_id)
);
