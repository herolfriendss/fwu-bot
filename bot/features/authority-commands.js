// AUTHORITY 3.3 — commandes Discord des dérogations (portées par SUCK ME en attendant le bot
// AUTHORITY dédié ; elles passeront au profil `authority` sans réécriture).
//
// Membres : /authority demander · mes-demandes · statut · historique
// OWNER   : /authority panneau (demandes en attente, boutons Approuver / Refuser)
//           /authority decider numero action:suspendre|reactiver|revoquer|prolonger [duree]
//
// Les boutons de décision portent le nonce à usage unique de la demande : un ancien bouton,
// un double clic ou un bouton recopié est refusé par le registre (bot/authority.js). L'identité de
// l'OWNER est revérifiée à chaque clic, par l'ID configuré uniquement.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { createRequest, decideRequest, EXCEPTIONABLE, getRequest, listRequests, requestHistory, STATUS_LABELS, effectiveStatus } from "../authority.js";
import { parsePndOwnerId } from "../pnd-owner-policy.js";
import { parseDuration } from "./community.js";

export const AUTHORITY_LABELS = Object.freeze({
  "voice.room.extra": "Salon vocal supplémentaire",
  "economy.quota.extra": "Quota économique supplémentaire",
  "module.beta.access": "Accès à un module en test",
  "staff.mission.create": "Créer des missions du staff",
  "staff.meeting.plan": "Planifier des réunions du staff",
});
const label = (permission) => AUTHORITY_LABELS[permission] ?? permission;
const ts = (ms, style = "f") => `<t:${Math.floor(Number(ms) / 1000)}:${style}>`;
const ownerIdOf = (env) => parsePndOwnerId(env.PND_OWNER_DISCORD_ID);

export function requestEmbed(row, now = Date.now()) {
  const status = effectiveStatus(row, now);
  return new EmbedBuilder()
    .setColor(status === "active" ? 0x22c55e : status === "pending" ? 0xf59e0b : 0x6b7280)
    .setTitle(`Dérogation n°${row.number} — ${STATUS_LABELS[status] ?? status}`)
    .setDescription(String(row.justification).slice(0, 1000))
    .addFields(
      { name: "Autorisation", value: label(row.permission), inline: true },
      { name: "Bénéficiaire", value: `<@${row.beneficiary_id}>`, inline: true },
      { name: "Demandeur", value: `<@${row.requester_id}>`, inline: true },
      { name: "Durée demandée", value: `${Math.round(Number(row.duration_ms) / 3_600_000)} h`, inline: true },
      ...(row.expires_at ? [{ name: "Fin", value: ts(row.expires_at), inline: true }] : []),
    )
    .setFooter({ text: "AUTHORITY" });
}

export function decisionButtons(row) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`authority:approve:${row.guild_id}:${row.number}:${row.nonce}`).setLabel("Approuver").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`authority:refuse:${row.guild_id}:${row.number}:${row.nonce}`).setLabel("Refuser").setStyle(ButtonStyle.Danger),
  );
}

/** Who may read a request: requester, beneficiary, OWNER. */
const canRead = (row, userId, env) => row && (userId === row.requester_id || userId === row.beneficiary_id || userId === ownerIdOf(env));

async function notifyOwner(client, row, env) {
  const ownerId = ownerIdOf(env);
  if (!ownerId || !client?.users?.fetch) return false;
  const owner = await client.users.fetch(ownerId).catch(() => null);
  if (!owner) return false;
  await owner.send({ content: "Nouvelle demande de dérogation.", embeds: [requestEmbed(row)], components: [decisionButtons(row)], allowedMentions: { parse: [] } }).catch(() => null);
  return true;
}

