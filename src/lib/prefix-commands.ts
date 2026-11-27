import { z } from "zod";

export const RESERVED_PREFIX_COMMANDS = new Set([
  "access", "panel", "pv", "sysp", "dog", "dogall", "undog", "doginfo", "menotte", "unmenotte", "menotteinfo", "addrole", "removerole", "rankall", "lockname", "unlockname", "locknamelist",
  "play", "p", "pause", "resume", "skip", "stop", "queue", "nowplaying", "np",
  "volume", "vol", "loop", "shuffle", "clearqueue", "remove", "join", "leave", "musicpanel",
]);

export const prefixCommandSchema = z.object({
  name: z.string().trim().toLowerCase().min(1).max(32).regex(/^[a-z0-9_-]+$/, "Nom : lettres, chiffres et tirets uniquement, sans ="),
  response: z.string().trim().min(1, "Ajoute une réponse du bot.").max(2000),
  permission: z.enum(["0", "32", "8192"]),
});
// Keep previously stored names readable so a settings save cannot silently
// discard them, while preventing new user commands from shadowing bot handlers.
export const prefixCommandFormSchema = prefixCommandSchema.refine(
  ({ name }) => !RESERVED_PREFIX_COMMANDS.has(name),
  "Ce nom est réservé à une commande intégrée.",
);
export type PrefixCommand = z.infer<typeof prefixCommandSchema>;
