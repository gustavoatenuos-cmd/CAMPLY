#!/bin/bash
set -euo pipefail

echo "=== VALIDAÇÃO LOCAL DO META ANALYTICS ENGINE ==="

MOCK_CONTAINER_NAME="camply-mock-graph"
SUPABASE_CLI="${SUPABASE_CLI:-./node_modules/.bin/supabase}"

if [[ ! -x "$SUPABASE_CLI" ]]; then
  echo "Erro: Supabase CLI local não encontrada. Execute npm ci antes da validação."
  exit 1
fi

# Aguarda um endpoint HTTP ficar saudável com tentativas e timeout limitados por
# tentativa — nunca um curl sem limite, que pode travar indefinidamente e
# esconder qual endpoint realmente falhou (era o bug real por trás do "Edge
# Functions não responderam após 30 segundos", que na prática travava ~9min
# num único curl pendurado em vez de falhar em 30 tentativas de ~1s).
wait_for_edge_function() {
  local name="$1"
  local url="$2"
  local method="${3:-GET}"
  local max_attempts="${4:-30}"
  local attempt http_code curl_exit

  echo "--- Aguardando '$name' em $url (method=$method, até $max_attempts tentativas) ---"
  for attempt in $(seq 1 "$max_attempts"); do
    if http_code=$(curl -sS -o /dev/null -w '%{http_code}' \
      --connect-timeout 3 --max-time 5 -X "$method" "$url"); then
      curl_exit=0
    else
      curl_exit=$?
    fi

    echo "[$name] tentativa $attempt/$max_attempts -> curl_exit=$curl_exit http_code=${http_code:-N/A}"

    if [[ "$curl_exit" -eq 0 && "$http_code" =~ ^[23] ]]; then
      echo "[$name] respondeu com sucesso (HTTP $http_code)."
      return 0
    fi

    sleep 1
  done

  echo "Erro: '$name' não respondeu com sucesso em $url após $max_attempts tentativas."
  return 1
}

# Despeja o máximo de contexto possível quando um health check falha, para que
# a causa real (runtime não subiu, erro de import Deno, container reiniciando,
# porta não exposta, etc.) apareça no log da CI em vez de só "não respondeu".
# Localiza containers por nome parcial/filtro, não por nome fixo, já que o
# nome exato pode mudar entre versões da CLI do Supabase.
dump_diagnostics() {
  local failed_function="$1"
  echo "=== DIAGNÓSTICO: falha ao aguardar '$failed_function' ==="

  echo "--- supabase status ---"
  "$SUPABASE_CLI" status || true

  echo "--- docker ps -a (todos os containers, com portas) ---"
  docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' || true

  echo "--- containers encerrados (exited) ---"
  docker ps -a --filter "status=exited" --format 'table {{.Names}}\t{{.Status}}' || true

  local edge_container
  edge_container=$(docker ps -a --filter "name=edge_runtime" --format '{{.Names}}' | head -n1)
  if [[ -z "$edge_container" ]]; then
    edge_container=$(docker ps -a --format '{{.Names}}' | grep -i "edge" | head -n1 || true)
  fi
  if [[ -n "$edge_container" ]]; then
    echo "--- logs do Edge Runtime ($edge_container), últimas 200 linhas ---"
    docker logs --tail 200 "$edge_container" || true
  else
    echo "--- nenhum container de Edge Runtime encontrado (procurado por 'edge_runtime'/'edge') ---"
  fi

  local gateway_container
  gateway_container=$(docker ps -a --format '{{.Names}}' | grep -iE "kong|gateway" | head -n1 || true)
  if [[ -n "$gateway_container" ]]; then
    echo "--- logs do Gateway ($gateway_container), últimas 100 linhas ---"
    docker logs --tail 100 "$gateway_container" || true
  else
    echo "--- nenhum container de gateway encontrado (procurado por 'kong'/'gateway') ---"
  fi

  if docker ps -a --format '{{.Names}}' | grep -qx "$MOCK_CONTAINER_NAME"; then
    echo "--- logs do Mock Graph API ($MOCK_CONTAINER_NAME), últimas 100 linhas ---"
    docker logs --tail 100 "$MOCK_CONTAINER_NAME" || true
  fi

  echo "=== FIM DO DIAGNÓSTICO ==="
}

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
  "$SUPABASE_CLI" stop --no-backup || true
  
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



# 2. Preparar migrations incrementais antes de iniciar o Supabase.
# O teste precisa recriar um banco legado até a migration 000002, aplicar fixtures
# antigas e só então subir todas as migrations posteriores. Portanto nenhuma
# migration >= 000003 pode estar presente durante `supabase start`/`db reset`.
echo "2. Preparando migrations incrementais..."
mkdir -p /tmp/camply_migrations
rm -f /tmp/camply_migrations/*.sql
for migration in supabase/migrations/*.sql; do
  version="$(basename "$migration" | cut -d_ -f1)"
  if [[ "$version" > "20260627000002" ]]; then
    mv "$migration" /tmp/camply_migrations/
  fi
done

# 2.5. Prepare environment variables for local testing
cat << EOF > supabase/functions/.env
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
DIRECT_DB_URL=postgresql://postgres:postgres@supabase_db_camply:5432/postgres
EOF

# 3. Iniciar o Supabase local
echo "3. Iniciar o Supabase local..."
"$SUPABASE_CLI" start

# Descobrir a rede do Supabase
SUPABASE_NETWORK=$(docker network ls --filter name=supabase -q | head -n 1)
if [[ -z "$SUPABASE_NETWORK" ]]; then
  echo "Erro: Rede do Supabase não encontrada."
  exit 1
fi
SUPABASE_NETWORK_NAME=$(docker network inspect $SUPABASE_NETWORK -f '{{.Name}}')
echo "Rede Supabase detectada: $SUPABASE_NETWORK_NAME"

# 4. db reset
echo "4. Executando db reset (até migration 2)..."
"$SUPABASE_CLI" db reset

# 5. Aplicar fixtures legadas
echo "5. Aplicando fixtures legadas (antes da migration 3)..."
PGPASSWORD=postgres docker exec -i supabase_db_camply psql -U postgres -d postgres < supabase/tests/fixtures_legacy.sql

# 6. Devolver migrations e aplicar
echo "6. Aplicando migrations >= 3..."
mv /tmp/camply_migrations/*.sql supabase/migrations/ 2>/dev/null || true
"$SUPABASE_CLI" migration up --include-all

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

if ! wait_for_edge_function "mock-graph" "http://localhost:9999/health" "GET" 30; then
  echo "--- logs do Mock Graph API ($MOCK_CONTAINER_NAME) ---"
  docker logs "$MOCK_CONTAINER_NAME" || true
  dump_diagnostics "mock-graph"
  exit 1
fi
echo "Mock API está saudável."

if ! wait_for_edge_function "meta-sync-performance" "http://localhost:54321/functions/v1/meta-sync-performance" "OPTIONS" 30; then
  dump_diagnostics "meta-sync-performance"
  exit 1
fi

if ! wait_for_edge_function "meta-oauth-callback" "http://localhost:54321/functions/v1/meta-oauth-callback" "OPTIONS" 30; then
  dump_diagnostics "meta-oauth-callback"
  exit 1
fi

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
