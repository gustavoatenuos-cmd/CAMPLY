#!/bin/bash
set -euo pipefail

AGENT_BROWSER_BIN="${AGENT_BROWSER_BIN:-}"
if [[ -z "$AGENT_BROWSER_BIN" && -d "$HOME/.npm/_npx" ]]; then
  AGENT_BROWSER_BIN=$(find "$HOME/.npm/_npx" -path '*/node_modules/.bin/agent-browser' -type l -print -quit 2>/dev/null)
fi
if [[ -n "$AGENT_BROWSER_BIN" && -x "$AGENT_BROWSER_BIN" ]]; then
  BROWSER=("$AGENT_BROWSER_BIN")
else
  BROWSER=(npx agent-browser)
fi
SERVER_PID=""
E2E_PORT="${E2E_PORT:-3100}"
E2E_BASE_URL="http://127.0.0.1:${E2E_PORT}"
E2E_ENTRY_URL="${E2E_BASE_URL}/?e2eReset=1"

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
  if ! actual=$("${BROWSER[@]}" eval "$expression"); then
    "${BROWSER[@]}" wait 150 >/dev/null
    if ! actual=$("${BROWSER[@]}" eval "$expression"); then
      echo "Browser E2E failed: browser evaluation could not run for: $message"
      exit 1
    fi
  fi
  if [[ "$actual" != "true" ]]; then
    "${BROWSER[@]}" wait 300 >/dev/null
    actual=$("${BROWSER[@]}" eval "$expression")
    if [[ "$actual" != "true" ]]; then
      echo "Browser E2E failed: $message (received $actual)"
      "${BROWSER[@]}" eval 'document.body.innerText.slice(0,1200)' || true
      exit 1
    fi
  fi
}

step() {
  echo "E2E step: $1"
}

VITE_META_E2E_MODE=true npm run dev -- --host=0.0.0.0 --port "$E2E_PORT" --strictPort >/tmp/camply-browser-e2e.log 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 30); do
  curl -fsS "$E2E_BASE_URL" >/dev/null 2>&1 && break
  sleep 1
done

if ! curl -fsS "$E2E_BASE_URL" >/dev/null 2>&1; then
  echo "Browser E2E failed: dev server did not start on ${E2E_BASE_URL}"
  tail -120 /tmp/camply-browser-e2e.log || true
  exit 1
fi

"${BROWSER[@]}" open "$E2E_ENTRY_URL"
"${BROWSER[@]}" wait --load networkidle
"${BROWSER[@]}" eval 'sessionStorage.removeItem("camply:performance-dashboard-filters"); true' >/dev/null
assert_js 'document.body.innerText.includes("Gestão de Tráfego Inteligente")' 'login screen did not render'
assert_js '!document.querySelector("input[type=email]")' 'password-only login should not render an email field'
"${BROWSER[@]}" fill 'input[type="password"]' "senha-segura-e2e"
"${BROWSER[@]}" press Enter
"${BROWSER[@]}" wait 1000

if [[ $("${BROWSER[@]}" eval 'document.body.innerText.includes("Briefing do Agente")') == "true" ]]; then
  "${BROWSER[@]}" find role button click --name "Fechar"
  "${BROWSER[@]}" wait 150
fi

step "segment filter persistence"
assert_js 'document.body.innerText.includes("Performance real da operação.")' 'overview did not render'
assert_js 'document.body.innerText.includes("Dashboard") && document.body.innerText.includes("Últimos 90 dias")' 'official Dashboard naming/default did not render'
"${BROWSER[@]}" eval 'document.querySelector("[data-testid=\"segment-filter-Saúde\"]").click(); true' >/dev/null
"${BROWSER[@]}" wait 100
"${BROWSER[@]}" reload
"${BROWSER[@]}" wait 500
if [[ $("${BROWSER[@]}" eval 'document.body.innerText.includes("Gestão de Tráfego Inteligente")') == "true" ]]; then
  "${BROWSER[@]}" fill 'input[type="password"]' "senha-segura-e2e"
  "${BROWSER[@]}" press Enter
  "${BROWSER[@]}" wait 1000
