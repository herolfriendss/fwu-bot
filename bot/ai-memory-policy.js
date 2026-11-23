// La mémoire nécessite à la fois l'autorisation globale du serveur et le consentement individuel.
export function canUseAiMemory(serverEnabled, memberConsented) {
  return serverEnabled === true && memberConsented === true;
}
