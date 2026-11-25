#!/usr/bin/env python3
"""Build one complete, production-ready folder (zip) per specialised FWU bot.

Each zip contains a top folder fwu-<bot>/ with the bot source, the shared
command catalogue, its own .env template, PM2 file, installer and guide.
FWU itself (bot + dashboard) is the main project archive.

    python3 scripts/package-fwu-bots.py [output_dir]
"""
from pathlib import Path
import stat
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
BOT = ROOT / "bot"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "livraison" / "bots"
EXCLUDED_DIRS = {".git", "node_modules", "data", "coverage", ".cache", ".output", "tmp", "temp", "fixtures"}
EXCLUDED_SUFFIXES = {".sqlite", ".sqlite3", ".db", ".log", ".zip", ".tar", ".gz", ".tmp"}
# Shipped assets whose extension the filters above would otherwise drop.
# The glyph atlas is gzipped on purpose: node:zlib unpacks it with no dependency.
ALWAYS_INCLUDE = {"image/atlas.bin.gz"}

BOTS = {
    "guard": ("GUARD", "PND_GUARD_TOKEN", "Administration et protection : GuildGuard, avertissements, mute, kick, purge, verrouillage, vérification, anti-spam, Guardian."),
    "fdpdlavoc": ("FDPDLAVOC", "PND_FDPDLAVOC_TOKEN", "Musique, radio, vocaux temporaires, /pv, /access, /voc."),
    "suckme": ("SUCK ME", "PND_SUCKME_TOKEN", "SYS+ : /sysp, rôles, rankall, DM ALL, DOG, MENOTTE, WAKEUP, WOUAF, LOCKNAME, Anti-Move, automatisations, webhooks, panel, setup."),
    "fisc": ("LE FISC", "PND_FISC_TOKEN", "Économie : solde, banque, boutique, marché, enchères, casino, roulette, blackjack, entreprises, investissements."),
}

ENV_TEMPLATE = """# FWU — {label} : fichier de configuration (secrets). Ne jamais le partager.
# L'installateur recopie automatiquement les réglages communs depuis FWU
# (site, secret de synchronisation, OWNER, serveurs, dossier partagé…).
# Tu n'as qu'UNE ligne à remplir : le token de {label}.

PND_BOT_PROFILE={profile}
# Token de l'application Discord « {label} » (portail développeur → Bot → Reset Token).
{token_env}=COLLER_ICI_LE_TOKEN_DE_{token_name}
"""

ECOSYSTEM = """// FWU — {label} : processus PM2 indépendant (dossier, token et .env propres).
module.exports = {{
  apps: [
    {{
      name: "fwu-{profile}",
      cwd: __dirname,
      script: "index.js",
      node_args: "--env-file=.env",
      env: {{ NODE_ENV: "production", PND_BOT_PROFILE: "{profile}" }},
      max_memory_restart: "{memory}",
      autorestart: true,
      restart_delay: 5000,
      min_uptime: "15s",
      max_restarts: 10,
      kill_timeout: 5000,
      time: true,
    }},
  ],
}};
"""

