#!/bin/bash
set -euo pipefail

echo "=== VALIDAÇÃO LOCAL (3X) ==="
for i in 1 2 3; do
  echo "--- RUN $i ---"
  mkdir -p /tmp/camply_migrations
  mv supabase/migrations/20260630000018_* /tmp/camply_migrations/ 2>/dev/null || true
  ./scripts/validate-meta-e2e-once.sh
done
echo "Execução completada com sucesso."
