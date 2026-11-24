#!/usr/bin/env python3
"""Build a source-only PND Assist bot archive from the complete bot tree.

The previous hand-maintained allowlist drifted behind index.js and silently
omitted newly integrated V5 modules. Package the whole bot source tree while
excluding runtime state, credentials, dependencies, VCS metadata and caches.
"""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
BOT = ROOT / "bot"
OUT = ROOT / "public" / "downloads" / "bot-oracle.zip"
EXCLUDED_DIRS = {
    ".git", "node_modules", "data", "coverage", ".cache", ".output",
    ".vite", ".nitro", "dist", "build", "tmp", "temp",
}
EXCLUDED_SUFFIXES = {".sqlite", ".sqlite3", ".db", ".log", ".zip", ".tar", ".gz"}

if not (BOT / "index.js").is_file() or not (BOT / "package.json").is_file():
    raise SystemExit("Racine bot invalide : index.js ou package.json absent.")

files = []
for path in sorted(BOT.rglob("*")):
    if not path.is_file():
        continue
    rel = path.relative_to(BOT)
    if any(part in EXCLUDED_DIRS for part in rel.parts):
        continue
    name = path.name
    if name == ".env" or (name.startswith(".env.") and name != ".env.example"):
        continue
    if name in {"*.sqlite", "*.db"} or path.suffix.lower() in EXCLUDED_SUFFIXES:
        continue
    if name.endswith((".pem", ".key", ".p12", ".pfx")):
        continue
    # Préfixes personnalisés du VPS : jamais écrasés par une mise à jour (bots.example.json est livré).
    if rel.as_posix() == "config/bots.json":
        continue
    files.append((path, rel.as_posix()))

# The bot imports the central command catalogue from the dashboard source.
shared = ROOT / "src" / "lib" / "slash-commands.ts"
if not shared.is_file():
    raise SystemExit("Catalogue partagé src/lib/slash-commands.ts absent.")
files.append((shared, "slash-commands.ts"))
# FWU multi-bot ownership map, also shared with the dashboard.
profiles = ROOT / "src" / "lib" / "bot-profiles.ts"
if not profiles.is_file():
    raise SystemExit("Répartition partagée src/lib/bot-profiles.ts absente.")
files.append((profiles, "bot-profiles.ts"))

names = [name for _, name in files]
if len(names) != len(set(names)):
    raise SystemExit("Chemins en double dans l’archive.")

OUT.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as archive:
    for source, name in files:
        archive.write(source, name)

with zipfile.ZipFile(OUT) as archive:
    bad = archive.testzip()
    if bad:
        raise SystemExit(f"CRC invalide : {bad}")
    entries = archive.namelist()
    forbidden = [n for n in entries if any(part in EXCLUDED_DIRS for part in Path(n).parts)
                 or n == ".env" or (Path(n).name.startswith(".env.") and Path(n).name != ".env.example")]
    if forbidden:
        raise SystemExit("Fichiers interdits dans l’archive : " + ", ".join(forbidden))

print(f"Archive source-only créée : {OUT}")
print(f"Entrées : {len(names)} | Taille : {OUT.stat().st_size} octets | CRC : OK")