INSTALLER = r"""#!/usr/bin/env bash
# FWU — {label} : installation / mise à jour en une commande, sur le VPS Oracle.
#
#   1. Dézippe ce dossier dans /home/opc/fwu-bots/ (le dossier fwu-{profile} y apparaît).
#   2. bash /home/opc/fwu-bots/fwu-{profile}/installer.sh
#   3. La première fois, il te demande le token (saisie masquée) et l'enregistre dans .env.
#
# Relançable à chaque mise à jour : ton .env est conservé, il n'est jamais affiché.
set -Eeuo pipefail

HERE="$(cd "$(dirname "${{BASH_SOURCE[0]}}")" && pwd)"
FWU_ROOT="${{PND_EXPECTED_ROOT:-/home/opc/her-v5-production}}"
FWU_ENV="$FWU_ROOT/bot/.env"
ENV_FILE="$HERE/.env"
PROFILE="{profile}"
TOKEN_ENV="{token_env}"
fail() {{ printf '\nERREUR : %s\n' "$*" >&2; exit 1; }}
info() {{ printf '\n==> %s\n' "$*"; }}

info "FWU — installation de {label}"
command -v node >/dev/null 2>&1 || fail "Node.js est introuvable (version 24 requise)."
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' || fail "Node.js 24 ou plus est requis (actuel : $(node -v))."
command -v pm2 >/dev/null 2>&1 || fail "PM2 est introuvable."
[[ -f "$FWU_ENV" ]] || fail "FWU introuvable ($FWU_ENV). Installe et mets à jour FWU d'abord."
SHARED="$(grep -E '^PND_DATA_DIR=' "$FWU_ENV" | tail -n 1 | cut -d= -f2- | tr -d '"'"'"'[:space:]' || true)"
[[ -n "$SHARED" ]] || fail "FWU n'utilise pas encore le dossier partagé. Lance d'abord : bash $FWU_ROOT/scripts/fwu-donnees-partagees.sh"

# .env : ses propres lignes (profil + token) gardées, réglages communs recopiés depuis FWU
# (tout sauf les tokens et les réglages propres à FWU). Aucune valeur n'est affichée.
[[ -f "$ENV_FILE" ]] || cp "$HERE/.env.example" "$ENV_FILE"
chmod 600 "$ENV_FILE"
own="$(grep -E "^(PND_BOT_PROFILE|${{TOKEN_ENV}})=" "$ENV_FILE" || true)"
grep -qE '^PND_BOT_PROFILE=' <<<"$own" || own="PND_BOT_PROFILE=$PROFILE"$'\n'"$own"
grep -qE "^${{TOKEN_ENV}}=" <<<"$own" || own="$own"$'\n'"${{TOKEN_ENV}}=COLLER_ICI_LE_TOKEN_DE_{token_name}"
umask 077
{{
  printf '# FWU — {label} : configuration (secrets). Ne jamais partager ce fichier.\n'
  printf '# Ne modifie que la ligne %s. Le reste est recopié depuis FWU à chaque installation.\n\n' "$TOKEN_ENV"
  printf '%s\n' "$own" | grep -vE '^$'
  printf '\n# --- Réglages communs recopiés depuis FWU ---\n'
  grep -vE '^(DISCORD_TOKEN|PND_[A-Z]+_TOKEN|PND_FWU_DELEGATED|PND_BOT_PROFILE)=' "$FWU_ENV" | grep -E '^[A-Z0-9_]+=' || true
}} > "$ENV_FILE.new"
mv "$ENV_FILE.new" "$ENV_FILE"
chmod 600 "$ENV_FILE"
unset own

read_token() {{ grep -E "^${{TOKEN_ENV}}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '"'"'"'[:space:]'; }}
TOKEN_VALUE="$(read_token)"
if [[ ( -z "$TOKEN_VALUE" || "$TOKEN_VALUE" == COLLER_ICI* ) && -t 0 ]]; then
  # Saisie masquée : rien ne s'affiche à l'écran, rien n'arrive dans l'historique du terminal.
  printf '\n🔑 Colle le token de l’application Discord {label} puis appuie sur Entrée.\n   (Rien ne s’affiche pendant que tu colles, c’est normal. Entrée seule = passer ce bot.)\n> '
  IFS= read -rs NEW_TOKEN || NEW_TOKEN=""
  printf '\n'
  NEW_TOKEN="$(printf '%s' "$NEW_TOKEN" | tr -d '"'"'"'[:space:]')"
  if [[ -n "$NEW_TOKEN" ]]; then
    [[ "$NEW_TOKEN" =~ ^[A-Za-z0-9_-]{{20,}}\.[A-Za-z0-9_-]{{4,}}\.[A-Za-z0-9_-]{{20,}}$ ]] || {{ unset NEW_TOKEN; fail "Ce texte ne ressemble pas à un token de bot Discord (portail développeur → Bot → Reset Token → Copy)."; }}
    FWU_TOKEN_TMP="$(grep -E '^DISCORD_TOKEN=' "$FWU_ENV" | tail -n 1 | cut -d= -f2- | tr -d '"'"'"'[:space:]' || true)"
    [[ "$NEW_TOKEN" != "$FWU_TOKEN_TMP" ]] || {{ unset NEW_TOKEN FWU_TOKEN_TMP; fail "Ce token est celui de FWU. Il faut le token de l'application {label}."; }}
    unset FWU_TOKEN_TMP
    NEW_TOKEN="$NEW_TOKEN" awk -v key="$TOKEN_ENV" 'BEGIN {{ t = ENVIRON["NEW_TOKEN"] }} index($0, key "=") == 1 {{ print key "=" t; next }} {{ print }}' "$ENV_FILE" > "$ENV_FILE.new"
    unset NEW_TOKEN
    mv "$ENV_FILE.new" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    printf '   Token enregistré dans %s (fichier protégé, jamais affiché).\n' "$ENV_FILE"
    TOKEN_VALUE="$(read_token)"
  fi
fi
if [[ -z "$TOKEN_VALUE" || "$TOKEN_VALUE" == COLLER_ICI* ]]; then
  printf '\n👉 {label} n’a pas de token : bot non démarré (FWU continue de faire son travail).\n   Pour l’ajouter plus tard, relance simplement :  bash %s/installer.sh\n\n' "$HERE"
  exit 2
fi
FWU_TOKEN="$(grep -E '^DISCORD_TOKEN=' "$FWU_ENV" | tail -n 1 | cut -d= -f2- | tr -d '"'"'"'[:space:]' || true)"
[[ "$TOKEN_VALUE" != "$FWU_TOKEN" ]] || fail "Ce token est celui de FWU. Il faut le token de l'application {label}."
unset TOKEN_VALUE FWU_TOKEN

info "Dépendances (npm ci)"
cd "$HERE"
npm ci --omit=dev --no-audit --no-fund >/dev/null
node --check index.js

info "Démarrage de fwu-{profile}"
# PM2's restart counter is cumulative across updates: reset it so the check below only counts crashes of this start.
pm2 reset fwu-{profile} >/dev/null 2>&1 || true
pm2 startOrReload ecosystem.config.cjs --update-env >/dev/null
ok=0
for attempt in $(seq 1 12); do
  sleep 5
  if pm2 jlist | node --input-type=module -e '
    let raw = ""; process.stdin.on("data", (c) => raw += c).on("end", () => {{
      const row = JSON.parse(raw).find((p) => p.name === "fwu-{profile}");
      process.exit(row?.pm2_env?.status === "online" && (row.pm2_env.restart_time ?? 0) < 3 ? 0 : 1);
    }});'; then ok=$((ok + 1)); [[ "$ok" -ge 2 ]] && break; else ok=0; fi
done
if [[ "$ok" -lt 2 ]]; then
  printf '\n--- fwu-{profile} ne tient pas : dernières lignes ---\n'
  pm2 logs fwu-{profile} --lines 20 --nostream 2>/dev/null | grep -vi token || true
  pm2 stop fwu-{profile} >/dev/null 2>&1 || true
  fail "{label} n'a pas démarré (bot arrêté, FWU continue de tout faire). Causes fréquentes : token faux, intents « Server Members » et « Message Content » non activés dans le portail Discord, bot pas invité sur le serveur."
fi
pm2 save >/dev/null

info "Synchronisation avec FWU"
if [[ -f "$FWU_ROOT/scripts/fwu-synchroniser.sh" ]]; then
  bash "$FWU_ROOT/scripts/fwu-synchroniser.sh"
else
  printf 'Script de synchronisation absent : mets FWU à jour, puis lance %s/scripts/fwu-synchroniser.sh\n' "$FWU_ROOT"
fi

printf '\n✅ {label} est en ligne (processus PM2 « fwu-{profile} »).\n'
printf 'Vérifie dans Discord : /sysp diagnostic bots. Les commandes slash peuvent mettre jusqu’à 1 h à apparaître.\n'
printf 'Arrêt d’urgence : pm2 stop fwu-{profile} (FWU reprend son travail en moins d’une minute).\n'
"""

