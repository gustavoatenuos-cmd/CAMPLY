#!/bin/bash
set -e

echo "=== VALIDAÇÃO LOCAL DO META ANALYTICS ENGINE ==="

# 1. Confirmar que não existe projeto remoto linkado
if grep -q "project_id" supabase/.temp/project-ref 2>/dev/null; then
  echo "Erro: Projeto Supabase remoto linkado. Remova o link antes de testar localmente."
  exit 1
fi

echo "1. Nenhum projeto remoto linkado."

# 2. Iniciar o Supabase local
echo "2. Iniciando Supabase local..."
npx supabase start

# 3. Mover migration 3 temporariamente para testar o fixture
echo "3. Preparando teste de migration incremental..."
mkdir -p /tmp/camply_migrations
mv supabase/migrations/20260627000003_mixed_attribution_support.sql /tmp/camply_migrations/

# 4. db reset
echo "4. Executando db reset (até migration 2)..."
npx supabase db reset

# 5. Aplicar fixtures legadas
echo "5. Aplicando fixtures legadas (antes da migration 3)..."
PGPASSWORD=postgres docker exec -i supabase_db_camply psql -U postgres -d postgres < supabase/tests/fixtures_legacy.sql

# 6. Mover migration 3 de volta e aplicar
echo "6. Aplicando migration 3 e validando deduplicação..."
mv /tmp/camply_migrations/20260627000003_mixed_attribution_support.sql supabase/migrations/
npx supabase migration up

# 7. Executar smoke test
echo "7. Executando Smoke Test SQL..."
PGPASSWORD=postgres docker exec -i supabase_db_camply psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/meta_analytics_smoke.sql

# 8. Executar lint, testes e build
echo "8. Executando Lint..."
npm run lint

echo "9. Executando Testes Unitários..."
npm test

echo "10. Executando Build..."
npm run build

echo "=== VALIDAÇÃO LOCAL CONCLUÍDA COM SUCESSO! ==="
