#!/usr/bin/env bash
# FWU — installation complète en UNE commande, à lancer SUR LE VPS Oracle :
#
#   bash /home/opc/FWU-installation/TOUT-INSTALLER.sh
#
# 1. met FWU à jour (retour arrière automatique en cas d'échec) ;
# 2. crée le dossier de données partagé (une seule fois, sans risque si relancé) ;
# 3. installe GUARD, FDPDLAVOC, SUCK ME et LE FISC : chacun te demande son token
#    (saisie masquée, Entrée seule = passer ce bot) ;
# 4. affiche l'état final.
# Relançable sans risque : ce qui est déjà fait est conservé. Aucun token n'est affiché.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${PND_EXPECTED_ROOT:-/home/opc/her-v5-production}"
BOTS_DIR="${FWU_BOTS_DIR:-/home/opc/fwu-bots}"
step() { printf '\n\033[1m━━━ %s ━━━\033[0m\n' "$*"; }
fail() { printf '\nERREUR : %s\n' "$*" >&2; exit 1; }
ask() { local reply; read -rp "$1 [O/n] " reply || reply=""; [[ ! "$reply" =~ ^[nN] ]]; }

FWU_ZIP="$(ls -1t "$HERE"/FWU_[0-9]*.zip 2>/dev/null | head -n 1)"
[[ -n "$FWU_ZIP" ]] || fail "FWU_<date>.zip introuvable à côté de ce script ($HERE)."
for z in GUARD FDPDLAVOC SUCK-ME LE-FISC; do [[ -f "$HERE/FWU-$z.zip" ]] || fail "FWU-$z.zip introuvable dans $HERE."; done
[[ -t 0 ]] || fail "Lance ce script dans un terminal (ssh -t), il doit pouvoir te demander les tokens."
command -v python3 >/dev/null || fail "python3 introuvable."
command -v unzip >/dev/null || fail "unzip introuvable : sudo dnf install -y unzip"

cat <<MSG

FWU — installation des 5 bots sur ce VPS.
Avant de continuer, dans le portail développeur Discord (discord.com/developers/applications),
pour GUARD, FDPDLAVOC, SUCK ME et LE FISC :
  • onglet Bot : active « Server Members Intent » et « Message Content Intent » ;
  • le bot est invité sur ton serveur ;
  • garde la page ouverte : tu copieras le token (Reset Token → Copy) quand il sera demandé.
MSG
read -rp "Appuie sur Entrée quand c'est prêt (Ctrl+C pour annuler)… " _ || exit 1

step "1/4 — Mise à jour de FWU ($(basename "$FWU_ZIP"))"
if ask "Mettre FWU à jour maintenant (environ 10 min, à faire au premier lancement) ?"; then
  python3 -c "import sys,zipfile;open(sys.argv[2],'wb').write(zipfile.ZipFile(sys.argv[1]).read('FWU/scripts/update-1942.sh'))" "$FWU_ZIP" "$HERE/update-1942.sh" \
    || fail "Impossible d'extraire update-1942.sh de $FWU_ZIP."
  PND_SUPABASE_MIGRATIONS_APPLIED=YES bash "$HERE/update-1942.sh" "$FWU_ZIP" \
    || fail "La mise à jour de FWU a échoué (l'ancienne version a été remise). Rien d'autre n'a été modifié."
else
  printf 'Mise à jour de FWU passée.\n'
fi

step "2/4 — Dossier de données partagé"
bash "$ROOT/scripts/fwu-donnees-partagees.sh" || fail "Création du dossier partagé impossible (FWU est-il bien à jour ?)."

step "3/4 — Installation des 4 bots"
mkdir -p "$BOTS_DIR"
for z in GUARD FDPDLAVOC SUCK-ME LE-FISC; do unzip -oq "$HERE/FWU-$z.zip" -d "$BOTS_DIR" || fail "Décompression de FWU-$z.zip impossible."; done
declare -A RESULT
for bot in guard fdpdlavoc suckme fisc; do
  printf '\n\033[1m▶ %s\033[0m\n' "$bot"
  bash "$BOTS_DIR/fwu-$bot/installer.sh"
  case $? in
    0) RESULT[$bot]="🟢 en ligne" ;;
    2) RESULT[$bot]="⚪ passé (pas de token) — plus tard : bash $BOTS_DIR/fwu-$bot/installer.sh" ;;
    *) RESULT[$bot]="🔴 échec (FWU fait son travail) — voir le message ci-dessus, puis : bash $BOTS_DIR/fwu-$bot/installer.sh" ;;
  esac
done

step "4/4 — Résultat"
printf 'FWU        : 🟢 (her-v5-bot / her-v5-web)\n'
for bot in guard fdpdlavoc suckme fisc; do printf '%-10s : %s\n' "$bot" "${RESULT[$bot]}"; done
cat <<MSG

Dernières étapes, dans Discord :
  • Paramètres du serveur → Rôles : SUCK ME juste sous ton rôle, GUARD au-dessus des membres qu'il modère.
  • /sysp diagnostic bots : chaque bot installé doit être 🟢.
  • Les commandes slash peuvent mettre jusqu'à 1 h à apparaître partout.
Arrêt d'urgence d'un bot : pm2 stop fwu-<bot>  (FWU reprend son travail en moins d'une minute).
MSG
