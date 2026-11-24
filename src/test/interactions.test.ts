import { describe, expect, it, vi } from "vitest";
import nacl from "tweetnacl";

const mocks = vi.hoisted(() => ({ discord: vi.fn(), discordWrite: vi.fn(), invalidateCache: vi.fn() }));
const runtime = vi.hoisted(() => ({ readRuntimeStatus: vi.fn() }));
vi.mock("@/lib/bot-status.server", () => runtime);
vi.mock("@/lib/discord.server", () => ({ discord: mocks.discord, discordWrite: mocks.discordWrite, invalidateCache: mocks.invalidateCache }));
import { getVerifyKey, handleInteraction, verifySignature } from "@/lib/discord-interactions.server";
import { SLASH_COMMANDS, toDiscordCommand } from "@/lib/slash-commands";

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const command = (name: string, options?: { name: string; value: unknown }[]) => ({
  type: 2,
  guild_id: "123456789012345678",
  channel_id: "223456789012345678",
  member: { user: { id: "998877665544332211", username: "ryan" }, permissions: "8192" },
  data: { name, options },
});

describe("interaction signature", () => {
  const keypair = nacl.sign.keyPair();
  const publicKey = toHex(keypair.publicKey);

  it("accepts a valid Ed25519 signature over timestamp + body", () => {
    const body = JSON.stringify({ type: 1 });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = toHex(nacl.sign.detached(new Uint8Array(new TextEncoder().encode(timestamp + body)), keypair.secretKey));
    expect(verifySignature(publicKey, sig, timestamp, body)).toBe(true);
  });
  it("rejects a tampered body, a bad key and malformed inputs", () => {
    const body = JSON.stringify({ type: 1 });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = toHex(nacl.sign.detached(new Uint8Array(new TextEncoder().encode(timestamp + body)), keypair.secretKey));
    expect(verifySignature(publicKey, sig, timestamp, body + " ")).toBe(false);
    expect(verifySignature("ab".repeat(32), sig, "1700000000", body)).toBe(false);
    expect(verifySignature(publicKey, "ff".repeat(128), timestamp, body)).toBe(false);
    expect(verifySignature(publicKey, "zz", timestamp, body)).toBe(false);
    expect(verifySignature(publicKey, sig, "abc", body)).toBe(false);
  });
  it("rejects expired and excessively future-dated signatures", () => {
    const now = Date.now();
    const body = JSON.stringify({ type: 1 });
    const expiredTimestamp = String(Math.floor((now - 5 * 60_000 - 1) / 1000));
    const futureTimestamp = String(Math.ceil((now + 60_001) / 1000));
    for (const timestamp of [expiredTimestamp, futureTimestamp]) {
      const sig = toHex(nacl.sign.detached(new Uint8Array(new TextEncoder().encode(timestamp + body)), keypair.secretKey));
      expect(verifySignature(publicKey, sig, timestamp, body, now)).toBe(false);
    }
  });
  it("reads the application public key from the Discord API and caches it", async () => {
    mocks.discord.mockResolvedValue({ id: "1565224187973341327", verify_key: publicKey });
    expect(await getVerifyKey()).toBe(publicKey);
    expect(await getVerifyKey()).toBe(publicKey);
    expect(mocks.discord).toHaveBeenCalledTimes(1);
  });
});

describe("slash command definitions", () => {
  it("strips panel-only fields for the Discord API", () => {
    const clean = toDiscordCommand(SLASH_COMMANDS.find((c) => c.name === "nettoyer")!);
    expect(clean).toEqual({
      name: "nettoyer",
      description: "Supprime les derniers messages de ce salon",
      type: 1,
      default_member_permissions: "8192",
      dm_permission: false,
      options: [{ type: 4, name: "nombre", description: "Nombre de messages à supprimer (1–100)", required: true, min_value: 1, max_value: 100 }],
    });
  });
});

