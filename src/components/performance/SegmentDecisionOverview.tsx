import { AlertTriangle, CheckCircle2, CircleDashed, Layers3 } from 'lucide-react';
import type React from 'react';
import type { Client } from '../../types';
import type { GlobalClientPerformance, MetricContract } from '../../lib/performance/globalPerformanceDashboard';
import { analysisVerticals, metricLabels, type ClientAnalysisProfile } from '../../lib/analysis/clientAnalysisProfile';

function metricValue(metric: MetricContract | undefined): number | null {
  return metric?.available && typeof metric.value === 'number' ? metric.value : null;
}

function currency(value: number, code: string | null): string {
  if (!code) return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: code }).format(value);
  } catch {
    return `${code} ${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`;
  }
}

export function effectiveClientProfile(client: GlobalClientPerformance): ClientAnalysisProfile | null {
  return client.analysisProfile?.analysisEnabled ? client.analysisProfile : null;
}

export function clientSeverity(client: GlobalClientPerformance): 'healthy' | 'attention' | 'critical' | 'no_data' {
  if (client.dataQuality.status === 'unavailable' || ['not_connected', 'never_synced', 'failed', 'no_delivery'].includes(client.clientStatus)) return 'no_data';
  if (client.score.status === 'critical' || client.evaluations.some((item) => item.status === 'critical')) return 'critical';
  if (
    client.dataQuality.status === 'partial'
    || ['partial', 'stale', 'syncing'].includes(client.clientStatus)
    || client.score.status === 'attention'
    || client.evaluations.some((item) => item.status === 'attention' || item.status === 'partial_data')
  ) return 'attention';
  return 'healthy';
}

export interface SegmentSummary {
  key: string;
  vertical: string;
  subsegments: Set<string>;
  clientsBySubsegment: Map<string, GlobalClientPerformance[]>;
  clients: GlobalClientPerformance[];
  plannedBudgetByCurrency: Map<string, number>;
  spendByCurrency: Map<string, number>;
  expectedSpendByCurrency: Map<string, number>;
  projectedSpendByCurrency: Map<string, number>;
  healthy: number;
  attention: number;
  critical: number;
  noData: number;
  pendingActions: number;
  primaryMetrics: Set<string>;
}

function emptySegmentSummary(key: string): SegmentSummary {
  return {
    key,
    vertical: key,
    subsegments: new Set<string>(),
    clientsBySubsegment: new Map<string, GlobalClientPerformance[]>(),
    clients: [],
    plannedBudgetByCurrency: new Map<string, number>(),
    spendByCurrency: new Map<string, number>(),
    expectedSpendByCurrency: new Map<string, number>(),
    projectedSpendByCurrency: new Map<string, number>(),
    healthy: 0,
    attention: 0,
    critical: 0,
    noData: 0,
    pendingActions: 0,
    primaryMetrics: new Set<string>(),
  };
}

function verticalLabel(profile: ClientAnalysisProfile): string {
  return profile.vertical === 'Outros' && profile.customVertical ? profile.customVertical : profile.vertical;
}

function subsegmentLabel(profile: ClientAnalysisProfile): string {
  return profile.subsegment === 'Outros' && profile.customSubsegment ? profile.customSubsegment : profile.subsegment;
}

function pendingReasons(client: GlobalClientPerformance, profile: ClientAnalysisProfile | null): string[] {
  const reasons: string[] = [];
  if (!profile) {
    reasons.push('Sem perfil de análise');
  } else {
    if (!profile.vertical) reasons.push('Sem segmento');
    if (!profile.subsegment) reasons.push('Sem subsegmento');
    if (!profile.primaryConversionMetric) reasons.push('Sem conversão principal');
    if (!profile.plannedBudget) reasons.push('Sem orçamento planejado');
  }
  if (client.accounts.length === 0) reasons.push('Sem conta Meta');
  if (client.resolvedTargets.length === 0) reasons.push('Sem metas');
  if (client.clientStatus === 'never_synced') reasons.push('Nunca sincronizado');
  if (client.clientStatus === 'partial') reasons.push('Sincronização parcial');
  if (client.clientStatus === 'failed') reasons.push('Falha de sincronização');
  if (client.score.status === 'unavailable') reasons.push('Score não calculável');
  return Array.from(new Set(reasons));
}

