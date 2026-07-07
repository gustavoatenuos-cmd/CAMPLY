const fs = require('fs');

const path = 'src/components/performance/ClientPerformanceTable.tsx';
let content = fs.readFileSync(path, 'utf8');

if (!content.includes('processClientStrategy')) {
  content = content.replace(
    /import \{ RefreshCw \} from 'lucide-react';/,
    `import { RefreshCw } from 'lucide-react';\nimport { processClientStrategy } from '../../lib/strategy/strategyDecisionEngine';`
  );
}

// Map the labels
content = content.replace(/partial:\s*'Sincronização parcial',/, "partial:        'Dados incompletos',");
content = content.replace(/period_not_synced:\s*'Período não sincronizado',/, "period_not_synced: 'Sem dados no período',");
content = content.replace(/never_synced:\s*'Nunca sincronizado',/, "never_synced:   'Não sincronizada',");

// Extract desktop block
const dStartStr = "{/* ── Desktop ── */}";
const dStart = content.indexOf(dStartStr);
const beforeDesktop = content.substring(0, dStart);
let desktopContent = content.substring(dStart);

// 1. Grid definition
desktopContent = desktopContent.replace(
    /grid-cols-\[260px_120px_120px_95px_110px_80px_105px_85px_105px_135px_145px\]/g,
    "grid-cols-[260px_140px_140px_140px_160px_180px_140px]"
);

// 2. Headers
const hdrOld = `<div className="px-4 py-3">Cliente / conta</div>
            <div className="px-4 py-3">Investimento</div>
            <div className="px-4 py-3">Pacing</div>
            <div className="px-4 py-3">Conversas</div>
            <div className="px-4 py-3">Custo conv.</div>
            <div className="px-4 py-3">Leads</div>
            <div className="px-4 py-3">CPL</div>
            <div className="px-4 py-3">Compras</div>
            <div className="px-4 py-3">CPA</div>
            <div className="px-4 py-3">Situação</div>
            <div className="px-4 py-3">Dados</div>`;
const hdrNew = `<div className="px-4 py-3">Cliente / conta</div>
            <div className="px-4 py-3">Investimento</div>
            <div className="px-4 py-3">Orçamento</div>
            <div className="px-4 py-3">Pacing</div>
            <div className="px-4 py-3">Estratégia</div>
            <div className="px-4 py-3">Qualidade dos Dados</div>
            <div className="px-4 py-3">Ação</div>`;
desktopContent = desktopContent.replace(hdrOld, hdrNew);

// 3. Process strategy
desktopContent = desktopContent.replace(
    /const isExpanded = expanded === key;/g,
    "const decision = processClientStrategy(client, client.analysisProfile);\n              const isExpanded = expanded === key;"
);

// 4. Columns replacing
const colsOldStart = `{/* Coluna 2: Investimento */}`;
const colsOldEndMarker = `</button>`;
const csIdx = desktopContent.indexOf(colsOldStart);
const ceIdx = desktopContent.indexOf(colsOldEndMarker, csIdx);

const colsNew = `{/* Coluna 2: Investimento */}
                      <div className="px-4 py-4 font-bold text-white">
                        <TraceableMetricValue metric={spendMetric}>
                          {formatCurrency(spend, account?.currency || null)}
                        </TraceableMetricValue>
                      </div>

                      {/* Coluna 3: Orçamento */}
                      <div className="px-4 py-4 font-bold text-white">
                        {client.analysisProfile?.plannedBudget
                          ? formatCurrency(client.analysisProfile.plannedBudget, account?.currency || null)
                          : <span className="text-brand-muted font-normal">—</span>}
                      </div>

                      {/* Coluna 4: Pacing */}
                      <div className="px-4 py-4">
                        {account?.budgetPacing
                          ? <PacingBar pct={account.budgetPacing.differencePercent} />
                          : <span className="text-brand-muted">—</span>
                        }
                      </div>

                      {/* Coluna 5: Estratégia */}
                      <div className="px-4 py-4">
                        <p className="font-bold text-white capitalize">{decision.strategyType.replace('_', ' ')}</p>
                        <div className="mt-1">
                          <PerformanceStatusBadge status={decision.macroStatus === 'saudavel' ? 'on_track' : decision.macroStatus === 'atencao' ? 'attention' : decision.macroStatus === 'critico' ? 'critical' : 'unavailable'} />
                        </div>
                      </div>

                      {/* Coluna 6: Qualidade dos Dados */}
                      <div className="px-4 py-4">
                        <p className="font-semibold text-white">{statusLabel(client.clientStatus)}</p>
                        <p className="mt-1 flex items-center gap-1 text-[10px] text-brand-muted">
                          <Clock3 size={11} />
                          {account?.lastSuccessfulRun?.finishedAt
                            ? new Date(account.lastSuccessfulRun.finishedAt).toLocaleString('pt-BR')
                            : 'Sem sync confiável'}
                        </p>
                      </div>

                      {/* Coluna 7: Ação */}
                      <div className="px-4 py-4 flex flex-col items-start justify-center gap-2">
                        {account && (client.clientStatus === 'failed' || client.clientStatus === 'period_not_synced') && (
                          <SyncAction account={account} period={period} />
                        )}
                        <span className="hidden rounded-md border border-brand-line/60 px-2 py-1 text-[10px] font-bold text-brand-soft group-hover:inline-block">
                          {account ? 'Ver campanhas' : 'Ver cliente'}
                        </span>
                      </div>
                    `;

desktopContent = desktopContent.substring(0, csIdx) + colsNew + desktopContent.substring(ceIdx);

fs.writeFileSync(path, beforeDesktop + desktopContent, 'utf8');
console.log('Update successful');