fi
if [[ $("${BROWSER[@]}" eval 'document.body.innerText.includes("Briefing do Agente")') == "true" ]]; then
  "${BROWSER[@]}" find role button click --name "Fechar"
  "${BROWSER[@]}" wait 150
fi
assert_js 'document.querySelector("[data-testid=\"segment-filter-Saúde\"]")?.getAttribute("aria-pressed") === "true"' 'segment filter did not survive reload'

step "analysis profile persistence"
"${BROWSER[@]}" find role button click --name "Clientes"
"${BROWSER[@]}" wait 200
"${BROWSER[@]}" eval '(() => { const card=[...document.querySelectorAll("article")].find((item) => item.innerText.includes("Clínica Mock")); const button=[...(card?.querySelectorAll("button") || [])].find((item) => item.innerText.trim() === "Editar"); button?.click(); return Boolean(button); })()' >/dev/null
"${BROWSER[@]}" wait 250
assert_js 'document.body.innerText.includes("Editar cliente")' 'client analysis profile editor did not open'
"${BROWSER[@]}" eval '(() => { const label=[...document.querySelectorAll("label")].find((item) => item.innerText.includes("Orçamento planejado Meta")); const input=label?.querySelector("input"); if (!input) return false; const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set; setter.call(input,"1650"); input.dispatchEvent(new Event("input",{bubbles:true})); return true; })()' >/dev/null
assert_js '(() => { const label=[...document.querySelectorAll("label")].find((item) => item.innerText.includes("Orçamento planejado Meta")); return label?.querySelector("input")?.value === "1650"; })()' 'client analysis profile input did not receive the planned budget'
"${BROWSER[@]}" find role button click --name "Salvar alterações"
"${BROWSER[@]}" wait 300
assert_js '!document.body.innerText.includes("Editar cliente")' 'client analysis profile did not save and close'
assert_js 'JSON.parse(sessionStorage.getItem("camply:meta-e2e:analysis-profiles") || "{}")["client-e2e"]?.plannedBudget === 1650' 'client analysis profile was not persisted before reload'
"${BROWSER[@]}" reload
"${BROWSER[@]}" wait 500
"${BROWSER[@]}" fill 'input[type="password"]' "senha-segura-e2e"
"${BROWSER[@]}" press Enter
"${BROWSER[@]}" wait 1000
if [[ $("${BROWSER[@]}" eval 'document.body.innerText.includes("Briefing do Agente")') == "true" ]]; then
  "${BROWSER[@]}" find role button click --name "Fechar"
  "${BROWSER[@]}" wait 150
