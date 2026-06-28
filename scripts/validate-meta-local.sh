#!/bin/bash
set -euo pipefail

echo "=== VALIDAÇÃO LOCAL DO META ANALYTICS ENGINE ==="

MIGRATION_PATH="supabase/migrations/20260627000003_mixed_attribution_support.sql"
TEMP_MIGRATION="/tmp/20260627000003_mixed_attribution_support.sql"

MOCK_PID=""
FUNCTION_PID=""

cleanup() {
  echo "--- Executando cleanup ---"
  
  if [[ -f "$TEMP_MIGRATION" && ! -f "$MIGRATION_PATH" ]]; then
    echo "Restaurando migration..."
    mv "$TEMP_MIGRATION" "$MIGRATION_PATH"
  fi
  
  if [[ -n "$MOCK_PID" ]]; then
    echo "Encerrando Mock API (PID $MOCK_PID)..."
    kill "$MOCK_PID" 2>/dev/null || true
  fi
  
  if [[ -n "$FUNCTION_PID" ]]; then
    echo "Encerrando Edge Function (PID $FUNCTION_PID)..."
    kill "$FUNCTION_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

# 1. Confirmar que não existe projeto remoto linkado
if [[ -s supabase/.temp/project-ref ]]; then
  echo "Erro: existe um projeto Supabase remoto linkado."
  exit 1
fi

echo "1. Nenhum projeto remoto linkado."

# 2. Iniciar o Supabase local
echo "2. Iniciando Supabase local..."
npx supabase start

# 3. Mover migration temporariamente
echo "3. Preparando teste de migration incremental..."
mkdir -p /tmp/camply_migrations
if [[ -f "$MIGRATION_PATH" ]]; then
  mv "$MIGRATION_PATH" "$TEMP_MIGRATION"
fi

# 4. db reset
echo "4. Executando db reset (até migration 2)..."
npx supabase db reset

# 5. Aplicar fixtures legadas
echo "5. Aplicando fixtures legadas (antes da migration 3)..."
PGPASSWORD=postgres docker exec -i supabase_db_camply psql -U postgres -d postgres < supabase/tests/fixtures_legacy.sql

# 6. Devolver migration 3 e aplicar
echo "6. Aplicando migration 3 e validando deduplicação..."
if [[ -f "$TEMP_MIGRATION" ]]; then
  mv "$TEMP_MIGRATION" "$MIGRATION_PATH"
fi
npx supabase migration up

# 7. Executar smoke test
echo "7. Executando Smoke Test SQL..."
PGPASSWORD=postgres docker exec -i supabase_db_camply psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/meta_analytics_smoke.sql

# 8. E2E: Iniciar Mock e Edge Function
echo "8. E2E HTTP Edge Function..."

echo "Iniciando Mock Graph API..."
lsof -ti:9999 | xargs kill -9 2>/dev/null || true
node scripts/mock-graph.cjs &
MOCK_PID=$!
sleep 2

echo "Iniciando Edge Function localmente com META_BASE_URL customizado..."
# Using host.docker.internal so the Docker container can reach the mock server on the host
META_BASE_URL="http://host.docker.internal:9999" npx supabase functions serve meta-sync-ads --env-file ./supabase/.env.local &
FUNCTION_PID=$!
sleep 5

echo "Rodando script E2E NodeJS..."
node scripts/test-edge-e2e.cjs

# 9. Executar lint, testes e build
echo "9. Executando Lint..."
npm run lint

echo "10. Executando Testes Unitários..."
npm test

echo "11. Executando Build..."
npm run build

echo "12. Validando integridade dos arquivos críticos..."
test -f "$MIGRATION_PATH"
git diff --exit-code -- "$MIGRATION_PATH"

echo "=== VALIDAÇÃO LOCAL CONCLUÍDA COM SUCESSO! ==="
