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
  if (client.dataQuality.status === 'unavailable' || ['not_connected', 'never_synced', 'period_not_synced', 'sync_without_metrics', 'failed', 'no_delivery'].includes(client.clientStatus)) return 'no_data';
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
  if (!client.analysisProfile) reasons.push('Sem perfil de análise');
  else if (!client.analysisProfile.analysisEnabled) reasons.push('Análise desativada');
  if (!profile?.vertical) reasons.push('Sem segmento');
  if (!profile?.subsegment) reasons.push('Sem subsegmento');
  if (!profile?.primaryConversionMetric) reasons.push('Sem conversão principal');
  if (!profile?.plannedBudget) reasons.push('Sem orçamento planejado');
  if (client.clientStatus === 'not_connected') reasons.push('Sem conta Meta');
  if (client.resolvedTargets.length === 0) reasons.push('Sem metas');
  if (client.clientStatus === 'never_synced') reasons.push('Nunca sincronizado');
  if (client.clientStatus === 'period_not_synced') reasons.push('Período não sincronizado');
  if (client.clientStatus === 'sync_without_metrics') reasons.push('Sync sem métricas');
  if (client.clientStatus === 'partial') reasons.push('Sincronização parcial');
  if (client.clientStatus === 'failed') reasons.push('Falha de sincronização');
  if (client.evaluations.some((evaluation) => evaluation.status === 'insufficient_data')) reasons.push('Dados insuficientes');
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
    if (reasons.length > 0) {
      pending.push(client);
      pendingByClient.set(client.clientId, reasons);
    }
    if (!profile || !profile.vertical || !profile.subsegment || !profile.primaryConversionMetric || !profile.plannedBudget) {
      continue;
    }
    const key = verticalLabel(profile);
    const subsegment = subsegmentLabel(profile);
    const summary = groups.get(key) ?? emptySegmentSummary(key);
    summary.clients.push(client);
    summary.subsegments.add(subsegment);
    summary.clientsBySubsegment.set(subsegment, [...(summary.clientsBySubsegment.get(subsegment) || []), client]);
    const accountCurrencies = new Set(client.accounts.map((account) => account.currency || 'SEM_MOEDA'));
    const budgetCurrency = accountCurrencies.size === 1 ? Array.from(accountCurrencies)[0] : 'SEM_MOEDA';
    summary.plannedBudgetByCurrency.set(
      budgetCurrency,
      (summary.plannedBudgetByCurrency.get(budgetCurrency) || 0) + (profile.plannedBudget ?? 0)
    );
    summary.primaryMetrics.add(profile.primaryConversionMetric);
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
          <p className="mt-1 text-sm text-brand-muted">Segmentos usam o perfil oficial do cliente. Clientes incompletos ficam separados para não contaminarem a leitura saudável.</p>
        </div>
        <p className="rounded-full bg-white/5 px-3 py-1 text-xs font-bold text-brand-soft">{activeCount} cliente(s) no recorte</p>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        <button data-testid="segment-filter-all" aria-pressed={selectedSegment === 'all'} type="button" onClick={() => selectSegment('all')} className={`shrink-0 rounded-full px-3 py-2 text-xs font-black ${selectedSegment === 'all' ? 'bg-brand-green text-brand-ink' : 'border border-brand-line text-brand-soft'}`}>Todos</button>
        {summaries.map((summary) => (
          <button data-testid={`segment-filter-${summary.key}`} aria-pressed={selectedSegment === summary.key} key={summary.key} type="button" onClick={() => selectSegment(summary.key)} className={`shrink-0 rounded-full px-3 py-2 text-xs font-black ${selectedSegment === summary.key ? 'bg-brand-green text-brand-ink' : 'border border-brand-line text-brand-soft'}`}>{summary.vertical}</button>
        ))}
        <button data-testid="segment-filter-pending" aria-pressed={selectedSegment === '__pending__'} type="button" onClick={() => selectSegment('__pending__')} className={`shrink-0 rounded-full px-3 py-2 text-xs font-black ${selectedSegment === '__pending__' ? 'bg-amber-300 text-brand-ink' : 'border border-amber-300/40 text-amber-100'}`}>Configurações pendentes ({pending.length})</button>
      </div>

      {selectedSummary && (
        <div data-testid="subsegment-filters" className="mt-3 flex gap-2 overflow-x-auto pb-1">
          <button aria-pressed={selectedSubsegment === 'all'} type="button" onClick={() => onSelectSubsegment('all')} className={`shrink-0 rounded-full px-3 py-2 text-xs font-bold ${selectedSubsegment === 'all' ? 'bg-sky-300 text-brand-ink' : 'border border-sky-300/30 text-sky-100'}`}>Todos os subsegmentos</button>
          {Array.from(selectedSummary.subsegments).sort().map((subsegment) => (
            <button data-testid={`subsegment-filter-${subsegment}`} aria-pressed={selectedSubsegment === subsegment} key={subsegment} type="button" onClick={() => onSelectSubsegment(subsegment)} className={`shrink-0 rounded-full px-3 py-2 text-xs font-bold ${selectedSubsegment === subsegment ? 'bg-sky-300 text-brand-ink' : 'border border-sky-300/30 text-sky-100'}`}>{subsegment}</button>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {summaries.map((summary) => {
          const mainMetric = summary.primaryMetrics.size === 0
            ? 'Sem clientes configurados'
            : summary.primaryMetrics.size === 1
              ? metricLabels[Array.from(summary.primaryMetrics)[0]] || Array.from(summary.primaryMetrics)[0]
              : 'Múltiplos objetivos';
          return (
            <button key={summary.key} type="button" onClick={() => selectSegment(summary.key)} className="rounded-xl border border-brand-line bg-brand-ink/50 p-4 text-left transition hover:border-brand-green/60">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-brand-green">{summary.vertical}</p>
                  <h3 className="mt-1 font-black text-white">{summary.clients.length} cliente(s)</h3>
                </div>
                <Layers3 className="text-brand-green" size={18} />
              </div>
              <p className="mt-2 text-xs text-brand-muted">{Array.from(summary.subsegments).join(' · ')}</p>
              <FinancialBreakdown summary={summary} />
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <Metric label="KPI principal" value={mainMetric} />
                <Metric label="Sem dados" value={String(summary.noData)} />
                <Metric label="Ações pendentes" value={String(summary.pendingActions)} />
                <Metric label="Subsegmentos" value={String(summary.subsegments.size)} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <Badge icon={<CheckCircle2 size={13} />} label="Saudável" value={summary.healthy} tone="green" />
                <Badge icon={<CircleDashed size={13} />} label="Atenção" value={summary.attention} tone="amber" />
                <Badge icon={<AlertTriangle size={13} />} label="Crítico" value={summary.critical} tone="rose" />
              </div>
            </button>
          );
        })}
      </div>

      {pending.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-300/30 bg-amber-300/10 p-4">
          <p className="font-black text-amber-100">Configurações pendentes</p>
          <p className="mt-1 text-sm text-amber-100/80">Esses clientes não entram na leitura saudável/crítica até terem segmento, subsegmento, conversão principal, orçamento, conta Meta e sync confiável.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {pending.slice(0, 8).map((client) => <span key={client.clientId} title={(pendingByClient.get(client.clientId) || []).join(' · ')} className="rounded-lg bg-black/20 px-3 py-2 text-xs font-bold text-amber-50">{client.clientName}<span className="mt-1 block font-normal text-amber-100/70">{(pendingByClient.get(client.clientId) || []).join(' · ')}</span></span>)}
            {pending.length > 8 && <span className="rounded-full bg-black/20 px-3 py-1 text-xs font-bold text-amber-50">+{pending.length - 8}</span>}
          </div>
        </div>
      )}
    </section>
  );
}

function FinancialBreakdown({ summary }: { summary: SegmentSummary }) {
  const currencies = Array.from(new Set([
    ...summary.plannedBudgetByCurrency.keys(),
    ...summary.spendByCurrency.keys(),
    ...summary.expectedSpendByCurrency.keys(),
    ...summary.projectedSpendByCurrency.keys(),
  ])).sort();
  if (currencies.length === 0) return <div className="mt-4 rounded-lg bg-black/20 p-3 text-xs text-brand-muted">Sem valores financeiros confiáveis.</div>;
  return (
    <div className="mt-4 space-y-2">
      {currencies.map((currencyCode) => {
        const code = currencyCode === 'SEM_MOEDA' ? null : currencyCode;
        const planned = summary.plannedBudgetByCurrency.get(currencyCode) ?? null;
        const spent = summary.spendByCurrency.get(currencyCode) ?? null;
        const expected = summary.expectedSpendByCurrency.get(currencyCode) ?? null;
        const projected = summary.projectedSpendByCurrency.get(currencyCode) ?? null;
        const balance = planned !== null && spent !== null ? planned - spent : null;
        const consumed = planned && spent !== null ? spent / planned * 100 : null;
        return (
          <div key={currencyCode} className="rounded-lg border border-brand-line/70 bg-black/20 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-brand-green">{code || 'Moeda não informada'}</p>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <FinancialValue label="Planejado" value={planned === null ? '—' : currency(planned, code)} />
              <FinancialValue label="Realizado" value={spent === null ? '—' : currency(spent, code)} />
              <FinancialValue label="Saldo" value={balance === null ? '—' : currency(balance, code)} />
              <FinancialValue label="Consumido" value={consumed === null ? '—' : `${consumed.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`} />
              <FinancialValue label="Esperado agora" value={expected === null ? '—' : currency(expected, code)} />
              <FinancialValue label="Projeção" value={projected === null ? '—' : currency(projected, code)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FinancialValue({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[9px] uppercase text-brand-muted">{label}</p><p className="mt-0.5 font-black text-white">{value}</p></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-black/20 p-2"><p className="text-[10px] uppercase text-brand-muted">{label}</p><p className="mt-1 font-black text-white">{value}</p></div>;
}

function Badge({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: 'green' | 'amber' | 'rose' }) {
  const classes = tone === 'green'
    ? 'bg-emerald-400/10 text-emerald-200'
    : tone === 'amber'
      ? 'bg-amber-400/10 text-amber-200'
      : 'bg-rose-400/10 text-rose-200';
  return <div className={`flex items-center justify-center gap-1 rounded-lg px-2 py-1 font-bold ${classes}`}>{icon}{value} {label}</div>;
}
