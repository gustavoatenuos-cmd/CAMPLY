import { AlertTriangle, CheckCircle2, CircleDashed, Layers3 } from 'lucide-react';
import type React from 'react';
import type { Client } from '../../types';
import type { GlobalClientPerformance, MetricContract } from '../../lib/performance/globalPerformanceDashboard';
import { metricLabels, type ClientAnalysisProfile } from '../../lib/analysis/clientAnalysisProfile';

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

function profileFor(client: GlobalClientPerformance, workspaceClients: Client[]): ClientAnalysisProfile | null {
  if (client.analysisProfile) return client.analysisProfile.analysisEnabled ? client.analysisProfile : null;
  const workspaceClient = workspaceClients.find((item) => item.id === client.clientId);
  if (!workspaceClient?.segment) return null;
  return {
    clientId: client.clientId,
    vertical: workspaceClient.segment,
    subsegment: 'Não classificado',
    customVertical: null,
    customSubsegment: null,
    businessModel: 'modelo misto',
    primaryConversionMetric: 'messaging_conversations_started_total',
    secondaryMetrics: [],
    primaryChannel: 'Misto',
    budgetPeriod: workspaceClient.adInvestmentPeriod,
    plannedBudget: workspaceClient.adInvestmentMeta || null,
    minimumEvaluationSpend: 0,
    minimumImpressions: 0,
    minimumResults: 0,
    attributionDelayHours: 24,
    analysisEnabled: true,
  };
}

function clientSeverity(client: GlobalClientPerformance): 'healthy' | 'attention' | 'critical' | 'no_data' {
  if (client.dataQuality.status === 'unavailable' || ['not_connected', 'never_synced'].includes(client.clientStatus)) return 'no_data';
  if (client.score.status === 'critical' || client.evaluations.some((item) => item.status === 'critical')) return 'critical';
  if (client.score.status === 'attention' || client.evaluations.some((item) => item.status === 'attention' || item.status === 'partial_data')) return 'attention';
  return 'healthy';
}

export interface SegmentSummary {
  key: string;
  vertical: string;
  subsegments: Set<string>;
  clients: GlobalClientPerformance[];
  plannedBudgetByCurrency: Map<string, number>;
  spendByCurrency: Map<string, number>;
  healthy: number;
  attention: number;
  critical: number;
  noData: number;
  primaryMetrics: Set<string>;
}

export function buildSegmentSummaries(
  clients: GlobalClientPerformance[],
  workspaceClients: Client[]
): { summaries: SegmentSummary[]; pending: GlobalClientPerformance[] } {
  const groups = new Map<string, SegmentSummary>();
  const pending: GlobalClientPerformance[] = [];

  for (const client of clients) {
    const profile = profileFor(client, workspaceClients);
    if (!profile || !profile.vertical || !profile.subsegment || !profile.primaryConversionMetric || !profile.plannedBudget) {
      pending.push(client);
      continue;
    }
    const key = profile.vertical;
    const summary = groups.get(key) ?? {
      key,
      vertical: key,
      subsegments: new Set<string>(),
      clients: [],
      plannedBudgetByCurrency: new Map<string, number>(),
      spendByCurrency: new Map<string, number>(),
      healthy: 0,
      attention: 0,
      critical: 0,
      noData: 0,
      primaryMetrics: new Set<string>(),
    };
    summary.clients.push(client);
    summary.subsegments.add(profile.subsegment);
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
    }
    const severity = clientSeverity(client);
    if (severity === 'healthy') summary.healthy += 1;
    if (severity === 'attention') summary.attention += 1;
    if (severity === 'critical') summary.critical += 1;
    if (severity === 'no_data') summary.noData += 1;
    groups.set(key, summary);
  }

  return {
    summaries: Array.from(groups.values()).sort((a, b) => b.critical - a.critical || b.attention - a.attention || a.vertical.localeCompare(b.vertical)),
    pending,
  };
}

