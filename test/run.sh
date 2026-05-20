#!/usr/bin/env bash
# run.sh — full local verification for galaga_clone in one command.
# 1) JS parse check on the inline <script> in index.html
# 2) logic test harness (test/logic.test.js)
# Exit 0 only if both pass. Usage:  bash test/run.sh   (or ./test/run.sh)
set -uo pipefail

# Resolve repo root relative to this script so it works from any cwd.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "== [1/2] JS parse check =="
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const m=h.match(/<script>([\s\S]*?)<\/script>/);if(!m){console.error('no <script> block');process.exit(1);}new Function(m[1]);const lines=h.split('\n').length;console.log('  JS parse OK ('+lines+' lines)');"
PARSE=$?
if [ "$PARSE" -ne 0 ]; then
  echo "  JS parse FAILED"
  exit 1
fi

echo "== [2/2] logic tests =="
node test/logic.test.js
TESTS=$?

echo "========================================"
if [ "$TESTS" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
  exit 0
else
  echo "LOGIC TESTS FAILED"
  exit 1
fi
