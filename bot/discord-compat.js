// discord.js 14 deprecations, handled in one place instead of ~440 call sites:
//  - `ephemeral: true` → `flags: MessageFlags.Ephemeral`
//  - `fetchReply: true` → `withResponse: true`, still returning the Message
// reply() and deferReply() are the only methods that warn. The shim is
// idempotent and leaves strings, MessagePayload instances and new-style
// options untouched. New code should use flags / withResponse directly.
import { CommandInteraction, MessageComponentInteraction, MessageFlags, ModalSubmitInteraction } from "discord.js";

const PATCHED = Symbol.for("fwu.discordCompat");

/** Pure conversion of one options object. Returns { options, fetchReply }. */
export function modernizeResponseOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.getPrototypeOf(options) !== Object.prototype) {
    return { options, fetchReply: false };
  }
  if (!("ephemeral" in options) && !("fetchReply" in options)) return { options, fetchReply: false };
  const { ephemeral, fetchReply, ...rest } = options;
  if (ephemeral) {
    const current = rest.flags;
    if (current === undefined || current === null) rest.flags = MessageFlags.Ephemeral;
    else if (typeof current === "number" || typeof current === "bigint") rest.flags = Number(current) | MessageFlags.Ephemeral;
    else if (Array.isArray(current)) rest.flags = [...current, MessageFlags.Ephemeral];
    else rest.flags = current; // exotic BitField: keep as given rather than guess
  }
  if (fetchReply && !rest.withResponse) rest.withResponse = true;
  return { options: rest, fetchReply: Boolean(fetchReply) };
}

function wrap(proto, method) {
  const original = proto[method];
  if (typeof original !== "function" || original[PATCHED]) return;
  const patched = async function (options, ...args) {
    const { options: modern, fetchReply } = modernizeResponseOptions(options);
    const result = await original.call(this, modern, ...args);
    // fetchReply used to resolve to the Message; withResponse resolves to a callback response.
    return fetchReply ? (result?.resource?.message ?? result) : result;
  };
  patched[PATCHED] = true;
  proto[method] = patched;
}

export function installDiscordCompat() {
  for (const cls of [CommandInteraction, MessageComponentInteraction, ModalSubmitInteraction]) {
    for (const method of ["reply", "deferReply"]) wrap(cls.prototype, method);
  }
}
