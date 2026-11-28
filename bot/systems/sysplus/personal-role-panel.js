// SUCK ME — « Rôles personnels — Espace membres » (demande de l'OWNER du 28/11).
//
// Un SYS+ publie le panneau dans un salon (/rolepanel espace). Chaque membre clique sur
// « Gérer mon rôle perso » et obtient une interface privée pour SON rôle perso :
//   • Nom & couleur   — fenêtre de saisie (mêmes règles que /rolepanel : 2 à 32 caractères, pas de %,
//                       pas de @everyone) ;
//   • Émoji / icône   — un émoji Unicode comme icône du rôle (serveur niveau de boost 2 requis) ;
//   • Membres         — donner ou retirer son rôle à des amis (au plus MAX_HOLDERS personnes) ;
//   • Protection      — si quelqu'un d'autre modifie le rôle ou le retire au membre, le bot
//                       remet l'état enregistré.
// Le rôle perso est celui de `sysplus_member_roles` (créé par un SYS+ avec /rolepanel membre), ou
// créé par le membre lui-même s'il détient un des rôles éligibles choisis par le staff.
//
// Sécurité, toujours, protection activée ou non :
//   • un rôle perso n'a JAMAIS de permission Discord : s'il en reçoit, le bot les retire ;
//   • il est placé au niveau du rôle le plus haut du membre : le membre ne gagne aucun rang ;
//   • chaque attribution à un ami passe par bot/role-grant-guard.js (BLR, rôle protégé…) ;
//   • seul le propriétaire du rôle (ou un SYS+ via /rolepanel) agit dessus ; chaque bouton revérifie.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder } from "discord.js";
import { db } from "../../database.js";
import { roleGrantRefusal } from "../../role-grant-guard.js";
import { normalizeCustomRoleColor, normalizeCustomRoleName } from "./custom-roles-policy.js";
import { MEMBER_ROLE_LIMIT, memberRolePosition } from "./member-roles.js";
import { isSysPlus } from "./permissions.js";

export const PANEL_PREFIX = "prole";
export const MAX_HOLDERS = 10;

db.exec(`
  CREATE TABLE IF NOT EXISTS sysplus_member_roles (
    guild_id TEXT NOT NULL, member_id TEXT NOT NULL, role_id TEXT NOT NULL, created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (guild_id, member_id)
  );
  CREATE TABLE IF NOT EXISTS personal_role_config (
    guild_id TEXT PRIMARY KEY, eligible_role_ids TEXT NOT NULL DEFAULT '[]', updated_by TEXT, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS personal_role_protection (
    guild_id TEXT NOT NULL, role_id TEXT NOT NULL, owner_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL, color INTEGER NOT NULL, icon TEXT, updated_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, role_id)
  );
`);

// ------------------------------------------------------------------ data
export function personalRoleIdOf(guildId, memberId) {
  return db.prepare("SELECT role_id FROM sysplus_member_roles WHERE guild_id=? AND member_id=?").get(String(guildId), String(memberId))?.role_id ?? null;
}
export function ownerOfPersonalRole(guildId, roleId) {
  return db.prepare("SELECT member_id FROM sysplus_member_roles WHERE guild_id=? AND role_id=?").get(String(guildId), String(roleId))?.member_id ?? null;
}
export function eligibleRoleIds(guildId) {
  try { return JSON.parse(db.prepare("SELECT eligible_role_ids FROM personal_role_config WHERE guild_id=?").get(String(guildId))?.eligible_role_ids ?? "[]"); } catch { return []; }
}
export function setEligibleRoles(guildId, roleIds, actorId, now = Date.now()) {
  db.prepare(`INSERT INTO personal_role_config(guild_id, eligible_role_ids, updated_by, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET eligible_role_ids=excluded.eligible_role_ids, updated_by=excluded.updated_by, updated_at=excluded.updated_at`).run(String(guildId), JSON.stringify([...new Set(roleIds)].slice(0, 5)), actorId, now);
}
export function protectionOf(guildId, roleId) {
  const row = db.prepare("SELECT * FROM personal_role_protection WHERE guild_id=? AND role_id=?").get(String(guildId), String(roleId));
  return row ? { enabled: Boolean(row.enabled), name: row.name, color: Number(row.color), icon: row.icon ?? null, ownerId: row.owner_id } : null;
}
/** Stores the reference state the protection restores (always kept up to date by the panel). */
export function saveSnapshot(guildId, role, ownerId, { enabled = null, now = Date.now() } = {}) {
  const current = protectionOf(guildId, role.id);
  db.prepare(`INSERT INTO personal_role_protection(guild_id, role_id, owner_id, enabled, name, color, icon, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, role_id) DO UPDATE SET owner_id=excluded.owner_id, enabled=excluded.enabled, name=excluded.name, color=excluded.color, icon=excluded.icon, updated_at=excluded.updated_at`)
    .run(String(guildId), role.id, ownerId, (enabled ?? current?.enabled ?? false) ? 1 : 0, role.name, Number(role.color ?? 0), role.unicodeEmoji ?? null, now);
}

