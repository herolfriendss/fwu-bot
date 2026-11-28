// FWU V2 — stabilité : interrupteur par commande, mode maintenance par bot, alerte sur
// erreurs répétées. État dans la base partagée par les 6 bots (aucun redémarrage requis).
import { db } from "./database.js";
import { parsePndOwnerId } from "./pnd-owner-policy.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS command_switches (command TEXT PRIMARY KEY, disabled_by TEXT, reason TEXT, updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS bot_maintenance (profile TEXT PRIMARY KEY, message TEXT, set_by TEXT, updated_at INTEGER NOT NULL);
`);

export function disableCommand(command, { by = null, reason = null } = {}, now = Date.now()) {
  const name = String(command ?? "").trim().toLowerCase().replace(/^[/=+;$-]/, "");
  if (!/^[a-z0-9-]{1,32}$/.test(name)) throw new Error("Nom de commande invalide.");
  if (["stabilite", "aide", "status"].includes(name)) throw new Error("Cette commande ne peut pas être coupée.");
  db.prepare("INSERT INTO command_switches(command, disabled_by, reason, updated_at) VALUES (?,?,?,?) ON CONFLICT(command) DO UPDATE SET disabled_by = excluded.disabled_by, reason = excluded.reason, updated_at = excluded.updated_at").run(name, by, reason, now);
  return name;
}
export function enableCommand(command) {
  return Number(db.prepare("DELETE FROM command_switches WHERE command = ?").run(String(command ?? "").toLowerCase().replace(/^[/=+;$-]/, "")).changes) > 0;
}
export function commandSwitch(command) {
  return db.prepare("SELECT command, reason FROM command_switches WHERE command = ?").get(String(command ?? "").toLowerCase()) ?? null;
}
export function listDisabledCommands() {
  return db.prepare("SELECT command, reason FROM command_switches ORDER BY command").all();
}

export function setMaintenance(profile, message = null, by = null, now = Date.now()) {
  db.prepare("INSERT INTO bot_maintenance(profile, message, set_by, updated_at) VALUES (?,?,?,?) ON CONFLICT(profile) DO UPDATE SET message = excluded.message, set_by = excluded.set_by, updated_at = excluded.updated_at").run(profile, message ? String(message).slice(0, 200) : null, by, now);
}
export function clearMaintenance(profile) {
  db.prepare("DELETE FROM bot_maintenance WHERE profile = ?").run(profile);
}
export function maintenanceState(profile) {
  const row = db.prepare("SELECT message FROM bot_maintenance WHERE profile = ?").get(profile);
  return row ? { message: row.message } : null;
}

export function setGlobalMaintenance(message = null, by = null, now = Date.now()) {
  setMaintenance("*", message, by, now);
}
export function clearGlobalMaintenance() {
  clearMaintenance("*");
}
export function globalMaintenanceState() {
  return maintenanceState("*");
}

/** Validate a global-maintenance panel action against the configured sole OWNER. */
export function parseGlobalMaintenanceButton(customId, actorId, env = process.env) {
  const match = /^stability:global:(on|off):(\\d{5,25})$/.exec(String(customId ?? ""));
  const ownerId = parsePndOwnerId(env.PND_OWNER_DISCORD_ID);
  if (!match || !ownerId || actorId !== ownerId || match[2] !== ownerId) return null;
  return match[1];
}

/** Refus à afficher (ou null) : maintenance du bot puis interrupteur de la commande. L'OWNER passe toujours. */
export function stabilityRefusal({ profile, command, userId, env = process.env }) {
  if (userId && userId === parsePndOwnerId(env.PND_OWNER_DISCORD_ID)) return null;
  const maintenance = globalMaintenanceState() ?? maintenanceState(profile);
  if (maintenance) return `🛠️ Ce bot est en maintenance${maintenance.message ? ` : ${maintenance.message}` : ""}. Réessaie un peu plus tard.`;
  const off = command && command !== "stabilite" ? commandSwitch(command) : null;
  if (off) return `⛔ La commande \`${off.command}\` est temporairement coupée par le staff${off.reason ? ` (${off.reason})` : ""}.`;
  return null;
}

/** Détecteur d'erreurs répétées : au-delà de `threshold` erreurs en `windowMs`, une alerte (au plus une par fenêtre). */
export function createErrorWatch({ threshold = 5, windowMs = 5 * 60_000, onAlert = () => {} } = {}) {
  const seen = new Map();
  const alerted = new Map();
  return (code, now = Date.now()) => {
    const recent = (seen.get(code) ?? []).filter((at) => now - at < windowMs);
    recent.push(now);
    seen.set(code, recent);
    if (recent.length >= threshold && (!alerted.has(code) || now - alerted.get(code) >= windowMs)) {
      alerted.set(code, now);
      try { onAlert(code, recent.length); } catch { /* une alerte ne casse jamais le bot */ }
      return true;
    }
    return false;
  };
}

/** /stabilite commande-off|commande-on|maintenance-on|maintenance-off|etat — OWNER et administrateurs. */
export function runToolCommand({ member, sub, command = null, reason = null, profile }, { env = process.env } = {}) {
  const ok = member?.id === parsePndOwnerId(env.PND_OWNER_DISCORD_ID) || member?.id === member?.guild?.ownerId || member?.permissions?.has?.(8n);
  if (!ok) return "⛔ Réservé à l'OWNER et aux administrateurs.";
  try {
    if (sub === "commande-off") return `✅ \`${disableCommand(command, { by: member.id, reason })}\` coupée sur les 6 bots.`;
    if (sub === "commande-on") return enableCommand(command) ? `✅ \`${command}\` rétablie.` : "ℹ️ Cette commande n'était pas coupée.";
    if (sub === "maintenance-on") { setMaintenance(profile, reason, member.id); return "🛠️ Maintenance du bot activée."; }
    if (sub === "maintenance-off") { clearMaintenance(profile); return "✅ Maintenance du bot terminée."; }
    if (sub === "maintenance-global-on") {
      if (member.id !== parsePndOwnerId(env.PND_OWNER_DISCORD_ID)) return "⛔ Seul l'OWNER peut activer la maintenance globale.";
      setGlobalMaintenance(reason, member.id);
      return "🛠️ Maintenance globale activée : les commandes sont suspendues sur tous les bots.";
    }
    if (sub === "maintenance-global-off") {
      if (member.id !== parsePndOwnerId(env.PND_OWNER_DISCORD_ID)) return "⛔ Seul l'OWNER peut terminer la maintenance globale.";
      if (!globalMaintenanceState()) return "ℹ️ Aucune maintenance globale n'est active.";
      clearGlobalMaintenance();
      return "✅ Maintenance globale terminée : les commandes sont rétablies sur tous les bots.";
    }
    const off = listDisabledCommands();
    const global = globalMaintenanceState();
    const m = maintenanceState(profile);
    return `**Maintenance globale** : ${global ? `🛠️ active${global.message ? ` (${global.message})` : ""}` : "non"}\n**Maintenance de ce bot** : ${m ? `🛠️ active${m.message ? ` (${m.message})` : ""}` : "non"}\n**Commandes coupées** : ${off.length ? off.map((c) => `\`${c.command}\``).join(", ") : "aucune"}`;
  } catch (error) {
    return `❌ ${error?.message ?? "Action impossible."}`;
  }
}
