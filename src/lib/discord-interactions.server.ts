// Server-only logic for Discord interactions (slash commands).
// Called from src/routes/api/public/discord-interactions.ts only.
import nacl from "tweetnacl";
import { discord, discordWrite, invalidateCache } from "./discord.server";
import { SLASH_COMMANDS } from "./slash-commands";
import { findCustomCommand } from "./custom-commands.server";
import { canUseCommand } from "./custom-commands";
import { readRuntimeStatus } from "./bot-status.server";
import { formatRuntimeDuration, slashRuntimeStatus } from "./bot-status";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type InteractionResponse = { type: number; data?: Record<string, unknown> };

type Interaction = {
  type?: number;
  id?: string;
  application_id?: string;
  guild_id?: string;
  channel_id?: string;
  member?: { user?: { id?: string; username?: string }; permissions?: string | number };
  user?: { id?: string; username?: string };
  data?: { id?: string; name?: string; options?: { name: string; value: unknown }[] };
};

const MANAGE_MESSAGES = 1n << 13n;
const EPHEMERAL = 64;

let verifyKeyCache: { key: string; exp: number } | null = null;
let receiptCleanupCounter = 0;

/** Atomically rejects an already processed Discord interaction across instances. */
export async function claimInteraction(id: string): Promise<boolean> {
  if (!/^\d{5,25}$/.test(id)) return false;
  const { error } = await supabaseAdmin.from("discord_interaction_receipts").insert({ interaction_id: id });
  if (error?.code === "23505") return false;
  if (error) throw new Error("Unable to persist Discord interaction receipt");
  if (++receiptCleanupCounter >= 200) {
    receiptCleanupCounter = 0;
    const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    await supabaseAdmin.from("discord_interaction_receipts").delete().lt("created_at", cutoff);
  }
  return true;
}

// The application public key comes straight from the Discord API, so the user never
// has to copy it. DISCORD_INTERACTIONS_PUBLIC_KEY, when set, overrides it.
export async function getVerifyKey(): Promise<string | null> {
  const fromEnv = process.env["DISCORD_INTERACTIONS_PUBLIC_KEY"];
  if (fromEnv) return fromEnv;
  if (verifyKeyCache && verifyKeyCache.exp > Date.now()) return verifyKeyCache.key;
  const app = await discord<{ id: string; verify_key?: string }>("oauth2/applications/@me");
  const key = typeof app.verify_key === "string" ? app.verify_key : "";
  if (!/^[0-9a-f]{64}$/i.test(key)) return null;
  verifyKeyCache = { key, exp: Date.now() + 5 * 60_000 };
  return key;
}

const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

export function verifySignature(publicKey: string, signatureHex: string, timestamp: string, body: string, now = Date.now()): boolean {
  try {
    if (!/^[0-9a-f]{64}$/i.test(publicKey)) return false;
    if (!/^[0-9a-f]{128}$/i.test(signatureHex) || !/^\d{1,12}$/.test(timestamp)) return false;
    const timestampMs = Number(timestamp) * 1000;
    if (!Number.isSafeInteger(timestampMs) || timestampMs > now + 60_000 || now - timestampMs > 5 * 60_000) return false;
    const message = new Uint8Array(new TextEncoder().encode(timestamp + body));
    return nacl.sign.detached.verify(message, hexToBytes(signatureHex), hexToBytes(publicKey));
  } catch {
    return false;
  }
}

const optValue = (i: Interaction, name: string): unknown => i.data?.options?.find((o) => o.name === name)?.value;
const strOpt = (i: Interaction, name: string) => String(optValue(i, name) ?? "").trim();
const ephemeral = (content: string): InteractionResponse => ({ type: 4, data: { content, flags: EPHEMERAL } });
const createdIso = (id: string) => new Date(Number(BigInt(id) >> 22n) + 1420070400000).toISOString();

export async function handleInteraction(raw: unknown): Promise<InteractionResponse> {
  const i = (raw ?? {}) as Interaction;
  if (i.type === 1) return { type: 1 }; // Discord endpoint verification PING
  if (i.type !== 2 || typeof i.data?.name !== "string") return ephemeral("Interaction non gérée.");
  try {
    return await runCommand(i);
  } catch (e) {
    console.error("Interaction failed:", e instanceof Error ? e.message : e);
    return ephemeral("⚠️ Une erreur est survenue côté bot. Réessaie dans un instant.");
  }
}

