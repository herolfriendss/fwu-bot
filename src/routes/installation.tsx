import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteNav } from "@/components/SiteNav";
import { getBotConnection } from "@/lib/bot-settings.functions";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, FileKey } from "lucide-react";

export const Route = createFileRoute("/installation")({
  head: () => ({ meta: [
    { title: "Installation du bot — FWU" }, { name: "description", content: "Préparez le fichier de configuration du bot Discord FWU pour Oracle." },
    { property: "og:title", content: "Installation du bot — FWU" }, { property: "og:description", content: "Préparation privée de l’installation du bot sur Oracle." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }), loader: () => getBotConnection(), component: InstallationPage,
});
function InstallationPage() {
  const connection = Route.useLoaderData();
  function download() {
    const contents = `# À compléter uniquement sur Oracle. Ne partage jamais ce fichier.\nDISCORD_TOKEN=\nSITE_URL=${window.location.origin}\nBOT_SYNC_SECRET=\n`;
    const url = URL.createObjectURL(new Blob([contents], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = ".env"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="console-shell bg-background"><header className="console-header border-b border-border p-4 md:p-8"><div className="mx-auto flex max-w-4xl items-center gap-4">
    <Button asChild variant="ghost" size="icon"><Link to="/configuration" aria-label="Retour à la configuration"><ArrowLeft className="h-5 w-5" /></Link></Button>
    <h1 className="flex items-center gap-2 text-xl font-semibold"><FileKey className="h-5 w-5 text-primary" /> Installation Oracle</h1>
  </div></header><SiteNav /><main className="console-content mx-auto max-w-4xl space-y-6 p-4 md:p-8">
    <section className="space-y-4 border-b border-border pb-6">
      <h2 className="text-lg font-semibold">Dernière version du bot</h2>
      <p className="text-sm text-muted-foreground">L’archive du bot contient les commandes DOG, les accès vocaux, la lecture de flux audio HTTPS autorisés, la radio configurable, l’économie PND, les jeux et les commandes slash partagées. Node.js 24 et npm install restent nécessaires.</p>
      <Button asChild><a href="/downloads/bot-oracle.zip" download="fwu-bot.zip"><Download className="h-4 w-4" /> Télécharger FWU (ZIP)</a></Button>
      <p className="text-sm text-muted-foreground">Pour une mise à jour, conserve ton fichier .env et le dossier data sur Oracle : ils ne sont pas inclus dans le ZIP. Tu n’as pas besoin de ressaisir tes accès.</p>
      <p className="text-sm text-muted-foreground">Pour une première installation, Node.js et l’installation des dépendances restent nécessaires ; le token et le secret doivent être renseignés sur Oracle.</p>
    </section>
    <h2 className="text-lg font-semibold">Fichier .env</h2>
    <p className="text-sm text-muted-foreground">L’adresse du site est déjà renseignée. Pour protéger tes accès, le token Discord et le secret ne sont ni affichés ni exportés : complète-les directement sur Oracle.</p>
    <dl className="divide-y divide-border text-sm"><div className="flex flex-wrap justify-between gap-3 py-4"><dt>Adresse du site</dt><dd className="break-all text-muted-foreground">Le domaine public de cette instance</dd></div><div className="flex justify-between gap-3 py-4"><dt>Secret de liaison du site</dt><dd className="text-muted-foreground">{connection.configured ? "Configuré · protégé" : "Non configuré"}</dd></div></dl>
    <Button onClick={download}><Download className="h-4 w-4" /> Télécharger le modèle .env</Button>
    <p className="text-sm text-muted-foreground">Chrome peut nommer le téléchargement env.txt : renomme-le en .env sur Oracle.</p>
    <p className="text-sm text-muted-foreground">Si tu as déjà un fichier .env sur Oracle, conserve-le : ce modèle ne contient pas tes accès.</p>
  </main></div>;
}
