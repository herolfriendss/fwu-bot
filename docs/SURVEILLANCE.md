# Surveillance des bots FWU (alerte quand un bot tombe)

`~/fwu-surveillance.mjs` (posé par `/maj`) tourne **chaque minute par cron, en dehors des bots**. Les cinq bots principaux sont surveillés dès le premier passage ; Invest + est facultatif et n'est surveillé qu'après sa première apparition dans PM2.
Si un bot plante, ou si FWU lui-même s'arrête, il le voit quand même et poste dans un salon staff, par webhook :
- 🔴 « GUARD arrêté depuis 2 min » puis 🟢 « GUARD revenu » ;
- 🟧 un bot qui redémarre 3 fois en 10 min ;
- 🟧 plus de 50 logs des bots en attente de publication ;
- 🟧 disque du VPS rempli à plus de 90 % ;
- 🔴 sauvegarde échouée ou plus vieille que 36 h (si les sauvegardes sont installées).

Un seul message par changement d'état. Il ne redémarre rien et ne modifie aucune donnée.

## Installation (à taper sur le VPS, une seule fois)
1. Sur Discord : salon staff → Paramètres → Intégrations → **Webhooks** → Nouveau webhook → **Copier l'URL**.
2. Sur le VPS, ranger l'URL (elle ne doit pas être partagée) :
   ```
   install -m 600 /dev/stdin ~/fwu-data/.alerte-webhook
   ```
   colle l'URL, Entrée, puis Ctrl+D.
3. Essai : `node ~/fwu-surveillance.mjs --test` → un message « message d'essai » arrive dans le salon.
4. Lancer chaque minute :
   ```
   (crontab -l 2>/dev/null; echo "* * * * * $(command -v node) $HOME/fwu-surveillance.mjs") | crontab -
   ```

Pour arrêter : `crontab -e` et supprimer la ligne `fwu-surveillance.mjs`.
