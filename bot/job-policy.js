export const JOBS = Object.freeze({
  artisan: { label: "Artisane", description: "fabrique et répare des objets" },
  explorer: { label: "Explorateur", description: "repère des routes et des ressources" },
  host: { label: "Hôte communautaire", description: "anime les événements du serveur" },
  mechanic: { label: "Mécanicien", description: "entretient les équipements" },
  courier: { label: "Coursier", description: "livre des colis dans la ville" },
});

export const JOB_MAX_LEVEL = 10;
export const JOB_XP_PER_WORK = 25;
export const JOB_XP_PER_LEVEL = 100;
const MAX_WORK_PAYOUT_BONUS_PERCENT = (JOB_MAX_LEVEL - 1) * 5;

export function jobPayout(baseReward, level = 1) {
  const reward = Number(baseReward);
  const normalizedLevel = Math.max(1, Math.min(JOB_MAX_LEVEL, Math.floor(Number(level) || 1)));
  if (!Number.isSafeInteger(reward) || reward < 0)
    throw new Error("Récompense de travail invalide.");
  return Math.floor((reward * (100 + (normalizedLevel - 1) * 5)) / 100);
}

export function jobProgress({ level = 1, experience = 0, earned = JOB_XP_PER_WORK } = {}) {
  let nextLevel = Math.max(1, Math.min(JOB_MAX_LEVEL, Math.floor(Number(level) || 1)));
  let xp = Math.max(0, Math.floor(Number(experience) || 0));
  if (!Number.isSafeInteger(earned) || earned < 0)
    throw new Error("Expérience de métier invalide.");
  if (nextLevel === JOB_MAX_LEVEL) return { level: nextLevel, experience: 0, levelsGained: 0 };
  xp += earned;
  let levelsGained = 0;
  while (xp >= JOB_XP_PER_LEVEL && nextLevel < JOB_MAX_LEVEL) {
    xp -= JOB_XP_PER_LEVEL;
    nextLevel += 1;
    levelsGained += 1;
  }
  if (nextLevel === JOB_MAX_LEVEL) xp = 0;
  return { level: nextLevel, experience: xp, levelsGained };
}
