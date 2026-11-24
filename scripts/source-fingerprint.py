#!/usr/bin/env python3
"""Empreinte des sources qui servent à construire le site (src, config, public hors downloads).

Utilisée par package-fwu-archive.py (machine de build) et deploy-pnd-v5-oracle.sh (VPS) :
un site déjà construit n'est réutilisé que si l'empreinte est identique.
"""
import hashlib, os, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."
FILES = ["package.json", "package-lock.json", "vite.config.ts", "tsconfig.json", "components.json"]
DIRS = ["src", "public"]
SKIP_DIRS = {os.path.join("public", "downloads")}

def collect():
    paths = [f for f in FILES if os.path.isfile(os.path.join(ROOT, f))]
    for top in DIRS:
        for base, dirs, names in os.walk(os.path.join(ROOT, top)):
            rel_base = os.path.relpath(base, ROOT)
            dirs[:] = sorted(d for d in dirs if os.path.join(rel_base, d) not in SKIP_DIRS)
            paths += [os.path.join(rel_base, n).replace(os.sep, "/") for n in names]
    return sorted(set(paths), key=lambda p: p.encode())

digest = hashlib.sha256()
for path in collect():
    with open(os.path.join(ROOT, path), "rb") as handle:
        digest.update(path.encode() + b"\0" + hashlib.sha256(handle.read()).hexdigest().encode() + b"\n")
print(digest.hexdigest())
