// SYS+ — charte du staff (/charte). Un texte que tout le staff accepte d'un clic ; modifier le texte
// change la version, donc chacun doit ré-accepter. /charte suivi liste ceux qui n'ont pas accepté la version en cours.
import { ActionRowBuilder, ModalBuilder, PermissionFlagsBits as P, TextInputBuilder, TextInputStyle } from "discord.js";
import { db } from "../../database.js";
import { respondInPlaceSafe } from "../../interaction-reply.js";
import { isStaffForFreeze } from "../../staff-freeze-gate.js";

export const CHARTER_COMMANDS = new Set(["charte"]);
export const CHARTER_MAX = 3_500;

db.exec(`
  CREATE TABLE IF NOT EXISTS staff_charter (guild_id TEXT PRIMARY KEY, body TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_by TEXT, updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS staff_charter_ack (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, version INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id));
`);

export function getCharter(guildId) {
  const row = db.prepare("SELECT * FROM staff_charter WHERE guild_id=?").get(guildId);
  return row ? { body: row.body, version: row.version, updatedBy: row.updated_by, updatedAt: row.updated_at } : null;
}

/** Enregistre le texte ; la version augmente seulement si le texte a changé. */
export function setCharter(guildId, body, actorId, now = Date.now()) {
  const text = String(body ?? "").trim();
  if (text.length < 20) throw new Error("La charte est trop courte (20 caractères au moins).");
  if (text.length > CHARTER_MAX) throw new Error(`La charte est trop longue (${CHARTER_MAX} caractères au plus).`);
  const cur = getCharter(guildId);
  if (cur?.body === text) return cur;
  const version = (cur?.version ?? 0) + 1;
  db.prepare(`INSERT INTO staff_charter(guild_id,body,version,updated_by,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(guild_id) DO UPDATE SET body=excluded.body, version=excluded.version, updated_by=excluded.updated_by, updated_at=excluded.updated_at`).run(guildId, text, version, actorId, now);
  return getCharter(guildId);
}

export function acceptCharter(guildId, userId, now = Date.now()) {
  const charter = getCharter(guildId);
  if (!charter) throw new Error("Aucune charte n'est définie.");
  db.prepare("INSERT OR REPLACE INTO staff_charter_ack(guild_id,user_id,version,at) VALUES(?,?,?,?)").run(guildId, userId, charter.version, now);
  return charter.version;
}

export const hasAccepted = (guildId, userId, version) => Number(db.prepare("SELECT version FROM staff_charter_ack WHERE guild_id=? AND user_id=?").get(guildId, userId)?.version ?? 0) >= version;

/** Membres du staff (ids) qui n'ont pas accepté la version en cours. */
export const pendingStaff = (guildId, staffIds, version) => staffIds.filter((id) => !hasAccepted(guildId, id, version));

const acceptRow = (version) => [{ type: 1, components: [{ type: 2, style: 3, label: "J'ai lu et j'accepte", emoji: { name: "✅" }, custom_id: `charter:accept:${version}` }] }];
const isAdmin = (member) => Boolean(member?.permissions?.has?.(P.ManageGuild) || member?.permissions?.has?.(P.Administrator) || member?.id === member?.guild?.ownerId);

export async function handleCharterInteraction(interaction, { getSettings = () => null, now = Date.now() } = {}) {
  const guild = interaction?.guild;
  if (!guild) return false;
  const settings = getSettings(guild.id);
  if (interaction.isModalSubmit?.() && interaction.customId === "charter:set") {
    try {
      if (!isAdmin(interaction.member)) throw new Error("Réservé aux admins (Gérer le serveur).");
      const charter = setCharter(guild.id, interaction.fields.getTextInputValue("body"), interaction.user.id, now);
      await interaction.reply({ content: `📜 Charte du staff enregistrée (version ${charter.version}). Chaque membre du staff doit l'accepter avec \`/charte voir\`.`, ephemeral: true });
    } catch (error) {
      await respondInPlaceSafe(interaction, { content: `❌ ${error.message}`, ephemeral: true });
    }
    return true;
  }
  if (interaction.isButton?.() && String(interaction.customId ?? "").startsWith("charter:accept:")) {
    try {
      const member = interaction.member ?? await guild.members.fetch(interaction.user.id);
      if (!(await isStaffForFreeze(member, settings).catch(() => false))) throw new Error("Seul le staff accepte la charte.");
      const wanted = Number(interaction.customId.split(":")[2]);
      if (wanted !== getCharter(guild.id)?.version) throw new Error("La charte a changé entre-temps : relis la nouvelle version avec `/charte voir`.");
      const version = acceptCharter(guild.id, interaction.user.id, now);
      await interaction.update({ content: `✅ Merci, tu as accepté la charte du staff (version ${version}).`, embeds: [], components: [] });
    } catch (error) {
      await respondInPlaceSafe(interaction, { content: `❌ ${error.message}`, ephemeral: true });
    }
    return true;
  }
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== "charte") return false;
  try {
    const sub = interaction.options.getSubcommand(false) ?? "voir";
    if (sub === "definir") {
      if (!isAdmin(interaction.member)) throw new Error("Réservé aux admins (Gérer le serveur).");
      const field = new TextInputBuilder().setCustomId("body").setLabel("Texte de la charte").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(CHARTER_MAX);
      const current = getCharter(guild.id);
      if (current) field.setValue(current.body);
      await interaction.showModal(new ModalBuilder().setCustomId("charter:set").setTitle("Charte du staff").addComponents(new ActionRowBuilder().addComponents(field)));
      return true;
    }
    const charter = getCharter(guild.id);
    if (!charter) throw new Error("Aucune charte n'est définie (`/charte definir`).");
    if (sub === "suivi") {
      if (!isAdmin(interaction.member)) throw new Error("Réservé aux admins (Gérer le serveur).");
      await interaction.deferReply({ ephemeral: true });
      await guild.members.fetch().catch(() => null);
      const staffIds = [];
      for (const m of guild.members.cache.values()) if (!m.user?.bot && await isStaffForFreeze(m, settings).catch(() => false)) staffIds.push(m.id);
      const pending = pendingStaff(guild.id, staffIds, charter.version);
      await interaction.editReply({ content: `📜 **Charte du staff, version ${charter.version}** : ${staffIds.length - pending.length}/${staffIds.length} ont accepté.${pending.length ? `\nÀ relancer : ${pending.slice(0, 40).map((id) => `<@${id}>`).join(" ")}` : "\nTout le staff a accepté."}`, allowedMentions: { parse: [] } });
      return true;
    }
    const accepted = hasAccepted(guild.id, interaction.user.id, charter.version);
    await interaction.reply({
      embeds: [{ title: `📜 Charte du staff · version ${charter.version}`, description: charter.body, footer: { text: accepted ? "Tu as déjà accepté cette version." : "Clique pour accepter cette version." } }],
      components: accepted ? [] : acceptRow(charter.version),
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    await respondInPlaceSafe(interaction, { content: `❌ ${error.message}`, ephemeral: true });
  }
  return true;
}
