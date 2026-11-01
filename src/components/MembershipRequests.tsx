import { ExternalLink, UserRoundCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MembershipRequests({ guildId }: { guildId: string }) {
  return <section className="space-y-4">
    <h2 className="flex items-center gap-2 font-semibold"><UserRoundCheck className="h-5 w-5" /> Demandes d’adhésion Discord</h2>
    <p className="text-sm text-muted-foreground">Discord ne donne pas aux bots l’accès aux candidatures « Demander à rejoindre », à leurs réponses, ni à leur acceptation ou refus.</p>
    <p className="text-sm">Les demandes existantes doivent être traitées dans Discord par un administrateur du serveur.</p>
    <Button asChild><a href={`https://discord.com/channels/${guildId}`} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Ouvrir le serveur dans Discord</a></Button>
    <p className="text-xs text-muted-foreground">Les membres qui n’ont pas encore accepté le règlement sont différents des personnes en attente d’adhésion.</p>
  </section>;
}