fi
"${BROWSER[@]}" find role button click --name "Clientes"
"${BROWSER[@]}" wait 200
assert_js 'JSON.parse(sessionStorage.getItem("camply:meta-e2e:analysis-profiles") || "{}")["client-e2e"]?.plannedBudget === 1650' 'client analysis profile storage did not survive reload'
"${BROWSER[@]}" eval '(() => { const card=[...document.querySelectorAll("article")].find((item) => item.innerText.includes("Clínica Mock")); const button=[...(card?.querySelectorAll("button") || [])].find((item) => item.innerText.trim() === "Editar"); button?.click(); return Boolean(button); })()' >/dev/null
"${BROWSER[@]}" wait 250
assert_js '(() => { const label=[...document.querySelectorAll("label")].find((item) => item.innerText.includes("Orçamento planejado Meta")); return label?.querySelector("input")?.value === "1650"; })()' 'client analysis profile did not survive reload'
"${BROWSER[@]}" find role button click --name "Cancelar"
"${BROWSER[@]}" find role button click --name "Dashboard"
"${BROWSER[@]}" wait 300
assert_js 'document.querySelector("[data-testid=\"segment-filter-Saúde\"]")?.getAttribute("aria-pressed") === "true"' 'segment filter did not survive profile navigation and reload'
step "Meta link and official metrics"
"${BROWSER[@]}" eval 'document.querySelector("[data-testid=segment-filter-all]").click(); true' >/dev/null
"${BROWSER[@]}" wait 100
assert_js 'document.querySelector("[data-testid=segment-filter-all]")?.getAttribute("aria-pressed") === "true"' 'dashboard segment filter did not reset before Meta navigation'
"${BROWSER[@]}" find role button click --name "Integração Meta"
"${BROWSER[@]}" wait 300
"${BROWSER[@]}" eval 'document.querySelector("[data-testid=meta-link-button]").click(); true' >/dev/null
"${BROWSER[@]}" wait 250
"${BROWSER[@]}" eval 'document.querySelector("[data-testid=meta-sync-linked-clients]").click(); true' >/dev/null
"${BROWSER[@]}" wait 350
assert_js 'document.querySelector("[data-testid=meta-last-snapshot]")?.innerText.toLocaleLowerCase("pt-BR").includes("snapshot salvo em") === true' 'official Meta synchronization did not persist a reliable snapshot'
"${BROWSER[@]}" eval 'sessionStorage.setItem("camply-e2e-snapshot-label", document.querySelector("[data-testid=meta-last-snapshot]").innerText); true' >/dev/null
"${BROWSER[@]}" find role button click --name "Dashboard"
"${BROWSER[@]}" wait 350
assert_js 'document.querySelector("[data-testid=segment-filter-all]")?.getAttribute("aria-pressed") === "true"' 'dashboard segment reset did not survive Meta navigation'
assert_js '(() => { const text=document.body.innerText.toLocaleLowerCase("pt-BR"); return text.includes("métricas mensais oficiais") && text.includes("conversas iniciadas") && text.includes("custo por conversa") && text.includes("valor de compras") && text.includes("visualizações da página de destino"); })()' 'required monthly metrics did not render'
assert_js 'document.body.innerText.includes("2026-07-01 a 2026-07-01")' 'exact monthly interval did not render'
assert_js 'document.body.innerText.includes("Conta Meta Mock")' 'mock account was not linked'

step "health retail and delivery decisions"
"${BROWSER[@]}" find role button click --name "Por subsegmento"
"${BROWSER[@]}" wait 150
assert_js '(() => { const text=document.body.innerText.toLocaleLowerCase("pt-BR"); return text.includes("clínica mock") && text.includes("custo por conversa") && (text.includes("custo acima da meta") || (text.includes("esperado") && text.includes("realizado"))); })()' 'health/odontology decision flow did not expose its KPI evaluation'

assert_js '(() => { const text=document.body.innerText.toLocaleLowerCase("pt-BR"); return text.includes("loja de calçados mock") && text.includes("compras") && text.includes("ação recomendada") && text.includes("crítico"); })()' 'retail/shoes flow did not expose KPI and recommended action'
assert_js 'document.body.innerText.includes("Loja de Produtos Mock")' 'physical-products subsegment did not expose its client'

"${BROWSER[@]}" eval '(() => { const select=document.querySelector("select[aria-label=\"Período do Dashboard\"]"); const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set; setter.call(select,"last_7d"); select.dispatchEvent(new Event("change",{bubbles:true})); return true; })()' >/dev/null
"${BROWSER[@]}" wait 300
assert_js '(() => { const text=document.body.innerText.replaceAll("\u00a0"," ").replaceAll("\u202f"," ").toLocaleLowerCase("pt-BR"); return text.includes("delivery mock") && text.includes("últimos 7 dias") && text.includes("compras") && text.includes("ação recomendada"); })()' 'delivery rolling seven-day flow did not expose purchases and recommended action'
"${BROWSER[@]}" eval '(() => { const select=document.querySelector("select[aria-label=\"Período do Dashboard\"]"); const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set; setter.call(select,"last_90d"); select.dispatchEvent(new Event("change",{bubbles:true})); document.querySelector("[data-testid=segment-filter-all]").click(); return true; })()' >/dev/null
"${BROWSER[@]}" wait 300

step "responsive desktop tablet mobile"
"${BROWSER[@]}" set viewport 1440 900
"${BROWSER[@]}" wait 100
assert_js 'document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1' 'desktop has structural horizontal overflow'
assert_js 'getComputedStyle(document.querySelector("[data-testid=client-performance-desktop]")).display !== "none" && getComputedStyle(document.querySelector("[data-testid=client-performance-mobile]")).display === "none"' 'desktop performance table/card breakpoint is incorrect'
"${BROWSER[@]}" screenshot /tmp/camply-segment-desktop.png --full

