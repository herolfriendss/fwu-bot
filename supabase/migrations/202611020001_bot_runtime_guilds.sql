ALTER TABLE public.bot_runtime_status
ADD COLUMN IF NOT EXISTS guilds jsonb NOT NULL DEFAULT '[]'::jsonb;
