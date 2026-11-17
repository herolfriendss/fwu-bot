// PND Assist V5 — identité de présence Discord.
// La rotation reste volontairement centrée sur l'identité PND, sans fausses statistiques.
export const PND_PRESENCE_INTERVAL_MS = 45_000;

export const PND_PRESENCE_FRAMES = Object.freeze([
  Object.freeze({ type: "Playing", name: "PND Assist • /aide" }),
  Object.freeze({ type: "Watching", name: "la communauté PND" }),
  Object.freeze({ type: "Listening", name: "discord.gg/fwu" }),
]);

export function getPndPresenceFrame(index) {
  const safeIndex = Number.isFinite(index) ? Math.abs(Math.floor(index)) : 0;
  return PND_PRESENCE_FRAMES[safeIndex % PND_PRESENCE_FRAMES.length];
}
