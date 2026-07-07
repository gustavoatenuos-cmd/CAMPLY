import { AlertTriangle, CheckCircle2, CircleDashed, Layers3, ChevronDown, ChevronUp } from 'lucide-react';
import React, { useState } from 'react';
import type { Client } from '../../types';
import type { GlobalClientPerformance, MetricContract } from '../../lib/performance/globalPerformanceDashboard';
import { processClientStrategy } from '../../lib/strategy/strategyDecisionEngine';
import type { ClientDecisionState, MacroStatus, DataStatus } from '../../lib/strategy/strategyDecisionEngine';

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

interface ClientAction {
  priority: number;
  title: string;
  description: string;
  clientId: string;
  clientName: string;
}

function getActionForDecision(decision: ClientDecisionState, clientName: string): ClientAction {
  if (decision.decisionSignals.length > 0) {
    const sorted = [...decision.decisionSignals].sort((a, b) => {
      const p = { critical: 1, attention: 2, info: 3 };
      return p[a.severity] - p[b.severity];
    });
    const top = sorted[0];
    return {
      priority: top.severity === 'critical' ? 1 : top.severity === 'attention' ? 2 : 3,
      title: top.title,
      description: top.description,
      clientId: decision.clientId,
      clientName
    };
  }
  
  if (decision.macroStatus === 'saudavel') {
    return {
      priority: 8,
      title: 'Saudável',
      description: 'Estratégia operando dentro das metas esperadas.',
      clientId: decision.clientId,
      clientName
    };
  }

  return {
    priority: 9,
    title: 'Monitoramento',
    description: 'Acompanhamento de rotina.',
    clientId: decision.clientId,
    clientName
  };
}

export function effectiveClientProfile(client: GlobalClientPerformance) {
  return client.analysisProfile?.analysisEnabled ? client.analysisProfile : null;
}

export function clientSeverity(client: GlobalClientPerformance): 'healthy' | 'attention' | 'critical' | 'no_data' {
  const decision = processClientStrategy(client, client.analysisProfile || null);
  if (decision.macroStatus === 'saudavel') return 'healthy';
  if (decision.macroStatus === 'atencao') return 'attention';
  if (decision.macroStatus === 'critico') return 'critical';
  return 'no_data';
}

export type ViewMode = 'strategyType' | 'macroStatus' | 'dataStatus';

export interface StrategySummary {
  key: string;
  label: string;
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
  strategyTypes: Set<string>;
}

function emptyStrategySummary(key: string, label: string): StrategySummary {
  return {
    key,
    label,
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
    strategyTypes: new Set<string>(),
  };
}

const strategyTypeLabels: Record<string, string> = {
  venda_site: 'Venda no Site',
  leads_whatsapp: 'Leads no WhatsApp',
  leads_formulario: 'Leads em Formulário',
  distribuicao_conteudo: 'Distribuição de Conteúdo',
  desconhecida: 'Não Definida'
};

const macroStatusLabels: Record<MacroStatus, string> = {
  sem_dados: 'Sem Dados',
  indisponivel: 'Indisponível',
  atencao: 'Atenção',
  critico: 'Crítico',
  saudavel: 'Saudável'
};

const dataStatusLabels: Record<DataStatus, string> = {
  sem_conta: 'Sem Conta Conectada',
  sem_sync: 'Sem Sincronização',
  periodo_nao_sincronizado: 'Período não sincronizado',
  sync_com_falha_recente: 'Falha recente no Sync',
  dados_parciais: 'Dados Parciais/Atrasados',
  dados_disponiveis: 'Dados Disponíveis'
};

