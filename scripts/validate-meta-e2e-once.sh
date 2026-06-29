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

echo "Iniciando Edge Function localmente com META_BASE_URL customizado para a internal network..."
META_BASE_URL="http://mock-graph:9999" npx supabase functions serve meta-sync-ads --env-file ./supabase/.env.local &
FUNCTION_PID=$!
sleep 5

echo "Rodando script E2E NodeJS 3 vezes para validar ausência de 502 / side-effects..."
for i in {1..3}; do
  echo ">>> EXECUÇÃO E2E #$i <<<"
  curl -s http://localhost:9999/reset > /dev/null
  node scripts/test-edge-e2e.cjs
done

# 9. Executar lint, testes e build
echo "9. Executando Lint..."
npm run lint

echo "10. Executando Testes Unitários..."
npm test

echo "11. Executando Build..."
npm run build

echo "=== VALIDAÇÃO LOCAL CONCLUÍDA COM SUCESSO! ==="
