// FWU V2 — couche de réponses centrale (les 6 bots).
//
// Une seule fonction décide de la visibilité, du format et de la suppression de chaque
// réponse, au lieu de retoucher les ≈480 réponses des modules. Elle est installée là où
// toutes les réponses passent déjà (index.js : interaction.reply/editReply/followUp/
// deferReply et message.reply des commandes à préfixe).
//
// Niveaux :
//   • normal   → public, toujours en embed (couleur et icône du bot, titre selon le type) ;
//   • sensible → public minimal (« 🚫 @membre est blacklisté »), détails conservés dans un
//                dossier que seul le staff ouvre (bouton « Voir le dossier », réponse privée) ;
//   • erreur   → public, supprimé au bout de 10 s (deleteReply / message du bot supprimé) ;
//   • privé    → secrets, données personnelles, écrans staff internes : éphémère.
// Règle conservée : on édite, on ne poste pas un second message. Une édition qui ne
// contient que du texte n'écrase jamais un panneau existant.
import { randomUUID } from "node:crypto";
import { PermissionFlagsBits as P } from "discord.js";
import { db } from "./database.js";
import { parsePndOwnerId } from "./pnd-owner-policy.js";

export const REFUSAL_DELETE_MS = 10_000;
const DOSSIER_RETENTION_MS = 90 * 24 * 60 * 60_000;

/** Couleur par bot et par type, icône du bot (aucun nom de produit affiché). */
export const BOT_STYLES = Object.freeze({
  fwu: { icon: "🌐", label: "Bot principal", colors: { success: 0x22c55e, refusal: 0xef4444, warning: 0xf59e0b, info: 0x5865f2 } },
  guard: { icon: "🛡️", label: "GUARD", colors: { success: 0x16a34a, refusal: 0xdc2626, warning: 0xea580c, info: 0x64748b } },
  fdpdlavoc: { icon: "🎧", label: "FDPDLAVOC", colors: { success: 0x10b981, refusal: 0xe11d48, warning: 0xf97316, info: 0x8b5cf6 } },
  suckme: { icon: "👑", label: "SUCK ME", colors: { success: 0x22c55e, refusal: 0xef4444, warning: 0xf59e0b, info: 0xeab308 } },
  fisc: { icon: "💰", label: "LE FISC", colors: { success: 0x15803d, refusal: 0xb91c1c, warning: 0xd97706, info: 0x059669 } },
  investplus: { icon: "📈", label: "Invest +", colors: { success: 0x0d9488, refusal: 0xbe123c, warning: 0xca8a04, info: 0x06b6d4 } },
});

export const KIND_TITLES = Object.freeze({
  success: "✅ C'est fait",
  refusal: "⛔ Refusé",
  warning: "⚠️ Attention",
  info: "ℹ️ Information",
});

/** Commandes dont les écrans restent privés (configuration, données internes, anonymat). */
export const PRIVATE_COMMANDS = Object.freeze(new Set([
  "setup", "panel", "outils", "warnings", "casier", "staffhistory", "vocalpresence", "knowledge",
  "automation", "webhook", "investadmin", "maj", "quota", "sanction-type", "embed", "reglement",
  "screening", "ia", "confession", "antinuke", "automod", "guildguard", "bouclier", "sysp",
  "candidature", "rappel", "live", "dmall", "logs", "dossier", "piege", "guide-config", "presence",
]));

/**
 * Actions sensibles : chemin de commande → texte public minimal. Raison, durée, auteur et
 * preuves vont dans les logs du staff et dans le dossier, jamais en public.
 */
export const SENSITIVE_ACTIONS = Object.freeze({
  ban: "🚫 {target} a été banni.",
  kick: "👢 {target} a été expulsé.",
  tempmute: "🔇 {target} est réduit au silence.",
  warn: "⚠️ {target} a reçu un avertissement.",
  "blacklist add": "🚫 {target} est blacklisté.",
  "quarantaine ajouter": "🔒 {target} est en quarantaine.",
  "blr poser": "⛓️ {target} est BLR.",
  "blr lever": "🔓 {target} n'est plus BLR.",
  sanction: "⚖️ {target} a été sanctionné.",
});

