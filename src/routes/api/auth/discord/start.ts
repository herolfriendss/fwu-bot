import { createFileRoute } from "@tanstack/react-router";
import { createHash, randomBytes } from "node:crypto";
import { useSession } from "@tanstack/react-start/server";
import { configuredPndOwners, sessionConfig, type GateSession } from "@/lib/discord.server";

const noStore = { "Cache-Control": "no-store", Pragma: "no-cache" };

export const Route = createFileRoute("/api/auth/discord/start")({
  server: { handlers: {
    GET: async () => {
      const clientId = process.env["DISCORD_CLIENT_ID"];
      const redirectUri = process.env["DISCORD_OAUTH_REDIRECT_URI"];
      if (!clientId || !redirectUri || configuredPndOwners().length !== 2) {
        return Response.json({ error: "Discord OAuth or the two PND owners are not configured." }, { status: 503, headers: noStore });
      }
      let callback: URL;
      try { callback = new URL(redirectUri); } catch {
        return Response.json({ error: "DISCORD_OAUTH_REDIRECT_URI is invalid." }, { status: 503, headers: noStore });
      }
      if (callback.protocol !== "https:" && callback.hostname !== "localhost") {
        return Response.json({ error: "OAuth redirect URI must use HTTPS." }, { status: 503, headers: noStore });
      }
      const state = randomBytes(32).toString("base64url");
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const session = await useSession<GateSession>(sessionConfig());
      await session.update({ oauth: { state, verifier, expiresAt: Date.now() + 10 * 60_000 } });
      const url = new URL("https://discord.com/oauth2/authorize");
      url.search = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: "identify",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        prompt: "none",
      }).toString();
      return new Response(null, { status: 302, headers: { ...noStore, Location: url.toString() } });
    },
  } },
});
