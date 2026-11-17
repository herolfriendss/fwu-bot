import { MessageFlags } from "discord.js";
import { db } from "../../database.js";
import { isSysPlus } from "./permissions.js";
import { recordSysPlusAudit } from "./audit.js";
import {
  DM_CAMPAIGN_COOLDOWN_MS, DM_CAMPAIGN_DELAY_MS, DM_CAMPAIGN_MAX_RECIPIENTS,
  WAKEUP_HOP_DELAY_MS, WAKEUP_MAX_CHANNELS, WAKEUP_TARGET_COOLDOWN_MS,
  isDmAllOwner, isEligibleWakeupChannel,
} from "./broadcast-policy.js";

const activeWakeups = new Set();
let dmWorkerRunning = false;
let dmWorkerTimer = null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function preference(guildId, userId) {
  return db.prepare("SELECT wakeup_opt_in,dm_opt_in FROM sysplus_member_preferences WHERE guild_id=? AND user_id=?").get(guildId, userId) ?? { wakeup_opt_in: 0, dm_opt_in: 0 };
}

function setPreference(guildId, userId, column, enabled) {
  if (column !== "wakeup_opt_in" && column !== "dm_opt_in") throw new Error("Invalid preference column");
  const sql = "INSERT INTO sysplus_member_preferences(guild_id,user_id," + column + ",updated_at) VALUES(?,?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET " + column + "=excluded." + column + ",updated_at=excluded.updated_at";
  db.prepare(sql).run(guildId, userId, enabled ? 1 : 0, Date.now());
}

function remainingCooldown(lastUsedAt, cooldownMs, now = Date.now()) {
  return Math.max(0, Number(lastUsedAt || 0) + cooldownMs - now);
}

function formatRemaining(ms) {
  const seconds = Math.ceil(ms / 1000);
  return seconds >= 60 ? Math.ceil(seconds / 60) + " min" : seconds + " s";
}

