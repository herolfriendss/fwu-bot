#!/usr/bin/env python3
"""Build the public, source-only Oracle bot archive with an explicit allowlist.

Never add .env, data/, node_modules or repository metadata here. The shared
slash-command definitions are copied from src/lib so an isolated extraction of
the archive still works.
"""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
BOT = ROOT / "bot"
OUT = ROOT / "public" / "downloads" / "bot-oracle.zip"

BOT_FILES = [
    "README.md",
    ".env.example",
    "package.json",
    "index.js",
    "v4-commands.js",
    "prefix-commands.js",
    "prefix-commands.d.ts",
    "voice-commands.js",
    "voice-permissions.js",
    "voice-permissions.d.ts",
    "dog-commands.js",
    "economy.js",
    "music/music.js",
    "music/music-policy.js",
    "systems/sysplus/commands.js",
    "systems/sysplus/permissions.js",
    "systems/sysplus/permissions.test.js",
    "scripts/export-economy.js",
]
SHARED_FILES = {
    "src/lib/slash-commands.ts": "slash-commands.ts",
}

missing = [rel for rel in BOT_FILES if not (BOT / rel).is_file()]
missing += [rel for rel in SHARED_FILES if not (ROOT / rel).is_file()]
if missing:
    raise SystemExit("Fichiers manquants pour l’archive : " + ", ".join(missing))

OUT.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as archive:
    for rel in BOT_FILES:
        archive.write(BOT / rel, rel)
    for source, destination in SHARED_FILES.items():
        archive.write(ROOT / source, destination)

print(f"✅ Archive écrite dans {OUT}")
with zipfile.ZipFile(OUT) as archive:
    for info in archive.infolist():
        print(f"   {info.filename} ({info.file_size} octets)")
