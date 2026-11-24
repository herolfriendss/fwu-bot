// SUCK ME — /roletemp (temporary roles), /annonce (now or scheduled), /staff (ladder, promotions, absences), /pseudo.
import { EmbedBuilder, PermissionFlagsBits as P } from "discord.js";
import { db } from "../database.js";
import { parsePndOwnerId } from "../pnd-owner-policy.js";
import { isSysPlus } from "../systems/sysplus/permissions.js";
import { parseDuration } from "./community.js";

export const SUCKME_COMMANDS = new Set(["roletemp", "annonce", "staff", "pseudo"]);
const DANGEROUS = [P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels, P.BanMembers, P.KickMembers, P.ManageWebhooks];

db.exec(`
  CREATE TABLE IF NOT EXISTS suckme_temp_roles (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL, expires_at INTEGER NOT NULL, given_by TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id, role_id)
  );
  CREATE INDEX IF NOT EXISTS suckme_temp_roles_due_idx ON suckme_temp_roles(expires_at);
  CREATE TABLE IF NOT EXISTS suckme_announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, title TEXT, body TEXT NOT NULL,
    color INTEGER, role_id TEXT, author_id TEXT NOT NULL, due_at INTEGER NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS suckme_staff_ladder (guild_id TEXT PRIMARY KEY, roles_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS suckme_staff_absences (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT, until_at INTEGER, created_at INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id)
  );
`);

const ownerId = () => parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);
const fullAccess = (member) => member?.id === ownerId() || member?.id === member?.guild?.ownerId;
const allowed = (member, settings) => fullAccess(member) || isSysPlus(member, settings?.sysPlus?.roleId ?? null);

/** Pure: may `actor` hand out / take `role`? */
export function roleGrantRefusal({ role, actorPosition, botPosition, actorFull, guildId }) {
  if (!role || role.id === guildId || role.managed) return "Ce rôle ne peut pas être attribué.";
  if (role.position >= botPosition) return "Ce rôle est au-dessus de mon rôle : place mon rôle plus haut.";
  if (!actorFull && role.position >= actorPosition) return "Tu ne peux gérer que des rôles placés sous ton rôle le plus élevé.";
  if (!actorFull && DANGEROUS.some((flag) => role.permissions?.has?.(flag))) return "Seul l'OWNER peut donner un rôle avec des permissions de modération.";
  return null;
}

async function context(interaction) {
  const guild = interaction.guild;
  const me = guild.members.me ?? await guild.members.fetchMe();
  const actor = await guild.members.fetch({ user: interaction.user.id }).catch(() => interaction.member);
  return { guild, me, actor, actorFull: fullAccess(actor) };
}

// ---------------------------------------------------------------- Temporary roles
async function roletemp(interaction, settings) {
  if (!allowed(interaction.member, settings)) return "⛔ Réservé aux SYS+ et à l'OWNER.";
  const sub = interaction.options.getSubcommand();
  const { guild, me, actor, actorFull } = await context(interaction);
  if (sub === "liste") {
    const rows = db.prepare("SELECT user_id, role_id, expires_at FROM suckme_temp_roles WHERE guild_id=? ORDER BY expires_at LIMIT 25").all(guild.id);
    return `⏳ **Rôles temporaires**\n${rows.map((r) => `• <@${r.user_id}> — <@&${r.role_id}> jusqu'à <t:${Math.floor(r.expires_at / 1000)}:R>`).join("\n") || "Aucun."}`;
  }
  const user = interaction.options.getUser("membre", true);
  const role = interaction.options.getRole("role", true);
  const member = await guild.members.fetch({ user: user.id }).catch(() => null);
  if (!member) return "❌ Ce membre n'est pas sur le serveur.";
  const refusal = roleGrantRefusal({ role, actorPosition: actor.roles.highest.position, botPosition: me.roles.highest.position, actorFull, guildId: guild.id });
  if (refusal) return `❌ ${refusal}`;
  if (sub === "donner") {
    const ms = parseDuration(interaction.options.getString("duree", true));
    if (!ms) return "❌ Durée invalide : `30m`, `12h`, `7j`… (1 minute à 365 jours).";
    const expires = Date.now() + ms;
    await member.roles.add(role, `Rôle temporaire donné par ${interaction.user.id}`);
    db.prepare("INSERT INTO suckme_temp_roles(guild_id,user_id,role_id,expires_at,given_by) VALUES(?,?,?,?,?) ON CONFLICT(guild_id,user_id,role_id) DO UPDATE SET expires_at=excluded.expires_at, given_by=excluded.given_by")
      .run(guild.id, user.id, role.id, expires, interaction.user.id);
    return `✅ <@&${role.id}> donné à <@${user.id}> jusqu'à <t:${Math.floor(expires / 1000)}:F>.`;
  }
  await member.roles.remove(role, `Rôle temporaire retiré par ${interaction.user.id}`).catch(() => {});
  db.prepare("DELETE FROM suckme_temp_roles WHERE guild_id=? AND user_id=? AND role_id=?").run(guild.id, user.id, role.id);
  return `✅ <@&${role.id}> retiré à <@${user.id}>.`;
}

