-- FWU — index pour la purge quotidienne des journaux (proposition n°10).
CREATE INDEX IF NOT EXISTS quota_usage_used_at_idx ON quota_usage (used_at);
CREATE INDEX IF NOT EXISTS command_usage_created_at_idx ON command_usage (created_at);
