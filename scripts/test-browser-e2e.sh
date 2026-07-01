#!/bin/bash
set -euo pipefail

BROWSER=(npx agent-browser)
SERVER_PID=""

cleanup() {
  local status=$?
  trap - EXIT
  "${BROWSER[@]}" close >/dev/null 2>&1 || true
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

assert_js() {
  local expression="$1"
  local message="$2"
  local actual
  actual=$("${BROWSER[@]}" eval "$expression")
  if [[ "$actual" != "true" ]]; then
    echo "Browser E2E failed: $message (received $actual)"
    "${BROWSER[@]}" eval 'document.body.innerText.slice(0,1200)' || true
    exit 1
  fi
}

if ! curl -fsS http://127.0.0.1:3000 >/dev/null 2>&1; then
  VITE_META_E2E_MODE=true npm run dev >/tmp/camply-browser-e2e.log 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 30); do
    curl -fsS http://127.0.0.1:3000 >/dev/null 2>&1 && break
    sleep 1
  done
fi

"${BROWSER[@]}" open http://127.0.0.1:3000
"${BROWSER[@]}" wait --load networkidle
assert_js 'document.body.innerText.includes("Gestão de Tráfego Inteligente")' 'login screen did not render'
"${BROWSER[@]}" fill 'input[aria-label="E-mail"]' "e2e@camply.test"
"${BROWSER[@]}" fill 'input[type="password"]' "senha-segura-e2e"
"${BROWSER[@]}" press Enter
"${BROWSER[@]}" wait 1000

if [[ $("${BROWSER[@]}" eval 'document.body.innerText.includes("Briefing do Agente")') == "true" ]]; then
  "${BROWSER[@]}" find role button click --name "Fechar"
  "${BROWSER[@]}" wait 150
fi

assert_js 'document.body.innerText.includes("Performance real da operação.")' 'overview did not render'
assert_js 'document.body.innerText.includes("Dashboard") && document.body.innerText.includes("Mês atual")' 'monthly Dashboard naming/default did not render'
"${BROWSER[@]}" eval 'document.querySelector("[data-testid=meta-link-button]").click(); true' >/dev/null
"${BROWSER[@]}" wait 250
assert_js '(() => { const text=document.body.innerText.toLocaleLowerCase("pt-BR"); return text.includes("métricas mensais oficiais") && text.includes("conversas iniciadas") && text.includes("custo por conversa") && text.includes("valor de compras") && text.includes("visualizações da página de destino"); })()' 'required monthly metrics did not render'
assert_js 'document.body.innerText.includes("2026-07-01 a 2026-07-01")' 'exact monthly interval did not render'
assert_js 'document.body.innerText.includes("Conta Meta Mock")' 'mock account was not linked'
"${BROWSER[@]}" eval 'document.querySelector("[data-testid=meta-sync-period]").click(); true' >/dev/null
"${BROWSER[@]}" wait 250

"${BROWSER[@]}" find role button click --name "Abrir Campanha Campanha histórica pausada"
"${BROWSER[@]}" wait 100
"${BROWSER[@]}" find role button click --name "Abrir Conjunto Conjunto pausado com leads"
"${BROWSER[@]}" wait 100
"${BROWSER[@]}" find role button click --name "Abrir Anúncio Anúncio pausado com compra"
"${BROWSER[@]}" wait 100
assert_js 'document.body.innerText.includes("Criativo Mock") && document.body.innerText.includes("Agende sua avaliação")' 'creative drill-down did not render'

"${BROWSER[@]}" eval 'document.querySelector("[data-testid=meta-target-campaign-paused-e2e]").click(); true' >/dev/null
"${BROWSER[@]}" fill 'input[name="targetValue"]' "15"
"${BROWSER[@]}" find role button click --name "Salvar nova versão"
"${BROWSER[@]}" wait 200
assert_js 'document.body.innerText.includes("Na meta") && document.body.innerText.includes("Meta: 15")' 'target comparison was not rendered'
"${BROWSER[@]}" find role button click --name "Fechar metas"

"${BROWSER[@]}" eval 'document.querySelector("[data-testid=meta-reconcile-campaign-campaign-paused-e2e]").click(); true' >/dev/null
"${BROWSER[@]}" fill 'input[aria-label="Referência Investimento"]' "350"
"${BROWSER[@]}" fill 'input[aria-label="Referência Impressões"]' "11800"
assert_js 'document.body.innerText.includes("reconciled") && document.body.innerText.includes("divergent")' 'reconciliation states were not rendered'
"${BROWSER[@]}" find role button click --name "Fechar conciliação"

"${BROWSER[@]}" eval 'const select=document.querySelector("[data-testid=meta-period-select]"); const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set; setter.call(select,"last_30d"); select.dispatchEvent(new Event("change",{bubbles:true})); true' >/dev/null
"${BROWSER[@]}" wait 200
assert_js 'document.body.innerText.includes("Período ainda não sincronizado")' 'unsynchronized period state was not rendered'
"${BROWSER[@]}" eval 'document.querySelector("[data-testid=meta-sync-period]").click(); true' >/dev/null
"${BROWSER[@]}" wait 200
assert_js 'document.body.innerText.includes("Campanha histórica pausada") && !document.body.innerText.includes("Período ainda não sincronizado")' 'period synchronization did not refresh hierarchy'

"${BROWSER[@]}" find role button click --name "Clientes"
"${BROWSER[@]}" wait 200
assert_js 'document.body.innerText.includes("Base operacional e Meta Ads") && document.querySelectorAll("[data-testid=meta-operational-workspace]").length === 1' 'Clients did not reuse the official workspace'
"${BROWSER[@]}" find role button click --name "Campanhas"
"${BROWSER[@]}" wait 200
assert_js 'document.body.innerText.includes("Performance Meta e operação") && document.body.innerText.includes("Quadro operacional")' 'Campaigns did not separate official and operational data'

assert_js 'Object.keys(localStorage).some(key => key.includes("00000000-0000-0000-0000-00000000e2e0"))' 'user-scoped cache was not created'
"${BROWSER[@]}" find role button click --name "Sair"
"${BROWSER[@]}" wait 200
assert_js 'document.body.innerText.includes("Gestão de Tráfego Inteligente") && Object.keys(localStorage).length === 0' 'logout did not clear user-scoped cache'
assert_js '!document.querySelector(".vite-error-overlay, #webpack-dev-server-client-overlay")' 'browser error overlay detected'

echo "Browser E2E passed: login -> link -> sync -> campaign -> adset -> ad -> creative -> target -> reconciliation -> period -> logout"