/** Every minute: remove expired temporary roles. */
export async function runTempRoles(client, now = Date.now()) {
  const due = db.prepare("SELECT * FROM suckme_temp_roles WHERE expires_at <= ? LIMIT 100").all(now);
  for (const row of due) {
    db.prepare("DELETE FROM suckme_temp_roles WHERE guild_id=? AND user_id=? AND role_id=?").run(row.guild_id, row.user_id, row.role_id);
    const guild = client.guilds.cache.get(row.guild_id);
    const member = guild ? await guild.members.fetch({ user: row.user_id }).catch(() => null) : null;
    if (member?.roles?.cache?.has(row.role_id)) await member.roles.remove(row.role_id, "Fin du rôle temporaire").catch(() => {});
  }
  return due.length;
}

// ---------------------------------------------------------------- Announcements
function announcementPayload(row) {
  const embed = new EmbedBuilder().setColor(row.color ?? 0x6d28d9).setDescription(row.body.slice(0, 4000)).setTimestamp(new Date());
  if (row.title) embed.setTitle(row.title.slice(0, 256));
  return { content: row.role_id ? `<@&${row.role_id}>` : undefined, embeds: [embed], allowedMentions: { roles: row.role_id ? [row.role_id] : [] } };
}

async function annonce(interaction, settings) {
  if (!allowed(interaction.member, settings)) return "⛔ Réservé aux SYS+ et à l'OWNER.";
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  if (sub === "liste") {
    const rows = db.prepare("SELECT id, channel_id, title, due_at FROM suckme_announcements WHERE guild_id=? ORDER BY due_at").all(guild.id);
    return `📣 **Annonces programmées**\n${rows.map((r) => `• #${r.id} <#${r.channel_id}> <t:${Math.floor(r.due_at / 1000)}:R> — ${r.title ?? "(sans titre)"}`).join("\n") || "Aucune."}`;
  }
  if (sub === "annuler") {
    const result = db.prepare("DELETE FROM suckme_announcements WHERE id=? AND guild_id=?").run(interaction.options.getInteger("id", true), guild.id);
    return Number(result.changes) ? "🗑️ Annonce annulée." : "❌ Annonce introuvable.";
  }
  const o = interaction.options;
  const channel = o.getChannel("salon", true);
  const colorText = o.getString("couleur");
  if (colorText && !/^#[\da-f]{6}$/i.test(colorText)) return "❌ Couleur au format #RRGGBB.";
  const role = o.getRole("mention");
  if (role && role.id === guild.id) return "❌ Pour la sécurité, pas de mention @everyone : choisis un rôle.";
  const delayText = o.getString("dans");
  const delay = delayText ? parseDuration(delayText) : 0;
  if (delayText && !delay) return "❌ Délai invalide : `30m`, `2h`, `1j`…";
  const row = { guild_id: guild.id, channel_id: channel.id, title: o.getString("titre"), body: o.getString("message", true).replace(/\\n/g, "\n"), color: colorText ? Number.parseInt(colorText.slice(1), 16) : null, role_id: role?.id ?? null };
  if (!delay) {
    await channel.send(announcementPayload(row));
    return `📣 Annonce publiée dans <#${channel.id}>.`;
  }
  const due = Date.now() + delay;
  const info = db.prepare("INSERT INTO suckme_announcements(guild_id,channel_id,title,body,color,role_id,author_id,due_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(row.guild_id, row.channel_id, row.title, row.body, row.color, row.role_id, interaction.user.id, due, Date.now());
  return `🗓️ Annonce **#${info.lastInsertRowid}** programmée <t:${Math.floor(due / 1000)}:R> dans <#${channel.id}>.`;
}

export async function runAnnouncements(client, now = Date.now()) {
  const due = db.prepare("SELECT * FROM suckme_announcements WHERE due_at <= ? LIMIT 20").all(now);
  for (const row of due) {
    db.prepare("DELETE FROM suckme_announcements WHERE id=?").run(row.id);
    const channel = await client.channels.fetch(row.channel_id).catch(() => null);
    if (channel?.isTextBased?.()) await channel.send(announcementPayload(row)).catch(() => {});
  }
  return due.length;
}

// ---------------------------------------------------------------- Staff
export function ladderOf(guildId) {
  try { return JSON.parse(db.prepare("SELECT roles_json FROM suckme_staff_ladder WHERE guild_id=?").get(guildId)?.roles_json ?? "[]"); } catch { return []; }
}
/** Pure: next ladder step for a member's role ids. dir = +1 (promote) or -1 (demote). */
export function ladderStep(ladder, memberRoleIds, dir) {
  const current = ladder.reduce((best, id, index) => (memberRoleIds.includes(id) ? index : best), -1);
  const next = current + dir;
  if (dir > 0 && next >= ladder.length) return { error: "Ce membre est déjà au sommet de l'échelle." };
  if (dir < 0 && current < 0) return { error: "Ce membre n'est pas dans l'échelle du staff." };
  return { add: next >= 0 ? ladder[next] : null, remove: current >= 0 ? ladder[current] : null };
}

async function staff(interaction, settings) {
  const sub = interaction.options.getSubcommand();
  const { guild, me, actor, actorFull } = await context(interaction);
  if (sub === "absence") {
    const until = interaction.options.getString("duree") ? parseDuration(interaction.options.getString("duree")) : null;
    db.prepare("INSERT INTO suckme_staff_absences(guild_id,user_id,reason,until_at,created_at) VALUES(?,?,?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET reason=excluded.reason, until_at=excluded.until_at, created_at=excluded.created_at")
      .run(guild.id, interaction.user.id, interaction.options.getString("raison") ?? null, until ? Date.now() + until : null, Date.now());
    return `🌙 Absence enregistrée${until ? ` jusqu'à <t:${Math.floor((Date.now() + until) / 1000)}:F>` : ""}. \`/staff retour\` quand tu reviens.`;
  }
  if (sub === "retour") { db.prepare("DELETE FROM suckme_staff_absences WHERE guild_id=? AND user_id=?").run(guild.id, interaction.user.id); return "👋 Bon retour !"; }
  if (sub === "liste") {
    const ladder = ladderOf(guild.id);
    const absences = new Map(db.prepare("SELECT user_id, reason, until_at FROM suckme_staff_absences WHERE guild_id=? AND (until_at IS NULL OR until_at > ?)").all(guild.id, Date.now()).map((a) => [a.user_id, a]));
    await guild.members.fetch().catch(() => null);
    const lines = [...ladder].reverse().map((roleId) => {
      const role = guild.roles.cache.get(roleId);
      if (!role) return null;
      const names = [...role.members.values()].map((m) => `<@${m.id}>${absences.has(m.id) ? " 🌙" : ""}`);
      return `**${role.name}** (${names.length}) : ${names.join(", ") || "—"}`;
    }).filter(Boolean);
    return { public: true, content: `👥 **Staff**\n${lines.join("\n") || "Aucune échelle : `/staff echelle`."}\n🌙 = absent` };
  }
  if (!allowed(interaction.member, settings)) return "⛔ Réservé aux SYS+ et à l'OWNER.";
  if (sub === "echelle") {
    const roles = [1, 2, 3, 4, 5, 6].map((n) => interaction.options.getRole(`role${n}`)).filter(Boolean);
    for (const role of roles) {
      const refusal = roleGrantRefusal({ role, actorPosition: actor.roles.highest.position, botPosition: me.roles.highest.position, actorFull: true, guildId: guild.id });
      if (refusal) return `❌ ${role.name} : ${refusal}`;
    }
    const sorted = [...new Set(roles.map((r) => r.id))].sort((a, b) => guild.roles.cache.get(a).position - guild.roles.cache.get(b).position);
    db.prepare("INSERT INTO suckme_staff_ladder(guild_id,roles_json) VALUES(?,?) ON CONFLICT(guild_id) DO UPDATE SET roles_json=excluded.roles_json").run(guild.id, JSON.stringify(sorted));
    return `✅ Échelle du staff (du plus bas au plus haut) : ${sorted.map((id) => `<@&${id}>`).join(" → ")}`;
  }
  const user = interaction.options.getUser("membre", true);
  const member = await guild.members.fetch({ user: user.id }).catch(() => null);
  if (!member) return "❌ Ce membre n'est pas sur le serveur.";
  const step = ladderStep(ladderOf(guild.id), [...member.roles.cache.keys()], sub === "promouvoir" ? 1 : -1);
  if (step.error) return `❌ ${step.error}`;
  if (step.add) {
    const refusal = roleGrantRefusal({ role: guild.roles.cache.get(step.add), actorPosition: actor.roles.highest.position, botPosition: me.roles.highest.position, actorFull, guildId: guild.id });
    if (refusal) return `❌ ${refusal}`;
    await member.roles.add(step.add, `${sub === "promouvoir" ? "Promotion" : "Rétrogradation"} par ${interaction.user.id}`);
  }
  if (step.remove) await member.roles.remove(step.remove, `${sub === "promouvoir" ? "Promotion" : "Rétrogradation"} par ${interaction.user.id}`);
  return sub === "promouvoir" ? `⬆️ <@${user.id}> promu${step.add ? ` : <@&${step.add}>` : ""}.` : `⬇️ <@${user.id}> rétrogradé${step.add ? ` : <@&${step.add}>` : " (retiré du staff)"}.`;
}

// ---------------------------------------------------------------- Nicknames
async function pseudo(interaction, settings) {
  if (!allowed(interaction.member, settings) && !interaction.member?.permissions?.has?.(P.ManageNicknames)) return "⛔ Réservé aux SYS+, à l'OWNER et au staff (Gérer les pseudos).";
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  const user = interaction.options.getUser("membre", true);
  const member = await guild.members.fetch({ user: user.id }).catch(() => null);
  if (!member) return "❌ Ce membre n'est pas sur le serveur.";
  let locked = false;
  try { locked = Boolean(db.prepare("SELECT 1 FROM protected_nicknames WHERE guild_id=? AND member_id=?").get(guild.id, user.id)); } catch { locked = false; }
  if (locked) return "⛔ Ce pseudo est protégé par LOCKNAME : retire d'abord LOCKNAME.";
  const nickname = sub === "changer" ? interaction.options.getString("nom", true).replace(/@(everyone|here)/gi, "").trim().slice(0, 32) : null;
  if (sub === "changer" && nickname.length < 1) return "❌ Pseudo invalide.";
  await member.setNickname(nickname, `Pseudo ${sub === "changer" ? "changé" : "réinitialisé"} par ${interaction.user.id}`);
  return sub === "changer" ? `✅ Pseudo de <@${user.id}> : **${nickname}**.` : `✅ Pseudo de <@${user.id}> réinitialisé.`;
}

export async function handleSuckmeInteraction(interaction, settings = {}) {
  if (!interaction.isChatInputCommand?.() || !SUCKME_COMMANDS.has(interaction.commandName)) return false;
  if (!interaction.guild) { await interaction.reply({ content: "Cette commande s'utilise sur un serveur.", ephemeral: true }); return true; }
  await interaction.deferReply({ ephemeral: !(interaction.commandName === "staff" && interaction.options.getSubcommand(false) === "liste") });
  try {
    const result = await { roletemp, annonce, staff, pseudo }[interaction.commandName](interaction, settings);
    const payload = typeof result === "string" ? { content: result } : { ...result };
    delete payload.public;
    await interaction.editReply({ ...payload, allowedMentions: { parse: [] } });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error instanceof Error ? error.message : "Action impossible."}`, allowedMentions: { parse: [] } }).catch(() => {});
  }
  return true;
}
