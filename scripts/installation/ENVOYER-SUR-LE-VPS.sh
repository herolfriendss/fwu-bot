#!/usr/bin/env bash
# FWU — depuis un Mac ou Linux : envoie ce dossier sur le VPS Oracle et lance l'installation.
#   bash ENVOYER-SUR-LE-VPS.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
read -rp "Adresse IP publique du VPS : " VPS
read -rp "Chemin de la clé SSH privée (Entrée si inutile) : " KEY
KEY="${KEY//\'/}"; KEY="${KEY//\"/}"; KEY="${KEY% }"
OPTS=(); [[ -n "$KEY" ]] && OPTS=(-i "$KEY")
ssh "${OPTS[@]}" "opc@$VPS" "mkdir -p /home/opc/FWU-installation"
scp "${OPTS[@]}" ./*.zip ./*.sh ./*.md "opc@$VPS:/home/opc/FWU-installation/"
ssh -t "${OPTS[@]}" "opc@$VPS" "bash /home/opc/FWU-installation/TOUT-INSTALLER.sh"
