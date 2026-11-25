import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

/** /agents : commandes du propriétaire. Visibles des admins, utilisables par le seul propriétaire. */
export const agentsCommand = new SlashCommandBuilder()
  .setName("agents")
  .setDescription("Piloter les agents du serveur (propriétaire uniquement)")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((s) => s.setName("statut").setDescription("État des agents, budget et propositions en attente"))
  .addSubcommand((s) => s.setName("pause").setDescription("Arrêt d'urgence : plus aucune analyse ni appel à l'IA"))
  .addSubcommand((s) => s.setName("reprendre").setDescription("Relancer les agents après une pause"))
  .addSubcommand((s) => s.setName("analyser").setDescription("Lancer l'analyse de l'Observateur maintenant"))
  .addSubcommand((s) => s.setName("propositions").setDescription("Lister les propositions en attente"));
