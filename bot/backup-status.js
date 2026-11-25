// Dernière sauvegarde quotidienne (scripts/installation/fwu-sauvegarde.sh), pour /sysp diagnostic bots.
import { readFileSync } from "node:fs";

const DATA = () => process.env.FWU_UPDATE_DATA_DIR ?? "/home/opc/fwu-data";
const MAX_AGE_S = 36 * 60 * 60;

export function readBackupStatus(dir = DATA()) {
  try {
    return JSON.parse(readFileSync(`${dir}/sauvegarde-status.json`, "utf8"));
  } catch {
    return null;
  }
}

/** Pur : une ligne lisible, jamais de chemin ni de secret. */
export function formatBackupLine(status, nowS = Math.floor(Date.now() / 1000)) {
  if (!status)
    return "⚪ Sauvegardes : pas encore installées (docs/SAUVEGARDES.md).";
  const when = status.at ? `<t:${Number(status.at)}:R>` : "date inconnue";
  if (!status.ok)
    return `🔴 Dernière sauvegarde **échouée** ${when} : ${String(status.step ?? "").slice(0, 150)}`;
  if (!status.at || nowS - Number(status.at) > MAX_AGE_S)
    return `🔴 Aucune sauvegarde réussie depuis plus de 36 h (dernière ${when}).`;
  if (!status.offsite)
    return `🟧 Dernière sauvegarde ${when}, mais **sans copie hors du VPS**.`;
  return `🟢 Dernière sauvegarde ${when}, copiée hors du VPS.`;
}