/** Pure: may this member create their own personal role? */
export function selfCreateDecision({ hasRole, memberRoleIds, eligible, guildCount }) {
  if (hasRole) return "Tu as déjà un rôle perso.";
  if (!eligible.length) return "La création libre n'est pas ouverte sur ce serveur : demande ton rôle perso au staff.";
  if (!eligible.some((id) => memberRoleIds.includes(id))) return "La création d'un rôle perso est réservée à certains rôles du serveur.";
  if (guildCount >= MEMBER_ROLE_LIMIT) return `Limite atteinte : ${MEMBER_ROLE_LIMIT} rôles perso sur ce serveur.`;
  return null;
}

/** Pure: a single Unicode emoji (role icons accept no text and no custom emoji here). */
export function normalizeRoleEmoji(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const segments = [...new Intl.Segmenter("fr", { granularity: "grapheme" }).segment(text)];
  if (segments.length !== 1 || !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(text)) throw new Error("Indique un seul émoji (ex. 👑), ou laisse vide pour retirer l'icône.");
  return text;
}

/** Pure: what the protection must restore. Permissions are always removed, protection or not. */
export function restorePlan(role, snapshot) {
  const changes = {};
  if (role.permissions?.bitfield && BigInt(role.permissions.bitfield) !== 0n) changes.permissions = [];
  if (snapshot?.enabled) {
    if (role.name !== snapshot.name) changes.name = snapshot.name;
    if (Number(role.color ?? 0) !== Number(snapshot.color)) changes.color = snapshot.color;
    if ((role.unicodeEmoji ?? null) !== (snapshot.icon ?? null)) changes.unicodeEmoji = snapshot.icon;
  }
  return Object.keys(changes).length ? changes : null;
}

