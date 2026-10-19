#!/usr/bin/env bash
# baseline = أقدم نسخة بالـ git، optimized = النسخة الحالية، sync-off = النسخة الحالية بدون انتظار fsync (للتجربة فقط)
set -euo pipefail
FILE=src/modules/consume/consume.service.ts
OLD=$(git log --format=%h -- "$FILE" | tail -1)
git show "$OLD:$FILE" > /tmp/consume.original.ts
if grep -q "WITH a AS" /tmp/consume.original.ts; then echo "STOP: the oldest commit already has the optimized version"; exit 1; fi
cp "$FILE" /tmp/consume.optimized.ts
if ! grep -q "WITH a AS" /tmp/consume.optimized.ts; then echo "STOP: the current file is not the optimized version"; exit 1; fi
trap 'cp /tmp/consume.optimized.ts "$FILE"' EXIT

run() {
  local label=$1 src=$2; shift 2
  cp "$src" "$FILE"
  env "$@" LOG_LEVEL=warn node --import tsx src/server.ts > /tmp/quota-server.log 2>&1 &
  local pid=$!
  for _ in $(seq 1 40); do curl -sf localhost:3000/health > /dev/null && break; sleep 0.5; done
  echo "=== $label ==="
  npx tsx perf/run.ts "$label" > /tmp/perf-$label.log 2>&1 || echo "(correctness check failed in $label)"
  kill $pid; wait $pid 2>/dev/null || true
}

run baseline  /tmp/consume.original.ts  A=1
run optimized /tmp/consume.optimized.ts A=1
run sync-off  /tmp/consume.optimized.ts "PGOPTIONS=-c synchronous_commit=off"
echo "done"
