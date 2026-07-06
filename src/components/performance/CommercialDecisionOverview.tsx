import { AlertTriangle, CheckCircle2, CircleDashed, Layers3, ChevronDown, ChevronUp } from 'lucide-react';
import React, { useState } from 'react';
import type { Client } from '../../types';
import type { GlobalClientPerformance, MetricContract } from '../../lib/performance/globalPerformanceDashboard';
import { 
  analysisVerticals, 
  metricLabels, 
  operationTypes,
  salesModels,
  primaryChannels,
  primaryConversionMetrics,
  subsegmentsByVertical,
  type ClientAnalysisProfile 
} from '../../lib/analysis/clientAnalysisProfile';

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
  if (
    client.dataQuality.status === 'unavailable' ||
    client.score.status === 'unavailable' ||
    ['not_connected', 'never_synced', 'period_not_synced', 'sync_without_metrics', 'failed', 'no_delivery'].includes(client.clientStatus)
  ) return 'no_data';
  if (client.score.status === 'critical' || client.evaluations.some((item) => item.status === 'critical')) return 'critical';
  if (
    client.dataQuality.status === 'partial'
    || ['partial', 'stale', 'syncing'].includes(client.clientStatus)
    || client.score.status === 'attention'
    || client.evaluations.some((item) => item.status === 'attention' || item.status === 'partial_data')
  ) return 'attention';
  return 'healthy';
}

function pendingReasons(client: GlobalClientPerformance, profile: ClientAnalysisProfile | null, workspaceClient?: Client): string[] {
  const reasons: string[] = [];
  if (!client.analysisProfile) {
    reasons.push('Sem perfil de análise');
    reasons.push('Sem segmento');
  } else if (!client.analysisProfile.analysisEnabled) {
    reasons.push('Análise desativada');
  }
  
  const vertical = profile?.vertical || workspaceClient?.category;
  if (!vertical && client.analysisProfile) reasons.push('Sem segmento');
  if (!profile?.subsegment && client.analysisProfile) reasons.push('Sem subsegmento');
  if (!profile?.primaryConversionMetric) reasons.push('Sem conversão principal');
  if (!profile?.plannedBudget) reasons.push('Sem orçamento planejado');
  if (client.clientStatus === 'not_connected' || client.accounts.length === 0) reasons.push('Sem conta Meta');
  if (client.resolvedTargets.length === 0) reasons.push('Sem metas');
  if (client.clientStatus === 'never_synced') reasons.push('Nunca sincronizado');
  if (client.clientStatus === 'period_not_synced') reasons.push('Período não sincronizado');
  if (client.clientStatus === 'sync_without_metrics') reasons.push('Sync sem métricas');
  if (client.clientStatus === 'partial') reasons.push('Sincronização parcial');
  if (client.clientStatus === 'failed') reasons.push('Falha de sincronização');
  if (client.evaluations.some((evaluation) => evaluation.status === 'insufficient_data')) reasons.push('Dados insuficientes');
  return Array.from(new Set(reasons));
}

interface ClientAction {
  priority: number;
  title: string;
  description: string;
  clientId: string;
  clientName: string;
}

function getClientAction(client: GlobalClientPerformance, profile: ClientAnalysisProfile | null, workspaceClient?: Client): ClientAction {
  const reasons = pendingReasons(client, profile, workspaceClient);
  if (reasons.length > 0) {
    return { priority: 1, title: 'Configuração pendente', description: reasons.join('. '), clientId: client.clientId, clientName: client.clientName };
  }
  
  if (client.dataQuality.status === 'unavailable' || client.evaluations.some(e => e.status === 'insufficient_data')) {
    return { priority: 2, title: 'Sem dados / rastreamento incompleto', description: 'Verificar rastreamento, pixel, eventos ou integração antes de tomar decisão.', clientId: client.clientId, clientName: client.clientName };
  }

  if (client.score.status === 'critical') {
    return { priority: 3, title: 'Crítico', description: 'Performance significativamente abaixo da meta.', clientId: client.clientId, clientName: client.clientName };
  }

  let hasLowSpend = false;
  let hasHighSpendLowConv = false;
  let hasHighBalance = false;
  
  const pacing = client.budgetPacing;
  if (pacing) {
     const spentRatio = pacing.actualSpend / (pacing.expectedSpendUntilNow || 1);
     if (spentRatio < 0.6) hasLowSpend = true;
     else if (spentRatio > 1.2 && client.score.status !== 'healthy') hasHighSpendLowConv = true;
     
     const targetBudget = profile?.plannedBudget || 0;
     const balance = targetBudget ? targetBudget - pacing.actualSpend : 0;
     if (balance > 0 && pacing.projectedMonthlySpend < targetBudget * 0.7) hasHighBalance = true;
  }

  if (hasLowSpend) return { priority: 4, title: 'Baixo consumo', description: 'Revisar orçamento, público, limite de gasto ou estratégia da campanha.', clientId: client.clientId, clientName: client.clientName };
  if (hasHighSpendLowConv) return { priority: 5, title: 'Consumo alto com baixa conversão', description: 'Revisar oferta e criativo.', clientId: client.clientId, clientName: client.clientName };
  if (hasHighBalance) return { priority: 6, title: 'Saldo alto', description: 'Orçamento com risco de não ser entregue totalmente.', clientId: client.clientId, clientName: client.clientName };

  if (client.score.status === 'attention') return { priority: 7, title: 'Atenção', description: 'Acompanhar métricas de perto, pequenas oscilações de performance.', clientId: client.clientId, clientName: client.clientName };

  return { priority: 8, title: 'Saudável', description: 'Operação dentro do esperado.', clientId: client.clientId, clientName: client.clientName };
}