// ------------------------------------------------------------------ views
export function publicPanel() {
  const embed = new EmbedBuilder()
    .setTitle("👑 Rôles personnels — Espace membres")
    .setDescription([
      "Centre de gestion et de personnalisation de ton rôle personnel sur le serveur.",
      "",
      "Clique sur le bouton ci-dessous pour ouvrir ton interface privée :",
      "• 🖋️ **Nom & couleur** : personnalise le nom et la teinte de ton rôle.",
      "• ✨ **Émoji / icône** : ajoute un émoji comme icône de ton rôle.",
      "• 👤 **Membres** : donne ou retire ton rôle à tes amis.",
      "• 🛡️ **Protection** : restauration automatique si quelqu'un modifie ou retire ton rôle.",
    ].join("\n"))
    .setFooter({ text: "SUCK ME" });
  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${PANEL_PREFIX}:open`).setLabel("Gérer mon rôle perso").setEmoji("👑").setStyle(ButtonStyle.Primary))],
  };
}

export function memberView(role, { holders = 0, protection = null, canCreate = null } = {}) {
  if (!role) {
    const rows = canCreate === null
      ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${PANEL_PREFIX}:create`).setLabel("Créer mon rôle perso").setEmoji("👑").setStyle(ButtonStyle.Primary))]
      : [];
    return { content: canCreate === null ? "Tu n'as pas encore de rôle perso. Tu peux en créer un (aucune permission, à ton niveau actuel)." : `Tu n'as pas de rôle perso. ${canCreate}`, embeds: [], components: rows };
  }
  const embed = new EmbedBuilder()
    .setTitle(`Ton rôle perso : ${role.name}`.slice(0, 256))
    .setDescription([
      `Rôle : <@&${role.id}>`,
      `Couleur : ${role.hexColor ?? "par défaut"}${role.unicodeEmoji ? ` · Icône : ${role.unicodeEmoji}` : ""}`,
      `Membres qui l'ont : ${holders} (dont toi, ${MAX_HOLDERS} amis au plus)`,
      `Protection : ${protection?.enabled ? "🛡️ activée" : "désactivée"}`,
      "Ton rôle n'a et n'aura jamais de permission Discord.",
    ].join("\n"))
    .setFooter({ text: "SUCK ME" });
  return {
    content: "",
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PANEL_PREFIX}:style`).setLabel("Nom & couleur").setEmoji("🖋️").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PANEL_PREFIX}:icon`).setLabel("Émoji / icône").setEmoji("✨").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PANEL_PREFIX}:protect`).setLabel(protection?.enabled ? "Désactiver la protection" : "Activer la protection").setEmoji("🛡️").setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${PANEL_PREFIX}:give`).setPlaceholder("👤 Donner mon rôle à…").setMinValues(1).setMaxValues(5)),
      new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${PANEL_PREFIX}:take`).setPlaceholder("Retirer mon rôle à…").setMinValues(1).setMaxValues(5)),
    ],
  };
}

function styleModal(role) {
  return new ModalBuilder().setCustomId(`${PANEL_PREFIX}:style-modal`).setTitle("Nom & couleur").addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("name").setLabel("Nom (2 à 32 caractères)").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32).setValue(role?.name ?? "")),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("color").setLabel("Couleur : nom (rose, bleu…) ou #RRGGBB").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20).setValue(role?.hexColor && role.hexColor !== "#000000" ? role.hexColor : "")),
  );
}
function iconModal() {
  return new ModalBuilder().setCustomId(`${PANEL_PREFIX}:icon-modal`).setTitle("Émoji / icône").addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("emoji").setLabel("Un émoji (vide pour retirer l'icône)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(16)),
  );
}

// ------------------------------------------------------------------ actions
async function ownRole(guild, memberId) {
  const roleId = personalRoleIdOf(guild.id, memberId);
  if (!roleId) return null;
  const role = await guild.roles.fetch(roleId, { force: true }).catch(() => null);
  if (!role) { db.prepare("DELETE FROM sysplus_member_roles WHERE guild_id=? AND member_id=?").run(guild.id, memberId); return null; }
  return role;
}

async function view(guild, member) {
  const role = await ownRole(guild, member.id);
  if (!role) {
    const refusal = selfCreateDecision({ hasRole: false, memberRoleIds: [...member.roles.cache.keys()], eligible: eligibleRoleIds(guild.id), guildCount: Number(db.prepare("SELECT COUNT(*) AS n FROM sysplus_member_roles WHERE guild_id=?").get(guild.id).n) });
    return memberView(null, { canCreate: refusal });
  }
  return memberView(role, { holders: role.members?.size ?? 1, protection: protectionOf(guild.id, role.id) });
}

async function createOwnRole(guild, member, name, color) {
  const refusal = selfCreateDecision({ hasRole: Boolean(personalRoleIdOf(guild.id, member.id)), memberRoleIds: [...member.roles.cache.keys()], eligible: eligibleRoleIds(guild.id), guildCount: Number(db.prepare("SELECT COUNT(*) AS n FROM sysplus_member_roles WHERE guild_id=?").get(guild.id).n) });
  if (refusal) throw new Error(refusal);
  const me = guild.members.me ?? await guild.members.fetchMe();
  const role = await guild.roles.create({ name: normalizeCustomRoleName(name), color: Number.parseInt(normalizeCustomRoleColor(color).slice(1), 16), permissions: [], hoist: false, mentionable: false, reason: `Rôle perso créé par ${member.id} (espace membres)` });
  try {
    await role.setPosition(memberRolePosition({ actorPosition: member.roles.highest.position, botPosition: me.roles.highest.position, actorFull: false, targetPosition: member.roles.highest.position })).catch(() => {});
    await member.roles.add(role, "Rôle perso (espace membres)");
    db.prepare("INSERT INTO sysplus_member_roles(guild_id,member_id,role_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(guild.id, member.id, role.id, member.id, Date.now(), Date.now());
    saveSnapshot(guild.id, role, member.id);
  } catch (error) {
    await role.delete("Nettoyage : rôle perso non attribué").catch(() => {});
    throw error;
  }
  return role;
}

async function grantTo(guild, role, ownerId, userIds, settings) {
  const done = []; const refused = [];
  const current = role.members?.size ?? 1;
  let room = MAX_HOLDERS + 1 - current;
  for (const userId of userIds) {
    if (userId === ownerId) continue;
    const target = await guild.members.fetch({ user: userId }).catch(() => null);
    if (!target || target.user?.bot) { refused.push(`<@${userId}> (introuvable ou bot)`); continue; }
    if (target.roles.cache.has(role.id)) continue;
    if (room <= 0) { refused.push(`<@${userId}> (limite de ${MAX_HOLDERS} amis)`); continue; }
    // Always through the central guard: BLR member, protected role, privileged permissions…
    const refusal = await roleGrantRefusal(guild, role, { actorId: ownerId, settings, automatic: false, targetId: userId });
    if (refusal) { refused.push(`<@${userId}> (${refusal})`); continue; }
    await target.roles.add(role, `Rôle perso de ${ownerId} donné par son propriétaire`).then(() => { done.push(`<@${userId}>`); room -= 1; }).catch(() => refused.push(`<@${userId}> (Discord a refusé)`));
  }
  return { done, refused };
}

async function takeFrom(guild, role, ownerId, userIds) {
  const done = [];
  for (const userId of userIds) {
    if (userId === ownerId) continue;
    const target = await guild.members.fetch({ user: userId }).catch(() => null);
    if (target?.roles.cache.has(role.id)) await target.roles.remove(role, `Rôle perso retiré par son propriétaire ${ownerId}`).then(() => done.push(`<@${userId}>`)).catch(() => {});
  }
  return done;
}

export async function handlePersonalRolePanel(interaction, settings = {}) {
  const id = String(interaction.customId ?? "");
  if (!id.startsWith(`${PANEL_PREFIX}:`) || !interaction.guild) return false;
  const guild = interaction.guild;
  const action = id.split(":")[1];
  const reply = (payload) => (interaction.replied || interaction.deferred ? interaction.followUp({ ...payload, ephemeral: true }) : interaction.reply({ ...payload, ephemeral: true }));
  try {
    const member = await guild.members.fetch({ user: interaction.user.id, force: true });
    if (action === "open") { await reply({ ...(await view(guild, member)), allowedMentions: { parse: [] } }); return true; }
    if (action === "create") { await interaction.showModal(styleModal(null).setCustomId(`${PANEL_PREFIX}:create-modal`).setTitle("Créer mon rôle perso")); return true; }
    if (action === "create-modal") {
      const role = await createOwnRole(guild, member, interaction.fields.getTextInputValue("name"), interaction.fields.getTextInputValue("color"));
      await reply({ content: `✅ Rôle perso <@&${role.id}> créé (aucune permission). Rouvre le panneau pour le personnaliser.`, allowedMentions: { parse: [] } });
      return true;
    }
    const role = await ownRole(guild, member.id);
    if (!role) { await reply({ content: "Tu n'as pas de rôle perso. Rouvre le panneau." }); return true; }
    const me = guild.members.me ?? await guild.members.fetchMe();
    if (role.position >= me.roles.highest.position) throw new Error("Ton rôle est au-dessus du bot : demande au staff de le replacer.");
    if (action === "style") { await interaction.showModal(styleModal(role)); return true; }
    if (action === "icon") { await interaction.showModal(iconModal()); return true; }
    if (action === "style-modal") {
      await role.edit({ name: normalizeCustomRoleName(interaction.fields.getTextInputValue("name")), color: Number.parseInt(normalizeCustomRoleColor(interaction.fields.getTextInputValue("color")).slice(1), 16), permissions: [] }, `Rôle perso modifié par son propriétaire ${member.id}`);
      saveSnapshot(guild.id, role, member.id);
      await reply({ content: `✅ Rôle mis à jour : <@&${role.id}>.`, allowedMentions: { parse: [] } });
      return true;
    }
    if (action === "icon-modal") {
      const emoji = normalizeRoleEmoji(interaction.fields.getTextInputValue("emoji"));
      if (emoji && !guild.features?.includes?.("ROLE_ICONS")) throw new Error("Les icônes de rôle demandent un serveur au niveau de boost 2.");
      await role.edit({ unicodeEmoji: emoji, permissions: [] }, `Icône du rôle perso de ${member.id}`);
      saveSnapshot(guild.id, role, member.id);
      await reply({ content: emoji ? `✅ Icône ${emoji} ajoutée.` : "✅ Icône retirée." });
      return true;
    }
    if (action === "protect") {
      const enabled = !protectionOf(guild.id, role.id)?.enabled;
      saveSnapshot(guild.id, role, member.id, { enabled });
      await interaction.update({ ...(await view(guild, member)), allowedMentions: { parse: [] } });
      return true;
    }
    if (action === "give" || action === "take") {
      const users = interaction.values ?? [];
      if (action === "give") {
        const r = await grantTo(guild, role, member.id, users, settings);
        await reply({ content: [r.done.length ? `✅ Donné à ${r.done.join(", ")}.` : null, r.refused.length ? `⛔ Refusé : ${r.refused.join(", ")}.` : null].filter(Boolean).join("\n") || "Rien à faire.", allowedMentions: { parse: [] } });
      } else {
        const done = await takeFrom(guild, role, member.id, users);
        await reply({ content: done.length ? `✅ Retiré à ${done.join(", ")}.` : "Rien à retirer.", allowedMentions: { parse: [] } });
      }
      return true;
    }
    return false;
  } catch (error) {
    await reply({ content: `❌ ${error instanceof Error ? error.message : "Action impossible."}` }).catch(() => {});
    return true;
  }
}

// ------------------------------------------------------------------ protection (events)
/** roleUpdate: remove any permission, and restore the saved state when the owner enabled protection. */
export async function enforcePersonalRole(role, { record = () => {} } = {}) {
  const ownerId = ownerOfPersonalRole(role.guild?.id, role.id);
  if (!ownerId) return false;
  const plan = restorePlan(role, protectionOf(role.guild.id, role.id));
  if (!plan) return false;
  await role.edit(plan, "Rôle perso : modification non autorisée annulée").then(() => record("personal_role_restored")).catch(() => record("personal_role_restore_error"));
  return true;
}

/** guildMemberUpdate: give the role back to its owner when protection is on and someone removed it. */
export async function restoreOwnerRole(oldMember, newMember, { record = () => {} } = {}) {
  const roleId = personalRoleIdOf(newMember.guild.id, newMember.id);
  if (!roleId || !oldMember.roles?.cache?.has(roleId) || newMember.roles.cache.has(roleId)) return false;
  if (!protectionOf(newMember.guild.id, roleId)?.enabled) return false;
  await newMember.roles.add(roleId, "Rôle perso protégé : remis à son propriétaire").then(() => record("personal_role_restored")).catch(() => record("personal_role_restore_error"));
  return true;
}

// ------------------------------------------------------------------ staff side
/** /rolepanel espace: SYS+ publishes the panel here and optionally sets the eligible roles. */
export async function publishPanel(interaction, settings = {}) {
  const sysRole = settings?.sysPlus?.roleId ?? null;
  const member = await interaction.guild.members.fetch({ user: interaction.user.id }).catch(() => interaction.member);
  if (!isSysPlus(member, sysRole)) return "⛔ Réservé aux SYS+.";
  const eligible = [1, 2, 3].map((n) => interaction.options.getRole?.(`eligible${n}`)).filter(Boolean);
  if (eligible.length) setEligibleRoles(interaction.guild.id, eligible.map((r) => r.id), interaction.user.id);
  const channel = interaction.channel;
  if (!channel?.isTextBased?.()) return "❌ Salon introuvable.";
  await channel.send({ ...publicPanel(), allowedMentions: { parse: [] } });
  const list = eligibleRoleIds(interaction.guild.id);
  return `✅ Panneau publié. Création libre : ${list.length ? list.map((id) => `<@&${id}>`).join(", ") : "fermée (les SYS+ créent les rôles avec /rolepanel membre)"}.`;
}
