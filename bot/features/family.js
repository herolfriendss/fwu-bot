// FWU V2 — relations entre membres (SUCK ME : /famille, =famille par le pont préfixe).
//   /famille mariage @membre · divorce · adopter @membre · emanciper · renier @membre · arbre [@membre]
// Règles : tout lien se fait avec l'accord de l'autre personne (bouton réservé à elle,
// valable 15 min) ; un seul conjoint ; un enfant a au plus deux parents (le couple qui
// l'adopte) ; jamais de lien avec soi-même, un bot, ou un parent proche (pas de boucle
// dans l'arbre) ; 6 enfants au plus par parent. Chacun peut se retirer seul à tout
// moment (divorce, émancipation, reniement). Données isolées par serveur.
// LE FISC lit coupleBonus() : bonus de 10 % sur le bonus quotidien des personnes mariées.
import { db } from "../database.js";
import { respondInPlaceSafe } from "../interaction-reply.js";

export const FAMILY_COMMANDS = new Set(["famille"]);
export const MAX_CHILDREN = 6;
export const PROPOSAL_TTL_MS = 15 * 60_000;
export const COUPLE_BONUS_RATE = 0.1;

db.exec(`
  CREATE TABLE IF NOT EXISTS family_marriages (guild_id TEXT NOT NULL, a_id TEXT NOT NULL, b_id TEXT NOT NULL, since INTEGER NOT NULL, PRIMARY KEY (guild_id, a_id, b_id));
  CREATE TABLE IF NOT EXISTS family_children (guild_id TEXT NOT NULL, child_id TEXT NOT NULL, parent_a TEXT NOT NULL, parent_b TEXT, since INTEGER NOT NULL, PRIMARY KEY (guild_id, child_id));
  CREATE TABLE IF NOT EXISTS family_proposals (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, kind TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL, created_at INTEGER NOT NULL);
`);

const pair = (x, y) => (String(x) < String(y) ? [String(x), String(y)] : [String(y), String(x)]);

export function spouseOf(guildId, userId) {
  const row = db.prepare("SELECT a_id, b_id, since FROM family_marriages WHERE guild_id = ? AND (a_id = ? OR b_id = ?)").get(String(guildId), String(userId), String(userId));
  if (!row) return null;
  return { id: row.a_id === String(userId) ? row.b_id : row.a_id, since: Number(row.since) };
}

export function parentsOf(guildId, userId) {
  const row = db.prepare("SELECT parent_a, parent_b FROM family_children WHERE guild_id = ? AND child_id = ?").get(String(guildId), String(userId));
  return row ? [row.parent_a, row.parent_b].filter(Boolean) : [];
}

export function childrenOf(guildId, userId) {
  return db.prepare("SELECT child_id FROM family_children WHERE guild_id = ? AND (parent_a = ? OR parent_b = ?) ORDER BY since").all(String(guildId), String(userId), String(userId)).map((r) => r.child_id);
}

/** Ancêtres (parents, grands-parents…), bornés pour rester sûrs même sur des données abîmées. */
export function ancestorsOf(guildId, userId, depth = 8) {
  const out = new Set();
  let level = [String(userId)];
  for (let i = 0; i < depth && level.length; i += 1) {
    const next = [];
    for (const id of level) for (const parent of parentsOf(guildId, id)) if (!out.has(parent)) { out.add(parent); next.push(parent); }
    level = next;
  }
  return out;
}

export function descendantsOf(guildId, userId, depth = 8) {
  const out = new Set();
  let level = [String(userId)];
  for (let i = 0; i < depth && level.length; i += 1) {
    const next = [];
    for (const id of level) for (const child of childrenOf(guildId, id)) if (!out.has(child)) { out.add(child); next.push(child); }
    level = next;
  }
  return out;
}

export function siblingsOf(guildId, userId) {
  const parents = parentsOf(guildId, userId);
  const out = new Set();
  for (const parent of parents) for (const child of childrenOf(guildId, parent)) if (child !== String(userId)) out.add(child);
  return [...out];
}

function closeRelatives(guildId, userId) {
  return new Set([...ancestorsOf(guildId, userId), ...descendantsOf(guildId, userId), ...siblingsOf(guildId, userId)]);
}

/** Vérifie qu'un lien est possible. Retourne un message d'erreur ou null. */
export function checkProposal(guildId, kind, fromId, toId, { toIsBot = false } = {}) {
  if (!fromId || !toId) return "Indique un membre.";
  if (String(fromId) === String(toId)) return "Tu ne peux pas faire ça avec toi-même.";
  if (toIsBot) return "Les bots ne font pas partie des familles.";
  if (kind === "marriage") {
    if (spouseOf(guildId, fromId)) return "Tu es déjà marié(e). Divorce d'abord avec `/famille divorce`.";
    if (spouseOf(guildId, toId)) return "Cette personne est déjà mariée.";
    if (closeRelatives(guildId, fromId).has(String(toId))) return "Impossible : vous êtes déjà de la même famille proche.";
    return null;
  }
  if (kind === "adoption") {
    if (parentsOf(guildId, toId).length) return "Cette personne a déjà des parents.";
    if (spouseOf(guildId, fromId)?.id === String(toId)) return "Tu ne peux pas adopter ton conjoint.";
    if (ancestorsOf(guildId, fromId).has(String(toId))) return "Impossible : cette personne fait partie de tes ancêtres.";
    if (childrenOf(guildId, fromId).length >= MAX_CHILDREN) return `Tu as déjà ${MAX_CHILDREN} enfants, le maximum.`;
    return null;
  }
  return "Demande inconnue.";
}