async function handleWakeup(interaction, settings) {
  const guild = interaction.guild;
  const actor = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!isSysPlus(actor, settings?.sysPlus?.roleId ?? null)) {
    await interaction.reply({ content: "⛔ La commande /wakeup est réservée à la SYS+.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const targetUser = interaction.options.getUser("membre", true);
  if (targetUser.bot || targetUser.id === interaction.user.id) {
    await interaction.reply({ content: "❌ Choisis un autre membre humain.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const target = await guild.members.fetch(targetUser.id).catch(() => null);
  if (!target) {
    await interaction.reply({ content: "❌ Ce membre ne semble plus être sur le serveur.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (preference(guild.id, target.id).wakeup_opt_in !== 1) {
    await interaction.reply({ content: "🔒 Ce membre n’a pas activé le réveil volontaire. Il peut utiliser /wakeup-optin.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const lockKey = guild.id + ":" + target.id;
  if (activeWakeups.has(lockKey)) {
    await interaction.reply({ content: "⏳ Un réveil est déjà en cours pour ce membre.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const originalChannel = target.voice.channel;
  const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!originalChannel || !botMember) {
    await interaction.reply({ content: "❌ Le membre doit être connecté à un vocal public et le bot doit être en ligne.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const tempChannelIds = new Set(db.prepare("SELECT channel_id FROM temp_voice WHERE guild_id=?").all(guild.id).map((row) => row.channel_id));
  const eligible = (channel) => isEligibleWakeupChannel(channel, { guildId: guild.id, everyoneRole: guild.roles.everyone, tempChannelIds, targetMember: target, botMember });
  if (!eligible(originalChannel)) {
    await interaction.reply({ content: "🔒 Le membre est dans un vocal privé, temporaire ou non accessible au bot. Aucun déplacement effectué.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const now = Date.now();
  const previous = db.prepare("SELECT last_used_at FROM sysplus_wakeup_cooldowns WHERE guild_id=? AND target_id=?").get(guild.id, target.id);
  const wait = remainingCooldown(previous?.last_used_at, WAKEUP_TARGET_COOLDOWN_MS, now);
  if (wait > 0) {
    await interaction.reply({ content: "⏳ Ce membre a déjà reçu un réveil récemment. Réessaie dans " + formatRemaining(wait) + ".", flags: MessageFlags.Ephemeral });
    return true;
  }
  const channels = [...guild.channels.cache.values()]
    .filter((channel) => eligible(channel) && channel.id !== originalChannel.id)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .slice(0, WAKEUP_MAX_CHANNELS);
  if (!channels.length) {
    await interaction.reply({ content: "Aucun autre vocal public et accessible n’est disponible.", flags: MessageFlags.Ephemeral });
    return true;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  activeWakeups.add(lockKey);
  const targetName = target.displayName || target.user.username;
  const actorName = actor.displayName || actor.user.username;
  try {
    // One direct message only; mentions are deliberately non-pinging.
    await target.send({ content: "@" + targetName + " réveille-toi !! c'est @" + actorName + " qui te le dis !!", allowedMentions: { parse: [] } });
  } catch {
    activeWakeups.delete(lockKey);
    await interaction.editReply("❌ Le membre n’accepte pas les MP du bot. Aucun déplacement vocal n’a été effectué.");
    return true;
  }
  db.prepare("INSERT INTO sysplus_wakeup_cooldowns(guild_id,target_id,last_used_at) VALUES(?,?,?) ON CONFLICT(guild_id,target_id) DO UPDATE SET last_used_at=excluded.last_used_at").run(guild.id, target.id, now);
  let moved = 0;
  let expectedChannelId = originalChannel.id;
  try {
    for (const channel of channels) {
      if (target.voice.channelId !== expectedChannelId) break;
      if (!eligible(channel)) continue;
      await target.voice.setChannel(channel, "Réveil volontaire lancé par " + interaction.user.tag);
      expectedChannelId = channel.id;
      moved += 1;
      await sleep(WAKEUP_HOP_DELAY_MS);
      if (target.voice.channelId !== expectedChannelId) break;
    }
    if (moved > 0 && target.voice.channelId === expectedChannelId) {
      const original = guild.channels.cache.get(originalChannel.id);
      if (original && eligible(original)) await target.voice.setChannel(original, "Fin du réveil volontaire");
    }
    recordSysPlusAudit(guild.id, interaction.user.id, "sysplus.wakeup", target.id, { channelsVisited: moved });
    await interaction.editReply("✅ Réveil terminé pour <@" + target.id + "> : " + moved + " vocal(aux) public(s) parcouru(s). Retour au vocal de départ lorsque possible. Un seul MP a été envoyé.");
  } catch {
    recordSysPlusAudit(guild.id, interaction.user.id, "sysplus.wakeup.partial", target.id, { channelsVisited: moved });
    await interaction.editReply("⚠️ Le parcours s’est arrêté après " + moved + " déplacement(s), probablement à cause d’une permission ou d’un changement vocal. Le bot n’insistera pas.");
  } finally {
    activeWakeups.delete(lockKey);
  }
  return true;
}

async function createDmCampaign(interaction) {
  const guild = interaction.guild;
  if (!isDmAllOwner(interaction.user.id)) {
    await interaction.reply({ content: "⛔ /dm-all est réservé aux propriétaires configurés dans DM_ALL_OWNER_IDS.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const recent = db.prepare("SELECT created_at FROM sysplus_dm_campaigns WHERE guild_id=? ORDER BY id DESC LIMIT 1").get(guild.id);
  const wait = remainingCooldown(recent?.created_at, DM_CAMPAIGN_COOLDOWN_MS);
  if (wait > 0) {
    await interaction.reply({ content: "⏳ Une campagne DM a été créée récemment. Réessaie dans " + formatRemaining(wait) + ".", flags: MessageFlags.Ephemeral });
    return true;
  }
  const message = interaction.options.getString("message", true).trim();
  if (!message || message.length > 1800) {
    await interaction.reply({ content: "Le message doit contenir entre 1 et 1 800 caractères.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const recipients = db.prepare("SELECT user_id FROM sysplus_member_preferences WHERE guild_id=? AND dm_opt_in=1 ORDER BY updated_at ASC").all(guild.id);
  if (!recipients.length) {
    await interaction.reply({ content: "Aucun membre n’est abonné aux annonces privées. Les membres peuvent utiliser /dm-optin.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (recipients.length > DM_CAMPAIGN_MAX_RECIPIENTS) {
    await interaction.reply({ content: "Cette campagne concerne " + recipients.length + " abonnés, au-delà de la limite de sécurité de " + DM_CAMPAIGN_MAX_RECIPIENTS + ". Publie plutôt une annonce dans un salon.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const createdAt = Date.now();
  const result = db.prepare("INSERT INTO sysplus_dm_campaigns(guild_id,actor_id,message,status,total_count,sent_count,failed_count,confirmed_at,created_at,updated_at) VALUES(?,?,?,'pending',?,0,0,NULL,?,?)").run(guild.id, interaction.user.id, message, recipients.length, createdAt, createdAt);
  const campaignId = Number(result.lastInsertRowid);
  const insertRecipient = db.prepare("INSERT OR IGNORE INTO sysplus_dm_campaign_recipients(campaign_id,user_id,status,updated_at) VALUES(?,?,'pending',?)");
  for (const row of recipients) insertRecipient.run(campaignId, row.user_id, createdAt);
  recordSysPlusAudit(guild.id, interaction.user.id, "sysplus.dm_all.start", String(campaignId), { recipients: recipients.length });
  await interaction.reply({ content: "📝 Prévisualisation de la campagne #" + campaignId + " : " + recipients.length + " abonné(s) ciblé(s). Aucun MP n’est encore envoyé. Vérifie le texte, puis lance /dm-all-confirm id:" + campaignId + " pour confirmer. Tu peux annuler avec /dm-all-stop id:" + campaignId + ".", flags: MessageFlags.Ephemeral });
  return true;
}

async function handleDmCampaignControl(interaction, action) {
  if (!isDmAllOwner(interaction.user.id)) {
    await interaction.reply({ content: "⛔ Cette commande est réservée aux propriétaires configurés.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const id = interaction.options.getInteger("id", true);
  if (action === "confirm") {
    const result = db.prepare("UPDATE sysplus_dm_campaigns SET confirmed_at=?,updated_at=? WHERE id=? AND guild_id=? AND actor_id=? AND status='pending' AND confirmed_at IS NULL").run(Date.now(), Date.now(), id, interaction.guild.id, interaction.user.id);
    await interaction.reply({ content: result.changes ? "✅ Campagne #" + id + " confirmée. L’envoi progressif aux membres abonnés va commencer." : "❌ Campagne introuvable, déjà confirmée, annulée ou créée par un autre owner.", flags: MessageFlags.Ephemeral });
    if (result.changes) recordSysPlusAudit(interaction.guild.id, interaction.user.id, "sysplus.dm_all.confirm", String(id));
    return true;
  }
  if (action === "stop") {
    const result = db.prepare("UPDATE sysplus_dm_campaigns SET status='cancelled',updated_at=? WHERE id=? AND guild_id=? AND status IN ('pending','sending')").run(Date.now(), id, interaction.guild.id);
    await interaction.reply({ content: result.changes ? "🛑 Campagne #" + id + " annulée. Aucun nouveau MP ne sera lancé." : "Aucune campagne active #" + id + " trouvée.", flags: MessageFlags.Ephemeral });
    if (result.changes) recordSysPlusAudit(interaction.guild.id, interaction.user.id, "sysplus.dm_all.cancel", String(id));
    return true;
  }
  const campaign = db.prepare("SELECT * FROM sysplus_dm_campaigns WHERE id=? AND guild_id=?").get(id, interaction.guild.id);
  if (!campaign) {
    await interaction.reply({ content: "Campagne introuvable.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const rows = db.prepare("SELECT status,COUNT(*) AS count FROM sysplus_dm_campaign_recipients WHERE campaign_id=? GROUP BY status").all(id);
  const counts = Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
  await interaction.reply({ content: "📬 Campagne #" + id + " — " + campaign.status + "\nEnvoyés : " + (counts.sent ?? 0) + " · Échecs : " + (counts.failed ?? 0) + " · En attente : " + (counts.pending ?? 0) + " · Ignorés : " + (counts.skipped ?? 0), flags: MessageFlags.Ephemeral });
  return true;
}

export async function handleSysPlusBroadcastInteraction(interaction, settings, { record = () => {} } = {}) {
  if (!interaction.isChatInputCommand() || !interaction.inGuild()) return false;
  const guild = interaction.guild;
  const preferences = {
    "wakeup-optin": ["wakeup_opt_in", true, "✅ Tu as activé les réveils volontaires. Tu peux les désactiver avec /wakeup-optout."],
    "wakeup-optout": ["wakeup_opt_in", false, "✅ Tu ne recevras plus de réveils vocaux."],
    "dm-optin": ["dm_opt_in", true, "✅ Tu es abonné aux annonces privées PND. Tu peux te désabonner avec /dm-optout."],
    "dm-optout": ["dm_opt_in", false, "✅ Tu es désabonné des annonces privées PND."],
  };
  if (preferences[interaction.commandName]) {
    const [column, enabled, response] = preferences[interaction.commandName];
    setPreference(guild.id, interaction.user.id, column, enabled);
    recordSysPlusAudit(guild.id, interaction.user.id, "sysplus.preference." + column + "." + (enabled ? "on" : "off"));
    await interaction.reply({ content: response, flags: MessageFlags.Ephemeral });
    return true;
  }
  if (interaction.commandName === "wakeup") { record("sysplus_wakeup_requested"); return handleWakeup(interaction, settings); }
  if (interaction.commandName === "dm-all") { record("sysplus_dm_campaign_requested"); return createDmCampaign(interaction); }
  if (interaction.commandName === "dm-all-confirm") return handleDmCampaignControl(interaction, "confirm");
  if (interaction.commandName === "dm-all-stop") return handleDmCampaignControl(interaction, "stop");
  if (interaction.commandName === "dm-all-status") return handleDmCampaignControl(interaction, "status");
  return false;
}

/** Persisted queue. It resumes after process restarts and can be cancelled. */
export function startSysPlusDmScheduler(client, allowedGuildIds, record = () => {}) {
  if (dmWorkerTimer) clearInterval(dmWorkerTimer);
  db.prepare("UPDATE sysplus_dm_campaign_recipients SET status='pending',updated_at=? WHERE status='processing'").run(Date.now());
  dmWorkerTimer = setInterval(async () => {
    if (dmWorkerRunning) return;
    dmWorkerRunning = true;
    try {
      const row = db.prepare("SELECT r.campaign_id,r.user_id,c.guild_id,c.message FROM sysplus_dm_campaign_recipients r JOIN sysplus_dm_campaigns c ON c.id=r.campaign_id WHERE r.status='pending' AND c.status IN ('pending','sending') AND c.confirmed_at IS NOT NULL ORDER BY c.id ASC,r.rowid ASC LIMIT 1").get();
      if (!row) {
        db.prepare("UPDATE sysplus_dm_campaigns SET status='completed',updated_at=? WHERE status IN ('pending','sending') AND confirmed_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sysplus_dm_campaign_recipients r WHERE r.campaign_id=sysplus_dm_campaigns.id AND r.status IN ('pending','processing'))").run(Date.now());
        return;
      }
      db.prepare("UPDATE sysplus_dm_campaigns SET status='sending',updated_at=? WHERE id=?").run(Date.now(), row.campaign_id);
      db.prepare("UPDATE sysplus_dm_campaign_recipients SET status='processing',updated_at=? WHERE campaign_id=? AND user_id=? AND status='pending'").run(Date.now(), row.campaign_id, row.user_id);
      let deliveryStatus = "failed";
      const guild = allowedGuildIds.includes(row.guild_id) ? client.guilds.cache.get(row.guild_id) : null;
      if (guild) {
        if (preference(row.guild_id, row.user_id).dm_opt_in !== 1) deliveryStatus = "skipped";
        else {
          const member = guild.members.cache.get(row.user_id) ?? await guild.members.fetch(row.user_id).catch(() => null);
          if (!member || member.user.bot) deliveryStatus = "skipped";
          else {
            try {
              await member.send({ content: row.message + "\n\n— Annonce privée PND\nPour ne plus recevoir ces annonces, utilise /dm-optout sur le serveur.", allowedMentions: { parse: [] } });
              deliveryStatus = "sent";
            } catch { deliveryStatus = "failed"; }
          }
        }
      }
      db.prepare("UPDATE sysplus_dm_campaign_recipients SET status=?,updated_at=? WHERE campaign_id=? AND user_id=?").run(deliveryStatus, Date.now(), row.campaign_id, row.user_id);
      const totals = db.prepare("SELECT status,COUNT(*) AS count FROM sysplus_dm_campaign_recipients WHERE campaign_id=? GROUP BY status").all(row.campaign_id);
      const counts = Object.fromEntries(totals.map((item) => [item.status, Number(item.count)]));
      const active = (counts.pending ?? 0) + (counts.processing ?? 0);
      const current = db.prepare("SELECT status FROM sysplus_dm_campaigns WHERE id=?").get(row.campaign_id);
      if (current?.status !== "cancelled") {
        db.prepare("UPDATE sysplus_dm_campaigns SET sent_count=?,failed_count=?,status=?,updated_at=? WHERE id=?").run(counts.sent ?? 0, counts.failed ?? 0, active === 0 ? "completed" : "sending", Date.now(), row.campaign_id);
      }
      record(deliveryStatus === "sent" ? "sysplus_dm_delivered" : "sysplus_dm_delivery_skipped_or_failed");
    } catch { record("sysplus_dm_worker_error"); }
    finally { dmWorkerRunning = false; }
  }, DM_CAMPAIGN_DELAY_MS);
  dmWorkerTimer.unref?.();
}
