// FWU GUARD — automod: links, Discord invites, banned words, excessive caps, flood.
// Each rule has its own action: delete, delete + warning, or delete + timeout.
// Never applies to: the OWNER, the server owner, staff (Manage Messages / Administrator),
// exempt channels and exempt roles. Config: /automod (staff with Manage Server, SYS+, OWNER).
import { PermissionFlagsBits as P } from "discord.js";
import { db } from "../database.js";
import { parsePndOwnerId } from "../pnd-owner-policy.js";

export const AUTOMOD_RULES = Object.freeze({
  liens: "Liens",
  invitations: "Invitations Discord",
  mots: "Mots interdits",
  majuscules: "Majuscules excessives",
  flood: "Flood (messages en rafale)",
});
export const AUTOMOD_ACTIONS = Object.freeze({ supprimer: "Supprimer", avertir: "Supprimer + avertir", exclure: "Supprimer + exclure temporairement" });
const DEFAULT_RULE = { enabled: false, action: "supprimer", minutes: 10 };
export const AUTOMOD_DEFAULTS = Object.freeze({
  rules: { liens: { ...DEFAULT_RULE }, invitations: { ...DEFAULT_RULE, enabled: true }, mots: { ...DEFAULT_RULE }, majuscules: { ...DEFAULT_RULE }, flood: { ...DEFAULT_RULE, enabled: true, action: "exclure", minutes: 5 } },
  words: [],
  exemptChannelIds: [],
  exemptRoleIds: [],
});

db.exec(`CREATE TABLE IF NOT EXISTS automod_config (guild_id TEXT PRIMARY KEY, config_json TEXT NOT NULL, updated_by TEXT, updated_at INTEGER NOT NULL);`);

function normalizeConfig(raw = {}) {
  const rules = {};
  for (const name of Object.keys(AUTOMOD_RULES)) {
    const rule = { ...AUTOMOD_DEFAULTS.rules[name], ...(raw.rules?.[name] ?? {}) };
    rules[name] = {
      enabled: Boolean(rule.enabled),
      action: AUTOMOD_ACTIONS[rule.action] ? rule.action : "supprimer",
      minutes: Math.min(10_080, Math.max(1, Math.trunc(Number(rule.minutes) || 10))),
    };
  }
  const ids = (list) => [...new Set((Array.isArray(list) ? list : []).filter((id) => /^\d{5,25}$/.test(String(id))))].slice(0, 50);
  return {
    rules,
    words: [...new Set((Array.isArray(raw.words) ? raw.words : []).map((w) => normalizeText(w)).filter((w) => w.length >= 2))].slice(0, 200),
    exemptChannelIds: ids(raw.exemptChannelIds),
    exemptRoleIds: ids(raw.exemptRoleIds),
  };
}

export function getAutomodConfig(guildId) {
  const row = db.prepare("SELECT config_json FROM automod_config WHERE guild_id=?").get(guildId);
  try { return normalizeConfig(row ? JSON.parse(row.config_json) : AUTOMOD_DEFAULTS); } catch { return normalizeConfig(AUTOMOD_DEFAULTS); }
}

