// FWU WET — registre réseau de sanctions durables et de comptes liés confirmés.
//
// WET est distinct de la blacklist locale : une décision OWNER s'applique à tous
// les serveurs FWU accessibles aux bots GUARD. Seules des données Discord
// normalement accessibles sont conservées (ID, nom au moment de la décision,
// date publique de création du compte, motif et liens de preuve).
// Aucun IP, MAC, identifiant matériel, empreinte d'appareil ou donnée privée
// inaccessible via l'API Discord n'est collecté.
// Les ressemblances détectées par GUARD restent des alertes humaines : elles ne
// créent jamais de lien WET et ne déclenchent jamais une sanction seules.

import { randomUUID } from "node:crypto";
import { db } from "./database.js";
import { sendCentralLog, systemLogEmbed } from "./logs.js";
import { parsePndOwnerId } from "./pnd-owner-policy.js";
import { isSysPlus } from "./systems/sysplus/permissions.js";

const SNOWFLAKE = /^\d{5,25}$/;
const MAX_REASON = 300;
const MAX_EVIDENCE = 1000;

db.exec(`
  CREATE TABLE IF NOT EXISTS wet_cases (
    id TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    evidence_url TEXT NOT NULL,
    source_guild_id TEXT NOT NULL,
    added_by TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
    revoked_by TEXT,
    revoked_at INTEGER,
    revoke_reason TEXT
  );
  CREATE INDEX IF NOT EXISTS wet_cases_status_idx ON wet_cases(status, added_at DESC);
  CREATE TABLE IF NOT EXISTS wet_case_accounts (
    case_id TEXT NOT NULL REFERENCES wet_cases(id),
    user_id TEXT NOT NULL,
    username_snapshot TEXT NOT NULL DEFAULT '',
    account_created_at INTEGER,
    linked_from_id TEXT,
    link_reason TEXT,
    link_evidence_url TEXT,
    linked_by TEXT NOT NULL,
    linked_at INTEGER NOT NULL,
    PRIMARY KEY(case_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS wet_case_accounts_user_idx ON wet_case_accounts(user_id, case_id);
  CREATE TABLE IF NOT EXISTS wet_audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    target_user_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('created','account_linked','revoked')),
    reason TEXT NOT NULL DEFAULT '',
    evidence_url TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS wet_audit_case_idx ON wet_audit_events(case_id, created_at DESC);
`);

export const WET_DENIED = "⛔ La gestion WET est réservée à l'OWNER technique. La consultation est réservée à l'OWNER et aux SYS+.";

export function isWetOwner(member) {
  return Boolean(member?.id && parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID) === member.id);
}

export function canReadWet(member, settings = null) {
  if (!member?.id) return false;
  if (isWetOwner(member)) return true;
  return isSysPlus(member, settings?.sysPlus?.roleId ?? null);
}

function validSnowflake(value) {
  return SNOWFLAKE.test(String(value ?? ""));
}

function requireWetOwner(actorId) {
  if (parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID) !== actorId) {
    throw new Error("Seul l'OWNER technique peut modifier un dossier WET.");
  }
}

function cleanReason(value) {
  const reason = String(value ?? "").trim().slice(0, MAX_REASON);
  if (reason.length < 10) throw new Error("Indique un motif précis d'au moins 10 caractères.");
  return reason;
}

function cleanEvidence(value) {
  const evidence = String(value ?? "").trim().slice(0, MAX_EVIDENCE);
  let parsed;
  try { parsed = new URL(evidence); } catch { throw new Error("Une preuve doit être un lien HTTPS consultable."); }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error("Une preuve doit être un lien HTTPS consultable.");
  }
  return parsed.toString();
}

