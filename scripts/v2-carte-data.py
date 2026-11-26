#!/usr/bin/env python3
"""Génère les tableaux bruts de docs/V2_CARTE.md (chemins de rôles, permissions de salons,
réponses éphémères, minuteries, routage). Usage : python3 scripts/v2-carte-data.py"""
import os, re, sys
ROOT = os.path.join(os.path.dirname(__file__), "..", "bot")
SKIP_DIRS = {"node_modules", "scripts", "fixtures"}

def files():
    for d, dirs, fs in os.walk(ROOT):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        for f in fs:
            if f.endswith(".js") and not f.endswith(".test.js"):
                p = os.path.join(d, f)
                yield os.path.relpath(p, ROOT), open(p, encoding="utf8").read().splitlines()

def grep(pattern):
    rx = re.compile(pattern)
    out = []
    for rel, lines in sorted(files()):
        for i, line in enumerate(lines, 1):
            if rx.search(line):
                out.append((rel, i, line.strip()[:150]))
    return out

def table(rows, title):
    print(f"\n### {title} ({len(rows)})\n")
    print("| Fichier:ligne | Code |\n|---|---|")
    for rel, i, code in rows:
        print(f"| `{rel}:{i}` | `{code.replace('|', '¦').replace('`', '')}` |")

def counts(rows, title):
    c = {}
    for rel, _, _ in rows:
        c[rel] = c.get(rel, 0) + 1
    print(f"\n### {title} ({len(rows)} occurrences, {len(c)} fichiers)\n")
    print("| Fichier | Nombre |\n|---|---|")
    for rel, n in sorted(c.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f"| `{rel}` | {n} |")

section = sys.argv[1] if len(sys.argv) > 1 else "all"
if section in ("all", "roles"):
    table(grep(r"roles\.(add|remove|set)\("), "Appels roles.add/remove/set")
if section in ("all", "perms"):
    table(grep(r"permissionOverwrites\.(edit|create|set|delete)\(|\.lockPermissions\("), "Modifications de permissions de salons")
if section in ("all", "ephemeral"):
    counts(grep(r"ephemeral\s*:\s*true|MessageFlags\.Ephemeral|flags:\s*64"), "Réponses éphémères")
if section in ("all", "timers"):
    table(grep(r"\bsetInterval\(|\bsetTimeout\([^)]*\d{4,}"), "Minuteries de fond (setInterval / setTimeout longs)")
if section in ("all", "routing"):
    lines = open(os.path.join(ROOT, "index.js"), encoding="utf8").read().splitlines()
    print("\n### Ordre de routage interactionCreate (index.js)\n")
    start = next(i for i, l in enumerate(lines) if 'client.on("interactionCreate"' in l)
    n = 0
    for i in range(start, len(lines)):
        m = re.search(r"(checkInteractionHierarchy|freezeRefusal|slashCommandOwner|await (handle\w+)|runPrefixFromSlash)", lines[i])
        if m:
            n += 1
            print(f"{n}. `{m.group(2) or m.group(1)}` (ligne {i + 1})")
        if lines[i].startswith("});"):
            break