export type ViewMode = 'vertical' | 'subsegment' | 'primaryChannel' | 'salesModel' | 'primaryConversionMetric' | 'status';

export interface CommercialSummary {
  key: string;
  label: string;
  subsegments: Set<string>;
  clients: GlobalClientPerformance[];
  actions: ClientAction[];
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

function emptyCommercialSummary(key: string, label: string): CommercialSummary {
  return {
    key,
    label,
    subsegments: new Set<string>(),
    clients: [],
    actions: [],
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

function findLabel(arr: { value: string; label: string }[], value: string, custom?: string | null): string {
  if (value === 'outros' && custom) return custom;
  const found = arr.find(item => item.value === value);
  return found ? found.label : value;
}

export function buildCommercialSummaries(
  clients: GlobalClientPerformance[],
  workspaceClients: Client[],
  viewMode: ViewMode
): { summaries: CommercialSummary[]; pending: GlobalClientPerformance[]; pendingByClient: Map<string, string[]> } {
  const groups = new Map<string, CommercialSummary>();
  const pending: GlobalClientPerformance[] = [];
  const pendingByClient = new Map<string, string[]>();

  const getOrCreateGroup = (key: string, label: string) => {
    if (!groups.has(key)) groups.set(key, emptyCommercialSummary(key, label));
    return groups.get(key)!;
  };

  for (const client of clients) {
    const profile = effectiveClientProfile(client);
    const workspaceClient = workspaceClients.find((w) => w.id === client.clientId);
    const reasons = pendingReasons(client, profile, workspaceClient);
    const action = getClientAction(client, profile, workspaceClient);
    
    if (viewMode !== 'status' && reasons.length > 0) {
      pending.push(client);
      pendingByClient.set(client.clientId, reasons);
    }
    
    const vertical = profile?.vertical || workspaceClient?.category;
    if (viewMode !== 'status' && (!profile || !vertical || !profile.subsegment || !profile.primaryConversionMetric || !profile.plannedBudget)) {
      continue;
    }

    const mapKeys: { key: string; label: string }[] = [];

    if (viewMode === 'vertical') {
      const v = profile?.vertical ?? 'outros';
      mapKeys.push({ key: v, label: findLabel(analysisVerticals, v, profile?.customVertical) });
    } else if (viewMode === 'subsegment') {
      const s = profile?.subsegment ?? 'outros';
      // Find subsegment array for vertical
      const subArr = subsegmentsByVertical[profile?.vertical ?? 'outros'] || [];
      mapKeys.push({ key: s, label: findLabel(subArr, s, profile?.customSubsegment) });
    } else if (viewMode === 'primaryChannel') {
      const ch = profile?.primaryChannel ?? 'whatsapp';
      mapKeys.push({ key: ch, label: findLabel(primaryChannels, ch) });
    } else if (viewMode === 'salesModel') {
      const models = profile?.salesModels ?? [];
      if (models.length === 0) {
        mapKeys.push({ key: 'sem_modelo', label: 'Sem modelo de venda' });
      } else {
        for (const m of models) {
          mapKeys.push({ key: m, label: findLabel(salesModels, m) });
        }
      }
    } else if (viewMode === 'primaryConversionMetric') {
      const metric = profile?.primaryConversionMetric ?? 'conversa_iniciada';
      mapKeys.push({ key: metric, label: findLabel(primaryConversionMetrics, metric) });
    } else if (viewMode === 'status') {
      mapKeys.push({ key: action.title, label: action.title });
    }

    for (const { key, label } of mapKeys) {
      const summary = getOrCreateGroup(key, label);
      summary.clients.push(client);
      summary.actions.push(action);
      
      if (profile) {
        const subArr = subsegmentsByVertical[profile.vertical] || [];
        summary.subsegments.add(findLabel(subArr, profile.subsegment, profile.customSubsegment));
        summary.primaryMetrics.add(profile.primaryConversionMetric);
        
        const accountCurrencies = new Set(client.accounts.map((account) => account.currency || 'SEM_MOEDA'));
        const budgetCurrency = accountCurrencies.size === 1 ? Array.from(accountCurrencies)[0] : 'SEM_MOEDA';
        summary.plannedBudgetByCurrency.set(
          budgetCurrency,
          (summary.plannedBudgetByCurrency.get(budgetCurrency) || 0) + (profile.plannedBudget ?? 0)
        );
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
    }
  }

  return {
    summaries: Array.from(groups.values())
      .filter((summary) => summary.clients.length > 0)
      .sort((a, b) => b.critical - a.critical || b.attention - a.attention || b.clients.length - a.clients.length || a.label.localeCompare(b.label)),
    pending,
    pendingByClient,
  };
}

export function CommercialDecisionOverview({
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
  const [viewMode, setViewMode] = useState<ViewMode>('vertical');
  
  const { summaries, pending, pendingByClient } = buildCommercialSummaries(clients, workspaceClients, viewMode);
  const selectedSummary = summaries.find((summary) => summary.key === selectedSegment);
  
  // Total active counts calculation
  let activeCount = 0;
  if (selectedSegment === 'all') {
    activeCount = viewMode === 'salesModel' ? summaries.reduce((acc, curr) => acc + curr.clients.length, 0) : clients.length - (viewMode === 'status' ? 0 : pending.length);
  } else if (selectedSegment === '__pending__') {
    activeCount = pending.length;
  } else if (selectedSummary) {
    activeCount = selectedSummary.clients.length;
  }

  const selectSegment = (segment: string) => {
    onSelectSegment(segment);
    onSelectSubsegment('all');
  };

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    onSelectSegment('all');
    onSelectSubsegment('all');
  };

  return (
    <section className="rounded-2xl border border-brand-line bg-brand-surface p-4 lg:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-green">Central de Decisão Comercial</p>
          <h2 className="mt-1 text-xl font-black text-white">O que eu esperava, o que aconteceu e onde agir primeiro</h2>
          <p className="mt-1 text-sm text-brand-muted">Visão modular focada em direcionar ações comerciais e corrigir ofensores operacionais.</p>
        </div>
        <p className="rounded-full bg-white/5 px-3 py-1 text-xs font-bold text-brand-soft">{activeCount} cliente(s) no recorte</p>
      </div>

      <div className="mt-6 flex flex-wrap gap-2 border-b border-brand-line pb-4">
        <ViewModeTab mode="vertical" label="Por segmento" current={viewMode} onChange={handleViewModeChange} />
        <ViewModeTab mode="subsegment" label="Por subsegmento" current={viewMode} onChange={handleViewModeChange} />
        <ViewModeTab mode="primaryChannel" label="Por canal principal" current={viewMode} onChange={handleViewModeChange} />
        <ViewModeTab mode="salesModel" label="Por modelo de venda" current={viewMode} onChange={handleViewModeChange} />
        <ViewModeTab mode="primaryConversionMetric" label="Por conversão" current={viewMode} onChange={handleViewModeChange} />
        <ViewModeTab mode="status" label="Por status" current={viewMode} onChange={handleViewModeChange} />
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        <button data-testid="segment-filter-all" aria-pressed={selectedSegment === 'all'} type="button" onClick={() => selectSegment('all')} className={`shrink-0 rounded-full px-3 py-2 text-xs font-black ${selectedSegment === 'all' ? 'bg-brand-green text-brand-ink' : 'border border-brand-line text-brand-soft'}`}>Todos</button>
        {summaries.map((summary) => (
          <button data-testid={`segment-filter-${summary.key}`} aria-pressed={selectedSegment === summary.key} key={summary.key} type="button" onClick={() => selectSegment(summary.key)} className={`shrink-0 rounded-full px-3 py-2 text-xs font-black ${selectedSegment === summary.key ? 'bg-brand-green text-brand-ink' : 'border border-brand-line text-brand-soft'}`}>{summary.label}</button>
        ))}
        {viewMode !== 'status' && (
          <button data-testid="segment-filter-pending" aria-pressed={selectedSegment === '__pending__'} type="button" onClick={() => selectSegment('__pending__')} className={`shrink-0 rounded-full px-3 py-2 text-xs font-black ${selectedSegment === '__pending__' ? 'bg-amber-300 text-brand-ink' : 'border border-amber-300/40 text-amber-100'}`}>Configurações pendentes ({pending.length})</button>
        )}
      </div>

      {viewMode === 'salesModel' && (
        <div className="mt-3 text-xs text-brand-soft flex items-center gap-2">
          <CircleDashed size={14} className="text-brand-green" />
          Nesta visualização, um mesmo cliente pode aparecer em mais de um modelo de venda.
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(selectedSegment === 'all' ? summaries : summaries.filter(s => s.key === selectedSegment)).map((summary) => (
          <CommercialCard key={summary.key} summary={summary} />
        ))}
      </div>

      {pending.length > 0 && (selectedSegment === 'all' || selectedSegment === '__pending__') && viewMode !== 'status' && (
        <div className="mt-4 rounded-xl border border-amber-300/30 bg-amber-300/10 p-4">
          <p className="font-black text-amber-100">Configurações pendentes</p>
          <p className="mt-1 text-sm text-amber-100/80">Esses clientes não entram na leitura principal até terem dados obrigatórios preenchidos.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {pending.map((client) => <span key={client.clientId} title={(pendingByClient.get(client.clientId) || []).join(' · ')} className="rounded-lg bg-black/20 px-3 py-2 text-xs font-bold text-amber-50">{client.clientName}<span className="mt-1 block font-normal text-amber-100/70">{(pendingByClient.get(client.clientId) || []).join(' · ')}</span></span>)}
          </div>
        </div>
      )}
    </section>
  );
}

function ViewModeTab({ mode, label, current, onChange }: { mode: ViewMode; label: string; current: ViewMode; onChange: (mode: ViewMode) => void }) {
  const active = current === mode;
  return (
    <button
      type="button"
      onClick={() => onChange(mode)}
      className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${active ? 'bg-white/10 text-white' : 'text-brand-soft hover:bg-white/5 hover:text-white'}`}
    >
      {label}
    </button>
  );
}

function CommercialCard({ summary }: { summary: CommercialSummary }) {
  const [expanded, setExpanded] = useState(false);
  
  const mainMetric = summary.primaryMetrics.size === 0
    ? 'Sem KPI'
    : summary.primaryMetrics.size === 1
      ? metricLabels[Array.from(summary.primaryMetrics)[0]] || findLabel(primaryConversionMetrics, Array.from(summary.primaryMetrics)[0])
      : 'Múltiplos KPIs';
      
  const topAction = summary.actions.sort((a, b) => a.priority - b.priority)[0];

  return (
    <div className="rounded-xl border border-brand-line bg-brand-ink/50 p-4 text-left transition hover:border-brand-green/60 flex flex-col h-full">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-brand-green">{summary.label}</p>
          <h3 className="mt-1 font-black text-white">{summary.clients.length} cliente(s)</h3>
        </div>
        <Layers3 className="text-brand-green" size={18} />
      </div>
      <p className="mt-2 text-xs text-brand-muted">{Array.from(summary.subsegments).join(' · ')}</p>
      
      <div className="flex-1">
        <FinancialBreakdown summary={summary} />
        
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Metric label="KPI dominante" value={mainMetric} />
          <Metric label="Sem dados" value={String(summary.noData)} />
        </div>
        
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <Badge icon={<CheckCircle2 size={13} />} label="Saudável" value={summary.healthy} tone="green" />
          <Badge icon={<CircleDashed size={13} />} label="Atenção" value={summary.attention} tone="amber" />
          <Badge icon={<AlertTriangle size={13} />} label="Crítico" value={summary.critical} tone="rose" />
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-black/30 p-3">
        <div className="flex justify-between items-center cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <div>
            <p className="text-[10px] font-bold uppercase text-brand-green">Ação recomendada</p>
            <p className="mt-1 text-xs font-semibold text-white">{topAction ? topAction.title : 'Nenhuma ação necessária'}</p>
            <p className="text-[11px] text-brand-muted">{topAction ? topAction.description : 'Todos os clientes saudáveis'}</p>
          </div>
          {expanded ? <ChevronUp size={16} className="text-brand-soft" /> : <ChevronDown size={16} className="text-brand-soft" />}
        </div>
        
        {expanded && (
          <div className="mt-3 space-y-2 border-t border-brand-line/50 pt-3">
            {summary.actions.sort((a, b) => a.priority - b.priority).map((action, idx) => (
              <div key={`${action.clientId}-${idx}`}>
                <p className="text-xs font-bold text-white">{action.clientName}</p>
                <p className="text-[11px] text-brand-soft">{action.title}: {action.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FinancialBreakdown({ summary }: { summary: CommercialSummary }) {
  const currencies = Array.from(new Set([
    ...summary.plannedBudgetByCurrency.keys(),
    ...summary.spendByCurrency.keys(),
    ...summary.expectedSpendByCurrency.keys(),
    ...summary.projectedSpendByCurrency.keys(),
  ])).sort();
  if (currencies.length === 0) return <div className="mt-4 rounded-lg bg-black/20 p-3 text-xs text-brand-muted">Sem valores financeiros.</div>;
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
