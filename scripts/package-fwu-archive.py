#!/usr/bin/env python3
"""Fabrique livraison/FWU_<date>.zip : le projet (git archive de HEAD) + le site déjà
testé (vitest), vérifié (tsc) et construit (.output), pour les VPS trop petits pour le faire.

    python3 scripts/package-fwu-archive.py

Refuse de travailler si le dépôt n'est pas propre : le site livré doit correspondre
exactement au commit archivé. Le VPS recalcule l'empreinte des sources
(scripts/source-fingerprint.py) et reconstruit lui-même au moindre écart.
"""
import datetime, os, subprocess, sys, tempfile, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "livraison"


def run(*cmd, **kw):
    print("▶", " ".join(cmd), flush=True)
    return subprocess.run(cmd, cwd=ROOT, check=True, **kw)


dirty = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
if dirty:
    sys.exit(f"Dépôt non propre : commite d'abord.\n{dirty}")
commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()

run("npm", "test")  # tests du site : sautés sur un petit VPS quand le site est livré tout fait
run("./node_modules/.bin/tsc", "--noEmit")
run("npm", "run", "build")
if not (ROOT / ".output" / "server" / "index.mjs").is_file():
    sys.exit("Build sans .output/server/index.mjs.")

OUT_DIR.mkdir(exist_ok=True)
out = OUT_DIR / f"FWU_{datetime.date.today():%Y%m%d}.zip"
with tempfile.TemporaryDirectory() as tmp:
    base = Path(tmp) / "base.zip"
    run("git", "archive", "--format=zip", "--prefix=FWU/", "-o", str(base), "HEAD")
    extract = Path(tmp) / "x"
    with zipfile.ZipFile(base) as archive:
        archive.extractall(extract)
    fingerprint = subprocess.run([sys.executable, "-I", str(ROOT / "scripts" / "source-fingerprint.py"), str(extract / "FWU")],
                                 capture_output=True, text=True, check=True).stdout.strip()
    marker = f"commit={commit}\nfingerprint={fingerprint}\nbuilt_at={datetime.datetime.now(datetime.timezone.utc):%Y-%m-%dT%H:%M:%SZ}\ntsc=ok\n"
    with zipfile.ZipFile(base) as source, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as target:
        for item in source.infolist():
            target.writestr(item, source.read(item.filename))
        output = ROOT / ".output"
        for path in sorted(output.rglob("*")):
            if path.is_file():
                target.write(path, "FWU/.output/" + path.relative_to(output).as_posix())
        target.writestr("FWU/.output/PREBUILT", marker)
with zipfile.ZipFile(out) as check:
    assert check.testzip() is None
    names = check.namelist()
    assert "FWU/.output/server/index.mjs" in names and "FWU/.output/PREBUILT" in names
    assert not any(n.endswith("/.env") or n == "FWU/.env" for n in names)
print(f"{out} — {len(names)} fichiers, {out.stat().st_size} octets, commit {commit}, empreinte {fingerprint[:12]}…")
