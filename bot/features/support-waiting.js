// FDPDLAVOC — salle d'attente du support vocal (/attente).
//   Un membre qui entre dans la salle d'attente déclenche une alerte dans le salon du staff (avec le rôle
//   support mentionné) : « Je m'en occupe » prend la demande, puis le staff l'amène avec `;pull @membre`.
//   L'alerte se met à jour quand le membre part ou est pris en charge. Une alerte par membre toutes les 2 min.
import { PermissionFlagsBits as P } from "discord.js";
import { db } from "../database.js";
import { respondInPlaceSafe } from "../interaction-reply.js";

export const WAITING_COMMANDS = new Set(["attente"]);
export const WAITING = Object.freeze({ cooldownMs: 2 * 60_000 });

db.exec(`
  CREATE TABLE IF NOT EXISTS support_waiting_config (guild_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, room_id TEXT NOT NULL, alert_channel_id TEXT NOT NULL, role_id TEXT);
  CREATE TABLE IF NOT EXISTS support_waits (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, room_id TEXT NOT NULL, alert_channel_id TEXT NOT NULL, message_id TEXT, status TEXT NOT NULL DEFAULT 'waiting', handled_by TEXT, created_at INTEGER NOT NULL, closed_at INTEGER);
  CREATE INDEX IF NOT EXISTS support_waits_user_idx ON support_waits(guild_id, user_id, status);
`);

export function waitingConfig(guildId) {
  const row = db.prepare("SELECT * FROM support_waiting_config WHERE guild_id=?").get(guildId);
  return row ? { enabled: Boolean(row.enabled), roomId: row.room_id, alertChannelId: row.alert_channel_id, roleId: row.role_id } : null;
}

export function configureWaiting(guildId, { roomId, alertChannelId, roleId = null }) {
  if (!roomId || !alertChannelId) throw new Error("Choisis la salle d'attente et le salon d'alerte.");
  db.prepare(`INSERT INTO support_waiting_config(guild_id,enabled,room_id,alert_channel_id,role_id) VALUES(?,1,?,?,?)
    ON CONFLICT(guild_id) DO UPDATE SET enabled=1, room_id=excluded.room_id, alert_channel_id=excluded.alert_channel_id, role_id=excluded.role_id`).run(guildId, roomId, alertChannelId, roleId);
  return waitingConfig(guildId);
}

export function disableWaiting(guildId) {
  return Number(db.prepare("UPDATE support_waiting_config SET enabled=0 WHERE guild_id=?").run(guildId).changes) > 0;
}

const waitButtons = (id, disabled = false) => [{ type: 1, components: [{ type: 2, style: 1, label: "Je m'en occupe", emoji: { name: "🙋" }, custom_id: `support:take:${id}`, disabled }] }];
const alertText = (wait, config) => `🎧 <@${wait.user_id}> attend dans <#${wait.room_id}>.${wait.status === "waiting" ? `\nPrends-le avec \`;pull @membre\` depuis ton salon vocal.` : ""}`;

/** voiceStateUpdate : entrée → alerte ; sortie de la salle → alerte mise à jour. */
export async function handleWaitingVoiceState(oldState, newState, now = Date.now()) {
  const guild = newState.guild ?? oldState.guild;
  const member = newState.member ?? oldState.member;
  const config = guild ? waitingConfig(guild.id) : null;
  if (!config?.enabled || !member || member.user?.bot) return null;
  const was = oldState.channelId === config.roomId; const is = newState.channelId === config.roomId;
  if (is && !was) {
    const last = db.prepare("SELECT created_at FROM support_waits WHERE guild_id=? AND user_id=? ORDER BY id DESC LIMIT 1").get(guild.id, member.id);
    if (last && now - last.created_at < WAITING.cooldownMs) return null;
    const info = db.prepare("INSERT INTO support_waits(guild_id,user_id,room_id,alert_channel_id,created_at) VALUES(?,?,?,?,?)").run(guild.id, member.id, config.roomId, config.alertChannelId, now);
    const id = Number(info.lastInsertRowid);
    const channel = guild.channels.cache.get(config.alertChannelId);
    const sent = await channel?.send?.({
      content: `${config.roleId ? `<@&${config.roleId}> ` : ""}${alertText({ user_id: member.id, room_id: config.roomId, status: "waiting" }, config)}`,
      components: waitButtons(id),
      allowedMentions: { roles: config.roleId ? [config.roleId] : [], users: [] },
    }).catch(() => null);
    if (sent) db.prepare("UPDATE support_waits SET message_id=? WHERE id=?").run(sent.id, id);
    return { id, alerted: Boolean(sent) };
  }
  if (was && !is) {
    const wait = db.prepare("SELECT * FROM support_waits WHERE guild_id=? AND user_id=? AND status IN ('waiting','taken') ORDER BY id DESC LIMIT 1").get(guild.id, member.id);
    if (!wait) return null;
    const status = wait.status === "taken" ? "handled" : "left";
    db.prepare("UPDATE support_waits SET status=?, closed_at=? WHERE id=?").run(status, now, wait.id);
    const message = wait.message_id ? await guild.channels.cache.get(wait.alert_channel_id)?.messages?.fetch?.(wait.message_id).catch(() => null) : null;
    await message?.edit?.({ content: status === "handled" ? `✅ <@${wait.user_id}> a été pris en charge par <@${wait.handled_by}>.` : `🚪 <@${wait.user_id}> a quitté la salle d'attente.`, components: waitButtons(wait.id, true), allowedMentions: { parse: [] } }).catch(() => {});
    return { id: wait.id, status };
  }
  return null;
}

