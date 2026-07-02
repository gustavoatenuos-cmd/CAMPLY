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
  return evaluations.reduce<PerformanceStatus>((worst, evaluation) => (
    severity[evaluation.status] > severity[worst] ? evaluation.status : worst
  ), 'unavailable');
}

function statusLabel(status: GlobalClientPerformance['clientStatus']): string {
  const labels: Record<GlobalClientPerformance['clientStatus'], string> = {
    not_connected: 'Conta não conectada',
    never_synced: 'Nunca sincronizado',
    syncing: 'Sincronizando',
    no_delivery: 'Sem entrega',
    available: 'Atualizado',
    stale: 'Desatualizado',
    partial: 'Sincronização parcial',
    failed: 'Falha na sincronização',
  };
  return labels[status];
}

function accountRowKey(clientId: string, account: GlobalPerformanceAccount): string {
  return `${clientId}:${account.clientMetaAssetId}`;
}

function CampaignGroupRow({ group }: { group: GlobalMetricGroup }) {
  const spendMetric = group.metrics.spend;
  const conversationsMetric = group.metrics.messaging_conversations_started_total;
  const leadsMetric = group.metrics.leads;
  const purchasesMetric = group.metrics.purchases;
  const spend = metricValue(spendMetric);
  const conversations = metricValue(conversationsMetric);
  const leads = metricValue(leadsMetric);
  const purchases = metricValue(purchasesMetric);

  return (
    <div className="grid gap-3 rounded-xl border border-brand-line/70 bg-brand-ink/40 p-4 md:grid-cols-[minmax(240px,1.7fr)_repeat(4,minmax(90px,0.7fr))] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-bold text-white">{group.campaignName}</span>
          {group.classifiedObjective && (
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-bold text-brand-soft">{group.classifiedObjective}</span>
          )}
        </div>
        <p className="mt-1 truncate text-xs text-brand-muted">
          {group.destinationType || 'Destino não informado'} · {group.attributionSetting || 'Atribuição não informada'}
        </p>
      </div>
      <MetricCell label="Investido" value={formatCurrency(spend, group.currency)} metric={spendMetric} />
      <MetricCell label="Conversas" value={formatNumber(conversations)} metric={conversationsMetric} />
      <MetricCell label="Leads" value={formatNumber(leads)} metric={leadsMetric} />
      <MetricCell label="Compras" value={formatNumber(purchases)} metric={purchasesMetric} />
    </div>
  );
}

function MetricCell({ label, value, metric }: { label: string; value: string; metric?: MetricContract }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">{label}</p>
      <p className="mt-1 font-bold text-white"><TraceableMetricValue metric={metric}>{value}</TraceableMetricValue></p>
    </div>
  );
}