export function buildSegmentSummaries(
  clients: GlobalClientPerformance[],
  _workspaceClients: Client[]
): { summaries: SegmentSummary[]; pending: GlobalClientPerformance[]; pendingByClient: Map<string, string[]> } {
  const groups = new Map<string, SegmentSummary>(analysisVerticals.map((vertical) => [vertical, emptySegmentSummary(vertical)]));
  const pending: GlobalClientPerformance[] = [];
  const pendingByClient = new Map<string, string[]>();

  for (const client of clients) {
    const profile = effectiveClientProfile(client);
    const reasons = pendingReasons(client, profile);

    // Add client to segment if they have vertical AND subsegment (not blocked by KPI/budget)
    if (profile && profile.vertical && profile.subsegment) {
      const key = verticalLabel(profile);
      const subsegment = subsegmentLabel(profile);
      const summary = groups.get(key) ?? emptySegmentSummary(key);
      summary.clients.push(client);
      summary.subsegments.add(subsegment);
      summary.clientsBySubsegment.set(subsegment, [...(summary.clientsBySubsegment.get(subsegment) || []), client]);

      // Add financial data if available
      if (profile.plannedBudget) {
        const accountCurrencies = new Set(client.accounts.map((account) => account.currency || 'SEM_MOEDA'));
        const budgetCurrency = accountCurrencies.size === 1 ? Array.from(accountCurrencies)[0] : 'SEM_MOEDA';
        summary.plannedBudgetByCurrency.set(
          budgetCurrency,
          (summary.plannedBudgetByCurrency.get(budgetCurrency) || 0) + (profile.plannedBudget ?? 0)
        );
      }

      if (profile.primaryConversionMetric) {
        summary.primaryMetrics.add(profile.primaryConversionMetric);
      }

      for (const account of client.accounts) {
        const spend = metricValue(account.metrics.spend);
        if (spend === null) continue;
        const currencyKey = account.currency || 'SEM_MOEDA';
        summary.spendByCurrency.set(currencyKey, (summary.spendByCurrency.get(currencyKey) || 0) + spend);
        if (account.budgetPacing) {
          summary.expectedSpendByCurrency.set(currencyKey, (summary.expectedSpendByCurrency.get(currencyKey) || 0) + account.budgetPacing.expectedSpendUntilNow);
          summary.projectedSpendByCurrency.set(currencyKey, (summary.projectedSpendByCurrency.get(currencyKey) || 0) + account.budgetPacing.projectedMonthlySpend);
        }
      }

      const severity = clientSeverity(client);
      if (severity === 'healthy') summary.healthy += 1;
      if (severity === 'attention') summary.attention += 1;
      if (severity === 'critical') summary.critical += 1;
      if (severity === 'no_data') summary.noData += 1;
      summary.pendingActions += client.score.signals.filter((signal) => ['critical', 'warning'].includes(signal.severity)).length;
      groups.set(key, summary);
    }

    // Add to pending if reasons exist (separately from segment)
    if (reasons.length > 0) {
      pending.push(client);
      pendingByClient.set(client.clientId, reasons);
    }
  }

  return {
    summaries: Array.from(groups.values()).sort((a, b) => b.critical - a.critical || b.attention - a.attention || b.clients.length - a.clients.length || a.vertical.localeCompare(b.vertical)),
    pending,
    pendingByClient,
  };
}

