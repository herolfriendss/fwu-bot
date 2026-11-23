import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@tanstack/react-start/server";
import { consumeOAuthState, sessionConfig, type GateSession } from "@/lib/discord.server";

const clearPendingOAuth = async () => {
  const session = await useSession<GateSession>(sessionConfig());
  await session.clear();
};

const redirectToLogin = (reason: string) => new Response(null, {
  status: 303,
  headers: { Location: `/connexion?error=${encodeURIComponent(reason)}`, "Cache-Control": "no-store" },
});

type DiscordToken = { access_token?: string; token_type?: string; expires_in?: number; error?: string };
type DiscordUser = { id?: string; username?: string };

export const Route = createFileRoute("/api/auth/discord/callback")({
  server: { handlers: {
    GET: async ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.has("error")) {
        await clearPendingOAuth();
        return redirectToLogin("discord_denied");
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state || code.length > 2048 || state.length > 256) {
        await clearPendingOAuth();
        return redirectToLogin("invalid_callback");
      }

      const oauthSession = await consumeOAuthState(state);
      if (!oauthSession) return redirectToLogin("invalid_state");
      const verifier = oauthSession.verifier;
      const clientId = process.env["DISCORD_CLIENT_ID"];
      const clientSecret = process.env["DISCORD_CLIENT_SECRET"];
      const redirectUri = process.env["DISCORD_OAUTH_REDIRECT_URI"];
      if (!clientId || !clientSecret || !redirectUri) return redirectToLogin("oauth_not_configured");

      try {
        const form = new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          code_verifier: verifier,
        });
        const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: form,
          signal: AbortSignal.timeout(10_000),
        });
        if (!tokenResponse.ok) return redirectToLogin("token_exchange_failed");
        const token = await tokenResponse.json() as DiscordToken;
        if (!token.access_token || token.token_type?.toLowerCase() !== "bearer") return redirectToLogin("invalid_token_response");

        const userResponse = await fetch("https://discord.com/api/v10/users/@me", {
          headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
        if (!userResponse.ok) return redirectToLogin("identity_lookup_failed");
        const user = await userResponse.json() as DiscordUser;
        if (!user.id || !/^\d{5,25}$/.test(user.id)) return redirectToLogin("invalid_identity");
        await oauthSession.establish(user.id);
        return new Response(null, { status: 303, headers: { Location: "/", "Cache-Control": "no-store" } });
      } catch (error) {
        console.error("Discord OAuth callback failed:", error instanceof Error ? error.message : "unknown error");
        return redirectToLogin("oauth_failed");
      }
    },
  } },
});
