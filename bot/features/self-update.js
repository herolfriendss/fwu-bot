// SUCK ME — /maj : the VPS updates itself from GitHub (OWNER only), so no computer is needed.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { parsePndOwnerId } from "../pnd-owner-policy.js";

export const SELF_UPDATE_COMMANDS = new Set(["maj"]);
const SCRIPT = () => process.env.FWU_AUTO_UPDATE_SCRIPT ?? "/home/opc/fwu-auto-update.sh";
const DATA = () => process.env.FWU_UPDATE_DATA_DIR ?? "/home/opc/fwu-data";
const STALE_MS = 90 * 60_000;

export function readUpdateStatus(dir = DATA()) {
  try { return JSON.parse(readFileSync(`${dir}/maj-status.json`, "utf8")); } catch { return null; }
}

/** Last log lines, with anything token-like masked (defence in depth: the script never logs it). */
export function readUpdateLog(dir = DATA(), lines = 15) {
  let text = "";
  try { text = readFileSync(`${dir}/maj.log`, "utf8"); } catch { return ""; }
  return text.split("\n").filter(Boolean).slice(-lines).join("\n")
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[masqué]").slice(-1800);
}

/** Pure: may a new update start now? */
export function canStartUpdate(status, now = Date.now()) {
  if (status?.state !== "running") return true;
  return now - Number(status.at ?? 0) * 1000 > STALE_MS;
}

/** Version numérotée (« v1.2.0 » ou « 1.2.0 »), ou null si le texte n'en est pas une. */
export function parseVersionTag(value) {
  const text = String(value ?? "").trim();
  const match = /^v?(\d{1,4}\.\d{1,4}\.\d{1,4})$/.exec(text);
  return match ? `v${match[1]}` : null;
}

export function readInstalledVersion(dir = DATA()) {
  try { return readFileSync(`${dir}/version-installee`, "utf8").trim() || null; } catch { return null; }
}

/**
 * The update script restarts the OTHER processes with `pm2 --update-env`: whatever this bot has in its
 * environment would be copied into them (a SUCK ME launching the update turned her-v5-bot into a second
 * SUCK ME). So the script only gets the environment without anything specific to one bot.
 */
export function cleanUpdateEnv(env = process.env) {
  const out = { ...env };
  for (const key of Object.keys(out)) {
    if (key === "DISCORD_TOKEN" || key === "PND_BOT_PROFILE" || key === "PND_FWU_DELEGATED" || /^PND_[A-Z]+_(TOKEN|GUILD_IDS)$/.test(key)) delete out[key];
  }
  return out;
}

/** Detached launch: the script survives the PM2 restarts it triggers (reparented to init). */
export function launchUpdate(spawnFn = spawn, script = SCRIPT(), version = null) {
  const args = version
    ? ["-c", 'setsid nohup bash "$0" "$1" >/dev/null 2>&1 < /dev/null &', script, version]
    : ["-c", 'setsid nohup bash "$0" >/dev/null 2>&1 < /dev/null &', script];
  const child = spawnFn("bash", args, { detached: true, stdio: "ignore", env: cleanUpdateEnv() });
  child.unref?.();
}

function statusText(status) {
  if (!status) return "Aucune mise à jour lancée pour l'instant.";
  const when = `<t:${status.at}:R>`;
  return { running: `⏳ En cours : **${status.step}** (${when})`, done: `✅ ${status.step} (${when})`, failed: `❌ Échec : ${status.step} (${when})` }[status.state] ?? `État : ${status.state}`;
}

export async function handleSelfUpdateInteraction(interaction, { spawnFn = spawn } = {}) {
  if (!interaction.isChatInputCommand?.() || !SELF_UPDATE_COMMANDS.has(interaction.commandName)) return false;
  const ownerId = parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);
  if (!ownerId || interaction.user.id !== ownerId) {
    await interaction.reply({ content: "⛔ Seul l'OWNER peut mettre les bots à jour.", ephemeral: true });
    return true;
  }
  const sub = interaction.options.getSubcommand();
  const status = readUpdateStatus();
  if (sub === "etat") {
    const log = readUpdateLog();
    const installed = readInstalledVersion();
    await interaction.reply({ content: `Version installée : **${installed ?? "inconnue"}**\n${statusText(status)}${log ? `\n\`\`\`\n${log.replace(/`/g, "'")}\n\`\`\`` : ""}`.slice(0, 1990), ephemeral: true, allowedMentions: { parse: [] } });
    return true;
  }
  if (!existsSync(SCRIPT())) {
    await interaction.reply({ content: "❌ La mise à jour automatique n'est pas encore installée sur le VPS. Fais une dernière mise à jour depuis un ordinateur (script de mise à jour complète) et colle le jeton GitHub quand il est demandé.", ephemeral: true });
    return true;
  }
  if (!canStartUpdate(status)) {
    await interaction.reply({ content: `⏳ Une mise à jour est déjà en cours : ${status.step}. Suis-la avec \`/maj etat\`.`, ephemeral: true });
    return true;
  }
  const rawVersion = interaction.options.getString?.("version") ?? null;
  const version = rawVersion ? parseVersionTag(rawVersion) : null;
  if (rawVersion && !version) {
    await interaction.reply({ content: "❌ Version illisible. Exemple : `v1.2.0`. Laisse vide pour la dernière version publiée.", ephemeral: true });
    return true;
  }
  launchUpdate(spawnFn, SCRIPT(), version);
  const target = version ? `la version **${version}**` : "la dernière version publiée (ou main s'il n'y en a pas encore)";
  await interaction.reply({ content: `🚀 Mise à jour lancée vers ${target} : le bot principal et le site, puis les 4 autres bots (10 à 30 min). Les bots vont redémarrer chacun leur tour : c'est normal.\nSuis l'avancement avec \`/maj etat\`. Je t'enverrai le résultat en message privé.`, ephemeral: true });
  return true;
}

