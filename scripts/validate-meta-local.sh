#!/bin/bash
set -euo pipefail

ENV_FILE="supabase/functions/.env"
ENV_BACKUP=""

restore_env() {
  if [[ -n "$ENV_BACKUP" && -f "$ENV_BACKUP" ]]; then
    mv "$ENV_BACKUP" "$ENV_FILE"
  else
    rm -f "$ENV_FILE"
  fi
}

trap restore_env EXIT INT TERM

if [[ -f "$ENV_FILE" ]]; then
  ENV_BACKUP="$(mktemp /tmp/camply-functions-env.XXXXXX)"
  cp "$ENV_FILE" "$ENV_BACKUP"
fi

for run in 1 2 3; do
  echo "=== VALIDAÇÃO LOCAL ${run}/3 ==="
  npx supabase stop --no-backup >/dev/null 2>&1 || true
  docker rm -f camply-mock-graph >/dev/null 2>&1 || true

  ./scripts/validate-meta-e2e-once.sh
  node scripts/test-external-gates.cjs

  npx supabase stop --no-backup >/dev/null 2>&1 || true
  docker rm -f camply-mock-graph >/dev/null 2>&1 || true

done

restore_env
trap - EXIT INT TERM

echo "Três execuções independentes concluídas com sucesso."
