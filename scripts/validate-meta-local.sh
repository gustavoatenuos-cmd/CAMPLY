#!/bin/bash
set -euo pipefail

for run in 1 2 3; do
  echo "=== VALIDAÇÃO LOCAL ${run}/3 ==="
  ./scripts/validate-meta-e2e-once.sh
done

echo "Três execuções independentes concluídas com sucesso."