export function saveAutomodConfig(guildId, config, actorId) {
  const next = normalizeConfig(config);
  db.prepare(`INSERT INTO automod_config(guild_id,config_json,updated_by,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(guild_id) DO UPDATE SET config_json=excluded.config_json, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
    .run(guildId, JSON.stringify(next), actorId ?? null, Date.now());
  return next;
}

export function normalizeText(value) {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const INVITE = /(discord\.gg|discord(?:app)?\.com\/invite|dsc\.gg)\/[a-z0-9-]+/i;
const LINK = /\bhttps?:\/\/\S+|\bwww\.\S+\.\S+/i;

/** Pure detection for content rules. Returns the first rule broken, or null. */
export function detectViolation(content, config) {
  const text = String(content ?? "");
  const { rules } = config;
  if (rules.invitations.enabled && INVITE.test(text)) return "invitations";
  if (rules.liens.enabled && LINK.test(text) && !INVITE.test(text)) return "liens";
  if (rules.mots.enabled && config.words.length) {
    const normalized = ` ${normalizeText(text)} `;
    if (config.words.some((word) => normalized.includes(` ${word} `))) return "mots";
  }
  if (rules.majuscules.enabled) {
    const letters = text.replace(/[^a-zA-ZÀ-ÿ]/g, "");
    if (letters.length >= 10 && letters.replace(/[^A-ZÀ-Þ]/g, "").length / letters.length > 0.7) return "majuscules";
  }
  return null;
}

/** Flood: 5 messages or more in 5 seconds from the same member. */
export function createFloodTracker({ max = 5, windowMs = 5000, now = () => Date.now() } = {}) {
  const seen = new Map();
  return (guildId, userId) => {
    const key = `${guildId}:${userId}`;
    const since = now() - windowMs;
    const list = (seen.get(key) ?? []).filter((at) => at >= since);
    list.push(now());
    seen.set(key, list);
    if (seen.size > 5000) seen.clear();
    return list.length >= max;
  };
}

export function isAutomodExempt(member, channelId, config, sysPlusRoleId = null) {
  if (!member) return true;
  if (member.id === parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID) || member.id === member.guild?.ownerId) return true;
  if (member.permissions?.has?.(P.Administrator) || member.permissions?.has?.(P.ManageMessages)) return true;
  if (sysPlusRoleId && member.roles?.cache?.has?.(sysPlusRoleId)) return true;
  if (config.exemptChannelIds.includes(channelId)) return true;
  return config.exemptRoleIds.some((id) => member.roles?.cache?.has?.(id));
}

/** messageCreate handler for the GUARD process. Returns the rule applied, or null. */
export function createAutomod({ report = async () => {}, record = () => {}, flood = createFloodTracker() } = {}) {
  return async function onMessage(message, guildSettings) {
    if (!message.guild || message.author?.bot || !message.member) return null;
    const config = getAutomodConfig(message.guild.id);
    if (isAutomodExempt(message.member, message.channelId, config, guildSettings?.sysPlus?.roleId ?? null)) return null;
    let rule = detectViolation(message.content, config);
    if (!rule && config.rules.flood.enabled && flood(message.guild.id, message.author.id)) rule = "flood";
    if (!rule) return null;
    const { action, minutes } = config.rules[rule];
    await message.delete().catch(() => {});
    const reason = `Automod : ${AUTOMOD_RULES[rule]}`;
    if (action === "avertir") {
      db.prepare("INSERT INTO moderation_warnings(guild_id,user_id,moderator_id,reason,created_at,expires_at) VALUES(?,?,?,?,?,NULL)")
        .run(message.guild.id, message.author.id, message.client.user?.id ?? "automod", reason, Date.now());
    }
    if (action === "exclure") await message.member.timeout(minutes * 60_000, reason).catch(() => {});
    db.prepare("INSERT INTO moderation_cases(guild_id,user_id,moderator_id,action,reason,details_json,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(message.guild.id, message.author.id, message.client.user?.id ?? "automod", `automod_${action}`, reason, JSON.stringify({ rule, channelId: message.channelId }), Date.now());
    record("automod_action");
    const notice = await message.channel.send({ content: `⚠️ <@${message.author.id}>, message retiré : ${AUTOMOD_RULES[rule].toLowerCase()}.${action === "exclure" ? ` Exclusion de ${minutes} min.` : action === "avertir" ? " Un avertissement a été ajouté." : ""}`, allowedMentions: { users: [message.author.id] } }).catch(() => null);
    if (notice) setTimeout(() => notice.delete().catch(() => {}), 6000).unref?.();
    await report(message.guild, { title: "🧹 Automod", description: `Membre : <@${message.author.id}>\nSalon : <#${message.channelId}>\nRègle : **${AUTOMOD_RULES[rule]}**\nAction : **${AUTOMOD_ACTIONS[action]}**${action === "exclure" ? ` (${minutes} min)` : ""}` }).catch(() => {});
    return rule;
  };
}