export function SegmentDecisionOverview({
  clients,
  workspaceClients,
  selectedSegment,
  onSelectSegment,
}: {
  clients: GlobalClientPerformance[];
  workspaceClients: Client[];
  selectedSegment: string;
  onSelectSegment: (segment: string) => void;
}) {
  const { summaries, pending } = buildSegmentSummaries(clients, workspaceClients);
  const activeCount = selectedSegment === 'all'
    ? clients.length
    : summaries.find((summary) => summary.key === selectedSegment)?.clients.length ?? pending.length;

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
        <button type="button" onClick={() => onSelectSegment('all')} className={`shrink-0 rounded-full px-3 py-2 text-xs font-black ${selectedSegment === 'all' ? 'bg-brand-green text-brand-ink' : 'border border-brand-line text-brand-soft'}`}>Todos</button>
        {summaries.map((summary) => (
          <button key={summary.key} type="button" onClick={() => onSelectSegment(summary.key)} className={`shrink-0 rounded-full px-3 py-2 text-xs font-black ${selectedSegment === summary.key ? 'bg-brand-green text-brand-ink' : 'border border-brand-line text-brand-soft'}`}>{summary.vertical}</button>
        ))}
        <button type="button" onClick={() => onSelectSegment('__pending__')} className={`shrink-0 rounded-full px-3 py-2 text-xs font-black ${selectedSegment === '__pending__' ? 'bg-amber-300 text-brand-ink' : 'border border-amber-300/40 text-amber-100'}`}>Configurações pendentes ({pending.length})</button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {summaries.map((summary) => {
          const mixedCurrencies = summary.spendByCurrency.size > 1;
          const spendText = mixedCurrencies
            ? 'Múltiplas moedas'
            : summary.spendByCurrency.size === 0
              ? '—'
              : currency(Array.from(summary.spendByCurrency.values())[0], Array.from(summary.spendByCurrency.keys())[0]);
          const mixedBudgetCurrencies = summary.plannedBudgetByCurrency.size > 1 || summary.plannedBudgetByCurrency.has('SEM_MOEDA');
          const plannedText = mixedBudgetCurrencies
            ? 'Múltiplas moedas'
            : summary.plannedBudgetByCurrency.size === 0
              ? '—'
              : currency(Array.from(summary.plannedBudgetByCurrency.values())[0], Array.from(summary.plannedBudgetByCurrency.keys())[0]);
          const mainMetric = summary.primaryMetrics.size === 1
            ? metricLabels[Array.from(summary.primaryMetrics)[0]] || Array.from(summary.primaryMetrics)[0]
            : 'Múltiplos objetivos';
          return (
            <button key={summary.key} type="button" onClick={() => onSelectSegment(summary.key)} className="rounded-xl border border-brand-line bg-brand-ink/50 p-4 text-left transition hover:border-brand-green/60">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-brand-green">{summary.vertical}</p>
                  <h3 className="mt-1 font-black text-white">{summary.clients.length} cliente(s)</h3>
                </div>
                <Layers3 className="text-brand-green" size={18} />
              </div>
              <p className="mt-2 text-xs text-brand-muted">{Array.from(summary.subsegments).join(' · ')}</p>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <Metric label="Planejado" value={plannedText} />
                <Metric label="Realizado" value={spendText} />
                <Metric label="KPI principal" value={mainMetric} />
                <Metric label="Sem dados" value={String(summary.noData)} />
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
            {pending.slice(0, 8).map((client) => <span key={client.clientId} className="rounded-full bg-black/20 px-3 py-1 text-xs font-bold text-amber-50">{client.clientName}</span>)}
            {pending.length > 8 && <span className="rounded-full bg-black/20 px-3 py-1 text-xs font-bold text-amber-50">+{pending.length - 8}</span>}
          </div>
        </div>
      )}
    </section>
  );
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
