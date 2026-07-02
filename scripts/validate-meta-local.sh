#!/bin/bash
set -euo pipefail

if ! docker info >/dev/null 2>&1; then
  echo "Erro: Docker Desktop não está disponível. A validação não foi executada."
  exit 1
fi

echo "=== VALIDAÇÃO LOCAL (3X) ==="
for i in 1 2 3; do
  echo "--- RUN $i ---"
  ./scripts/validate-meta-e2e-once.sh
done
echo "Execução completada com sucesso."
