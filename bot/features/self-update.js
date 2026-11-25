// SUCK ME — /maj : the VPS updates itself from GitHub (OWNER only), so no computer is needed.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

/** Detached launch: the script survives the PM2 restarts it triggers (reparented to init). */
export function launchUpdate(spawnFn = spawn, script = SCRIPT()) {
  const child = spawnFn("bash", ["-c", 'setsid nohup bash "$0" >/dev/null 2>&1 < /dev/null &', script], { detached: true, stdio: "ignore" });
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
    await interaction.reply({ content: `${statusText(status)}${log ? `\n\`\`\`\n${log.replace(/`/g, "'")}\n\`\`\`` : ""}`.slice(0, 1990), ephemeral: true, allowedMentions: { parse: [] } });
    return true;
  }
  if (!existsSync(SCRIPT())) {
    await interaction.reply({ content: "❌ La mise à jour automatique n'est pas encore installée sur le VPS. Fais une dernière mise à jour depuis un ordinateur (FWU-MAJ-COMPLETE.sh) et colle le jeton GitHub quand il est demandé.", ephemeral: true });
    return true;
  }
  if (!canStartUpdate(status)) {
    await interaction.reply({ content: `⏳ Une mise à jour est déjà en cours : ${status.step}. Suis-la avec \`/maj etat\`.`, ephemeral: true });
    return true;
  }
  launchUpdate(spawnFn);
  await interaction.reply({ content: "🚀 Mise à jour lancée depuis GitHub : FWU et le site, puis les 4 bots (10 à 30 min). Les bots vont redémarrer chacun leur tour : c'est normal.\nSuis l'avancement avec `/maj etat`. Je t'enverrai le résultat en message privé.", ephemeral: true });
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
  await user?.send(status.state === "done" ? `✅ Mise à jour FWU terminée : ${status.step}. Ferme et rouvre Discord pour voir les nouvelles commandes.` : `❌ Mise à jour FWU échouée : ${status.step}\nDétails : \`/maj etat\`.`).catch(() => {});
  return true;
}
