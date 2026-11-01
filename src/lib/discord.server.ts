import { useSession } from "@tanstack/react-start/server";
import { redirect } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "node:crypto";

export type GateSession = { owner?: boolean };
export const sessionConfig = () => ({
  password: process.env["SESSION_SECRET"]!,
  name: "bot-owner",
  maxAge: 60 * 60 * 24 * 7,
  cookie: { httpOnly: true, secure: true, sameSite: "none" as const, path: "/", partitioned: true },
});

export async function isOwner() {
  const session = await useSession<GateSession>(sessionConfig());
  return !!session.data.owner;
}

export async function requireOwner() {
  if (!(await isOwner())) throw redirect({ to: "/connexion" });
}

const GATEWAY_URL = "https://connector-gateway.lovable.dev/discord";

export async function discord<T>(path: string, init?: RequestInit): Promise<T> {
  const lovableKey = process.env['LOVABLE_API_KEY'];
  const discordKey = process.env['DISCORD_API_KEY'];
  if (!lovableKey) throw new Error("LOVABLE_API_KEY is not configured");
  if (!discordKey) throw new Error("DISCORD_API_KEY is not configured");
  const isGet = !init?.method || init.method === "GET";
  if (isGet) {
    const hit = cache.get(path);
    if (hit && hit.exp > Date.now()) return hit.value as T;
  }
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${GATEWAY_URL}/${path}`, {
      ...init,
      headers: {
        ...((init?.headers as Record<string, string>) ?? {}),
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": discordKey,
        "Content-Type": "application/json",
      },
    });
    if (res.status === 429 && attempt < 3) {
      // Discord rate limit: wait the requested time, then retry
      let wait = Number(res.headers.get("retry-after")) || 1;
      try {
        const j = (await res.json()) as { retry_after?: number };
        if (j.retry_after) wait = j.retry_after;
      } catch {}
      await new Promise((r) => setTimeout(r, Math.min(wait, 5) * 1000 + 100));
      continue;
    }
    if (!res.ok) {
      await res.text(); // consume the response without logging arbitrary upstream data
      console.error(`Discord request failed [${res.status}]`);
      throw new Error(`Discord request failed (${res.status}).`);
    }
    const value = (await res.json()) as T;
    if (isGet) {
      const now = Date.now();
      if (cache.size >= 500) {
        for (const [key, entry] of cache) if (entry.exp <= now) cache.delete(key);
        while (cache.size >= 500) cache.delete(cache.keys().next().value!);
      }
      cache.set(path, { value, exp: now + 15_000 });
    }
    return value;
  }
}

export const cache = new Map<string, { value: unknown; exp: number }>();

export const snowflake = (v: unknown) => {
  if (typeof v !== "string" || !/^\d{5,25}$/.test(v)) throw new Error("Invalid id");
  return v;
};

// Write helper: Discord answers 204 No Content on many writes, which breaks json().
export async function discordWrite(path: string, method: string, body?: unknown): Promise<void> {
  try {
    await discord(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch (e) {
    if (e instanceof SyntaxError) return;
    throw e;
  }
}

export const invalidateCache = (prefix: string) => {
  for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
};
