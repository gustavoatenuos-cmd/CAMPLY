#!/bin/bash
set -euo pipefail

echo "=== VALIDAÇÃO LOCAL COMPLETA (3X) ==="

for i in 1 2 3; do
  echo ""
  echo ">>> INICIANDO EXECUÇÃO $i/3 <<<"
  ./scripts/validate-meta-e2e-once.sh
  echo ">>> SUCESSO EXECUÇÃO $i/3 <<<"
done

echo "Todas as 3 execuções limpas completadas com sucesso."
