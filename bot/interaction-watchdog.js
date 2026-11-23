// FWU — slow-server safety net for slash commands.
//
// Discord drops a command that is not acknowledged within 3 seconds ("L'application ne
// répond plus" / Unknown interaction). On a busy VPS a handler can miss that window.
// If nothing has answered after `delayMs`, the watchdog acknowledges the command
// (private "thinking…"); a later reply() is then delivered as editReply() automatically.
export function armSlowCommandWatchdog(interaction, { delayMs = 2200, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (!interaction?.isChatInputCommand?.()) return () => {};
  const original = {
    reply: interaction.reply?.bind(interaction),
    deferReply: interaction.deferReply?.bind(interaction),
    showModal: interaction.showModal?.bind(interaction),
  };
  if (!original.reply || !original.deferReply) return () => {};
  let acked = false;
  let autoDefer = null;
  const timer = setTimer(() => {
    if (acked || interaction.deferred || interaction.replied) return;
    autoDefer = original.deferReply({ ephemeral: true }).catch(() => {});
  }, delayMs);
  timer?.unref?.();
  const ack = () => { acked = true; clearTimer(timer); };

  interaction.reply = async (payload, ...rest) => {
    if (autoDefer) {
      await autoDefer;
      const body = typeof payload === "string" ? { content: payload } : { ...payload };
      delete body.ephemeral; delete body.flags; delete body.fetchReply; delete body.withResponse;
      return interaction.editReply(body);
    }
    ack();
    return original.reply(payload, ...rest);
  };
  interaction.deferReply = async (...args) => {
    if (autoDefer) { await autoDefer; return undefined; }
    ack();
    return original.deferReply(...args);
  };
  if (original.showModal) {
    interaction.showModal = async (...args) => { ack(); return original.showModal(...args); };
  }
  return () => clearTimer(timer);
}
