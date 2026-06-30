#!/bin/bash
set -euo pipefail

echo "=== VALIDAÇÃO LOCAL DO META ANALYTICS ENGINE ==="

FUNCTION_PID=""
MOCK_CONTAINER_NAME="camply-mock-graph"

cleanup() {
  echo "--- Executando cleanup ---"
  
  if ls /tmp/camply_migrations/*.sql 1> /dev/null 2>&1; then
    echo "Restaurando migrations temporárias..."
    mv /tmp/camply_migrations/*.sql supabase/migrations/ || true
  fi
  
  echo "Encerrando Mock API Container ($MOCK_CONTAINER_NAME)..."
  docker stop "$MOCK_CONTAINER_NAME" 2>/dev/null || true
  docker rm "$MOCK_CONTAINER_NAME" 2>/dev/null || true
  
  echo "Encerrando Supabase (stop --no-backup)..."
  npx supabase stop --no-backup || true
  
  echo "Removendo supabase/functions/.env..."
  rm -f supabase/functions/.env
  
  echo "Verificando containers órfãos..."
  ORPHANS=$(docker ps -a --filter name=supabase --format '{{.Names}}')
  if [[ -n "$ORPHANS" ]]; then
    echo "Containers órfãos detectados: $ORPHANS"
    # exit 1 (disabled strictly in trap, but we can print error)
  fi

  echo "Verificando working tree limpa..."
  if ! git diff --quiet; then
    echo "Aviso: A working tree não está limpa!"
    # exit 1
  fi
}

trap cleanup EXIT INT TERM

# 1. Confirmar que não existe projeto remoto linkado
if [[ -s supabase/.temp/project-ref ]]; then
  echo "Erro: existe um projeto Supabase remoto linkado."
  exit 1
fi

echo "1. Nenhum projeto remoto linkado."

# 1.5. Prepare environment variables for local testing
cat << 'EOF' > supabase/functions/.env
META_TEST_MODE=true
META_API_ENV=local
TEST_TIMEOUT_MS=100
TEST_MAX_RETRIES=2
TEST_BACKOFF_MS=50
META_APP_ID=123
META_APP_SECRET=abc
APP_BASE_URL=http://localhost:3000
META_BASE_URL=http://mock-graph:9999
META_TOKEN_ENCRYPTION_KEY=my-super-secret-encryption-key
EOF

# 2. Iniciar o Supabase local
echo "2. Iniciando Supabase local..."
npx supabase start

# Descobrir a rede do Supabase
SUPABASE_NETWORK=$(docker network ls --filter name=supabase -q | head -n 1)
if [[ -z "$SUPABASE_NETWORK" ]]; then
  echo "Erro: Rede do Supabase não encontrada."
  exit 1
fi
SUPABASE_NETWORK_NAME=$(docker network inspect $SUPABASE_NETWORK -f '{{.Name}}')
echo "Rede Supabase detectada: $SUPABASE_NETWORK_NAME"

# 3. Mover migrations temporariamente
echo "3. Preparando teste de migration incremental..."
mkdir -p /tmp/camply_migrations
mv supabase/migrations/20260627000003_* /tmp/camply_migrations/ 2>/dev/null || true
mv supabase/migrations/20260627000004_* /tmp/camply_migrations/ 2>/dev/null || true
mv supabase/migrations/20260627000005_* /tmp/camply_migrations/ 2>/dev/null || true
mv supabase/migrations/20260627000006_* /tmp/camply_migrations/ 2>/dev/null || true
mv supabase/migrations/20260627000007_* /tmp/camply_migrations/ 2>/dev/null || true
mv supabase/migrations/20260627000008_* /tmp/camply_migrations/ 2>/dev/null || true
mv supabase/migrations/20260627000009_* /tmp/camply_migrations/ 2>/dev/null || true
mv supabase/migrations/20260627000010_* /tmp/camply_migrations/ 2>/dev/null || true
mv supabase/migrations/20260627000011_* /tmp/camply_migrations/ 2>/dev/null || true
mv supabase/migrations/20260627000012_* /tmp/camply_migrations/ 2>/dev/null || true
mv supabase/migrations/20260627000013_* /tmp/camply_migrations/ 2>/dev/null || true
mv supabase/migrations/20260627000014_* /tmp/camply_migrations/ 2>/dev/null || true
mv supabase/migrations/20260627000015_* /tmp/camply_migrations/ 2>/dev/null || true
mv supabase/migrations/20260627000016_* /tmp/camply_migrations/ 2>/dev/null || true

# 4. db reset
echo "4. Executando db reset (até migration 2)..."
npx supabase db reset

# 5. Aplicar fixtures legadas
echo "5. Aplicando fixtures legadas (antes da migration 3)..."
PGPASSWORD=postgres docker exec -i supabase_db_camply psql -U postgres -d postgres < supabase/tests/fixtures_legacy.sql

# 6. Devolver migrations e aplicar
echo "6. Aplicando migrations >= 3..."
mv /tmp/camply_migrations/*.sql supabase/migrations/ 2>/dev/null || true
npx supabase migration up --include-all

# 7. Executar smoke test (RLS, constraints, etc sem usar GRANT ALL na psql)
echo "7. Executando Smoke Test SQL..."
PGPASSWORD=postgres docker exec -i supabase_db_camply psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/meta_analytics_smoke.sql

# 8. E2E: Iniciar Mock Container
echo "8. E2E HTTP Edge Function..."
echo "Limpando container mock órfão se existir..."
docker stop "$MOCK_CONTAINER_NAME" 2>/dev/null || true
docker rm "$MOCK_CONTAINER_NAME" 2>/dev/null || true

echo "Iniciando Mock Graph API via Docker..."
docker run -d --name "$MOCK_CONTAINER_NAME" \
  --network "$SUPABASE_NETWORK_NAME" \
  --network-alias mock-graph \
  -v "$(pwd)/scripts:/scripts" \
  -p 9999:9999 \
  -e MOCK_PORT=9999 \
  -e MOCK_HOST="mock-graph:9999" \
  node:18 node /scripts/mock-graph.cjs

echo "Aguardando Mock API ficar saudável..."
TIMEOUT=30
until curl -s http://localhost:9999/health > /dev/null; do
  sleep 1
  ((TIMEOUT--))
  if [[ $TIMEOUT -le 0 ]]; then
    echo "Erro: Mock API não respondeu após 30 segundos."
    docker logs "$MOCK_CONTAINER_NAME"
    exit 1
  fi
done
echo "Mock API está saudável."

echo "Aguardando Edge Functions (mock) ficarem saudáveis..."
TIMEOUT=30
until curl -s -f http://localhost:54321/functions/v1/meta-sync-ads -X OPTIONS > /dev/null && curl -s -f http://localhost:54321/functions/v1/meta-oauth-callback -X OPTIONS > /dev/null; do
  sleep 1
  ((TIMEOUT--))
  if [[ $TIMEOUT -le 0 ]]; then
    echo "Erro: Edge Functions não responderam após 30 segundos."
    exit 1
  fi
done
echo "Edge Functions estão saudáveis."

# RLS / OAuth
node scripts/test-rls-api.cjs
if [ $? -ne 0 ]; then
  echo "RLS API test failed"
  cleanup
  exit 1
fi
node scripts/test-oauth-concurrent.cjs
if [ $? -ne 0 ]; then
  echo "OAuth Concurrent test failed"
  cleanup
  exit 1
fi

echo "9. Rodando script E2E NodeJS..."
node scripts/test-edge-e2e.cjs

# 9. Executar lint, testes e build
echo "9. Executando Lint..."
npm run lint

echo "10. Executando Testes Unitários..."
npm test

echo "11. Executando Build..."
npm run build

echo "=== VALIDAÇÃO LOCAL CONCLUÍDA COM SUCESSO! ==="