export function createProposal(guildId, kind, fromId, toId, now = Date.now()) {
  db.prepare("DELETE FROM family_proposals WHERE created_at < ? OR (guild_id = ? AND from_id = ?)").run(now - PROPOSAL_TTL_MS, String(guildId), String(fromId));
  const id = `${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  db.prepare("INSERT INTO family_proposals(id, guild_id, kind, from_id, to_id, created_at) VALUES (?,?,?,?,?,?)").run(id, String(guildId), kind, String(fromId), String(toId), now);
  return id;
}

/** Réponse à une demande. Seule la personne demandée peut répondre. Retourne le texte à afficher. */
export function answerProposal(guildId, proposalId, responderId, accept, now = Date.now()) {
  const p = db.prepare("SELECT * FROM family_proposals WHERE id = ? AND guild_id = ?").get(String(proposalId), String(guildId));
  if (!p || now - Number(p.created_at) > PROPOSAL_TTL_MS) throw new Error("Cette demande a expiré.");
  if (p.to_id !== String(responderId)) throw new Error("Cette demande ne t'est pas adressée.");
  db.prepare("DELETE FROM family_proposals WHERE id = ?").run(p.id);
  if (!accept) return p.kind === "marriage" ? `💔 <@${p.to_id}> a refusé la demande en mariage de <@${p.from_id}>.` : `🙅 <@${p.to_id}> a refusé d'être adopté(e) par <@${p.from_id}>.`;
  // La situation a pu changer pendant les 15 minutes : on revérifie tout.
  const problem = checkProposal(guildId, p.kind, p.from_id, p.to_id);
  if (problem) throw new Error(problem);
  if (p.kind === "marriage") {
    const [a, b] = pair(p.from_id, p.to_id);
    db.prepare("INSERT INTO family_marriages(guild_id, a_id, b_id, since) VALUES (?,?,?,?)").run(String(guildId), a, b, now);
    return `💍 <@${p.from_id}> et <@${p.to_id}> sont maintenant marié(e)s ! Bonus de couple actif sur le bonus quotidien de LE FISC.`;
  }
  const spouse = spouseOf(guildId, p.from_id)?.id ?? null;
  db.prepare("INSERT INTO family_children(guild_id, child_id, parent_a, parent_b, since) VALUES (?,?,?,?,?)").run(String(guildId), p.to_id, p.from_id, spouse, now);
  return `👶 <@${p.to_id}> a été adopté(e) par <@${p.from_id}>${spouse ? ` et <@${spouse}>` : ""} !`;
}

export function divorce(guildId, userId) {
  const spouse = spouseOf(guildId, userId);
  if (!spouse) throw new Error("Tu n'es pas marié(e).");
  const [a, b] = pair(userId, spouse.id);
  db.prepare("DELETE FROM family_marriages WHERE guild_id = ? AND a_id = ? AND b_id = ?").run(String(guildId), a, b);
  return `💔 <@${userId}> et <@${spouse.id}> ont divorcé. Les enfants gardent leurs deux parents.`;
}

export function emancipate(guildId, userId) {
  if (!parentsOf(guildId, userId).length) throw new Error("Tu n'as pas de parents dans le serveur.");
  db.prepare("DELETE FROM family_children WHERE guild_id = ? AND child_id = ?").run(String(guildId), String(userId));
  return `🕊️ <@${userId}> a quitté sa famille et vole de ses propres ailes.`;
}

export function disown(guildId, parentId, childId) {
  const parents = parentsOf(guildId, childId);
  if (!parents.includes(String(parentId))) throw new Error("Cette personne n'est pas ton enfant.");
  const other = parents.find((id) => id !== String(parentId));
  // L'autre parent garde son enfant : seul le lien de celui qui renie disparaît.
  if (other) db.prepare("UPDATE family_children SET parent_a = ?, parent_b = NULL WHERE guild_id = ? AND child_id = ?").run(other, String(guildId), String(childId));
  else db.prepare("DELETE FROM family_children WHERE guild_id = ? AND child_id = ?").run(String(guildId), String(childId));
  return `📤 <@${parentId}> ne compte plus <@${childId}> parmi ses enfants.`;
}

