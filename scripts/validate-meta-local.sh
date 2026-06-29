#!/bin/bash
set -euo pipefail

echo "=== VALIDAÇÃO LOCAL (1X) ==="
./scripts/validate-meta-e2e-once.sh
echo "Execução completada com sucesso."
