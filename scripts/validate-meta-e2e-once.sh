#!/bin/bash
set -euo pipefail

echo "=== VALIDAÇÃO LOCAL DO META ANALYTICS ENGINE ==="

MOCK_CONTAINER_NAME="camply-mock-graph"
MIGRATION_TMP_DIR="$(mktemp -d /tmp/camply_migrations.XXXXXX)"

cleanup() {
  echo "--- Executando cleanup ---"

  if compgen -G "$MIGRATION_TMP_DIR/*.sql" > /dev/null; then
    mv "$MIGRATION_TMP_DIR"/*.sql supabase/migrations/ || true
  fi
  rm -rf "$MIGRATION_TMP_DIR"

  docker stop "$MOCK_CONTAINER_NAME" >/dev/null 2>&1 || true
  docker rm "$MOCK_CONTAINER_NAME" >/dev/null 2>&1 || true
  npx supabase stop --no-backup >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

if [[ -s supabase/.temp/project-ref ]]; then
  echo "Erro: existe um projeto Supabase remoto linkado."
  exit 1
fi

cat << 'EOF' > supabase/functions/.env
META_TEST_MODE=true
META_API_ENV=local
TEST_TIMEOUT_MS=100
TEST_MAX_RETRIES=2
TEST_BACKOFF_MS=50
META_APP_ID=local-test-app
META_APP_SECRET=local-test-value
APP_BASE_URL=http://localhost:3000
META_BASE_URL=http://mock-graph:9999
META_TOKEN_ENCRYPTION_KEY=local-test-encryption-value
EOF

npx supabase stop --no-backup >/dev/null 2>&1 || true
npx supabase start

SUPABASE_NETWORK_NAME="$(docker inspect supabase_edge_runtime_camply --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}' 2>/dev/null || true)"
if [[ -z "$SUPABASE_NETWORK_NAME" ]]; then
  SUPABASE_NETWORK_ID="$(docker network ls --filter name=supabase -q | head -n 1)"
  SUPABASE_NETWORK_NAME="$(docker network inspect "$SUPABASE_NETWORK_ID" -f '{{.Name}}')"
fi

for version in 03 04 05 06 07 08 09 10 11 12 13 14; do
  mv supabase/migrations/202606270000${version}_* "$MIGRATION_TMP_DIR"/ 2>/dev/null || true
done

npx supabase db reset
PGPASSWORD=postgres docker exec -i supabase_db_camply psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/fixtures_legacy.sql

if compgen -G "$MIGRATION_TMP_DIR/*.sql" > /dev/null; then
  mv "$MIGRATION_TMP_DIR"/*.sql supabase/migrations/
fi
npx supabase migration up --include-all

PGPASSWORD=postgres docker exec -i supabase_db_camply psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/meta_analytics_smoke.sql

docker rm -f "$MOCK_CONTAINER_NAME" >/dev/null 2>&1 || true
docker run -d --name "$MOCK_CONTAINER_NAME" \
  --network "$SUPABASE_NETWORK_NAME" \
  --network-alias mock-graph \
  -v "$(pwd)/scripts:/scripts:ro" \
  -p 9999:9999 \
  -e MOCK_PORT=9999 \
  -e MOCK_HOST="mock-graph:9999" \
  node:18 node /scripts/mock-graph.cjs >/dev/null

wait_for_http() {
  local description="$1"
  local endpoint="$2"
  local method="${3:-GET}"
  local remaining=30

  until curl -sS -f -X "$method" "$endpoint" >/dev/null 2>&1; do
    sleep 1
    remaining=$((remaining - 1))
    if [[ "$remaining" -le 0 ]]; then
      echo "Erro: $description não respondeu após 30 segundos."
      docker logs "$MOCK_CONTAINER_NAME" 2>/dev/null || true
      exit 1
    fi
  done
}

wait_for_http "Mock API" "http://127.0.0.1:9999/health"
wait_for_http "meta-sync-ads" "http://127.0.0.1:54321/functions/v1/meta-sync-ads" "OPTIONS"
wait_for_http "meta-oauth-callback" "http://127.0.0.1:54321/functions/v1/meta-oauth-callback" "OPTIONS"

rm -f /tmp/camply-oauth-result.json /tmp/camply-rls-result.json
node scripts/test-rls-api.cjs
node scripts/test-oauth-concurrent.cjs
node scripts/test-edge-e2e.cjs

npm run lint
npm test
npm run build

cleanup
trap - EXIT INT TERM

if docker ps -a --format '{{.Names}}' | grep -qx "$MOCK_CONTAINER_NAME"; then
  echo "Erro: container mock órfão após cleanup."
  exit 1
fi

echo "=== VALIDAÇÃO LOCAL CONCLUÍDA COM SUCESSO! ==="
