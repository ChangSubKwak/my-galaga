#!/usr/bin/env bash
# run.sh — full local verification for galaga_clone in one command.
# 1) JS parse check on the inline <script> in index.html
# 2) logic test harness (test/logic.test.js)
# 3) layout audit — no permanently off-screen text (test/layout-audit.js)
# 4) fresh boot   — the first-time player path (test/fresh-boot.js)
# Exit 0 only if all three pass. Usage:  bash test/run.sh   (or ./test/run.sh)
#
# NOT run here: the three REPORTS, which measure a shape rather than gate a
# change — run them by hand when working on what they watch:
#   test/curve-audit.js      difficulty + score economy across stages 1-100
#   test/telegraph-audit.js  the fairness budget (warning frames per threat)
#   test/pulse-audit.js      the control budget (frames your input does nothing)
#   test/recovery-audit.js   the recovery budget (does the death spiral have a brake)
#   test/loadout-audit.js    the shield economy that limits THE REDOUBT
#   test/ebb-audit.js        whether the sortie window is ever actually cuttable
#   test/measure-audit.js    THE MEASURE (clock / authorship / arrangement / rhythm)
set -uo pipefail

# Resolve repo root relative to this script so it works from any cwd.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "== [1/4] JS parse check =="
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const m=h.match(/<script>([\s\S]*?)<\/script>/);if(!m){console.error('no <script> block');process.exit(1);}new Function(m[1]);const lines=h.split('\n').length;console.log('  JS parse OK ('+lines+' lines)');"
PARSE=$?
if [ "$PARSE" -ne 0 ]; then
  echo "  JS parse FAILED"
  exit 1
fi

echo "== [2/4] logic tests =="
node test/logic.test.js
TESTS=$?
if [ "$TESTS" -ne 0 ]; then
  echo "========================================"
  echo "LOGIC TESTS FAILED"
  exit 1
fi

echo "== [3/4] layout audit =="
node test/layout-audit.js | tail -n 6
LAYOUT=${PIPESTATUS[0]}

if [ "$LAYOUT" -ne 0 ]; then
  echo "========================================"
  echo "LAYOUT AUDIT FAILED (text renders permanently off-screen)"
  exit 1
fi

echo "== [4/4] fresh boot =="
node test/fresh-boot.js | tail -n 3
FRESH=${PIPESTATUS[0]}

echo "========================================"
if [ "$FRESH" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
  exit 0
else
  echo "FRESH BOOT FAILED (a first-time profile cannot start)"
  exit 1
fi
