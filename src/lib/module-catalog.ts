// Modules shown on the dashboard, in the same order and with the same French names and
// descriptions as the Discord /setup (bot/systems/setup/policy.js, kept in sync by a test).
// `owner` is the bot that runs the module (see the serves("…") gates in bot/index.js).
import type { BotProfileId } from "./bot-profiles";

export type ModuleCatalogEntry = {
  key: "spam" | "guildGuard" | "moderation" | "verification" | "tickets" | "tempVoice" | "automation" | "dog" | "liveAlerts";
  label: string;
  description: string;
  owner: BotProfileId;
  /** false = no on/off switch, the module is always active. */
  toggle: boolean;
};

export const MODULE_CATALOG: readonly ModuleCatalogEntry[] = [
  { key: "spam", label: "Anti-spam et mentions", description: "Supprime les rafales de messages et les mentions de masse, puis met l’auteur en sourdine.", owner: "guard", toggle: true },
  { key: "guildGuard", label: "Sécurité anti-raid", description: "Surveille les nouveaux comptes et protège le serveur contre les raids.", owner: "guard", toggle: true },
  { key: "moderation", label: "Modération", description: "Journal des sanctions et durée de vie des avertissements.", owner: "fwu", toggle: false },
  { key: "verification", label: "Vérification des membres", description: "Les nouveaux membres doivent valider un panneau pour obtenir l’accès.", owner: "guard", toggle: true },
  { key: "tickets", label: "Tickets communautaires", description: "Les membres ouvrent un ticket privé pour contacter l’équipe.", owner: "fwu", toggle: true },
  { key: "tempVoice", label: "Salons vocaux temporaires", description: "Rejoindre le vocal de création ouvre un salon vocal personnel.", owner: "fdpdlavoc", toggle: true },
  { key: "automation", label: "Automatisations de bienvenue", description: "Rôles donnés automatiquement et message privé de bienvenue.", owner: "suckme", toggle: false },
  { key: "dog", label: "DOG — laisses par SYS+", description: "Nombre de laisses qu’un SYS+ peut poser en même temps.", owner: "suckme", toggle: false },
  { key: "liveAlerts", label: "Alertes de démarrage LIVE", description: "Annonce dans un salon quand un créateur lance un live.", owner: "fwu", toggle: true },
];

export type ToggleModuleKey = "spam" | "guildGuard" | "verification" | "tickets" | "tempVoice" | "liveAlerts";
