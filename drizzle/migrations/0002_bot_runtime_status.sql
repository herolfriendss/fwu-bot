CREATE TABLE public.bot_runtime_status (
 id text PRIMARY KEY,
 connected boolean NOT NULL DEFAULT false,
 last_seen timestamptz NOT NULL DEFAULT now(),
 last_sync timestamptz,
 started_at timestamptz NOT NULL,
 events jsonb NOT NULL DEFAULT '[]'::jsonb
);
GRANT ALL ON public.bot_runtime_status TO service_role;
ALTER TABLE public.bot_runtime_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service only runtime status" ON public.bot_runtime_status FOR ALL TO service_role USING (true) WITH CHECK (true);