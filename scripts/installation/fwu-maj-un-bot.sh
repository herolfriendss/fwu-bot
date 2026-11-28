#!/usr/bin/env bash
# FWU — met à jour UN des 4 bots, avec retour arrière (proposition n°9 de l'Éclaireur).
#
#   bash fwu-maj-un-bot.sh <paquet.zip> <dossier des bots> <profil>
#   ex. bash fwu-maj-un-bot.sh ~/FWU-installation/FWU-GUARD.zip ~/fwu-bots guard
#
# 1. Copie le dossier actuel du bot (code copié, node_modules en liens physiques : presque
#    aucune place disque en plus) ;
# 2. dézippe la nouvelle version et lance son installer.sh ;
# 3. si l'installateur échoue, remet l'ancienne version et la redémarre.
# Codes de sortie : 0 = à jour · 2 = pas de token (bot non démarré, rien à remettre)
#                   4 = échec, ancienne version remise · 1 = échec sans retour possible.
set -uo pipefail
ZIP="$1"; BOTS="$2"; PROFILE="$3"
DIR="$BOTS/fwu-$PROFILE"
SNAP="$BOTS/.avant-maj/fwu-$PROFILE"

[[ -f "$ZIP" ]] || { echo "Paquet introuvable : $ZIP"; exit 1; }

# Empreinte du contenu du paquet (noms + CRC, sans les dates) : un bot dont le code n'a pas changé
# et qui tourne n'est ni réinstallé ni redémarré (pas d'interruption inutile des autres bots).
FINGERPRINT_FILE="$DIR/.fwu-paquet-empreinte"
fingerprint="$(python3 -I -c 'import hashlib, sys, zipfile
h = hashlib.sha256()
for info in sorted(zipfile.ZipFile(sys.argv[1]).infolist(), key=lambda i: i.filename):
    h.update(f"{info.filename}\0{info.CRC}\0{info.file_size}\n".encode())
print(h.hexdigest())' "$ZIP" 2>/dev/null || true)"
if [[ -n "$fingerprint" && -f "$FINGERPRINT_FILE" && "$(tr -d '[:space:]' < "$FINGERPRINT_FILE")" == "$fingerprint" ]]; then
  pid="$(pm2 pid "fwu-$PROFILE" 2>/dev/null | tr -d '[:space:]' || true)"
  if [[ -n "$pid" && "$pid" != "0" ]]; then echo "$PROFILE : paquet inchangé et bot en ligne, rien à faire."; exit 0; fi
fi
mkdir -p "$BOTS/.avant-maj"
rm -rf "$SNAP"
had_previous=0
if [[ -d "$DIR" ]]; then
  mkdir -p "$SNAP"
  # Code, .env et ecosystem : vraie copie. node_modules : liens physiques (npm ci le remplace sans toucher aux fichiers liés).
  (cd "$DIR" && find . -mindepth 1 -maxdepth 1 ! -name node_modules -exec cp -a {} "$SNAP/" \;) || { echo "Copie de sauvegarde de $PROFILE impossible."; rm -rf "$SNAP"; exit 1; }
  if [[ -d "$DIR/node_modules" ]]; then cp -al "$DIR/node_modules" "$SNAP/node_modules" 2>/dev/null || cp -a "$DIR/node_modules" "$SNAP/node_modules" || { echo "Copie de node_modules impossible."; rm -rf "$SNAP"; exit 1; }; fi
  had_previous=1
fi

restore() {
  if [[ "$had_previous" != 1 ]]; then echo "❌ $PROFILE : pas d'ancienne version à remettre."; return 1; fi
  echo "↩️  $PROFILE : retour à l'ancienne version"
  rm -rf "$DIR.echec" && mv "$DIR" "$DIR.echec" 2>/dev/null
  mv "$SNAP" "$DIR" || { echo "❌ Retour impossible : ancienne version dans $SNAP"; return 1; }
  rm -rf "$DIR.echec"
  (cd "$DIR" && pm2 startOrReload ecosystem.config.cjs --update-env >/dev/null 2>&1) || echo "⚠️ Redémarrage de l'ancienne version de $PROFILE à vérifier : pm2 logs fwu-$PROFILE"
  return 0
}

(cd "$BOTS" && unzip -oq "$ZIP") || { echo "Paquet $PROFILE illisible."; restore; exit 4; }
bash "$DIR/installer.sh" </dev/null
code=$?
if [[ "$code" == 0 ]]; then rm -rf "$SNAP"; [[ -n "$fingerprint" ]] && printf '%s\n' "$fingerprint" > "$FINGERPRINT_FILE"; exit 0; fi
if [[ "$code" == 2 ]]; then rm -rf "$SNAP"; exit 2; fi
restore && exit 4
exit 1
