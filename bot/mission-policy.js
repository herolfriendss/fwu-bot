export const DAILY_MISSIONS = Object.freeze([
  { key: "work_three", action: "work", target: 3, reward: 150, label: "Effectuer 3 travaux" },
  {
    key: "transfer_one",
    action: "transfer",
    target: 1,
    reward: 100,
    label: "Envoyer un transfert PND",
  },
  {
    key: "shop_one",
    action: "shop",
    target: 1,
    reward: 120,
    label: "Acheter un rôle dans la boutique",
  },
]);

export function missionDate(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

export function advanceMission(progress, target, amount = 1) {
  if (
    !Number.isSafeInteger(progress) ||
    progress < 0 ||
    !Number.isSafeInteger(target) ||
    target < 1 ||
    !Number.isSafeInteger(amount) ||
    amount < 0
  ) {
    throw new Error("Progression de mission invalide.");
  }
  const next = Math.min(target, progress + amount);
  return { progress: next, completed: next >= target };
}