/** At startup: DM the OWNER once with the result of the last finished update. */
export async function announceUpdateResult(client, dir = DATA()) {
  const status = readUpdateStatus(dir);
  if (!status || status.state === "running" || status.announced) return false;
  const ownerId = parsePndOwnerId(process.env.PND_OWNER_DISCORD_ID);
  if (!ownerId) return false;
  try { writeFileSync(`${dir}/maj-status.json`, JSON.stringify({ ...status, announced: true })); } catch { return false; }
  const user = await client.users.fetch(ownerId).catch(() => null);
  await user?.send(status.state === "done" ? `✅ Mise à jour terminée : ${status.step}. Ferme et rouvre Discord pour voir les nouvelles commandes.` : `❌ Mise à jour échouée : ${status.step}\nDétails : \`/maj etat\`.`).catch(() => {});
  return true;
}

/**
 * V2 — mise à jour automatique : chaque jour à 8 h (heure de Paris, réglable par
 * FWU_AUTO_UPDATE_HOUR=0..23), SUCK ME lance le script en mode --auto ; il ne réinstalle que si
 * main (ou la dernière version publiée) a changé. FWU_AUTO_UPDATE=off la désactive.
 *
 * Rattrapage : si le bot était arrêté à l'heure prévue, le contrôle a lieu à son redémarrage, mais
 * seulement pendant AUTO_UPDATE_CATCH_UP_HOURS heures (pas de redémarrage général en pleine soirée).
 * Un seul contrôle par jour, même après plusieurs redémarrages : le jour du dernier contrôle est
 * noté dans fwu-data/auto-update-jour, et une mise à jour (manuelle ou auto) terminée ou échouée
 * aujourd'hui compte aussi.
 */
export const AUTO_UPDATE_DEFAULT_HOUR = 8;
export const AUTO_UPDATE_CATCH_UP_HOURS = 4;

/** Heure configurée, ou 8 si la valeur n'est pas un entier 0..23 écrit en chiffres (« 8abc » refusé). */
export function parseAutoUpdateHour(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,2}$/.test(text)) return AUTO_UPDATE_DEFAULT_HOUR;
  const hour = Number(text);
  return hour <= 23 ? hour : AUTO_UPDATE_DEFAULT_HOUR;
}

function parisParts(date) {
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

export function autoUpdateDue({ now = new Date(), lastRunDay = null, env = process.env, status = null } = {}) {
  if (String(env.FWU_AUTO_UPDATE ?? "on").trim().toLowerCase() === "off") return false;
  if (!canStartUpdate(status, now.getTime())) return false;
  const hour = parseAutoUpdateHour(env.FWU_AUTO_UPDATE_HOUR);
  const { day, hour: current } = parisParts(now);
  const statusTimestamp = Number(status?.at);
  const statusDay = Number.isFinite(statusTimestamp) && statusTimestamp > 0 ? parisParts(new Date(statusTimestamp * 1000)).day : null;
  if (day === lastRunDay || (statusDay === day && status?.state !== "running")) return false;
  return current >= hour && current < hour + AUTO_UPDATE_CATCH_UP_HOURS ? day : false;
}

const LAST_DAY_FILE = (dir) => `${dir}/auto-update-jour`;
export function readAutoUpdateDay(dir = DATA()) {
  try {
    const text = readFileSync(LAST_DAY_FILE(dir), "utf8").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  } catch { return null; }
}
function writeAutoUpdateDay(day, dir = DATA()) {
  try { writeFileSync(`${LAST_DAY_FILE(dir)}.tmp`, `${day}\n`); renameSync(`${LAST_DAY_FILE(dir)}.tmp`, LAST_DAY_FILE(dir)); return true; } catch { return false; }
}

export function startAutoUpdate({ spawnFn = spawn, record = () => {}, env = process.env, intervalMs = 15 * 60_000, dir = DATA(), now = () => new Date(), scriptExists = existsSync } = {}) {
  let lastRunDay = readAutoUpdateDay(dir);
  const tick = () => {
    try {
      const day = autoUpdateDue({ now: now(), lastRunDay, env, status: readUpdateStatus(dir) });
      if (!day) return false;
      lastRunDay = day;
      // Noté avant le lancement : le script redémarre SUCK ME, qui ne doit pas relancer un contrôle.
      // Si le marqueur ne peut pas être persisté, ne lance pas une mise à jour qui pourrait repartir en boucle après redémarrage.
      if (!writeAutoUpdateDay(day, dir)) { record("auto_update_error"); return false; }
      if (!scriptExists(SCRIPT())) { record("auto_update_error"); return false; }
      launchUpdate(spawnFn, SCRIPT(), "--auto");
      record("auto_update_check");
      return true;
    } catch {
      record("auto_update_error");
      return false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}