"${BROWSER[@]}" set viewport 768 1024
"${BROWSER[@]}" wait 100
assert_js 'document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1' 'tablet has structural horizontal overflow'
assert_js 'getComputedStyle(document.querySelector("[data-testid=client-performance-mobile]")).display !== "none" && getComputedStyle(document.querySelector("[data-testid=client-performance-desktop]")).display === "none"' 'tablet must use performance cards'
"${BROWSER[@]}" screenshot /tmp/camply-segment-tablet.png --full

"${BROWSER[@]}" set viewport 390 844
"${BROWSER[@]}" wait 100
assert_js 'document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1' 'mobile has structural horizontal overflow'
assert_js 'getComputedStyle(document.querySelector("[data-testid=client-performance-mobile]")).display !== "none" && getComputedStyle(document.querySelector("[data-testid=client-performance-desktop]")).display === "none"' 'mobile must use performance cards'
"${BROWSER[@]}" eval 'document.querySelector("[data-testid=client-performance-details-toggle]").click(); true' >/dev/null
"${BROWSER[@]}" wait 250
assert_js '(() => { const button=document.querySelector("[data-testid=client-performance-details-toggle]"); const details=document.querySelector("[data-testid=client-performance-details]"); const text=details?.innerText.toLocaleLowerCase("pt-BR") || ""; return Boolean(button && details && button.getAttribute("aria-expanded") === "true" && text.includes("metas e realizado") && text.includes("campanhas da conta")); })()' 'mobile performance accordion did not expose details'
"${BROWSER[@]}" eval 'document.querySelector("[data-testid=client-performance-details-toggle]").click(); true' >/dev/null
"${BROWSER[@]}" screenshot /tmp/camply-segment-mobile.png --full

"${BROWSER[@]}" set viewport 1440 900
"${BROWSER[@]}" wait 100
step "hierarchy target and persistence"
"${BROWSER[@]}" find role button click --name "Integração Meta"
"${BROWSER[@]}" wait 300
assert_js 'document.querySelector("[data-testid=meta-last-snapshot]")?.innerText.toLocaleLowerCase("pt-BR").includes("snapshot salvo em") === true' 'explicit Meta synchronization did not persist a reliable snapshot'

assert_js 'document.querySelector("[data-testid=meta-campaign-campaign-active-e2e] button[aria-label^=\"Abrir Campanha\"]") !== null' 'active campaign hierarchy node did not render'
"${BROWSER[@]}" eval 'document.querySelector("[data-testid=meta-campaign-campaign-active-e2e] button[aria-label^=\"Abrir Campanha\"]").click(); true' >/dev/null
"${BROWSER[@]}" wait 700
assert_js '[...document.querySelectorAll("button")].some((button) => button.getAttribute("aria-label") === "Abrir Conjunto Conjunto ativo com leads")' 'ad set hierarchy level did not load'
"${BROWSER[@]}" eval 'document.querySelector("[data-testid=meta-adset-adset-active-e2e] button[aria-label^=\"Abrir Conjunto\"]").click(); true' >/dev/null
"${BROWSER[@]}" wait 700
assert_js '[...document.querySelectorAll("button")].some((button) => button.getAttribute("aria-label") === "Abrir Anúncio Anúncio ativo com compra")' 'ad hierarchy level did not load'
"${BROWSER[@]}" eval 'document.querySelector("[data-testid=meta-ad-ad-active-e2e] button[aria-label^=\"Abrir Anúncio\"]").click(); true' >/dev/null
"${BROWSER[@]}" wait 700
assert_js 'document.body.innerText.includes("Criativo Mock")' 'creative hierarchy level did not load'
step "creative hierarchy opened"
assert_js 'document.body.innerText.includes("Criativo Mock") && document.body.innerText.includes("Agende sua avaliação")' 'creative drill-down did not render'