describe("interaction dispatch", () => {
  it("dispatches /status using Oracle telemetry without exposing events", async () => {
    const startedAt = new Date(Date.now() - 90061_000).toISOString();
    runtime.readRuntimeStatus.mockResolvedValue({ connected: true, startedAt, lastSeen: new Date().toISOString(), lastSync: null, events: [{ code: "sync_ok", at: startedAt }] });
    const r = await handleInteraction(command("status"));
    expect(runtime.readRuntimeStatus).toHaveBeenCalled();
    expect(r.type).toBe(4);
    expect(r.data?.["flags"]).toBe(64);
    expect(r.data?.["embeds"]).toEqual([expect.objectContaining({ fields: [
      { name: "État", value: "Connecté à Discord", inline: true },
      // A slow machine may take a few seconds between the two dates.
      { name: "Durée de fonctionnement", value: expect.stringMatching(/^1 j 1 h 1 min \d+ s$/), inline: true },
    ] })]);
    expect(JSON.stringify(r)).not.toContain("sync_ok");
  });
  it("answers the verification PING", async () => {
    expect(await handleInteraction({ type: 1 })).toEqual({ type: 1 });
  });
  it("lists every registered command in /aide", async () => {
    const r = await handleInteraction(command("aide"));
    for (const c of SLASH_COMMANDS) expect(JSON.stringify(r)).toContain(`/${c.name}`);
  });
  it("greets the member who used /salut", async () => {
    const r = await handleInteraction(command("salut"));
    expect(r.type).toBe(4);
    expect(JSON.stringify(r)).toContain("<@998877665544332211>");
  });
  it("builds a poll with at least two answers", async () => {
    const ok = await handleInteraction(command("sondage", [
      { name: "question", value: "Pizza ce soir ?" },
      { name: "option_1", value: "Oui" },
      { name: "option_2", value: "Non" },
    ]));
    const poll = (ok.data as { poll: { question: { text: string }; answers: unknown[]; duration: number } }).poll;
    expect(poll.question.text).toBe("Pizza ce soir ?");
    expect(poll.answers).toHaveLength(2);
    expect(poll.duration).toBe(24);
  });
  it("refuses a poll with a single answer", async () => {
    const r = await handleInteraction(command("sondage", [{ name: "question", value: "Pizza ?" }, { name: "option_1", value: "Oui" }]));
    expect(JSON.stringify(r)).toContain("au moins deux choix");
  });
  it("rejects /nettoyer without the Manage Messages permission", async () => {
    const r = await handleInteraction({ ...command("nettoyer", [{ name: "nombre", value: 5 }]), member: { user: { id: "1" }, permissions: "0" } });
    expect(JSON.stringify(r)).toContain("Gérer les messages");
    expect(mocks.discord).not.toHaveBeenCalledWith(expect.stringContaining("bulk-delete"));
  });
  it("bulk deletes recent messages and reports skipped ones", async () => {
    const recent = (n: number) => ({ id: String(n), timestamp: new Date().toISOString() });
    mocks.discord.mockResolvedValue([recent(1), recent(2), { id: "3", timestamp: new Date(Date.now() - 20 * 86400_000).toISOString() }]);
    const r = await handleInteraction(command("nettoyer", [{ name: "nombre", value: 3 }]));
    expect(mocks.discordWrite).toHaveBeenCalledWith("channels/223456789012345678/messages/bulk-delete", "POST", { messages: ["1", "2"] });
    expect(JSON.stringify(r)).toContain("2 message(s) supprimé(s)");
    expect(JSON.stringify(r)).toContain("1 ignoré(s)");
    expect(mocks.invalidateCache).toHaveBeenCalledWith("channels/223456789012345678/messages");
  });
  it("needs a guild for /info-serveur", async () => {
    const r = await handleInteraction({ type: 2, data: { name: "info-serveur" } });
    expect(JSON.stringify(r)).toContain("dans un serveur");
  });
  it("reports server info from the Discord API", async () => {
    mocks.discord.mockImplementation(async (path: string) => {
      if (path.includes("with_counts")) return { id: "123456789012345678", name: "Mon serveur", approximate_member_count: 42 };
      if (path.endsWith("/channels")) return [{ id: "1" }, { id: "2" }];
      return [{ id: "1" }];
    });
    const r = await handleInteraction(command("info-serveur"));
    const embed = (r.data as { embeds: { title: string; fields: { name: string; value: string }[] }[] }).embeds[0];
    expect(embed?.title).toBe("Mon serveur");
    expect(embed?.fields.find((f) => f.name === "Membres")?.value).toBe("42");
  });
  it("explains that economy commands need the Oracle gateway bot", async () => {
    const r = await handleInteraction(command("balance", [{ name: "membre", value: "998877665544332211" }]));
    expect(JSON.stringify(r)).toContain("bot Oracle 24/7");
    expect(r.data?.["flags"]).toBe(64);
  });
  it("answers an unknown command with an ephemeral notice", async () => {
    const r = await handleInteraction(command("inconnue"));
    expect(JSON.stringify(r)).toContain("Commande inconnue");
    expect(r.data?.["flags"]).toBe(64);
  });
});
