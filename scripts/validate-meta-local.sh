#!/bin/bash
set -euo pipefail

echo "=== VALIDAÇÃO LOCAL (3X) ==="
for i in 1 2 3; do
  echo "--- RUN $i ---"
  ./scripts/validate-meta-e2e-once.sh
done
echo "Execução completada com sucesso."