export function SegmentDecisionOverview({
  clients,
  workspaceClients,
  selectedSegment,
  selectedSubsegment,
  onSelectSegment,
  onSelectSubsegment,
}: {
  clients: GlobalClientPerformance[];
  workspaceClients: Client[];
  selectedSegment: string;
  selectedSubsegment: string;
  onSelectSegment: (segment: string) => void;
  onSelectSubsegment: (subsegment: string) => void;
}) {
  const { summaries, pending, pendingByClient } = buildSegmentSummaries(clients, workspaceClients);
  const selectedSummary = summaries.find((summary) => summary.key === selectedSegment);
  const activeCount = selectedSegment === 'all'
    ? clients.length
    : selectedSubsegment !== 'all' && selectedSummary
      ? selectedSummary.clientsBySubsegment.get(selectedSubsegment)?.length ?? 0
      : selectedSummary?.clients.length ?? pending.length;

  const selectSegment = (segment: string) => {
    onSelectSegment(segment);
    onSelectSubsegment('all');
  };

  return (
    <section className="rounded-2xl border border-brand-line bg-brand-surface p-4 lg:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-green">Central de decisão por segmento</p>
          <h2 className="mt-1 text-xl font-black text-white">O que eu esperava, o que aconteceu e onde agir primeiro</h2>
          <p className="mt-1 text-sm text-brand-muted">Clientes com segmento/subsegmento aparecem no segmento. Pendências aparecem com motivo. Sem bloqueio por KPI ou orçamento.</p>
        </div>
        <p className="rounded-full bg-white/5 px-3 py-1 text-xs font-bold text-brand-soft">{activeCount} cliente(s)</p>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        <button
          data-testid="segment-filter-all"
          aria-pressed={selectedSegment === 'all'}
          type="button"
          onClick={() => selectSegment('all')}
          className={`shrink-0 rounded-full px-3 py-2 text-xs font-bold ${
            selectedSegment === 'all'
              ? 'bg-brand-green text-brand-ink'
              : 'bg-white/8 text-brand-muted hover:bg-white/12'
          }`}
        >
          Todos
        </button>
        {summaries.map((summary) => (
          <button
            data-testid={`segment-filter-${summary.key}`}
            aria-pressed={selectedSegment === summary.key}
            key={summary.key}
            type="button"
            onClick={() => selectSegment(summary.key)}
            className={`shrink-0 rounded-full px-3 py-2 text-xs font-bold ${
              selectedSegment === summary.key
                ? 'bg-brand-green text-brand-ink'
                : 'bg-white/8 text-brand-muted hover:bg-white/12'
            }`}
          >
            {summary.vertical}
          </button>
        ))}
        <button
          data-testid="segment-filter-pending"
          aria-pressed={selectedSegment === '__pending__'}
          type="button"
          onClick={() => selectSegment('__pending__')}
          className={`shrink-0 rounded-full px-3 py-2 text-xs font-bold ${
            selectedSegment === '__pending__'
              ? 'bg-brand-green text-brand-ink'
              : 'bg-white/8 text-brand-muted hover:bg-white/12'
          }`}
        >
          Pendências ({pending.length})
        </button>
      </div>

      {selectedSummary && (
        <div data-testid="subsegment-filters" className="mt-3 flex gap-2 overflow-x-auto pb-1">
          <button
            aria-pressed={selectedSubsegment === 'all'}
            type="button"
            onClick={() => onSelectSubsegment('all')}
            className={`shrink-0 rounded-full px-3 py-2 text-xs font-bold ${
              selectedSubsegment === 'all'
                ? 'bg-brand-green text-brand-ink'
                : 'bg-white/8 text-brand-muted hover:bg-white/12'
            }`}
          >
            Todos
          </button>
          {Array.from(selectedSummary.subsegments)
            .sort()
            .map((subsegment) => (
              <button
                data-testid={`subsegment-filter-${subsegment}`}
                aria-pressed={selectedSubsegment === subsegment}
                key={subsegment}
                type="button"
                onClick={() => onSelectSubsegment(subsegment)}
                className={`shrink-0 rounded-full px-3 py-2 text-xs font-bold ${
                  selectedSubsegment === subsegment
                    ? 'bg-brand-green text-brand-ink'
                    : 'bg-white/8 text-brand-muted hover:bg-white/12'
                }`}
              >
                {subsegment}
              </button>
            ))}
        </div>
      )}

      {selectedSegment === '__pending__' ? (
        <div className="mt-4 rounded-xl border border-amber-300/30 bg-amber-300/10 p-4">
          <p className="font-black text-amber-100">Configurações pendentes</p>
          <p className="mt-1 text-sm text-amber-100/80">
            Esses clientes não entram na leitura de segmento até terem: perfil de análise, segmento, subsegmento, conversão principal, orçamento planejado, conta Meta e metas.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {pending.slice(0, 12).map((client) => (
              <div
                key={client.clientId}
                title={(pendingByClient.get(client.clientId) || []).join('; ')}
                className="rounded-lg bg-black/20 px-3 py-2 text-xs text-amber-100"
              >
                {client.clientName}
              </div>
            ))}
            {pending.length > 12 && <span className="rounded-full bg-black/20 px-3 py-1 text-xs font-bold text-amber-50">+{pending.length - 12}</span>}
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {summaries.map((summary) => {
            const mainMetric = summary.primaryMetrics.size === 0
              ? 'Sem clientes configurados'
              : summary.primaryMetrics.size === 1
                ? metricLabels[Array.from(summary.primaryMetrics)[0]] || Array.from(summary.primaryMetrics)[0]
                : 'Múltiplos objetivos';
            return (
              <button
                key={summary.key}
                type="button"
                onClick={() => selectSegment(summary.key)}
                className="rounded-xl border border-brand-line bg-brand-ink/50 p-4 text-left transition hover:border-brand-green/50 hover:bg-white/[0.03]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-brand-green">{summary.vertical}</p>
                    <h3 className="mt-1 font-black text-white">{summary.clients.length} cliente(s)</h3>
                  </div>
                  <Layers3 className="text-brand-green" size={18} />
                </div>
                <p className="mt-2 text-xs text-brand-muted">{Array.from(summary.subsegments).join(' · ')}</p>
                <div className="mt-3 space-y-2">
                  <div className="rounded-lg bg-black/20 p-2">
                    <p className="text-[10px] uppercase text-brand-muted">KPI principal</p>
                    <p className="mt-1 font-black text-white text-sm">{mainMetric}</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                  <div className="flex items-center justify-center gap-1 rounded-lg bg-emerald-400/10 px-2 py-1 font-bold text-emerald-200">
                    <CheckCircle2 size={13} />
                    {summary.healthy}
                  </div>
                  <div className="flex items-center justify-center gap-1 rounded-lg bg-amber-400/10 px-2 py-1 font-bold text-amber-200">
                    <CircleDashed size={13} />
                    {summary.attention}
                  </div>
                  <div className="flex items-center justify-center gap-1 rounded-lg bg-rose-400/10 px-2 py-1 font-bold text-rose-200">
                    <AlertTriangle size={13} />
                    {summary.critical}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
