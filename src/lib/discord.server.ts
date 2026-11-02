import { useSession } from "@tanstack/react-start/server";
import { redirect } from "@tanstack/react-router";

export type GateSession = { owner?: boolean };

export const sessionConfig = () => ({
  password: process.env["SESSION_SECRET"]!,
  name: "bot-owner",
  maxAge: 60 * 60 * 24 * 7,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
    path: "/",
    partitioned: true,
  },
});

export async function isOwner() {
  const session = await useSession<GateSession>(sessionConfig());
  return !!session.data.owner;
}

export async function requireOwner() {
  if (!(await isOwner())) throw redirect({ to: "/connexion" });
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
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(
      `${DISCORD_API_URL}/${path.replace(/^\/+/, "")}`,
      { ...init, headers },
    );

    if (res.status === 429 && attempt < 3) {
      let wait = Number(res.headers.get("retry-after")) || 1;
      try {
        const body = (await res.json()) as { retry_after?: number };
        if (body.retry_after) wait = body.retry_after;
      } catch {}
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(wait, 10) * 1000 + 100),
      );
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
        for (const [key, entry] of cache) {
          if (entry.exp <= now) cache.delete(key);
        }
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
  if (typeof v !== "string" || !/^\d{5,25}$/.test(v)) {
    throw new Error("Invalid id");
  }
  return v;
};

export async function discordWrite(
  path: string,
  method: string,
  body?: unknown,
): Promise<void> {
  await discord(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export const invalidateCache = (prefix: string) => {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
};