export function ClientPerformanceTable({ clients }: { clients: GlobalClientPerformance[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = useMemo(() => clients.flatMap((client) => {
    if (client.accounts.length === 0) {
      return [{ client, account: null as GlobalPerformanceAccount | null }];
    }
    return client.accounts.map((account) => ({ client, account }));
  }), [clients]);

  return (
    <div className="overflow-hidden rounded-2xl border border-brand-line bg-brand-surface">
      <div className="flex flex-col gap-2 border-b border-brand-line p-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-green">Central de clientes</p>
          <h2 className="mt-1 text-xl font-black text-white">Performance por conta de anúncios</h2>
          <p className="mt-1 text-sm text-brand-muted">Os valores seguem conta, moeda, período e atribuição disponíveis no sync confiável.</p>
        </div>
        <p className="text-xs text-brand-muted">Clique em uma linha para abrir as campanhas.</p>
      </div>

      <div data-testid="client-performance-mobile" className="space-y-3 p-4 lg:hidden">
        {rows.map(({ client, account }) => {
          const key = account ? accountRowKey(client.clientId, account) : `${client.clientId}:none`;
          const spendMetric = account?.metrics.spend;
          const primaryMetricId = client.analysisProfile?.primaryConversionMetric || 'messaging_conversations_started_total';
          const primaryMetric = account?.metrics[primaryMetricId];
          const spend = metricValue(spendMetric);
          const primaryValue = metricValue(primaryMetric);
          const evaluations = account
            ? client.evaluations.filter((evaluation) => evaluation.clientMetaAssetId === account.clientMetaAssetId)
            : [];
          const performanceStatus = worstEvaluation(evaluations);
          const groups = account
            ? client.metricGroups.filter((group) => group.clientMetaAssetId === account.clientMetaAssetId)
            : [];
          const isExpanded = expanded === key;

          return (
            <article key={key} className="rounded-xl border border-brand-line bg-brand-ink/50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold uppercase tracking-wider text-brand-green">{client.analysisProfile?.vertical || 'Sem segmento'}</p>
                  <h3 className="mt-1 truncate font-black text-white">{client.clientName}</h3>
                  <p className="mt-1 truncate text-xs text-brand-muted">{account?.accountName || 'Nenhuma conta vinculada'}</p>
                </div>
                <PerformanceStatusBadge status={performanceStatus} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <MetricCell label="Investimento" value={formatCurrency(spend, account?.currency || null)} metric={spendMetric} />
                <MetricCell label={metricLabels[primaryMetricId] || 'KPI principal'} value={formatNumber(primaryValue)} metric={primaryMetric} />
                <MetricCell label="Orçamento" value={client.analysisProfile?.plannedBudget ? formatCurrency(client.analysisProfile.plannedBudget, account?.currency || null) : '—'} />
                <MetricCell label="Pacing" value={account?.budgetPacing ? `${account.budgetPacing.differencePercent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—'} />
              </div>
              <p className="mt-3 text-xs text-brand-muted">{statusLabel(client.clientStatus)} · {account?.lastSuccessfulRun?.finishedAt ? new Date(account.lastSuccessfulRun.finishedAt).toLocaleString('pt-BR') : 'Sem sync confiável'}</p>
              <button
                type="button"
                data-testid="client-performance-details-toggle"
                aria-expanded={isExpanded}
                onClick={() => setExpanded(isExpanded ? null : key)}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-brand-line px-3 py-2 text-xs font-bold text-brand-soft"
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {isExpanded ? 'Ocultar detalhes' : 'Ver detalhes'}
              </button>
              {isExpanded && (
                <div data-testid="client-performance-details" className="mt-3 space-y-3 border-t border-brand-line pt-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-brand-muted">Metas e realizado</p>
                    {evaluations.length === 0 ? <p className="mt-1 text-xs text-brand-muted">Nenhuma meta comparável neste período.</p> : evaluations.map((evaluation) => (
                      <div key={`${evaluation.metricId}:${evaluation.campaignId || 'account'}`} className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-black/20 p-2 text-xs">
                        <div><p className="font-bold text-white">{metricLabels[evaluation.metricId] || evaluation.metricId.split('_').join(' ')}</p><p className="text-brand-muted">Esperado {formatNumber(evaluation.targetValue)} · realizado {formatNumber(evaluation.actualValue)}</p></div>
                        <PerformanceStatusBadge status={evaluation.status} />
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-brand-muted">Campanhas da conta</p>
                    <p className="mt-1 text-xs text-brand-soft">{groups.length > 0 ? groups.map((group) => group.campaignName).join(' · ') : 'Nenhuma campanha confiável neste recorte.'}</p>
                  </div>
                  <p className="text-xs text-brand-muted">Qualidade: {account?.dataQuality.status || client.dataQuality.status} · Moeda: {account?.currency || 'não informada'} · Fuso: {account?.timezone || 'não informado'}</p>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div data-testid="client-performance-desktop" className="hidden overflow-x-auto lg:block">
        <table className="min-w-[1180px] w-full text-left text-sm">
          <thead className="border-b border-brand-line bg-brand-ink/60 text-[11px] uppercase tracking-wider text-brand-muted">
            <tr>
              <th className="px-4 py-3">Cliente / conta</th>
              <th className="px-4 py-3">Investimento</th>
              <th className="px-4 py-3">Pacing</th>
              <th className="px-4 py-3">Conversas</th>
              <th className="px-4 py-3">Custo/conv.</th>
              <th className="px-4 py-3">Leads</th>
              <th className="px-4 py-3">CPL</th>
              <th className="px-4 py-3">Compras</th>
              <th className="px-4 py-3">CPA</th>
              <th className="px-4 py-3">Situação</th>
              <th className="px-4 py-3">Dados</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-line/70">
            {rows.map(({ client, account }) => {
              const key = account ? accountRowKey(client.clientId, account) : `${client.clientId}:none`;
              const spendMetric = account?.metrics.spend;
              const conversationsMetric = account?.metrics.messaging_conversations_started_total;
              const leadsMetric = account?.metrics.leads;
              const purchasesMetric = account?.metrics.purchases;
              const spend = metricValue(spendMetric);
              const conversations = metricValue(conversationsMetric);
              const leads = metricValue(leadsMetric);
              const purchases = metricValue(purchasesMetric);
              const costPerConversation = deriveCostMetric('cost_per_messaging_conversation', spendMetric, conversationsMetric);
              const costPerLead = deriveCostMetric('cost_per_lead', spendMetric, leadsMetric);
              const costPerPurchase = deriveCostMetric('cost_per_purchase', spendMetric, purchasesMetric);
              const evaluations = account
                ? client.evaluations.filter((evaluation) => evaluation.clientMetaAssetId === account.clientMetaAssetId)
                : [];
              const performanceStatus = worstEvaluation(evaluations);
              const groups = account
                ? client.metricGroups.filter((group) => group.clientMetaAssetId === account.clientMetaAssetId)
                : [];
              const isExpanded = expanded === key;

              return (
                <tr key={key} className="align-top">
                  <td colSpan={11} className="p-0">
                    <button
                      type="button"
                      onClick={() => account && setExpanded(isExpanded ? null : key)}
                      className={`grid w-full min-w-[1180px] grid-cols-[260px_120px_120px_95px_110px_80px_105px_85px_105px_135px_145px] items-center text-left transition ${account ? 'hover:bg-white/[0.03]' : 'cursor-default'} `}
                    >
                      <div className="flex items-center gap-3 px-4 py-4">
                        {account ? (isExpanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />) : <Database size={17} />}
                        <div className="min-w-0">
                          <p className="truncate font-bold text-white">{client.clientName}</p>
                          <p className="truncate text-xs text-brand-muted">{account?.accountName || 'Nenhuma conta vinculada'}</p>
                        </div>
                      </div>
                      <div className="px-4 py-4 font-bold text-white"><TraceableMetricValue metric={spendMetric}>{formatCurrency(spend, account?.currency || null)}</TraceableMetricValue></div>
                      <div className="px-4 py-4">
                        {account?.budgetPacing ? (
                          <div>
                            <p className="font-bold text-white">{account.budgetPacing.differencePercent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</p>
                            <p className="text-[10px] text-brand-muted">vs. esperado</p>
                          </div>
                        ) : '—'}
                      </div>
                      <div className="px-4 py-4 text-white"><TraceableMetricValue metric={conversationsMetric}>{formatNumber(conversations)}</TraceableMetricValue></div>
                      <div className="px-4 py-4 text-white"><TraceableMetricValue metric={costPerConversation}>{formatCurrency(metricValue(costPerConversation), account?.currency || null)}</TraceableMetricValue></div>
                      <div className="px-4 py-4 text-white"><TraceableMetricValue metric={leadsMetric}>{formatNumber(leads)}</TraceableMetricValue></div>
                      <div className="px-4 py-4 text-white"><TraceableMetricValue metric={costPerLead}>{formatCurrency(metricValue(costPerLead), account?.currency || null)}</TraceableMetricValue></div>
                      <div className="px-4 py-4 text-white"><TraceableMetricValue metric={purchasesMetric}>{formatNumber(purchases)}</TraceableMetricValue></div>
                      <div className="px-4 py-4 text-white"><TraceableMetricValue metric={costPerPurchase}>{formatCurrency(metricValue(costPerPurchase), account?.currency || null)}</TraceableMetricValue></div>
                      <div className="px-4 py-4"><PerformanceStatusBadge status={performanceStatus} /></div>
                      <div className="px-4 py-4">
                        <p className="font-semibold text-white">{statusLabel(client.clientStatus)}</p>
                        <p className="mt-1 flex items-center gap-1 text-[10px] text-brand-muted">
                          <Clock3 size={11} />
                          {account?.lastSuccessfulRun?.finishedAt
                            ? new Date(account.lastSuccessfulRun.finishedAt).toLocaleString('pt-BR')
                            : 'Sem sync confiável'}
                        </p>
                      </div>
                    </button>

                    {isExpanded && account && (
                      <div className="border-t border-brand-line bg-brand-ink/50 px-5 py-5">
                        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="flex items-center gap-2 font-bold text-white"><Layers3 size={16} className="text-brand-green" /> Campanhas da conta</p>
                            <p className="mt-1 text-xs text-brand-muted">Cada combinação de objetivo, destino e atribuição permanece separada.</p>
                          </div>
                          <div className="text-xs text-brand-muted">
                            Moeda: <strong className="text-white">{account.currency || '—'}</strong> · Timezone: <strong className="text-white">{account.timezone || '—'}</strong>
                          </div>
                        </div>
                        <div className="space-y-3">
                          {groups.length > 0 ? groups.map((group, index) => (
                            <CampaignGroupRow key={`${group.campaignId}:${group.attributionSetting || 'none'}:${index}`} group={group} />
                          )) : (
                            <div className="rounded-xl border border-dashed border-brand-line p-6 text-center text-sm text-brand-muted">
                              Nenhuma campanha confiável foi retornada para este período.
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <div className="p-10 text-center text-brand-muted">Nenhum cliente disponível para os filtros atuais.</div>
      )}
    </div>
  );
}
