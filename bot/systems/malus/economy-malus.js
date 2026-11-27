// MALUS économie : taxe (prélevée dans economy.js), rançon, cible.
import { grantPnd, pndBalance } from "../../economy.js";
import { db } from "../../database.js";
import { MalusError, activeMalus, registerMalusKind, registerMalusSubcommand, stopMalus } from "./commands.js";

export const RANCON_MIN = 10;
export const RANCON_MAX = 100_000;
export const CIBLE_REWARD = 25;
export const CIBLE_COOLDOWN_MS = 30_000;
export const CIBLE_MAX_PER_MEMBER = 10;

// ── Rançon : muet (texte et vocal) jusqu'au paiement, ou fin de la durée ──
registerMalusKind("rancon", {
  async start({ target, data }) {
    if (!Number.isInteger(data?.amount)) throw new MalusError("Montant de rançon manquant.");
    if (target.voice?.channelId && !target.voice.serverMute) await target.voice.setMute(true, "Malus RANÇON").catch(() => {});
  },
  async stop({ guild, row }) {
    const member = await guild.members.fetch(row.member_id).catch(() => null);
    if (member?.voice?.serverMute) await member.voice.setMute(false, "Fin du malus RANÇON").catch(() => {});
  },
});

export function ransomAmount(value) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < RANCON_MIN || amount > RANCON_MAX) throw new MalusError(`La rançon doit être entre ${RANCON_MIN} et ${RANCON_MAX.toLocaleString("fr-FR")} PND.`);
  return amount;
}

/** Anyone can pay: the payer's PND go to the SYS+ who set the ransom, and the malus ends. */
registerMalusSubcommand("payer-rancon", async (interaction, guildSettings) => {
  const guild = interaction.guild;
  const user = interaction.options.getUser("membre", true);
  const row = activeMalus(guild.id, user.id, "rancon");
  if (!row) throw new MalusError("Ce membre n'a pas de rançon à payer.");
  const amount = JSON.parse(row.data ?? "{}").amount;
  if (!Number.isInteger(amount)) throw new MalusError("Rançon invalide.");
  if (interaction.user.id === row.started_by) throw new MalusError("Tu as posé cette rançon : lève-la avec `/malus stop`.");
  if (pndBalance(guild.id, interaction.user.id).balance < amount) throw new MalusError(`Il te faut ${amount.toLocaleString("fr-FR")} PND sur ton solde.`);
  try {
    grantPnd(guild.id, row.started_by, amount, "malus_rancon_recue");
    grantPnd(guild.id, interaction.user.id, -amount, "malus_rancon_payee");
  } catch (error) { throw new MalusError(`❌ Paiement impossible : ${error.message}`); }
  await stopMalus({ guild, memberId: user.id, kind: "rancon", actorId: interaction.user.id, guildSettings, reason: `rançon de ${amount} PND payée` });
  await interaction.channel?.send?.({ content: `💰 <@${interaction.user.id}> a payé la rançon de <@${user.id}> (${amount.toLocaleString("fr-FR")} PND). Libéré !`, allowedMentions: { parse: [] } }).catch(() => {});
  return "💰 Rançon payée.";
});

/** messageCreate: a member under ransom cannot write. */
export async function handleRansomMessage(message) {
  if (!message.guild || message.author?.bot) return false;
  const row = activeMalus(message.guild.id, message.author.id, "rancon");
  if (!row) return false;
  const amount = JSON.parse(row.data ?? "{}").amount;
  await message.delete().catch(() => {});
  if (Math.random() < 0.34) {
    await message.channel.send({ content: `🔒 <@${message.author.id}> est retenu en otage. Rançon : **${Number(amount).toLocaleString("fr-FR")} PND** (\`/malus payer-rancon\`).`, allowedMentions: { parse: [] } }).catch(() => {});
  }
  return true;
}

// ── Cible : chaque membre qui la mentionne gagne un peu de PND ──
registerMalusKind("cible", {});
const cibleRewards = new Map(); // guild:target:member -> { count, last }
export function cibleRewardAllowed(state, now = Date.now()) {
  if (!state) return true;
  return state.count < CIBLE_MAX_PER_MEMBER && now - state.last >= CIBLE_COOLDOWN_MS;
}
export async function handleCibleMessage(message, { now = Date.now() } = {}) {
  if (!message.guild || message.author?.bot) return false;
  const mentioned = message.mentions?.users?.filter?.((u) => !u.bot && u.id !== message.author.id);
  if (!mentioned?.size) return false;
  let paid = false;
  for (const user of mentioned.values()) {
    const row = activeMalus(message.guild.id, user.id, "cible", now);
    if (!row) continue;
    const k = `${message.guild.id}:${user.id}:${message.author.id}`;
    const state = cibleRewards.get(k);
    if (!cibleRewardAllowed(state, now)) continue;
    try { grantPnd(message.guild.id, message.author.id, CIBLE_REWARD, "malus_cible"); } catch { continue; }
    cibleRewards.set(k, { count: (state?.count ?? 0) + 1, last: now });
    paid = true;
    await message.react("🎯").catch(() => {});
  }
  if (cibleRewards.size > 10_000) cibleRewards.clear();
  return paid;
}

export { db };
