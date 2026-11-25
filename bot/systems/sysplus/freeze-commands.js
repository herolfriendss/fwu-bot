// /sysp gel et /sysp degel : gel d'urgence du staff (idée SYS+ n°1). Owner uniquement.
import { parseDurationToSeconds } from "../../shared/sanctions.js";
import { formatDurationFr } from "../../shared/quotas.js";
import { liftStaffFreeze, setStaffFreeze, expiredStaffFreezes, getStaffFreeze } from "../../shared/freeze.js";
import { ownerId } from "../../shared/tiers.js";
import { rememberFreeze } from "../../staff-freeze-gate.js";
import { getAdminPlusRoleId } from "./role-config.js";
import { assertRoleGrantable } from "../../role-grant-guard.js";
import { runAsActor } from "../../owner-shield.js";
import { recordSysPlusAudit } from "./audit.js";

/** Retire ADMIN+ à tous ceux qui l'ont (sauf l'owner). Renvoie les ids retirés. */
async function removeAdminPlus(guild) {
  const roleId = getAdminPlusRoleId(guild.id);
  if (!roleId) return [];
  await guild.members.fetch().catch(() => null);
  const role = guild.roles.cache.get(roleId);
  if (!role) return [];
  const removed = [];
  for (const member of role.members.values()) {
    if (member.id === ownerId() || member.user?.bot) continue;
    try { await member.roles.remove(roleId, "Gel d'urgence du staff (owner)"); removed.push(member.id); } catch { /* rôle trop haut : signalé par le compte */ }
  }
  return removed;
}

/** Rend ADMIN+ exactement à ceux à qui le gel l'a retiré, au nom de l'owner (role-grant-guard). */
export async function restoreAdminPlus(guild, memberIds) {
  const roleId = getAdminPlusRoleId(guild.id);
  const role = roleId ? guild.roles.cache.get(roleId) ?? await guild.roles.fetch(roleId).catch(() => null) : null;
  if (!role || !memberIds?.length) return { restored: 0, failed: memberIds?.length ?? 0 };
  const owner = ownerId();
  let restored = 0;
  let failed = 0;
  await runAsActor(owner, async () => {
    try { await assertRoleGrantable(guild, role, { actorId: owner }); } catch { failed = memberIds.length; return; }
    for (const id of memberIds) {
      const member = await guild.members.fetch(id).catch(() => null);
      if (!member) { failed += 1; continue; }
      try { await member.roles.add(roleId, "Fin du gel d'urgence : ADMIN+ rendu"); restored += 1; } catch { failed += 1; }
    }
  });
  return { restored, failed };
}

export async function handleFreezeCommand(interaction, { bot, audit = () => {} }) {
  const guild = interaction.guild;
  const owner = ownerId();
  if (!owner || interaction.user.id !== owner) {
    await interaction.reply({ content: "⛔ Seul l'owner peut geler ou dégeler le staff.", ephemeral: true });
    return true;
  }
  const sub = interaction.options.getSubcommand();
  await interaction.deferReply({ ephemeral: true });
  if (sub === "gel") {
    const seconds = parseDurationToSeconds(interaction.options.getString("duree", true));
    const reason = interaction.options.getString("raison") ?? "";
    const withAdmin = interaction.options.getBoolean("retirer_admin_plus") ?? false;
    if (!seconds) { await interaction.editReply("❌ Durée illisible : 30m, 2h, 1j…"); return true; }
    // Le gel d'abord (effet immédiat sur les 5 bots), le retrait d'ADMIN+ ensuite.
    let freeze = await setStaffFreeze({ guildId: guild.id, seconds, reason, actorId: owner, bot });
    rememberFreeze(guild.id, freeze.until);
    let removed = [];
    if (withAdmin) {
      removed = await removeAdminPlus(guild);
      freeze = await setStaffFreeze({ guildId: guild.id, seconds, reason, actorId: owner, bot, removedAdminPlus: removed });
    }
    recordSysPlusAudit(guild.id, owner, "owner.staff_freeze", null, { seconds, adminPlusRemoved: removed.length });
    const t = Math.floor(freeze.until / 1000);
    audit(guild, "🧊 Gel d'urgence du staff", `Par l'owner, jusqu'à <t:${t}:f> (${formatDurationFr(seconds)}).${reason ? `\nRaison : ${reason}` : ""}\nCommandes du staff suspendues sur les 5 bots.${withAdmin ? `\nADMIN+ retiré à ${removed.length} membre(s), rendu au dégel.` : ""}`);
    await interaction.editReply(`🧊 **Staff gelé** jusqu'à <t:${t}:f> (<t:${t}:R>). Toutes les commandes du staff sont suspendues sur les 5 bots (toi, l'owner, tu gardes tout).${withAdmin ? `\nADMIN+ retiré à **${removed.length}** membre(s) : il leur sera rendu au dégel.` : ""}\nFin anticipée : \`/sysp degel\`.`);
    return true;
  }
  // degel
  const lifted = await liftStaffFreeze({ guildId: guild.id, actorId: owner, bot });
  rememberFreeze(guild.id, null);
  if (!lifted) { await interaction.editReply("ℹ️ Aucun gel en cours."); return true; }
  const { restored, failed } = await restoreAdminPlus(guild, lifted.removedAdminPlus);
  recordSysPlusAudit(guild.id, owner, "owner.staff_unfreeze", null, { adminPlusRestored: restored, failed });
  audit(guild, "🔥 Fin du gel du staff", `Dégel par l'owner.${lifted.removedAdminPlus.length ? `\nADMIN+ rendu : ${restored}${failed ? `, échecs : ${failed}` : ""}.` : ""}`);
  await interaction.editReply(`🔥 **Staff dégelé.**${lifted.removedAdminPlus.length ? ` ADMIN+ rendu à ${restored} membre(s)${failed ? `, ${failed} échec(s) (membre parti ou rôle trop haut)` : ""}.` : ""}`);
  return true;
}

/** FWU, chaque minute : dégèle les gels expirés et rend ADMIN+. */
export function startFreezeExpiry({ client, bot, audit = () => {}, shouldRun = () => true, record = () => {} }) {
  const run = async () => {
    if (!shouldRun()) return;
    let guildIds = [];
    try { guildIds = await expiredStaffFreezes(); } catch { return; }
    for (const guildId of guildIds) {
      try {
        const lifted = await liftStaffFreeze({ guildId, actorId: client.user.id, bot, onlyExpired: true });
        rememberFreeze(guildId, null);
        const guild = client.guilds.cache.get(guildId);
        if (!lifted || !guild) continue;
        const { restored, failed } = await restoreAdminPlus(guild, lifted.removedAdminPlus);
        audit(guild, "🔥 Fin du gel du staff", `Durée écoulée.${lifted.removedAdminPlus.length ? `\nADMIN+ rendu : ${restored}${failed ? `, échecs : ${failed}` : ""}.` : ""}`);
      } catch { record("staff_freeze_expiry_error"); }
    }
  };
  const timer = setInterval(() => { void run(); }, 60_000);
  timer.unref?.();
  return run;
}

export { getStaffFreeze };