README = """# FWU — {label}

{summary}

Ce dossier est un bot complet et indépendant : son code, son token, son fichier `.env` et son processus PM2 (`fwu-{profile}`).
Il partage la base de données de FWU (dossier partagé sur le VPS), ce qui permet aux bots de s'échanger les informations : rôles SYS+, économie, logs centralisés par FWU…

## Installation sur le VPS Oracle (5 minutes)

Prérequis, à faire une seule fois : FWU est à jour, et `bash /home/opc/her-v5-production/scripts/fwu-donnees-partagees.sh` a été lancé.

1. Dans le portail développeur Discord, application **{label}** : onglet **Bot**, active **Server Members Intent** et **Message Content Intent**, puis copie le token. Invite le bot sur le serveur s'il n'y est pas encore.
2. Envoie le zip sur le VPS, puis :

```bash
mkdir -p /home/opc/fwu-bots && cd /home/opc/fwu-bots && unzip -o FWU-{zipname}.zip
```

```bash
bash /home/opc/fwu-bots/fwu-{profile}/installer.sh
```

3. La première fois, l'installateur te demande le token : colle-le et appuie sur Entrée (rien ne s'affiche, c'est normal). Il est enregistré dans `.env`, protégé.

L'installateur recopie tout seul les réglages communs depuis FWU, installe, démarre, vérifie que le bot tient, puis synchronise FWU. Il n'affiche jamais le token.

## Mise à jour
Dézippe la nouvelle version au même endroit (`unzip -o`), puis relance `installer.sh`. Ton `.env` est conservé.

## En cas de problème
- `pm2 logs fwu-{profile} --lines 50 --nostream`
- Arrêt d'urgence : `pm2 stop fwu-{profile}`. FWU reprend son travail en moins d'une minute.
"""

