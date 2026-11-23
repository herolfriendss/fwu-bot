/**
 * Reply to a Discord interaction exactly once.
 * If Discord has already acknowledged it (deferReply/reply), update the
 * original response instead of attempting a second initial response.
 */
export async function respondToInteraction(interaction, payload, { ephemeral = false } = {}) {
  if (!interaction || typeof interaction !== "object") {
    throw new TypeError("Une interaction Discord valide est requise.");
  }

  const acknowledged = Boolean(interaction.deferred || interaction.replied);
  if (acknowledged) {
    const editPayload = { ...payload };
    // Ephemeral visibility is chosen on the initial response and cannot be
    // changed by editReply. Avoid passing the initial-response-only option.
    delete editPayload.ephemeral;
    if (typeof interaction.editReply !== "function") {
      throw new TypeError("Cette interaction ne permet pas de modifier sa réponse.");
    }
    return interaction.editReply(editPayload);
  }

  if (typeof interaction.reply !== "function") {
    throw new TypeError("Cette interaction ne permet pas de répondre.");
  }
  return interaction.reply({ ...payload, ...(ephemeral ? { ephemeral: true } : {}) });
}
