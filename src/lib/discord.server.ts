import { useSession } from "@tanstack/react-start/server";
import { redirect } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

export type GateSession = {
  ownerDiscordId?: string;
  oauth?: { state: string; verifier: string; expiresAt: number };
};

export const sessionConfig = () => {
  const password = process.env["SESSION_SECRET"];
  if (!password || password.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }
  return {
    password,
    name: "pnd-owner-session",
    maxAge: 60 * 60 * 24 * 7,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      path: "/",
    },
  };
};

export function configuredPndOwners(): string[] {
  const ownerId = process.env["PND_OWNER_DISCORD_ID"]?.trim() ?? "";
  return /^\d{5,25}$/.test(ownerId) ? [ownerId] : [];
}

function constantTimeTextEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function isOwner() {
  const session = await useSession<GateSession>(sessionConfig());
  const actorId = session.data.ownerDiscordId;
  return typeof actorId === "string" && configuredPndOwners().includes(actorId);
}

export async function requireOwner() {
  if (!(await isOwner())) throw redirect({ to: "/connexion" });
}

const consumedOAuthStates = new Map<string, number>();

export async function consumeOAuthState(provided: string) {
  const now = Date.now();
  for (const [state, expiry] of consumedOAuthStates) {
    if (expiry <= now) consumedOAuthStates.delete(state);
  }
  if (consumedOAuthStates.has(provided)) return null;
  const session = await useSession<GateSession>(sessionConfig());
  const pending = session.data.oauth;
  if (!pending || pending.expiresAt < now || !constantTimeTextEqual(pending.state, provided)) {
    return null;
  }
  consumedOAuthStates.set(provided, pending.expiresAt);
  while (consumedOAuthStates.size > 2_000) {
    const oldest = consumedOAuthStates.keys().next().value;
    if (oldest === undefined) break;
    consumedOAuthStates.delete(oldest);
  }
  // Consume the browser's pending state before contacting Discord. A failed
  // exchange must not leave a reusable authorization attempt in the cookie.
  const verifier = pending.verifier;
  await session.clear();
  return {
    verifier,
    establish: async (ownerDiscordId: string) => {
      if (!configuredPndOwners().includes(ownerDiscordId)) throw new Error("Not an authorized PND owner");
      await session.update({ ownerDiscordId });
    },
    clear: async () => session.clear(),
  };
}

const DISCORD_API_URL = "https://discord.com/api/v10";

export const cache = new Map<string, { value: unknown; exp: number }>();

export async function discord<T>(path: string, init?: RequestInit): Promise<T> {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) throw new Error("DISCORD_BOT_TOKEN is not configured");

  const method = init?.method?.toUpperCase() ?? "GET";
  const isGet = method === "GET";
  if (isGet) {
    const hit = cache.get(path);
    if (hit && hit.exp > Date.now()) return hit.value as T;
  }

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bot ${token}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${DISCORD_API_URL}/${path.replace(/^\/+/, "")}`, { ...init, headers });
    if (res.status === 429 && attempt < 3) {
      let wait = Number(res.headers.get("retry-after")) || 1;
      try {
        const body = (await res.json()) as { retry_after?: number };
        if (body.retry_after) wait = body.retry_after;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 10) * 1000 + 100));
      continue;
    }
    if (!res.ok) {
      await res.text();
      console.error(`Discord request failed [${res.status}]`);
      throw new Error(`Discord request failed (${res.status}).`);
    }
    const text = await res.text();
    const value = text ? (JSON.parse(text) as T) : (undefined as T);
    if (isGet) {
      const now = Date.now();
      if (cache.size >= 500) {
        for (const [key, entry] of cache) if (entry.exp <= now) cache.delete(key);
        while (cache.size >= 500) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cache.delete(oldest);
        }
      }
      cache.set(path, { value, exp: now + 15_000 });
    }
    return value;
  }
}

export const snowflake = (v: unknown) => {
  if (typeof v !== "string" || !/^\d{5,25}$/.test(v)) throw new Error("Invalid id");
  return v;
};

export async function discordWrite(path: string, method: string, body?: unknown): Promise<void> {
  await discord(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

export const invalidateCache = (prefix: string) => {
  for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
};