function ensureTargetAllowed(user, client, guilds) {
  if (!user || !validSnowflake(user.id)) throw new Error("Compte Discord introuvable.");
  if (user.bot) throw new Error("Un bot ne peut pas être placé dans le registre WET.");
  const ownerId = parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);
  if (user.id === ownerId || user.id === client?.user?.id) throw new Error("Ce compte est protégé et ne peut pas être placé en WET.");
  // Être propriétaire d'un serveur ne protège pas un compte dans les autres
  // serveurs du réseau : le bannissement est simplement ignoré sur son propre
  // serveur par banWetAccountsAcrossNetwork().
  void guilds;
}

export function getActiveWetCase(userId) {
  if (!validSnowflake(userId)) return null;
  return db.prepare(`
    SELECT c.id, c.reason, c.evidence_url, c.source_guild_id, c.added_by, c.added_at,
      a.username_snapshot, a.account_created_at, a.linked_from_id, a.link_reason, a.link_evidence_url
    FROM wet_case_accounts a JOIN wet_cases c ON c.id=a.case_id
    WHERE a.user_id=? AND c.status='active'
    ORDER BY c.added_at DESC LIMIT 1
  `).get(userId) ?? null;
}

export function isWet(userId) {
  return Boolean(getActiveWetCase(userId));
}

export function getWetCaseAccounts(caseId) {
  return db.prepare(`
    SELECT user_id, username_snapshot, account_created_at, linked_from_id, link_reason,
      link_evidence_url, linked_by, linked_at
    FROM wet_case_accounts WHERE case_id=? ORDER BY linked_at ASC
  `).all(caseId);
}

export function listWetCases(limit = 20) {
  const cases = db.prepare(`
    SELECT id, reason, evidence_url, source_guild_id, added_by, added_at
    FROM wet_cases WHERE status='active' ORDER BY added_at DESC LIMIT ?
  `).all(Math.min(50, Math.max(1, Number(limit) || 20)));
  return cases.map((entry) => ({ ...entry, accounts: getWetCaseAccounts(entry.id) }));
}

function addAudit({ caseId, guildId, actorId, targetId, action, reason, evidence, now }) {
  db.prepare(`
    INSERT INTO wet_audit_events(case_id,guild_id,actor_id,target_user_id,action,reason,evidence_url,created_at)
    VALUES(?,?,?,?,?,?,?,?)
  `).run(caseId, guildId, actorId, targetId, action, reason ?? "", evidence ?? "", now);
}

function createCaseRecord({ guildId, actorId, user, reason, evidence, now }) {
  const existing = getActiveWetCase(user.id);
  if (existing) throw new Error(`Ce compte est déjà en WET (dossier ${existing.id.slice(0, 8)}).`);
  const caseId = randomUUID();
  db.exec("BEGIN IMMEDIATE");
  try {
    // Recheck under the write lock to avoid two GUARD processes creating parallel cases.
    if (getActiveWetCase(user.id)) throw new Error("Ce compte vient d'être placé en WET par une autre session.");
    db.prepare(`
      INSERT INTO wet_cases(id,reason,evidence_url,source_guild_id,added_by,added_at,status)
      VALUES(?,?,?,?,?,?,'active')
    `).run(caseId, reason, evidence, guildId, actorId, now);
    db.prepare(`
      INSERT INTO wet_case_accounts(case_id,user_id,username_snapshot,account_created_at,linked_by,linked_at)
      VALUES(?,?,?,?,?,?)
    `).run(caseId, user.id, String(user.username ?? "").slice(0, 100), Number.isFinite(user.createdTimestamp) ? user.createdTimestamp : null, actorId, now);
    addAudit({ caseId, guildId, actorId, targetId: user.id, action: "created", reason, evidence, now });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return caseId;
}

export function createWetCase({ guildId, actorId, user, reason, evidence, now = Date.now() }) {
  if (!validSnowflake(guildId) || !validSnowflake(actorId)) throw new Error("Contexte serveur ou auteur invalide.");
  requireWetOwner(actorId);
  if (!validSnowflake(user?.id)) throw new Error("Identifiant Discord invalide.");
  if (user.bot) throw new Error("Un bot ne peut pas être placé dans le registre WET.");
  const protectedOwner = parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);
  if (user.id === protectedOwner) throw new Error("Le compte OWNER technique est protégé et ne peut pas être placé en WET.");
  return createCaseRecord({ guildId, actorId, user, reason: cleanReason(reason), evidence: cleanEvidence(evidence), now });
}