/** Bouton « Je m'en occupe » : réservé à ceux qui peuvent déplacer des membres. */
export async function handleWaitingButton(interaction) {
  if (!interaction?.isButton?.() || !String(interaction.customId ?? "").startsWith("support:take:")) return false;
  const id = Number(interaction.customId.split(":")[2]);
  const member = interaction.member;
  if (!(member?.permissions?.has?.(P.MoveMembers) || member?.permissions?.has?.(P.Administrator))) {
    await interaction.reply({ content: "⛔ Il te faut « Déplacer des membres » pour prendre une demande.", ephemeral: true }).catch(() => {});
    return true;
  }
  const taken = db.prepare("UPDATE support_waits SET status='taken', handled_by=? WHERE id=? AND status='waiting'").run(interaction.user.id, id);
  if (!Number(taken.changes)) {
    await interaction.reply({ content: "Cette demande est déjà prise en charge ou terminée.", ephemeral: true }).catch(() => {});
    return true;
  }
  const wait = db.prepare("SELECT * FROM support_waits WHERE id=?").get(id);
  await interaction.update({ content: `🙋 <@${interaction.user.id}> s'occupe de <@${wait.user_id}> (attend dans <#${wait.room_id}>). \`;pull @membre\` pour l'amener.`, components: waitButtons(id, true), allowedMentions: { parse: [] } }).catch(() => {});
  return true;
}

const isAdmin = (member) => Boolean(member?.permissions?.has?.(P.ManageGuild) || member?.permissions?.has?.(P.Administrator) || member?.id === member?.guild?.ownerId);

export async function handleWaitingInteraction(interaction) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== "attente" || !interaction.guild) return false;
  const gid = interaction.guild.id;
  const o = interaction.options;
  try {
    if (!isAdmin(interaction.member)) throw new Error("Réservé aux admins (Gérer le serveur).");
    const sub = o.getSubcommand(false) ?? "etat";
    let content;
    if (sub === "configurer") {
      const config = configureWaiting(gid, { roomId: o.getChannel("salle", true).id, alertChannelId: o.getChannel("alerte", true).id, roleId: o.getRole("role", false)?.id ?? null });
      content = `🎧 Salle d'attente <#${config.roomId}> : alertes dans <#${config.alertChannelId}>${config.roleId ? ` avec <@&${config.roleId}>` : ""}. Il me faut **Envoyer des messages** dans le salon d'alerte.`;
    } else if (sub === "desactiver") {
      content = disableWaiting(gid) ? "🔕 Salle d'attente désactivée." : "La salle d'attente n'était pas configurée.";
    } else {
      const config = waitingConfig(gid);
      content = config ? `🎧 Salle d'attente <#${config.roomId}> · alertes <#${config.alertChannelId}>${config.roleId ? ` · <@&${config.roleId}>` : ""} · ${config.enabled ? "active" : "désactivée"}` : "Aucune salle d'attente configurée (`/attente configurer`).";
    }
    await interaction.reply({ content, ephemeral: true, allowedMentions: { parse: [] } });
  } catch (error) {
    await respondInPlaceSafe(interaction, { content: `❌ ${error.message}`, ephemeral: true });
  }
  return true;
}
