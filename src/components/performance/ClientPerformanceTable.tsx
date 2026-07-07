import { ChevronDown, ChevronRight, Clock3, Database, Layers3 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  GlobalClientPerformance,
  GlobalMetricGroup,
  GlobalPerformanceAccount,
  MetricContract,
} from '../../lib/performance/globalPerformanceDashboard';
import type { PerformanceEvaluation, PerformanceStatus } from '../../lib/performance/types';
import { deriveCostMetric } from '../../lib/performance/traceableMetrics';
import { PerformanceStatusBadge } from './PerformanceStatusBadge';
import { TraceableMetricValue } from './TraceableMetricValue';
import { metricLabels } from '../../lib/analysis/clientAnalysisProfile';
import { CampaignHierarchicalTable } from './CampaignHierarchicalTable';
import { syncMetaAsset } from '../../lib/meta/metaSyncService';
import type { DashboardPeriod } from '../../lib/performance/analyticsCapabilities';
import { RefreshCw } from 'lucide-react';

// ─── Helpers de formatação ────────────────────────────────────────────────────

function metricValue(metric: MetricContract | undefined): number | null {
  return metric?.available && typeof metric.value === 'number' ? metric.value : null;
}

function formatNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function formatCurrency(value: number | null, currency: string | null): string {
  if (value === null) return '—';
  if (!currency) return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`;
  }
}

// ─── Sistema de semântica visual ──────────────────────────────────────────────

const severity: Record<PerformanceStatus, number> = {
  unavailable: 0,
  insufficient_data: 1,
  on_track: 2,
  partial_data: 3,
  attention: 4,
  critical: 5,
};

function worstEvaluation(evaluations: PerformanceEvaluation[]): PerformanceStatus {
  if (evaluations.length === 0) return 'unavailable';
  return evaluations.reduce<PerformanceStatus>(
    (worst, ev) => (severity[ev.status] > severity[worst] ? ev.status : worst),
    'unavailable',
  );
}

/** Cor do indicador (bolinha) na primeira coluna */
function statusDotColor(status: PerformanceStatus): string {
  switch (status) {
    case 'critical':          return 'bg-red-500';
    case 'attention':         return 'bg-amber-400';
    case 'partial_data':      return 'bg-amber-400/70';
    case 'on_track':          return 'bg-green-500';
    default:                  return 'bg-[#475569]'; // cinza — sem dados
  }
}

/** Fundo + borda-esquerda da linha baseado no status mais grave */
function rowStyle(status: PerformanceStatus): string {
  switch (status) {
    case 'critical':
      return 'border-l-[3px] border-l-red-500 bg-red-500/[0.04]';
    case 'attention':
      return 'border-l-[3px] border-l-amber-400 bg-amber-400/[0.04]';
    default:
      return 'border-l-[3px] border-l-transparent';
  }
}

// ─── Barra de pacing ──────────────────────────────────────────────────────────

/** Exibe uma mini barra de progresso (80px × 4px) + valor colorido.
 *  A largura representa a SEVERIDADE do desvio (0 % = perfeito, 100 % = desvio extremo).
 *  Verde < 10 %, âmbar 10–25 %, vermelho > 25 %.
 */
function PacingBar({ pct }: { pct: number }) {
  const abs = Math.abs(pct);
  const barWidth = Math.min(abs * 3, 100); // escala: desvio de 33 % = barra cheia
  const colorClass =
    abs > 25 ? 'bg-red-500'   :
    abs > 10 ? 'bg-amber-400' :
               'bg-green-500';
  const textClass =
    abs > 25 ? 'text-red-400'   :
    abs > 10 ? 'text-amber-400' :
               'text-green-400';

  return (
    <div>
      <div className="mb-1 h-1 w-[80px] overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all ${colorClass}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <p className={`text-[10px] font-semibold ${textClass}`}>
        {pct > 0 ? '+' : ''}{pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
      </p>
    </div>
  );
}


function MetricCell({ label, value, metric }: { label: string; value: string; metric?: MetricContract }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">{label}</p>
      <p className="mt-1 font-bold text-white">
        <TraceableMetricValue metric={metric}>{value}</TraceableMetricValue>
      </p>
    </div>
  );
}

// ─── Helpers de status de sync ────────────────────────────────────────────────

function statusLabel(status: GlobalClientPerformance['clientStatus']): string {
  const labels: Record<GlobalClientPerformance['clientStatus'], string> = {
    not_connected:  'Conta não conectada',
    never_synced:   'Nunca sincronizado',
    syncing:        'Sincronizando',
    period_not_synced: 'Período não sincronizado',
    sync_without_metrics: 'Sync sem métricas',
    no_delivery:    'Sem entrega',
    available:      'Atualizado',
    stale:          'Desatualizado',
    partial:        'Sincronização parcial',
    failed:         'Falha na sincronização',
  };
  return labels[status];
}

function accountRowKey(clientId: string, account: GlobalPerformanceAccount): string {
  return `${clientId}:${account.clientMetaAssetId}`;
}

function SyncAction({ account, period }: { account: GlobalPerformanceAccount, period: DashboardPeriod }) {
  const [syncing, setSyncing] = useState(false);
  
  const handleSync = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await syncMetaAsset({ metaAssetId: account.clientMetaAssetId, period, requestedLevel: 'campaign' });
      if (!result.success) {
        alert('Erro ao sincronizar: ' + (result.message || 'Erro desconhecido'));
      } else {
        alert('Sincronização iniciada com sucesso. Pode levar alguns minutos.');
      }
    } catch (err: any) {
      alert('Erro inesperado: ' + err.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <button
      onClick={handleSync}
      disabled={syncing}
      className="mt-2 hidden flex items-center gap-1 rounded-md border border-brand-line/60 bg-white/5 px-2 py-1 text-[10px] font-bold text-brand-soft hover:bg-white/10 group-hover:inline-flex disabled:opacity-50"
    >
      <RefreshCw size={10} className={syncing ? 'animate-spin' : ''} />
      {syncing ? 'Sincronizando...' : 'Sincronizar'}
    </button>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function ClientPerformanceTable({ clients, period }: { clients: GlobalClientPerformance[], period: DashboardPeriod }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = useMemo(() => clients.flatMap((client) => {
    if (client.accounts.length === 0) {
      return [{ client, account: null as GlobalPerformanceAccount | null }];
    }
    return client.accounts.map((account) => ({ client, account }));
  }), [clients]);

  return (
    <div className="overflow-hidden rounded-2xl border border-brand-line bg-brand-surface">

      {/* Cabeçalho */}
      <div className="flex flex-col gap-2 border-b border-brand-line p-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-green">Central de clientes</p>
          <h2 className="mt-1 text-xl font-black text-white">Performance por conta de anúncios</h2>
          <p className="mt-1 text-sm text-brand-muted">
            Os valores seguem conta, moeda, período e atribuição disponíveis no sync confiável.
          </p>
        </div>
        <p className="text-xs text-brand-muted">Clique em uma linha para abrir as campanhas.</p>
      </div>

      {/* ── Mobile ── */}
      <div data-testid="client-performance-mobile" className="space-y-3 p-4 lg:hidden">
        {rows.map(({ client, account }) => {
          const key = account ? accountRowKey(client.clientId, account) : `${client.clientId}:none`;
          const spendMetric     = account?.metrics.spend;
          const primaryMetricId = client.analysisProfile?.primaryConversionMetric || 'messaging_conversations_started_total';
          const primaryMetric   = account?.metrics[primaryMetricId];
          const evaluations     = account
            ? client.evaluations.filter((ev) => ev.clientMetaAssetId === account.clientMetaAssetId)
            : [];
          const performanceStatus = worstEvaluation(evaluations);
          const groups            = account
            ? client.metricGroups.filter((g) => g.clientMetaAssetId === account.clientMetaAssetId)
            : [];
          const isExpanded = expanded === key;

          return (
            <article
              key={key}
              className={`rounded-xl border bg-brand-ink/50 p-4 transition ${
                performanceStatus === 'critical'
                  ? 'border-red-500/30'
                  : performanceStatus === 'attention'
                  ? 'border-amber-400/30'
                  : 'border-brand-line'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold uppercase tracking-wider text-brand-green">
                    {client.analysisProfile?.vertical || 'Sem segmento'}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    {/* Indicador de saúde */}
                    <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotColor(performanceStatus)}`} aria-hidden="true" />
                    <h3 className="truncate font-black text-white">{client.clientName}</h3>
                  </div>
                  <p className="mt-1 truncate text-xs text-brand-muted">
                    {account?.accountName || 'Nenhuma conta vinculada'}
                  </p>
                </div>
                <PerformanceStatusBadge status={performanceStatus} />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <MetricCell
                  label="Investimento"
                  value={formatCurrency(metricValue(spendMetric), account?.currency || null)}
                  metric={spendMetric}
                />
                <MetricCell
                  label={metricLabels[primaryMetricId] || 'KPI principal'}
                  value={formatNumber(metricValue(primaryMetric))}
                  metric={primaryMetric}
                />
                <MetricCell
                  label="Orçamento"
                  value={
                    client.analysisProfile?.plannedBudget
                      ? formatCurrency(client.analysisProfile.plannedBudget, account?.currency || null)
                      : '—'
                  }
                />
                {/* Pacing visual no mobile */}
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Pacing</p>
                  <div className="mt-1">
                    {account?.budgetPacing
                      ? <PacingBar pct={account.budgetPacing.differencePercent} />
                      : <span className="font-bold text-brand-muted">—</span>
                    }
                  </div>
                </div>
              </div>

              <p className="mt-3 text-xs text-brand-muted">
                {statusLabel(client.clientStatus)} · {
                  account?.lastSuccessfulRun?.finishedAt
                    ? new Date(account.lastSuccessfulRun.finishedAt).toLocaleString('pt-BR')
                    : 'Sem sync confiável'
                }
              </p>

              <button
                type="button"
                data-testid="client-performance-details-toggle"
                aria-expanded={isExpanded}
                onClick={() => setExpanded(isExpanded ? null : key)}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-brand-line px-3 py-2 text-xs font-bold text-brand-soft"
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {isExpanded ? 'Ocultar detalhes' : 'Ver detalhes'}
              </button>

              {isExpanded && (
                <div data-testid="client-performance-details" className="mt-3 space-y-3 border-t border-brand-line pt-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-brand-muted">Metas e realizado</p>
                    {evaluations.length === 0
                      ? <p className="mt-1 text-xs text-brand-muted">Nenhuma meta comparável neste período.</p>
                      : evaluations.map((ev) => (
                        <div
                          key={`${ev.metricId}:${ev.campaignId || 'account'}`}
                          className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-black/20 p-2 text-xs"
                        >
                          <div>
                            <p className="font-bold text-white">{metricLabels[ev.metricId] || ev.metricId.split('_').join(' ')}</p>
                            <p className="text-brand-muted">Esperado {formatNumber(ev.targetValue)} · realizado {formatNumber(ev.actualValue)}</p>
                          </div>
                          <PerformanceStatusBadge status={ev.status} />
                        </div>
                      ))
                    }
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-brand-muted mb-2">Campanhas da conta</p>
                    {account ? (
                      <CampaignHierarchicalTable account={account} period={period} />
                    ) : (
                      <p className="mt-1 text-xs text-brand-soft">Nenhuma conta selecionada.</p>
                    )}
                  </div>
                  <p className="text-xs text-brand-muted">
                    Qualidade: {account?.dataQuality.status || client.dataQuality.status} · Moeda: {account?.currency || 'não informada'} · Fuso: {account?.timezone || 'não informado'}
                  </p>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {/* ── Desktop ── */}
      <div data-testid="client-performance-desktop" className="hidden overflow-x-auto lg:block">
        <div className="min-w-[1360px] w-full text-left text-sm">
          <div className="grid grid-cols-[260px_120px_120px_95px_110px_80px_105px_85px_105px_135px_145px] items-center border-b border-brand-line bg-brand-ink/60 text-[11px] font-bold uppercase tracking-wider text-brand-muted">
            <div className="px-4 py-3">Cliente / conta</div>
            <div className="px-4 py-3">Investimento</div>
            <div className="px-4 py-3">Pacing</div>
            <div className="px-4 py-3">Conversas</div>
            <div className="px-4 py-3">Custo/conv.</div>
            <div className="px-4 py-3">Leads</div>
            <div className="px-4 py-3">CPL</div>
            <div className="px-4 py-3">Compras</div>
            <div className="px-4 py-3">CPA</div>
            <div className="px-4 py-3">Situação</div>
            <div className="px-4 py-3">Dados</div>
          </div>
          <div className="flex flex-col divide-y divide-brand-line/70">
            {rows.map(({ client, account }) => {
              const key               = account ? accountRowKey(client.clientId, account) : `${client.clientId}:none`;
              const spendMetric       = account?.metrics.spend;
              const conversationsMetric = account?.metrics.messaging_conversations_started_total;
              const leadsMetric       = account?.metrics.leads;
              const purchasesMetric   = account?.metrics.purchases;
              const spend             = metricValue(spendMetric);
              const conversations     = metricValue(conversationsMetric);
              const leads             = metricValue(leadsMetric);
              const purchases         = metricValue(purchasesMetric);
              const costPerConversation = deriveCostMetric('cost_per_messaging_conversation', spendMetric, conversationsMetric);
              const costPerLead         = deriveCostMetric('cost_per_lead', spendMetric, leadsMetric);
              const costPerPurchase     = deriveCostMetric('cost_per_purchase', spendMetric, purchasesMetric);
              const evaluations       = account
                ? client.evaluations.filter((ev) => ev.clientMetaAssetId === account.clientMetaAssetId)
                : [];
              const performanceStatus = worstEvaluation(evaluations);
              const groups            = account
                ? client.metricGroups.filter((g) => g.clientMetaAssetId === account.clientMetaAssetId)
                : [];
              const isExpanded = expanded === key;

              return (
                <div key={key} className="flex flex-col">
                  <div className="w-full p-0">
                    {/**
                     * rowStyle() aplica:
                     *  - borda-esquerda 3 px colorida por severidade
                     *  - fundo com opacity 4 % na cor semântica
                     * group + group-hover expõe o botão "Ver campanhas" na última célula.
                     */}
                    <button
                      type="button"
                      onClick={() => account && setExpanded(isExpanded ? null : key)}
                      className={[
                        'group grid w-full min-w-[1360px]',
                        'grid-cols-[260px_120px_120px_95px_110px_80px_105px_85px_105px_135px_145px]',
                        'items-center text-left transition-colors duration-100',
                        account ? 'hover:bg-white/[0.03]' : 'cursor-default',
                        rowStyle(performanceStatus),
                      ].join(' ')}
                    >
                      {/* Coluna 1: indicador de saúde + nome */}
                      <div className="flex items-center gap-3 px-4 py-4">
                        {account
                          ? (isExpanded ? <ChevronDown size={17} className="shrink-0 text-brand-muted" /> : <ChevronRight size={17} className="shrink-0 text-brand-muted" />)
                          : <Database size={17} className="shrink-0 text-brand-muted" />
                        }
                        {/* Bolinha de status */}
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${statusDotColor(performanceStatus)}`}
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <p className="truncate font-bold text-white">{client.clientName}</p>
                          <p className="truncate text-xs text-brand-muted">
                            {account?.accountName || 'Nenhuma conta vinculada'}
                          </p>
                        </div>
                      </div>

                      {/* Coluna 2: Investimento */}
                      <div className="px-4 py-4 font-bold text-white">
                        <TraceableMetricValue metric={spendMetric}>
                          {formatCurrency(spend, account?.currency || null)}
                        </TraceableMetricValue>
                      </div>

                      {/* Coluna 3: Pacing — barra visual */}
                      <div className="px-4 py-4">
                        {account?.budgetPacing
                          ? <PacingBar pct={account.budgetPacing.differencePercent} />
                          : <span className="text-brand-muted">—</span>
                        }
                      </div>

                      {/* Colunas 4–9: métricas */}
                      <div className="px-4 py-4 text-white">
                        <TraceableMetricValue metric={conversationsMetric}>{formatNumber(conversations)}</TraceableMetricValue>
                      </div>
                      <div className="px-4 py-4 text-white">
                        <TraceableMetricValue metric={costPerConversation}>
                          {formatCurrency(metricValue(costPerConversation), account?.currency || null)}
                        </TraceableMetricValue>
                      </div>
                      <div className="px-4 py-4 text-white">
                        <TraceableMetricValue metric={leadsMetric}>{formatNumber(leads)}</TraceableMetricValue>
                      </div>
                      <div className="px-4 py-4 text-white">
                        <TraceableMetricValue metric={costPerLead}>
                          {formatCurrency(metricValue(costPerLead), account?.currency || null)}
                        </TraceableMetricValue>
                      </div>
                      <div className="px-4 py-4 text-white">
                        <TraceableMetricValue metric={purchasesMetric}>{formatNumber(purchases)}</TraceableMetricValue>
                      </div>
                      <div className="px-4 py-4 text-white">
                        <TraceableMetricValue metric={costPerPurchase}>
                          {formatCurrency(metricValue(costPerPurchase), account?.currency || null)}
                        </TraceableMetricValue>
                      </div>

                      {/* Coluna 10: Situação */}
                      <div className="px-4 py-4">
                        <PerformanceStatusBadge status={performanceStatus} />
                      </div>

                      {/* Coluna 11: Dados + hover CTA */}
                      <div className="px-4 py-4">
                        <p className="font-semibold text-white">{statusLabel(client.clientStatus)}</p>
                        <p className="mt-1 flex items-center gap-1 text-[10px] text-brand-muted">
                          <Clock3 size={11} />
                          {account?.lastSuccessfulRun?.finishedAt
                            ? new Date(account.lastSuccessfulRun.finishedAt).toLocaleString('pt-BR')
                            : 'Sem sync confiável'}
                        </p>
                        {/* Botão fantasma — aparece no hover da linha */}
                        {account && (client.clientStatus === 'failed' || client.clientStatus === 'period_not_synced') ? (
                          <SyncAction account={account} period={period} />
                        ) : account ? (
                          <span className="mt-2 hidden rounded-md border border-brand-line/60 px-2 py-1 text-[10px] font-bold text-brand-soft group-hover:inline-block">
                            Ver campanhas
                          </span>
                        ) : (
                          <span className="mt-2 hidden rounded-md border border-brand-line/60 px-2 py-1 text-[10px] font-bold text-brand-soft group-hover:inline-block">
                            Ver cliente
                          </span>
                        )}
                      </div>
                    </button>

                    {/* Linha expandida: campanhas */}
                    {isExpanded && account && (
                      <div className="border-t border-brand-line bg-brand-ink/50 px-5 py-5">
                        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="flex items-center gap-2 font-bold text-white">
                              <Layers3 size={16} className="text-brand-green" /> Campanhas da conta
                            </p>
                            <p className="mt-1 text-xs text-brand-muted">
                              Cada combinação de objetivo, destino e atribuição permanece separada.
                            </p>
                          </div>
                          <div className="text-xs text-brand-muted">
                            Moeda: <strong className="text-white">{account.currency || '—'}</strong> · Timezone:{' '}
                            <strong className="text-white">{account.timezone || '—'}</strong>
                          </div>
                        </div>
                        <div className="space-y-3">
                          <CampaignHierarchicalTable account={account} period="last_90d" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {rows.length === 0 && (
        <div className="p-10 text-center text-brand-muted">
          Nenhum cliente disponível para os filtros atuais.
        </div>
      )}
    </div>
  );
}
