import { parsePndOwnerId } from "./pnd-owner-policy.js";

const SNOWFLAKE = /^\d{5,25}$/;

/**
 * Validate the OWNER-related environment before the bot connects to Discord.
 *
 * 1942 has exactly one technical OWNER (PND_OWNER_DISCORD_ID). Cofounders
 * (PND_COFOUNDER_DISCORD_IDS) are staff: they never become OWNER. Any
 * contradictory configuration must fail closed at startup instead of silently
 * granting (or silently dropping) the owner role.
 *
 * Returns { ok, errors, warnings }. Never includes the raw ID values in messages.
 */
export function validateOwnerConfig(env = process.env) {
  const errors = [];
  const warnings = [];
  const rawOwner =
    typeof env.PND_OWNER_DISCORD_ID === "string"
      ? env.PND_OWNER_DISCORD_ID.trim()
      : "";

  if (
    typeof env.PND_OWNER_DISCORD_IDS === "string" &&
    env.PND_OWNER_DISCORD_IDS.trim()
  ) {
    errors.push(
      "PND_OWNER_DISCORD_IDS (pluriel) est interdit : FWU n'a qu'un seul OWNER, utilise PND_OWNER_DISCORD_ID.",
    );
  }

  let owner = null;
  if (!rawOwner) {
    warnings.push(
      "PND_OWNER_DISCORD_ID absent : aucune commande réservée à l'OWNER ne sera autorisée.",
    );
  } else {
    owner = parsePndOwnerId(rawOwner);
    if (!owner)
      errors.push(
        "PND_OWNER_DISCORD_ID doit contenir exactement un identifiant Discord (pas de liste, pas de séparateur).",
      );
  }

  const rawCofounders =
    typeof env.PND_COFOUNDER_DISCORD_IDS === "string"
      ? env.PND_COFOUNDER_DISCORD_IDS.trim()
      : "";
  if (rawCofounders) {
    const ids = rawCofounders
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (ids.some((id) => !SNOWFLAKE.test(id)))
      errors.push(
        "PND_COFOUNDER_DISCORD_IDS contient un identifiant Discord invalide.",
      );
    if (new Set(ids).size !== ids.length)
      errors.push("PND_COFOUNDER_DISCORD_IDS contient des doublons.");
    if (owner && ids.includes(owner))
      errors.push(
        "Un cofondateur ne peut pas être l'OWNER : retire-le de PND_COFOUNDER_DISCORD_IDS.",
      );
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Throws (fail closed) when the owner configuration is contradictory. */
export function assertOwnerConfig(env = process.env, log = console) {
  const result = validateOwnerConfig(env);
  for (const warning of result.warnings) log.warn?.(`⚠️ ${warning}`);
  if (!result.ok) {
    for (const error of result.errors)
      log.error?.(`❌ Configuration OWNER invalide : ${error}`);
    throw new Error("Configuration OWNER contradictoire : démarrage refusé.");
  }
  return result;
}