"${BROWSER[@]}" eval 'document.querySelector("[data-testid=meta-target-campaign-active-e2e]").click(); true' >/dev/null
step "target drawer opened"
"${BROWSER[@]}" fill 'input[name="targetValue"]' "15"
"${BROWSER[@]}" find role button click --name "Salvar nova versão"
"${BROWSER[@]}" wait 200
step "target saved"
assert_js 'document.body.innerText.includes("Na meta") && document.body.innerText.includes("Meta: 15")' 'target comparison was not rendered'
"${BROWSER[@]}" find role button click --name "Fechar metas"

step "reloading linked account and target"
"${BROWSER[@]}" reload
"${BROWSER[@]}" wait 500
"${BROWSER[@]}" fill 'input[type="password"]' "senha-segura-e2e"
"${BROWSER[@]}" press Enter
"${BROWSER[@]}" wait 1000
if [[ $("${BROWSER[@]}" eval 'document.body.innerText.includes("Briefing do Agente")') == "true" ]]; then
  "${BROWSER[@]}" find role button click --name "Fechar"
  "${BROWSER[@]}" wait 150
fi
assert_js 'document.body.innerText.includes("Conta Meta Mock")' 'official Meta account link did not survive reload'
"${BROWSER[@]}" find role button click --name "Integração Meta"
"${BROWSER[@]}" wait 350
assert_js 'document.querySelector("[data-testid=meta-last-snapshot]")?.innerText === sessionStorage.getItem("camply-e2e-snapshot-label")' 'saved Meta snapshot changed or disappeared after reload without an explicit synchronization'
"${BROWSER[@]}" eval 'document.querySelector("[data-testid=meta-target-campaign-active-e2e]").click(); true' >/dev/null
"${BROWSER[@]}" wait 200
assert_js 'document.body.innerText.includes("Meta: 15")' 'performance target did not survive reload'
"${BROWSER[@]}" find role button click --name "Fechar metas"

step "reconciliation period refresh and navigation"
"${BROWSER[@]}" eval 'document.querySelector("[data-testid=meta-reconcile-campaign-campaign-active-e2e]").click(); true' >/dev/null
"${BROWSER[@]}" fill 'input[aria-label="Referência Investimento"]' "350"
"${BROWSER[@]}" fill 'input[aria-label="Referência Impressões"]' "11800"
assert_js 'document.body.innerText.includes("reconciled") && document.body.innerText.includes("divergent")' 'reconciliation states were not rendered'
"${BROWSER[@]}" find role button click --name "Fechar conciliação"

assert_js 'document.querySelector("[data-testid=meta-period-select]")?.value === "last_90d" && document.body.innerText.includes("Campanha ativa mock") && !document.body.innerText.includes("Período ainda não sincronizado") && !document.body.innerText.includes("Campanha histórica pausada")' 'official 90-day hierarchy did not preserve active-only campaigns'

"${BROWSER[@]}" find role button click --name "Clientes"
"${BROWSER[@]}" wait 200
assert_js 'document.body.innerText.includes("Base operacional e Meta Ads") && document.querySelectorAll("[data-testid=meta-operational-workspace]").length === 1' 'Clients did not reuse the official workspace'
"${BROWSER[@]}" find role button click --name "Campanhas"
"${BROWSER[@]}" wait 400
assert_js '(() => { const text=document.body.innerText.toLocaleLowerCase("pt-BR"); return text.includes("performance meta e operação") && text.includes("quadro operacional") && text.includes("planejamento interno"); })()' 'Campaigns did not separate official and operational data'

assert_js 'Object.keys(localStorage).some(key => key.includes("00000000-0000-0000-0000-00000000e2e0"))' 'user-scoped cache was not created'
"${BROWSER[@]}" find role button click --name "Sair"
"${BROWSER[@]}" wait 200
assert_js 'document.body.innerText.includes("Gestão de Tráfego Inteligente") && Object.keys(localStorage).length === 0' 'logout did not clear user-scoped cache'
assert_js '!document.querySelector(".vite-error-overlay, #webpack-dev-server-client-overlay")' 'browser error overlay detected'

echo "Browser E2E passed: login -> link -> sync -> campaign -> adset -> ad -> creative -> target -> reconciliation -> period -> logout"
