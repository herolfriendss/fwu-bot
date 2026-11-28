// Santé du VPS : espace disque du dossier de données et mémoire libre. Un bot tombe souvent
// à cause d'un disque plein (journaux PM2) ou d'un manque de mémoire : on prévient avant.
import { statfsSync } from "node:fs";
import { freemem, totalmem, loadavg, cpus } from "node:os";

export const DISK_WARN_RATIO = 0.10;   // moins de 10 % libres
export const DISK_WARN_BYTES = 2 * 1024 ** 3; // ou moins de 2 Go
export const MEMORY_WARN_RATIO = 0.08; // moins de 8 % de mémoire libre

export function readVpsHealth(path, { statfs = statfsSync, mem = { free: freemem(), total: totalmem() }, load = loadavg()[0], cores = cpus().length || 1 } = {}) {
  let disk = null;
  try { const s = statfs(path); disk = { free: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) }; } catch { /* non lisible */ }
  return { disk, memory: mem, load, cores };
}

const gb = (bytes) => `${(bytes / 1024 ** 3).toFixed(1)} Go`;

/** Pure: list of problems (French sentences), empty when all is fine. */
export function healthProblems(health) {
  const problems = [];
  const { disk, memory, load, cores } = health;
  if (disk && disk.total > 0 && (disk.free / disk.total < DISK_WARN_RATIO || disk.free < DISK_WARN_BYTES)) {
    problems.push(`Disque presque plein : ${gb(disk.free)} libres sur ${gb(disk.total)}. Libère de la place : \`pm2 flush\` vide les journaux.`);
  }
  if (memory?.total > 0 && memory.free / memory.total < MEMORY_WARN_RATIO) {
    problems.push(`Mémoire presque pleine : ${gb(memory.free)} libres sur ${gb(memory.total)}. Regarde \`pm2 status\` (colonne mem).`);
  }
  if (Number.isFinite(load) && load > cores * 2) problems.push(`Processeur surchargé (charge ${load.toFixed(1)} pour ${cores} cœur(s)).`);
  return problems;
}

/** Alerts only when the set of problems changes (no repeat every check). */
export function createHealthWatch() {
  let last = "";
  return (problems) => {
    const key = problems.map((p) => p.split(" :")[0]).sort().join("|");
    if (key === last) return null;
    const previous = last;
    last = key;
    if (!key) return previous ? { recovered: true, problems: [] } : null;
    return { recovered: false, problems };
  };
}