async function runCommand(i: Interaction): Promise<InteractionResponse> {
  const userId = i.member?.user?.id ?? i.user?.id ?? "";
  switch (i.data?.name) {
    case "aide": {
      const lines = SLASH_COMMANDS.map((c) => `• \`/${c.name}\` — ${c.description}`);
      return ephemeral(`**Commandes du bot**\n${lines.join("\n")}`);
    }
    case "salut": {
      return { type: 4, data: { content: `Salut${userId ? ` <@${userId}>` : ""} ! 👋` } };
    }
    case "sondage":
      return poll(i);
    case "info-serveur":
      return serverInfo(i);
    case "status":
      return botStatus();
    case "nettoyer":
      return clean(i);
    default: {
      if (i.application_id && i.data?.id) {
        const saved = await findCustomCommand(i.application_id, i.data.id);
        if (saved) {
          if (!canUseCommand(saved.permission, i.member?.permissions)) return ephemeral("Tu n’as pas la permission d’utiliser cette commande.");
          return { type: 4, data: { content: saved.response, allowed_mentions: { parse: [] }, ...(saved.ephemeral ? { flags: EPHEMERAL } : {}) } };
        }
      }
      return ephemeral("Commande inconnue : mets à jour les commandes depuis le panneau de configuration.");
    }
  }
}

async function botStatus(): Promise<InteractionResponse> {
  const { state, uptimeSeconds } = slashRuntimeStatus(await readRuntimeStatus());
  return {
    type: 4,
    data: {
      flags: EPHEMERAL,
      embeds: [{
        title: "Statut du bot",
        fields: [
          { name: "État", value: state === "online" ? "Connecté à Discord" : state === "offline" ? "Déconnecté ou signal expiré" : "Inconnu — aucun signal reçu", inline: true },
          { name: "Durée de fonctionnement", value: uptimeSeconds === null ? "Indisponible" : formatRuntimeDuration(uptimeSeconds), inline: true },
        ],
        footer: { text: "Processus Oracle · état d’après le dernier signal du bot" },
      }],
    },
  };
}

function poll(i: Interaction): InteractionResponse {
  const question = strOpt(i, "question");
  const answers = [1, 2, 3, 4, 5].map((n) => strOpt(i, `option_${n}`)).filter(Boolean);
  if (!question || question.length > 300) return ephemeral("Question invalide (1–300 caractères).");
  if (answers.length < 2) return ephemeral("Un sondage demande au moins deux choix.");
  if (answers.some((a) => a.length > 55)) return ephemeral("Chaque choix doit faire 55 caractères au maximum.");
  return {
    type: 4,
    data: {
      poll: {
        question: { text: question },
        answers: answers.map((text) => ({ poll_media: { text } })),
        duration: 24,
        allow_multiselect: false,
        layout_type: 1,
      },
    },
  };
}

async function serverInfo(i: Interaction): Promise<InteractionResponse> {
  if (!i.guild_id) return ephemeral("Cette commande s'utilise dans un serveur.");
  const gid = i.guild_id;
  const [guild, channels, roles] = await Promise.all([
    discord<{ id: string; name: string; icon?: string | null; approximate_member_count?: number; member_count?: number }>(`guilds/${gid}?with_counts=true`),
    discord<{ id: string }[]>(`guilds/${gid}/channels`).catch(() => null),
    discord<{ id: string }[]>(`guilds/${gid}/roles`).catch(() => null),
  ]);
  return {
    type: 4,
    data: {
      embeds: [
        {
          title: guild.name,
          color: 0x5865f2,
          fields: [
            { name: "Membres", value: String(guild.approximate_member_count ?? guild.member_count ?? "—"), inline: true },
            { name: "Salons", value: channels ? String(channels.length) : "—", inline: true },
            { name: "Rôles", value: roles ? String(roles.length) : "—", inline: true },
          ],
          footer: { text: `ID du serveur : ${guild.id}` },
          timestamp: createdIso(guild.id),
          ...(guild.icon ? { thumbnail: { url: `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=256` } } : {}),
        },
      ],
    },
  };
}

async function clean(i: Interaction): Promise<InteractionResponse> {
  if (!i.guild_id || !i.channel_id) return ephemeral("Cette commande s'utilise dans un salon d'un serveur.");
  let perms = 0n;
  try {
    perms = BigInt(String(i.member?.permissions ?? "0") || "0");
  } catch {
    perms = 0n;
  }
  if (!(perms & MANAGE_MESSAGES)) return ephemeral("Il te faut la permission « Gérer les messages » pour utiliser cette commande.");
  const count = Math.max(1, Math.min(100, Math.floor(Number(optValue(i, "nombre")) || 0)));
  const msgs = await discord<{ id: string; timestamp: string }[]>(`channels/${i.channel_id}/messages?limit=${count}`);
  const cutoff = Date.now() - 13.9 * 24 * 3600_000; // Discord refuses bulk delete for messages older than 14 days
  const ids = msgs.filter((m) => new Date(m.timestamp).getTime() > cutoff).map((m) => m.id);
  if (ids.length >= 2) await discordWrite(`channels/${i.channel_id}/messages/bulk-delete`, "POST", { messages: ids });
  else if (ids.length === 1) await discordWrite(`channels/${i.channel_id}/messages/${ids[0]}`, "DELETE");
  invalidateCache(`channels/${i.channel_id}/messages`);
  const skipped = msgs.length - ids.length;
  return ephemeral(`🗑️ ${ids.length} message(s) supprimé(s).${skipped ? ` ${skipped} ignoré(s) : plus de 14 jours.` : ""}`);
}
