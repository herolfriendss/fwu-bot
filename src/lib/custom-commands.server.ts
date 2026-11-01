import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Call only after requireOwner() or Discord signature verification.
export async function listCustomCommands(applicationId: string) {
  const { data, error } = await supabaseAdmin.from("discord_custom_commands").select("*").eq("application_id", applicationId);
  if (error) throw new Error("Impossible de lire les réponses enregistrées.");
  return data ?? [];
}
export async function findCustomCommand(applicationId: string, commandId: string) {
  const { data, error } = await supabaseAdmin.from("discord_custom_commands").select("*").eq("application_id", applicationId).eq("command_id", commandId).maybeSingle();
  if (error) throw new Error("Impossible de lire la réponse de cette commande.");
  return data;
}