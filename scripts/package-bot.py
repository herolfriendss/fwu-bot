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
    "database.js",
    "v4-commands.js",
    "module-settings.js",
    "prefix-commands.js",
    "prefix-commands.d.ts",
    "voice-commands.js",
    "voice-access-requests.js",
    "voice-access-request-policy.js",
    "voice-access-request-policy.test.js",
    "voice-permissions.js",
    "voice-permissions.d.ts",
    "voice-v2.js",
    "voice-v2-policy.js",
    "voice-v2-policy.d.ts",
    "dog-commands.js",
    "dog-hierarchy-policy.js",
    "dog-hierarchy-policy.test.js",
    "economy.js",
    "economy-policy.js",
    "economy-policy.d.ts",
    "moderation.js",
    "moderation-policy.js",
    "moderation-protection-policy.js",
    "moderation-protection-policy.test.js",
    "moderation-policy.d.ts",
    "guild-guard.js",
    "guild-guard-policy.js",
    "guild-guard-policy.d.ts",
    "guild-guard-commands.js",
    "social.js",
    "social-policy.js",
    "social-policy.d.ts",
    "cards.js",
    "cards-data.js",
    "cards-data.d.ts",
    "cards-policy.js",
    "cards-policy.d.ts",
    "games.js",
    "games-policy.js",
    "games-policy.d.ts",
    "tickets.js",
    "tickets-policy.js",
    "tickets-policy.d.ts",
    "automation.js",
    "automation-policy.js",
    "automation-policy.d.ts",
    "music/music.js",
    "music/music-policy.js",
    "systems/sysplus/commands.js",
    "systems/sysplus/permissions.js",
    "systems/sysplus/permissions.test.js",
    "systems/sysplus/audit.js",
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