MEMORY = {"fdpdlavoc": "220M"}


def bot_files():
    files = []
    for path in sorted(BOT.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(BOT)
        if any(part in EXCLUDED_DIRS for part in rel.parts):
            continue
        name = path.name
        if name == ".env" or name.startswith(".env."):
            continue
        if rel.as_posix() not in ALWAYS_INCLUDE and (
            path.suffix.lower() in EXCLUDED_SUFFIXES or name.endswith((".pem", ".key", ".p12", ".pfx"))
        ):
            continue
        if name.endswith(".test.js") or rel.parts[0] == "scripts":
            continue
        files.append((path, rel.as_posix()))
    for shared in ("slash-commands.ts", "bot-profiles.ts"):
        files.append((ROOT / "src" / "lib" / shared, shared))
    return files


def write_text(archive, name, text, executable=False):
    info = zipfile.ZipInfo(name)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = ((0o755 if executable else 0o644) | stat.S_IFREG) << 16
    archive.writestr(info, text)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sources = bot_files()
    for profile, (label, token_env, summary) in BOTS.items():
        zipname = label.replace(" ", "-")
        token_name = label.replace(" ", "_")
        top = f"fwu-{profile}"
        target = OUT / f"FWU-{zipname}.zip"
        values = dict(profile=profile, label=label, token_env=token_env, token_name=token_name, summary=summary, zipname=zipname, memory=MEMORY.get(profile, "160M"))
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
            for source, name in sources:
                archive.write(source, f"{top}/{name}")
            write_text(archive, f"{top}/.env.example", ENV_TEMPLATE.format(**values))
            write_text(archive, f"{top}/ecosystem.config.cjs", ECOSYSTEM.format(**values))
            write_text(archive, f"{top}/installer.sh", INSTALLER.format(**values), executable=True)
            write_text(archive, f"{top}/LISEZMOI.md", README.format(**values))
        with zipfile.ZipFile(target) as archive:
            if archive.testzip():
                raise SystemExit(f"Archive corrompue : {target}")
            names = archive.namelist()
            forbidden = [n for n in names if n.endswith("/.env") or "/data/" in n or "node_modules/" in n]
            if forbidden:
                raise SystemExit(f"Fichiers interdits dans {target.name} : {forbidden[:5]}")
        print(f"{target.name} : {len(names)} fichiers, {target.stat().st_size} octets")


if __name__ == "__main__":
    main()
