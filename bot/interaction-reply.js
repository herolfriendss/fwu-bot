/**
 * Product rule: never post a separate status/error/confirmation message right
 * under an embed or a panel. After deferReply / deferUpdate (or a first reply),
 * the existing message is edited instead of sending a follow-up.
 *
 * - not answered yet           -> reply()
 * - deferred or already replied -> editReply() : the late text replaces or
 *   enriches the initial content. Omitted fields (embeds, components) are kept
 *   by Discord, so a panel stays usable and gains the discreet notice above it.
 */
import { applyBannerToPayload, categoryForCommand } from "./banners.js";

/** Component interactions keep the banner of the command that opened the panel. */
function bannerCategoryOf(interaction) {
  const name = interaction?.commandName
    ?? interaction?.message?.interactionMetadata?.name
    ?? interaction?.message?.interaction?.commandName;
  return name ? categoryForCommand(name) : null;
}

export async function respondInPlace(interaction, payload) {
  const data =
    typeof payload === "string" ? { content: payload } : { ...payload };
  applyBannerToPayload(data, bannerCategoryOf(interaction));
  if (interaction.deferred || interaction.replied) {
    // editReply does not accept the ephemeral flag: the original message keeps its visibility.
    delete data.ephemeral;
    delete data.flags;
    return interaction.editReply(data);
  }
  return interaction.reply(data);
}

/** Same as respondInPlace but never throws (used from error handlers). */
export async function respondInPlaceSafe(interaction, payload) {
  try {
    return await respondInPlace(interaction, payload);
  } catch (error) {
    console.error("[bot] respondInPlace failed:", error?.message ?? "unknown");
    return null;
  }
}

export const INTERACTION_FAILURE_TEXT = "Une erreur est survenue pendant le traitement de cette commande.";

/**
 * Global safety net for unexpected handler errors:
 * - not acknowledged → ephemeral reply;
 * - deferred but never answered → the "thinking…" placeholder is replaced
 *   (before this, the member stayed on an endless loading state);
 * - already answered → left untouched (never overwrite a valid answer).
 */
export async function reportInteractionFailure(interaction) {
  if (!interaction?.isRepliable?.()) return null;
  if (interaction.replied) return null;
  if (interaction.deferred) {
    // A deferred component (deferUpdate) points at a panel: never overwrite it,
    // tell only the clicking member. A deferred command gets its placeholder replaced.
    if (interaction.isMessageComponent?.() || interaction.isModalSubmit?.()) {
      return interaction.followUp({ content: INTERACTION_FAILURE_TEXT, ephemeral: true }).catch(() => null);
    }
    return interaction.editReply({ content: `❌ ${INTERACTION_FAILURE_TEXT}` }).catch(() => null);
  }
  return interaction.reply({ content: INTERACTION_FAILURE_TEXT, ephemeral: true }).catch(() => null);
}