export function linkWetAccount({ guildId, actorId, sourceUserId, user, reason, evidence, now = Date.now() }) {
  if (!validSnowflake(guildId) || !validSnowflake(actorId) || !validSnowflake(sourceUserId) || !validSnowflake(user?.id)) {
    throw new Error("Identifiant Discord invalide.");
  }
  requireWetOwner(actorId);
  if (user.bot) throw new Error("Un bot ne peut pas être relié à un dossier WET.");
  const protectedOwner = parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);
  if (user.id === protectedOwner) throw new Error("Le compte OWNER technique est protégé et ne peut pas être relié à un dossier WET.");
  if (sourceUserId === user.id) throw new Error("Un compte ne peut pas être lié à lui-même.");
  const source = getActiveWetCase(sourceUserId);
  if (!source) throw new Error("Le compte source n'est pas dans un dossier WET actif.");
  const existing = getActiveWetCase(user.id);
  if (existing) throw new Error(`Ce compte est déjà lié à un dossier WET actif (${existing.id.slice(0, 8)}).`);
  const cleanWhy = cleanReason(reason);
  const proof = cleanEvidence(evidence);
  db.exec("BEGIN IMMEDIATE");
  try {
    const currentSource = getActiveWetCase(sourceUserId);
    if (!currentSource || currentSource.id !== source.id) throw new Error("Le dossier source WET a été levé ou modifié pendant l'opération.");
    if (getActiveWetCase(user.id)) throw new Error("Ce compte vient d'être lié à un dossier WET par une autre session.");
    db.prepare(`
      INSERT INTO wet_case_accounts(case_id,user_id,username_snapshot,account_created_at,linked_from_id,
        link_reason,link_evidence_url,linked_by,linked_at)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).run(source.id, user.id, String(user.username ?? "").slice(0, 100),
      Number.isFinite(user.createdTimestamp) ? user.createdTimestamp : null,
      sourceUserId, cleanWhy, proof, actorId, now);
    addAudit({ caseId: source.id, guildId, actorId, targetId: user.id, action: "account_linked", reason: cleanWhy, evidence: proof, now });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return source.id;
}

export function revokeWetCase(userId, { guildId, actorId, reason, now = Date.now() } = {}) {
  if (!validSnowflake(userId) || !validSnowflake(guildId) || !validSnowflake(actorId)) throw new Error("Identifiant Discord invalide.");
  requireWetOwner(actorId);
  const cleanWhy = cleanReason(reason);
  const active = getActiveWetCase(userId);
  if (!active) return null;
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = db.prepare("SELECT id FROM wet_cases WHERE id=? AND status='active'").get(active.id);
    if (!current) throw new Error("Ce dossier WET vient d'être levé par une autre session.");
    db.prepare(`
      UPDATE wet_cases SET status='revoked', revoked_by=?, revoked_at=?, revoke_reason=?
      WHERE id=? AND status='active'
    `).run(actorId, now, cleanWhy, active.id);
    addAudit({ caseId: active.id, guildId, actorId, targetId: userId, action: "revoked", reason: cleanWhy, evidence: "", now });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { ...active, accounts: getWetCaseAccounts(active.id), revokedBy: actorId, revokedAt: now, revokeReason: cleanWhy };
}

function banReason(entry) {
  return `WET · dossier ${entry.id.slice(0, 8)} · ${entry.reason}`.slice(0, 500);
}

export async function banWetAccountsAcrossNetwork(client, accounts, entry, networkGuilds = null) {
  const guilds = [...(networkGuilds ?? client?.guilds?.cache?.values?.() ?? [])];
  const results = { banned: 0, alreadyBanned: 0, skippedOwner: 0, failed: [] };
  for (const account of accounts) {
    for (const guild of guilds) {
      if (guild.ownerId === account.user_id) { results.skippedOwner++; continue; }
      try {
        const existing = await guild.bans.fetch(account.user_id).catch((error) => {
          if (Number(error?.code) === 10026) return null;
          throw error;
        });
        if (existing) { results.alreadyBanned++; continue; }
        await guild.bans.create(account.user_id, { reason: banReason(entry) });
        results.banned++;
      } catch (error) {
        results.failed.push({ guildId: guild.id, userId: account.user_id, code: Number(error?.code) || null });
      }
    }
  }
  return results;
}

export async function unbanWetAccountsAcrossNetwork(client, accounts, actorId, caseEntry, networkGuilds = null) {
  const guilds = [...(networkGuilds ?? client?.guilds?.cache?.values?.() ?? [])];
  const results = { unbanned: 0, notBanned: 0, stillBlacklisted: 0, stillWet: 0, preservedOtherBan: 0, failed: [] };
  if (!caseEntry || typeof caseEntry.id !== "string" || typeof caseEntry.reason !== "string") {
    throw new Error("Le dossier WET complet est requis pour vérifier l’origine exacte du bannissement.");
  }
  const expectedBanReason = banReason(caseEntry);
  for (const account of accounts) {
    if (isWet(account.user_id)) { results.stillWet++; continue; }
    for (const guild of guilds) {
      if (guild.ownerId === account.user_id) continue;
      try {
        const stillBlacklisted = db.prepare("SELECT 1 FROM blacklist_entries WHERE guild_id=? AND user_id=?").get(guild.id, account.user_id);
        if (stillBlacklisted) { results.stillBlacklisted++; continue; }
      } catch (error) {
        // Fail closed: never lift a ban when the local blacklist cannot be read.
        results.failed.push({ guildId: guild.id, userId: account.user_id, code: Number(error?.code) || null, reason: "blacklist_unreadable" });
        continue;
      }
      let existingBan;
      try {
        existingBan = await guild.bans.fetch(account.user_id);
      } catch (error) {
        if (Number(error?.code) === 10026) { results.notBanned++; continue; }
        results.failed.push({ guildId: guild.id, userId: account.user_id, code: Number(error?.code) || null, reason: "ban_lookup_failed" });
        continue;
      }
      if (!existingBan) { results.notBanned++; continue; }
      // Never lift a manual or pre-existing ban: only remove a ban whose audit
      // reason proves it was created by this exact WET case.
      if (String(existingBan.reason ?? "") !== expectedBanReason) {
        results.preservedOtherBan++;
        continue;
      }
      try {
        await guild.bans.remove(account.user_id, `WET levé par ${actorId} · dossier ${caseEntry.id.slice(0, 8)}`.slice(0, 500));
        results.unbanned++;
      } catch (error) {
        if (Number(error?.code) === 10026) results.notBanned++;
        else results.failed.push({ guildId: guild.id, userId: account.user_id, code: Number(error?.code) || null });
      }
    }
  }
  return results;
}

/** guildMemberAdd: the primary account and every manually confirmed linked account are enforced. */
export async function enforceWetOnJoin(member, record = () => {}) {
  if (!member?.guild) return false;
  // Read the case once: a concurrent /unwet must not leave a stale positive
  // check that blocks a member after the case has already been revoked.
  const entry = getActiveWetCase(member.id);
  if (!entry) return false;
  try {
    await member.ban({ reason: banReason(entry) });
    record("wet_rebanned");
  } catch {
    record("wet_reban_error");
  }
  // A WET account must never continue through welcome/automation, even if
  // Discord denies the ban because the bot is below the target's role.
  return true;
}

function formatCase(entry) {
  const accounts = entry.accounts.map((account) => {
    const created = Number.isFinite(account.account_created_at) && account.account_created_at > 0
      ? ` · créé <t:${Math.floor(account.account_created_at / 1000)}:R>`
      : "";
    return `• <@${account.user_id}> (${account.user_id})${account.linked_from_id ? ` — lié à ${account.linked_from_id}` : " — compte principal"}${created}`;
  }).join("\n");
  return [
    `**Dossier WET ${entry.id.slice(0, 8)}**`,
    `Motif : ${entry.reason}`,
    `Preuve : ${entry.evidence_url}`,
    `Par : <@${entry.added_by}> · <t:${Math.floor(entry.added_at / 1000)}:R>`,
    accounts,
  ].join("\n").slice(0, 1800);
}

export async function handleWetInteraction(interaction, settings = null, networkGuildsInput = null) {
  if (!interaction?.isChatInputCommand?.() || !["wet", "unwet"].includes(interaction.commandName)) return false;
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: "Cette commande s'utilise sur un serveur.", ephemeral: true }).catch(() => {});
    return true;
  }
  const owner = isWetOwner(interaction.member);
  const readAllowed = canReadWet(interaction.member, settings);
  if (!readAllowed) {
    await interaction.reply({ content: WET_DENIED, ephemeral: true }).catch(() => {});
    return true;
  }
  const command = interaction.commandName;
  const networkGuilds = [...(networkGuildsInput ?? interaction.client.guilds.cache.values())];
  const action = command === "unwet" ? "revoke" : interaction.options.getSubcommand(false);
  if (command === "unwet" || ["ajouter", "lier"].includes(action)) {
    if (!owner) {
      await interaction.reply({ content: "⛔ Seul l'OWNER technique peut créer, relier ou lever un dossier WET.", ephemeral: true }).catch(() => {});
      return true;
    }
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    if (command === "wet" && action === "liste") {
      const rows = listWetCases(15);
      const text = rows.length ? rows.map(formatCase).join("\n\n") : "Aucun dossier WET actif.";
      await interaction.editReply({ content: text.slice(0, 1900), allowedMentions: { parse: [] } });
      return true;
    }
    if (command === "wet" && action === "verifier") {
      const userId = interaction.options.getString("id", true).trim();
      if (!validSnowflake(userId)) throw new Error("Identifiant Discord invalide.");
      const entry = getActiveWetCase(userId);
      await interaction.editReply({ content: entry ? formatCase({ ...entry, accounts: getWetCaseAccounts(entry.id) }) : `✅ ${userId} n'est dans aucun dossier WET actif.`, allowedMentions: { parse: [] } });
      return true;
    }
    if (command === "wet" && action === "ajouter") {
      const userId = interaction.options.getString("id", true).trim();
      if (!validSnowflake(userId)) throw new Error("Identifiant Discord invalide.");
      const user = await interaction.client.users.fetch(userId).catch(() => null);
      ensureTargetAllowed(user, interaction.client, networkGuilds);
      const reason = interaction.options.getString("raison", true);
      const evidence = interaction.options.getString("preuve", true);
      const caseId = createWetCase({ guildId: interaction.guild.id, actorId: interaction.user.id, user, reason, evidence });
      const accounts = getWetCaseAccounts(caseId);
      const result = await banWetAccountsAcrossNetwork(interaction.client, accounts, { id: caseId, reason }, networkGuilds);
      await sendCentralLog(interaction.guild, settings, systemLogEmbed({
        category: "moderation",
        title: "⛔ WET — dossier créé",
        description: `Compte : <@${userId}> (${userId})\nMotif : ${reason}\nPreuve : ${cleanEvidence(evidence)}\nBannissements envoyés : ${result.banned}\nÉchecs : ${result.failed.length}`,
        color: 0x991b1b,
      })).catch(() => {});
      await interaction.editReply({
        content: `⛔ Dossier WET ${caseId.slice(0, 8)} créé pour <@${userId}>. Bannissements envoyés : **${result.banned}** · déjà bannis : **${result.alreadyBanned}** · échecs : **${result.failed.length}**. Le registre est actif sur tous les serveurs autorisés ; les comptes seront rebannis à leur arrivée même si un bannissement immédiat a échoué.`,
        allowedMentions: { parse: [] },
      });
      return true;
    }
    if (command === "wet" && action === "lier") {
      const sourceUserId = interaction.options.getString("source", true).trim();
      const userId = interaction.options.getString("compte", true).trim();
      if (!validSnowflake(userId) || !validSnowflake(sourceUserId)) throw new Error("Identifiant Discord invalide.");
      const user = await interaction.client.users.fetch(userId).catch(() => null);
      ensureTargetAllowed(user, interaction.client, networkGuilds);
      const reason = interaction.options.getString("raison", true);
      const evidence = interaction.options.getString("preuve", true);
      const caseId = linkWetAccount({ guildId: interaction.guild.id, actorId: interaction.user.id, sourceUserId, user, reason, evidence });
      const entry = getActiveWetCase(sourceUserId);
      const accounts = getWetCaseAccounts(caseId);
      const result = await banWetAccountsAcrossNetwork(interaction.client, accounts.filter((a) => a.user_id === userId), entry, networkGuilds);
      await sendCentralLog(interaction.guild, settings, systemLogEmbed({
        category: "moderation",
        title: "⛔ WET — compte lié",
        description: `Compte : <@${userId}> (${userId})\nCompte source : ${sourceUserId}\nMotif : ${reason}\nPreuve : ${cleanEvidence(evidence)}\nBannissements envoyés : ${result.banned} · échecs : ${result.failed.length}`,
        color: 0x991b1b,
      })).catch(() => {});
      await interaction.editReply({ content: `Compte <@${userId}> relié au dossier WET ${caseId.slice(0, 8)} sur preuve documentée. Bannissements envoyés : **${result.banned}** · échecs : **${result.failed.length}**.`, allowedMentions: { parse: [] } });
      return true;
    }
    if (command === "unwet") {
      const userId = interaction.options.getString("id", true).trim();
      const reason = interaction.options.getString("raison", true);
      const revoked = revokeWetCase(userId, { guildId: interaction.guild.id, actorId: interaction.user.id, reason });
      if (!revoked) {
        await interaction.editReply({ content: `ℹ️ ${userId} n'appartient à aucun dossier WET actif.`, allowedMentions: { parse: [] } });
        return true;
      }
      const result = await unbanWetAccountsAcrossNetwork(interaction.client, revoked.accounts, interaction.user.id, revoked, networkGuilds);
      await sendCentralLog(interaction.guild, settings, systemLogEmbed({
        category: "moderation",
        title: "♻️ WET — dossier levé",
        description: `Dossier : ${revoked.id}\nComptes : ${revoked.accounts.map((a) => a.user_id).join(", ")}\nMotif de levée : ${reason}\nDébannissements WET : ${result.unbanned} · bans indépendants conservés : ${result.preservedOtherBan} · WET encore actif : ${result.stillWet} · blacklist locale : ${result.stillBlacklisted} · échecs : ${result.failed.length}`,
        color: 0x22c55e,
      })).catch(() => {});
      await interaction.editReply({
        content: `♻️ Dossier WET ${revoked.id.slice(0, 8)} levé pour ${revoked.accounts.length} compte(s). Débannissements WET : **${result.unbanned}** · sanctions indépendantes conservées : **${result.preservedOtherBan}** · WET encore actif : **${result.stillWet}** · blacklist locale : **${result.stillBlacklisted}** · déjà absents : **${result.notBanned}** · échecs : **${result.failed.length}**.`,
        allowedMentions: { parse: [] },
      });
      return true;
    }
    await interaction.editReply({ content: "Action WET inconnue.", allowedMentions: { parse: [] } });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error instanceof Error ? error.message : "Action WET impossible."}`, allowedMentions: { parse: [] } }).catch(() => {});
  }
  return true;
}
