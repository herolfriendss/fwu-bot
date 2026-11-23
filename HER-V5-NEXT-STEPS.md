# Her? V5 — suivi du chantier

## Passe du 12 novembre 2026

### Alertes LIVE — durcissement sécurité
- Validation HTTPS obligatoire des URL de flux.
- Refus des URL locales, IP privées, hôtes `.local` / `.internal` et résolution DNS vers une adresse privée.
- Redirections HTTP refusées pour empêcher les rebonds vers des services internes.
- Taille des flux plafonnée à 1 Mo, y compris lorsque `Content-Length` est absent.
- Délai réseau plafonné à 10 secondes.
- Exécution du poller protégée contre les chevauchements.
- Tests couvrant RSS, Atom, URL HTTP, IP loopback, DNS privé et hôte public.

### Résultats
- `npm --prefix bot test` : 23 tests réussis, 0 échec.
- `node --check bot/live-alerts.js` : réussi.
- `node --check bot/live-alerts.test.js` : réussi.

### Limites connues
- La détection LIVE dépend de flux RSS/Atom qui publient explicitement un item de direct. Un flux de vidéos ordinaires ne garantit pas l'événement de démarrage d'un LIVE.
- Les tests complets du dashboard et le build global doivent encore être exécutés sous Node.js 24 avec les dépendances racine installées.
- Aucune mise en production n'a été effectuée.
