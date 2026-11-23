#!/usr/bin/env bash
# FWU — met à jour les 4 bots spécialisés (GUARD, FDPDLAVOC, SUCK ME, LE FISC) en une commande,
# depuis ton ordinateur (Chromebook/Linux/Mac). FWU lui-même n'est pas touché.
#
#   bash METTRE-A-JOUR-BOTS.sh opc@ADRESSE_DU_VPS
#
# Les tokens déjà enregistrés sont conservés (rien n'est redemandé, rien n'est affiché).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
TARGET="${1:-}"
[[ -n "$TARGET" ]] || read -rp "Adresse du VPS (ex. opc@1.2.3.4) : " TARGET
for z in GUARD FDPDLAVOC SUCK-ME LE-FISC; do [[ -f "FWU-$z.zip" ]] || { echo "FWU-$z.zip introuvable ici."; exit 1; }; done

echo "==> Envoi des 4 bots"
ssh "$TARGET" "mkdir -p /home/opc/FWU-installation /home/opc/fwu-bots"
scp FWU-GUARD.zip FWU-FDPDLAVOC.zip FWU-SUCK-ME.zip FWU-LE-FISC.zip "$TARGET:/home/opc/FWU-installation/"

echo "==> Installation sur le VPS"
ssh -t "$TARGET" 'set -u
cd /home/opc/fwu-bots
for z in GUARD FDPDLAVOC SUCK-ME LE-FISC; do unzip -oq "/home/opc/FWU-installation/FWU-$z.zip" || exit 1; done
status=0
for b in guard fdpdlavoc suckme fisc; do
  printf "\n\033[1m▶ %s\033[0m\n" "$b"
  bash "/home/opc/fwu-bots/fwu-$b/installer.sh" </dev/null || status=1
done
printf "\n==> État des processus\n"
pm2 ls
others=$(pm2 jlist | node -e "let r=\"\";process.stdin.on(\"data\",c=>r+=c).on(\"end\",()=>{const n=JSON.parse(r).map(p=>p.name).filter(n=>!/^(her-v5-(bot|web)|fwu-(guard|fdpdlavoc|suckme|fisc))$/.test(n));console.log(n.join(\" \"))})")
if [ -n "$others" ]; then
  printf "\n⚠️  Autres processus PM2 encore présents : %s\n   Si c est un ANCIEN bot, il peut encore appliquer d anciennes règles (ex. anciens DOG).\n   Pour l arrêter : pm2 stop <nom> && pm2 save\n" "$others"
fi
exit $status'
