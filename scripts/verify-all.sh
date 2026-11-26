#!/usr/bin/env bash
# Vérification complète V2 (section 4 du cahier des charges). Résumé en fin de sortie.
set -u
cd "$(dirname "$0")/.."
OUT=${VERIFY_OUT:-/tmp/fwu-verify}; mkdir -p "$OUT"; status=0
run() { local name=$1; shift; if "$@" >"$OUT/$name.log" 2>&1; then echo "OK   $name"; else echo "FAIL $name"; status=1; fi; }
run bot-test npm --prefix bot test
run smoke npm --prefix bot run smoke
run audit-commands npm --prefix bot run audit:commands
run audit-replies npm --prefix bot run audit:replies
run vitest npx vitest run
run tsc npx tsc --noEmit
run eslint npx eslint .
grep -E "^# (tests|pass|fail|skipped)" "$OUT/bot-test.log" | tr '\n' ' '; echo
grep -E '"(runs|findings)"' "$OUT/smoke.log" | tr -d ' \n'; echo
grep -E "Tests  " "$OUT/vitest.log"
grep -E "problems" "$OUT/eslint.log" || echo "eslint: 0 problème"
exit $status