const SECRET_PATTERNS = [
  /\b[MNO][A-Za-z\d_-]{23,25}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,}\b/, // jeton de bot Discord
  /\bsk-[A-Za-z0-9_-]{20,}\b/, // clés d'API
  /\bBearer\s+[A-Za-z0-9._-]{16,}\b/i,
  /\bpostgres(?:ql)?:\/\/[^\s]+:[^\s]+@/i,
];

function textOf(payload) {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";
  const parts = [payload.content ?? ""];
  for (const embed of payload.embeds ?? []) {
    const data = typeof embed?.toJSON === "function" ? embed.toJSON() : embed ?? {};
    parts.push(data.title ?? "", data.description ?? "", ...(data.fields ?? []).map((f) => `${f.name} ${f.value}`));
  }
  return parts.join("\n");
}

export function containsSecret(payload) {
  const text = textOf(payload);
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

/** Type d'une réponse d'après son premier marqueur (texte ou titre de l'embed). */
export function detectKind(payload) {
  let head = typeof payload === "string" ? payload : payload?.content;
  if (!head && payload && typeof payload === "object") {
    const first = payload.embeds?.[0];
    const data = typeof first?.toJSON === "function" ? first.toJSON() : first;
    head = data?.title ?? data?.description ?? "";
  }
  const text = String(head ?? "").trim();
  if (/^(⛔|❌|🚫|✖|Erreur\b|Impossible\b|Tu ne peux\b|Accès refusé)/u.test(text)) return "refusal";
  if (/^(⚠️|⚠)/u.test(text)) return "warning";
  if (/^(✅|☑️|✔️|🎉)/u.test(text)) return "success";
  return "info";
}

export function isPlainText(payload) {
  if (typeof payload === "string") return payload.trim().length > 0;
  return Boolean(payload?.content?.trim?.()) && !(payload.embeds?.length) && !(payload.files?.length) && !payload.poll;
}

export function publicSensitiveText(path, targetId) {
  const template = SENSITIVE_ACTIONS[path];
  const target = targetId ? `<@${targetId}>` : "le membre";
  return template ? template.replace("{target}", target) : null;
}

function stripLeadingMarker(text) {
  return String(text).replace(/^(⛔|❌|🚫|✖|⚠️|⚠|✅|☑️|✔️|ℹ️)\s*/u, "");
}

/** Mentions qui doivent réellement notifier quelqu'un (allowedMentions les autorise). */
function pingingMentions(payload) {
  const content = String(payload.content ?? "");
  const allowed = payload.allowedMentions;
  if (!allowed) return content.match(/<@[!&]?\d{17,20}>|@everyone|@here/g) ?? [];
  const users = new Set(allowed.users ?? []);
  const roles = new Set(allowed.roles ?? []);
  const parse = new Set(allowed.parse ?? []);
  return (content.match(/<@[!&]?\d{17,20}>/g) ?? []).filter((mention) => {
    const id = mention.replace(/\D/g, "");
    return mention.startsWith("<@&") ? parse.has("roles") || roles.has(id) : parse.has("users") || users.has(id);
  });
}

function embedFor(style, kind, description) {
  return {
    color: style.colors[kind] ?? style.colors.info,
    author: { name: `${style.icon} ${style.label}` },
    title: KIND_TITLES[kind],
    description: String(description).slice(0, 4096),
  };
}

function saveDossier({ guildId, targetId, path, payload }) {
  const id = randomUUID().replace(/-/g, "").slice(0, 20);
  try {
    const now = Date.now();
    db.prepare("DELETE FROM reply_dossiers WHERE created_at < ?").run(now - DOSSIER_RETENTION_MS);
    const embeds = (payload.embeds ?? []).map((e) => (typeof e?.toJSON === "function" ? e.toJSON() : e));
    const stored = { content: payload.content ?? null, embeds };
    db.prepare("INSERT INTO reply_dossiers (id, guild_id, target_id, path, payload, created_at) VALUES (?,?,?,?,?,?)")
      .run(id, String(guildId ?? ""), targetId ?? null, path, JSON.stringify(stored), now);
    return { id, stored };
  } catch {
    return { id: null, stored: null };
  }
}

db.exec(`CREATE TABLE IF NOT EXISTS reply_dossiers (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  target_id TEXT,
  path TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`);

/**
 * Décision pure (sauf l'enregistrement du dossier sensible).
 * ctx : { bot, commandName, subcommand, surface: "slash" | "component" | "prefix",
 *         initial, previousVisual, targetId, guildId, method }
 * Retourne { payload, level, autoDeleteMs, dossier }.
 */
export function shapeReply(input, ctx = {}) {
  const style = BOT_STYLES[ctx.bot] ?? BOT_STYLES.fwu;
  const payload = typeof input === "string" ? { content: input } : { ...(input ?? {}) };
  const explicit = payload.visibility ?? null;
  delete payload.visibility;
  const path = [ctx.commandName, ctx.subcommand].filter(Boolean).join(" ");
  const kind = detectKind(payload);
  const requestedPrivate = payload.ephemeral === true || (Number(payload.flags ?? 0) & 64) === 64;
  const edit = ctx.initial === false;

  let level;
  if (explicit === "private" || containsSecret(payload) || PRIVATE_COMMANDS.has(ctx.commandName)) level = "private";
  else if (ctx.surface === "component") level = requestedPrivate ? "private" : "normal";
  else if (explicit === "error" || kind === "refusal") level = "error";
  else if (explicit === "sensitive" || ((SENSITIVE_ACTIONS[path] || SENSITIVE_ACTIONS[ctx.commandName]) && kind !== "warning")) level = "sensitive";
  else level = "normal";

  if (level === "private" && ctx.surface !== "prefix") payload.ephemeral = true;
  else if (level !== "private") {
    delete payload.ephemeral;
    if (payload.flags !== undefined) {
      const flags = Number(payload.flags) & ~64;
      if (flags) payload.flags = flags;
      else delete payload.flags;
    }
  }

  let dossier = null;
  if (level === "sensitive") {
    const sensitivePath = SENSITIVE_ACTIONS[path] ? path : ctx.commandName;
    const saved = saveDossier({ guildId: ctx.guildId, targetId: ctx.targetId, path: sensitivePath, payload });
    dossier = saved.stored ?? { content: payload.content ?? null, embeds: payload.embeds ?? [] };
    const minimal = { embeds: [embedFor(style, "success", publicSensitiveText(sensitivePath, ctx.targetId))], allowedMentions: { parse: [] } };
    if (saved.id) {
      minimal.components = [{ type: 1, components: [{ type: 2, style: 2, label: "Voir le dossier", emoji: { name: "📁" }, custom_id: `reply:dossier:${saved.id}` }] }];
    }
    return { payload: minimal, level, autoDeleteMs: 0, dossier };
  }

  // Embed pour tout : un texte seul devient un embed, sauf une édition qui
  // compléterait un panneau existant (le panneau ne doit jamais être écrasé).
  if (isPlainText(payload) && !(edit && ctx.previousVisual)) {
    const pings = pingingMentions(payload);
    const embed = embedFor(style, kind, stripLeadingMarker(payload.content));
    payload.embeds = [embed];
    if (pings.length) payload.content = [...new Set(pings)].join(" ");
    else delete payload.content;
  } else if (Array.isArray(payload.embeds)) {
    payload.embeds = payload.embeds.map((embed) => {
      if (typeof embed?.toJSON === "function") {
        const data = embed.toJSON();
        return data.color === undefined ? { ...data, color: style.colors[kind] ?? style.colors.info } : embed;
      }
      return embed && embed.color === undefined ? { ...embed, color: style.colors[kind] ?? style.colors.info } : embed;
    });
  }

  const autoDeleteMs = level === "error" && (!edit || !ctx.previousVisual) ? REFUSAL_DELETE_MS : 0;
  // Bouton « En savoir plus » : activé par le guide des permissions (tâche 5).
  if (level === "error" && learnMore.enabled && learnMore.customId) {
    const row = { type: 1, components: [{ type: 2, style: 2, label: "En savoir plus", emoji: { name: "📘" }, custom_id: learnMore.customId(path) }] };
    payload.components = [...(payload.components ?? []), row];
  }
  return { payload, level, autoDeleteMs, dossier };
}

/** Réglage du bouton « En savoir plus » des refus (le guide l'active). */
export const learnMore = { enabled: false, customId: null };
export function enableLearnMore(customId) {
  learnMore.enabled = true;
  learnMore.customId = customId;
}

function hasVisual(payload) {
  return Boolean(payload && typeof payload === "object" && (payload.embeds?.length || payload.components?.length));
}

function interactionContext(interaction, bot) {
  const options = interaction.options;
  const commandName = interaction.commandName
    ?? interaction.message?.interactionMetadata?.name?.split(" ")[0]
    ?? interaction.message?.interaction?.commandName?.split(" ")[0]
    ?? null;
  const subcommand = [options?.getSubcommandGroup?.(false), options?.getSubcommand?.(false)].filter(Boolean).join(" ") || null;
  let targetId = null;
  try { targetId = options?.getUser?.("membre", false)?.id ?? options?.getUser?.("cible", false)?.id ?? null; } catch { targetId = null; }
  const component = interaction.isMessageComponent?.() || interaction.isModalSubmit?.();
  return { bot, commandName, subcommand, targetId, guildId: interaction.guildId, surface: component ? "component" : "slash" };
}

/**
 * Installe la couche sur une interaction. `transform` (slashifyPayload) est appliqué
 * avant la décision. `schedule` est injectable pour les tests.
 */
export function installReplyLayer(interaction, { bot, transform = (p) => p, schedule = (fn, ms) => setTimeout(fn, ms).unref?.() } = {}) {
  if (!interaction || interaction.__replyLayer) return interaction;
  interaction.__replyLayer = true;
  const base = interactionContext(interaction, bot);
  const state = { previousVisual: false, deferredPrivate: false };
  const wrap = (method, initial) => {
    const original = interaction[method];
    if (typeof original !== "function") return;
    interaction[method] = async (payload, ...rest) => {
      const isInitial = typeof initial === "function" ? initial() : initial;
      const transformed = transform(payload);
      if (method === "update" && interaction.message?.embeds?.length) state.previousVisual = true;
      const shaped = shapeReply(transformed, { ...base, method, initial: isInitial, previousVisual: state.previousVisual });
      if (method === "editReply" || method === "update") {
        delete shaped.payload.ephemeral;
        delete shaped.payload.flags;
      }
      if (method === "followUp" && state.deferredPrivate) shaped.payload.ephemeral = true;
      const result = await original.call(interaction, shaped.payload, ...rest);
      if (hasVisual(shaped.payload)) state.previousVisual = true;
      if (shaped.autoDeleteMs && (method === "reply" || method === "editReply")) {
        schedule(() => interaction.deleteReply?.().catch?.(() => {}), shaped.autoDeleteMs);
      }
      return result;
    };
  };
  const originalDefer = interaction.deferReply;
  if (typeof originalDefer === "function") {
    interaction.deferReply = (options = {}, ...rest) => {
      const opts = { ...(options ?? {}) };
      const privateScreen = PRIVATE_COMMANDS.has(base.commandName) || base.surface === "component";
      if (!privateScreen) { delete opts.ephemeral; if (opts.flags !== undefined) { const f = Number(opts.flags) & ~64; if (f) opts.flags = f; else delete opts.flags; } }
      state.deferredPrivate = Boolean(opts.ephemeral) || (Number(opts.flags ?? 0) & 64) === 64;
      return originalDefer.call(interaction, opts, ...rest);
    };
  }
  wrap("reply", true);
  wrap("editReply", () => !state.previousVisual);
  wrap("followUp", false);
  wrap("update", false);
  return interaction;
}

/** Même couche pour message.reply des commandes à préfixe. */
export function installMessageReplyLayer(message, { bot, commandName = null, subcommand = null, targetId = null, transform = (p) => p, schedule = (fn, ms) => setTimeout(fn, ms).unref?.() } = {}) {
  if (!message || typeof message.reply !== "function" || message.__replyLayer) return message;
  message.__replyLayer = true;
  const original = message.reply;
  message.reply = async (payload, ...rest) => {
    const shaped = shapeReply(transform(payload), { bot, commandName, subcommand, targetId, guildId: message.guild?.id ?? message.guildId, surface: "prefix", initial: true });
    delete shaped.payload.ephemeral;
    const sent = await original.call(message, shaped.payload, ...rest);
    if (shaped.autoDeleteMs && sent?.delete) schedule(() => sent.delete().catch?.(() => {}), shaped.autoDeleteMs);
    return sent;
  };
  return message;
}

/** Staff autorisé à ouvrir un dossier : OWNER, propriétaire, modérateurs Discord, SYS+/ADMIN+. */
export function canOpenDossier(member, { settings = null, guildOwnerId = null, env = process.env } = {}) {
  if (!member?.id) return false;
  const owner = parsePndOwnerId(env.PND_OWNER_DISCORD_ID);
  if (member.id === owner || member.id === guildOwnerId) return true;
  try {
    if ([P.Administrator, P.ModerateMembers, P.BanMembers, P.KickMembers].some((bit) => member.permissions?.has?.(bit))) return true;
  } catch { /* permissions illisibles : pas d'accès */ }
  const roles = [settings?.sysPlus?.roleId, settings?.adminPlus?.roleId].filter(Boolean);
  return roles.some((roleId) => member.roles?.cache?.has?.(roleId));
}

/** Bouton « Voir le dossier » : réponse privée, staff seulement. */
export async function handleDossierButton(interaction, { settings = null } = {}) {
  if (!interaction?.isButton?.() || !String(interaction.customId ?? "").startsWith("reply:dossier:")) return false;
  const id = interaction.customId.slice("reply:dossier:".length);
  if (!canOpenDossier(interaction.member, { settings, guildOwnerId: interaction.guild?.ownerId })) {
    await interaction.reply({ embeds: [embedFor(BOT_STYLES.fwu, "refusal", "Ce dossier est réservé au staff.")], ephemeral: true }).catch(() => {});
    return true;
  }
  const row = db.prepare("SELECT payload, guild_id FROM reply_dossiers WHERE id = ?").get(id);
  if (!row || (interaction.guildId && row.guild_id && row.guild_id !== String(interaction.guildId))) {
    await interaction.reply({ embeds: [embedFor(BOT_STYLES.fwu, "warning", "Dossier introuvable ou expiré.")], ephemeral: true }).catch(() => {});
    return true;
  }
  const stored = JSON.parse(row.payload);
  const embeds = stored.embeds?.length ? stored.embeds : [embedFor(BOT_STYLES.fwu, "info", stored.content ?? "—")];
  await interaction.reply({ ...(stored.embeds?.length && stored.content ? { content: stored.content } : {}), embeds, ephemeral: true, allowedMentions: { parse: [] } }).catch(() => {});
  return true;
}