/** Bonus de couple de LE FISC : montant ajouté à une récompense, 0 si célibataire. */
export function coupleBonus(guildId, userId, reward) {
  return spouseOf(guildId, userId) ? Math.max(1, Math.round(Number(reward) * COUPLE_BONUS_RATE)) : 0;
}

const list = (ids) => (ids.length ? ids.map((id) => `<@${id}>`).join(", ") : "—");

/** Lignes courtes pour /profil (vide si aucun lien). */
export function familySummary(guildId, userId) {
  const spouse = spouseOf(guildId, userId);
  const parents = parentsOf(guildId, userId);
  const children = childrenOf(guildId, userId);
  const lines = [];
  if (spouse) lines.push(`💍 Marié(e) à <@${spouse.id}> depuis <t:${Math.floor(spouse.since / 1000)}:D>`);
  if (parents.length) lines.push(`👪 Parents : ${list(parents)}`);
  if (children.length) lines.push(`👶 Enfants : ${list(children)}`);
  return lines.join("\n");
}

/** Arbre familial sur trois générations autour du membre. */
export function familyTree(guildId, userId) {
  const parents = parentsOf(guildId, userId);
  const grandparents = [...new Set(parents.flatMap((p) => parentsOf(guildId, p)))];
  const children = childrenOf(guildId, userId);
  const grandchildren = [...new Set(children.flatMap((c) => childrenOf(guildId, c)))];
  const spouse = spouseOf(guildId, userId);
  const siblings = siblingsOf(guildId, userId);
  if (!parents.length && !children.length && !spouse && !siblings.length) return `🌱 <@${userId}> n'a pas encore de famille. \`/famille mariage\` ou \`/famille adopter\` pour commencer.`;
  return [
    `🌳 **Arbre familial de** <@${userId}>`,
    grandparents.length ? `👴 Grands-parents : ${list(grandparents)}` : null,
    parents.length ? `👪 Parents : ${list(parents)}` : null,
    `🧑 <@${userId}>${spouse ? ` 💍 <@${spouse.id}>` : ""}`,
    siblings.length ? `🤝 Frères et sœurs : ${list(siblings)}` : null,
    children.length ? `👶 Enfants : ${list(children)}` : null,
    grandchildren.length ? `🍼 Petits-enfants : ${list(grandchildren)}` : null,
  ].filter(Boolean).join("\n");
}

function proposalCard(kind, fromId, toId, proposalId) {
  const text = kind === "marriage"
    ? `💍 <@${toId}>, <@${fromId}> te demande en mariage ! Tu as 15 minutes pour répondre.`
    : `👶 <@${toId}>, <@${fromId}> veut t'adopter ! Tu as 15 minutes pour répondre.`;
  return {
    content: text,
    components: [{ type: 1, components: [
      { type: 2, style: 3, label: "Accepter", emoji: { name: "✅" }, custom_id: `family:yes:${proposalId}` },
      { type: 2, style: 4, label: "Refuser", emoji: { name: "✖️" }, custom_id: `family:no:${proposalId}` },
    ] }],
    // Seule la personne demandée est notifiée.
    allowedMentions: { users: [String(toId)] },
  };
}

export async function handleFamilyInteraction(interaction) {
  const guild = interaction?.guild;
  if (!guild) return false;
  const userId = interaction.user?.id;
  if (interaction.isButton?.() && String(interaction.customId).startsWith("family:")) {
    const [, answer, proposalId] = interaction.customId.split(":");
    try {
      const text = answerProposal(guild.id, proposalId, userId, answer === "yes");
      await interaction.update({ content: text, components: [], allowedMentions: { parse: [] } });
    } catch (error) {
      await respondInPlaceSafe(interaction, { content: `❌ ${error.message}`, ephemeral: true });
    }
    return true;
  }
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== "famille") return false;
  const sub = interaction.options.getSubcommand();
  const say = (content, ephemeral = false) => interaction.reply({ content, ephemeral, allowedMentions: { parse: [] } });
  try {
    if (sub === "mariage" || sub === "adopter") {
      const target = interaction.options.getUser("membre", true);
      const kind = sub === "mariage" ? "marriage" : "adoption";
      const problem = checkProposal(guild.id, kind, userId, target.id, { toIsBot: Boolean(target.bot) });
      if (problem) { await say(`❌ ${problem}`, true); return true; }
      const id = createProposal(guild.id, kind, userId, target.id);
      await interaction.reply(proposalCard(kind, userId, target.id, id));
      return true;
    }
    if (sub === "divorce") { await say(divorce(guild.id, userId)); return true; }
    if (sub === "emanciper") { await say(emancipate(guild.id, userId)); return true; }
    if (sub === "renier") { await say(disown(guild.id, userId, interaction.options.getUser("membre", true).id)); return true; }
    if (sub === "arbre") { await say(familyTree(guild.id, interaction.options.getUser("membre", false)?.id ?? userId)); return true; }
  } catch (error) {
    await say(`❌ ${error.message}`, true);
    return true;
  }
  return false;
}
