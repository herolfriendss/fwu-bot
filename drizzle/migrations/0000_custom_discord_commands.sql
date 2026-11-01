CREATE TABLE public.discord_custom_commands (
 application_id text NOT NULL,
 command_id text NOT NULL,
 name text NOT NULL,
 description text NOT NULL,
 response text NOT NULL,
 ephemeral boolean NOT NULL DEFAULT false,
 permission text NOT NULL DEFAULT '0',
 PRIMARY KEY (application_id, command_id),
 UNIQUE (application_id, name)
);
GRANT ALL ON public.discord_custom_commands TO service_role;
ALTER TABLE public.discord_custom_commands ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.discord_custom_commands IS 'Server-only command responses; access requires owner cookie or verified Discord interaction signature. No browser Data API policies.';