async function slash(interaction, { env, client }) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const ownerId = ownerIdOf(env);
  if (sub === "demander") {
    const beneficiary = interaction.options.getUser("beneficiaire") ?? interaction.user;
    const raw = interaction.options.getString("duree");
    const durationMs = raw ? parseDuration(raw) : undefined;
    if (raw && !durationMs) return { content: "❌ Durée illisible (ex. 12h, 3j)." };
    const created = createRequest({ guildId, requesterId: userId, beneficiaryId: beneficiary.id, permission: interaction.options.getString("type"), service: "discord", justification: interaction.options.getString("justification"), durationMs }, { env });
    if (created.error) return { content: `❌ ${created.error}` };
    const row = getRequest(guildId, created.number);
    const told = await notifyOwner(client, row, env);
    return { content: `📨 Demande n°${created.number} envoyée à l'OWNER${told ? "" : " (MP impossible pour le moment : elle reste visible dans son panneau)"}. Suis-la avec \`/authority statut numero:${created.number}\`.` };
  }
  if (sub === "mes-demandes") {
    const rows = listRequests(guildId, { userId, limit: 10 });
    return { content: rows.length ? rows.map((r) => `**n°${r.number}** ${label(r.permission)} pour <@${r.beneficiary_id}> — ${STATUS_LABELS[r.effective] ?? r.effective}${r.expires_at && r.effective === "active" ? ` jusqu'à ${ts(r.expires_at)}` : ""}`).join("\n") : "Aucune demande." };
  }
  if (sub === "statut" || sub === "historique") {
    const row = getRequest(guildId, interaction.options.getInteger("numero"));
    if (!canRead(row, userId, env)) return { content: "❌ Demande introuvable, ou réservée à son demandeur, son bénéficiaire et l'OWNER." };
    if (sub === "statut") return { embeds: [requestEmbed(row)] };
    const history = requestHistory(guildId, row.number);
    const names = { request: "Demande", approve: "Approuvée", refuse: "Refusée", suspend: "Suspendue", resume: "Réactivée", revoke: "Révoquée", extend: "Prolongée", expire: "Expirée" };
    return { content: `🗂️ **Dérogation n°${row.number}**\n${history.map((e) => `${ts(e.created_at, "d")} ${names[e.kind] ?? e.kind} — ${e.actor_id === "system" ? "automatique" : `<@${e.actor_id}>`}`).join("\n")}` };
  }
  if (!ownerId || userId !== ownerId) return { content: "⛔ Réservé à l'OWNER." };
  if (sub === "panneau") {
    const pending = listRequests(guildId, { status: "pending", limit: 5 });
    const active = listRequests(guildId, { status: "active", limit: 10 });
    const text = [`⏳ **En attente** : ${pending.length || "aucune"}`, `🟢 **Actives** : ${active.map((r) => `n°${r.number} ${label(r.permission)} → <@${r.beneficiary_id}> (fin ${ts(r.expires_at, "R")})`).join(" · ") || "aucune"}`].join("\n");
    return { content: text, embeds: pending.map((r) => requestEmbed(r)), components: pending.map((r) => decisionButtons(r)) };
  }
  if (sub === "decider") {
    const map = { suspendre: "suspend", reactiver: "resume", revoquer: "revoke", prolonger: "extend" };
    const action = map[interaction.options.getString("action")];
    const raw = interaction.options.getString("duree");
    const extra = raw ? parseDuration(raw) : null;
    if (action === "extend" && !extra) return { content: "❌ Indique la prolongation (ex. 12h, 3j)." };
    const r = decideRequest({ guildId, number: interaction.options.getInteger("numero"), actorId: userId, action, durationMs: extra }, { env });
    return { content: r.error ? `❌ ${r.error}` : `✅ Dérogation : ${STATUS_LABELS[r.status] ?? r.status}${r.expiresAt ? ` jusqu'à ${ts(r.expiresAt)}` : ""}.` };
  }
  return { content: "❌ Action inconnue." };
}

async function button(interaction, { env }) {
  const [, action, guildId, number, nonce] = String(interaction.customId).split(":");
  if (!["approve", "refuse"].includes(action)) return false;
  if (interaction.user.id !== ownerIdOf(env)) {
    await interaction.reply({ content: "⛔ Seul l'OWNER décide des dérogations.", ephemeral: true }).catch(() => {});
    return true;
  }
  const r = decideRequest({ guildId, number: Number(number), actorId: interaction.user.id, action, nonce }, { env });
  const row = getRequest(guildId, Number(number));
  if (r.error) {
    await interaction.reply({ content: `❌ ${r.error}`, ephemeral: true }).catch(() => {});
    return true;
  }
  await interaction.update({ content: action === "approve" ? "✅ Approuvée." : "🚫 Refusée.", embeds: row ? [requestEmbed(row)] : [], components: [] }).catch(() => {});
  return true;
}

export async function handleAuthorityInteraction(interaction, { env = process.env, client = interaction.client } = {}) {
  if (interaction.isButton?.() && String(interaction.customId ?? "").startsWith("authority:")) return button(interaction, { env });
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== "authority") return false;
  if (!interaction.guildId) { await interaction.reply({ content: "Cette commande s'utilise sur un serveur.", ephemeral: true }); return true; }
  await interaction.deferReply({ ephemeral: true });
  try {
    const payload = await slash(interaction, { env, client });
    await interaction.editReply({ ...payload, allowedMentions: { parse: [] } });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error instanceof Error ? error.message : "Action impossible."}` }).catch(() => {});
  }
  return true;
}

export const AUTHORITY_TYPE_CHOICES = EXCEPTIONABLE.map((value) => ({ name: label(value), value }));
