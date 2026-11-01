import { z } from "zod";

export const commandFormSchema = z.object({
  id: z.string().regex(/^\d{5,25}$/).optional(),
  name: z.string().trim().min(1).max(32).regex(/^[a-z0-9_-]+$/, "Nom : lettres minuscules, chiffres, tirets uniquement"),
  description: z.string().trim().min(1).max(100),
  response: z.string().trim().min(1).max(2000),
  ephemeral: z.boolean(),
  permission: z.enum(["0", "32", "8192"]),
});
export type CommandForm = z.infer<typeof commandFormSchema>;
export function canUseCommand(permission: string, memberPermissions: string | number | undefined): boolean {
  if (permission === "0") return true;
  try {
    const actual = BigInt(memberPermissions ?? "0");
    const required = BigInt(permission);
    return (actual & 8n) !== 0n || (actual & required) === required;
  } catch { return false; }
}