export function buildStrategySummaries(
  clients: GlobalClientPerformance[],
  workspaceClients: Client[],
  viewMode: ViewMode
): { summaries: StrategySummary[]; pending: GlobalClientPerformance[]; pendingByClient: Map<string, string[]> } {
  const groups = new Map<string, StrategySummary>();
  const pending: GlobalClientPerformance[] = [];
  const pendingByClient = new Map<string, string[]>();

  const getOrCreateGroup = (key: string, label: string) => {
    if (!groups.has(key)) groups.set(key, emptyStrategySummary(key, label));
    return groups.get(key)!;
  };

  for (const client of clients) {
    const decision = processClientStrategy(client, client.analysisProfile || null);
    const action = getActionForDecision(decision, client.clientName);

    const isPending = decision.macroStatus === 'sem_dados' || decision.macroStatus === 'indisponivel';
    if (viewMode !== 'macroStatus' && isPending) {
      pending.push(client);
      pendingByClient.set(client.clientId, decision.decisionSignals.map(s => s.title));
    }

    if (viewMode !== 'macroStatus' && isPending) {
      continue;
    }

    const mapKeys: { key: string; label: string }[] = [];

    if (viewMode === 'strategyType') {
      const k = decision.strategyType;
      mapKeys.push({ key: k, label: strategyTypeLabels[k] || k });
    } else if (viewMode === 'macroStatus') {
      const k = decision.macroStatus;
      mapKeys.push({ key: k, label: macroStatusLabels[k] || k });
    } else if (viewMode === 'dataStatus') {
      const k = decision.dataStatus;
      mapKeys.push({ key: k, label: dataStatusLabels[k] || k });
    }

    for (const { key, label } of mapKeys) {
      const summary = getOrCreateGroup(key, label);
      summary.clients.push(client);
      summary.actions.push(action);
      summary.strategyTypes.add(strategyTypeLabels[decision.strategyType] || decision.strategyType);

      if (client.analysisProfile) {
        const budgetCurrency = client.accounts[0]?.currency || 'BRL'; // Defaulting
        summary.plannedBudgetByCurrency.set(
          budgetCurrency,
          (summary.plannedBudgetByCurrency.get(budgetCurrency) || 0) + (client.analysisProfile.plannedBudget ?? 0)
        );
      }
      
      for (const account of client.accounts) {
        const spend = metricValue(account.metrics.spend);
        if (spend === null) continue;
        const currencyKey = account.currency || 'BRL';
        summary.spendByCurrency.set(currencyKey, (summary.spendByCurrency.get(currencyKey) || 0) + spend);
        if (account.budgetPacing) {
          summary.expectedSpendByCurrency.set(currencyKey, (summary.expectedSpendByCurrency.get(currencyKey) || 0) + account.budgetPacing.expectedSpendUntilNow);
          summary.projectedSpendByCurrency.set(currencyKey, (summary.projectedSpendByCurrency.get(currencyKey) || 0) + account.budgetPacing.projectedMonthlySpend);
        }
      }
      
      if (decision.macroStatus === 'saudavel') summary.healthy += 1;
      if (decision.macroStatus === 'atencao') summary.attention += 1;
      if (decision.macroStatus === 'critico') summary.critical += 1;
      if (decision.macroStatus === 'sem_dados' || decision.macroStatus === 'indisponivel') summary.noData += 1;
      summary.pendingActions += decision.decisionSignals.filter(s => s.severity !== 'info').length;
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
  const [viewMode, setViewMode] = useState<ViewMode>('strategyType');
  
  const { summaries, pending, pendingByClient } = buildStrategySummaries(clients, workspaceClients, viewMode);
  const selectedSummary = summaries.find((summary) => summary.key === selectedSegment);
  
  let activeCount = 0;
  if (selectedSegment === 'all') {
    activeCount = clients.length - (viewMode === 'macroStatus' ? 0 : pending.length);
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
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-green">Central de Decisão Estratégica</p>
          <h2 className="mt-1 text-xl font-black text-white">Estratégias, Alertas e Decisões</h2>
          <p className="mt-1 text-sm text-brand-muted">Visão modular focada em corrigir desvios da estratégia operacional e da meta do cliente.</p>
        </div>
        <p className="rounded-full bg-white/5 px-3 py-1 text-xs font-bold text-brand-soft">{activeCount} cliente(s) no recorte</p>
      </div>

      <div className="mt-6 flex flex-wrap gap-2 border-b border-brand-line pb-4">
        <ViewModeTab mode="strategyType" label="Por Estratégia" current={viewMode} onChange={handleViewModeChange} />
        <ViewModeTab mode="macroStatus" label="Por Status de Performance" current={viewMode} onChange={handleViewModeChange} />
        <ViewModeTab mode="dataStatus" label="Por Qualidade de Dados" current={viewMode} onChange={handleViewModeChange} />
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        <button data-testid="segment-filter-all" aria-pressed={selectedSegment === 'all'} type="button" onClick={() => selectSegment('all')} className={`shrink-0 rounded-full px-3 py-2 text-xs font-black ${selectedSegment === 'all' ? 'bg-brand-green text-brand-ink' : 'border border-brand-line text-brand-soft'}`}>Todos</button>
        {summaries.map((summary) => (
          <button data-testid={`segment-filter-${summary.key}`} aria-pressed={selectedSegment === summary.key} key={summary.key} type="button" onClick={() => selectSegment(summary.key)} className={`shrink-0 rounded-full px-3 py-2 text-xs font-black ${selectedSegment === summary.key ? 'bg-brand-green text-brand-ink' : 'border border-brand-line text-brand-soft'}`}>{summary.label}</button>
        ))}
        {viewMode !== 'macroStatus' && (
          <button data-testid="segment-filter-pending" aria-pressed={selectedSegment === '__pending__'} type="button" onClick={() => selectSegment('__pending__')} className={`shrink-0 rounded-full px-3 py-2 text-xs font-black ${selectedSegment === '__pending__' ? 'bg-amber-300 text-brand-ink' : 'border border-amber-300/40 text-amber-100'}`}>Configurações / Dados Pendentes ({pending.length})</button>
        )}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(selectedSegment === 'all' ? summaries : summaries.filter(s => s.key === selectedSegment)).map((summary) => (
          <CommercialCard key={summary.key} summary={summary} />
        ))}
      </div>

      {pending.length > 0 && (selectedSegment === 'all' || selectedSegment === '__pending__') && viewMode !== 'macroStatus' && (
        <div className="mt-4 rounded-xl border border-amber-300/30 bg-amber-300/10 p-4">
          <p className="font-black text-amber-100">Contas Indisponíveis ou Sem Dados</p>
          <p className="mt-1 text-sm text-amber-100/80">Esses clientes não entram na leitura principal devido a falta de perfil estratégico ou dados inacessíveis.</p>
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

function CommercialCard({ summary }: { summary: StrategySummary }) {
  const [expanded, setExpanded] = useState(false);
      
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
      <p className="mt-2 text-xs text-brand-muted">{Array.from(summary.strategyTypes).join(' · ')}</p>
      
      <div className="flex-1">
        <FinancialBreakdown summary={summary} />
        
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Metric label="Estratégias Únicas" value={String(summary.strategyTypes.size)} />
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

function FinancialBreakdown({ summary }: { summary: StrategySummary }) {
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
            <p className="text-[10px] font-bold uppercase tracking-wider text-brand-green">{code || 'BRL'}</p>
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
