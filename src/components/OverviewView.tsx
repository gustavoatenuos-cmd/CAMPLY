import {
  AlertTriangle,
  Banknote,
  BriefcaseBusiness,
  CheckSquare2,
  CircleGauge,
  Megaphone,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CamplyData, Insight, ViewId } from '../types';
import {
  loadGlobalPerformanceDashboard,
  type GlobalClientPerformance,
} from '../lib/performance/globalPerformanceDashboard';
import { motion } from 'framer-motion';
import {
  compatibilityReasonMessage,
  loadAnalyticsCapabilities,
  type AnalyticsCapabilityState,
  type DashboardPeriod,
} from '../lib/performance/analyticsCapabilities';
import type { PerformanceEvaluation, PerformanceStatus } from '../lib/performance/types';
import { GlobalSummaryCards } from './performance/GlobalSummaryCards';
import { ClientPerformanceTable } from './performance/ClientPerformanceTable';
import { PerformanceStatusBadge } from './performance/PerformanceStatusBadge';
import { CommercialDecisionOverview, buildCommercialSummaries, clientSeverity, effectiveClientProfile } from './performance/CommercialDecisionOverview';
import { ExecutiveSummary } from './performance/ExecutiveSummary';
import { CollapsibleSection } from './ui/CollapsibleSection';
import { MetaOperationalWorkspace } from './meta/MetaOperationalWorkspace';
import { isMetaE2EMode } from '../lib/meta/metaE2ERuntime';
import { metricLabels } from '../lib/analysis/clientAnalysisProfile';


interface OverviewViewProps {
  data: CamplyData;
  insights: Insight[];
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
  setActiveView: (view: ViewId) => void;
}

const periodLabels: Record<DashboardPeriod, string> = {
  today: 'Hoje',
  yesterday: 'Ontem',
  today_and_yesterday: 'Hoje e ontem',
  last_7d: 'Últimos 7 dias',
  last_30d: 'Últimos 30 dias',
  last_90d: 'Últimos 90 dias',
};

const evaluationSeverity: Record<PerformanceStatus, number> = {
  critical: 6,
  attention: 5,
  partial_data: 4,
  insufficient_data: 3,
  unavailable: 2,
  on_track: 1,
};

type DecisionFilter = 'all' | 'healthy' | 'attention' | 'critical' | 'no_data';

interface StoredDashboardFilters {
  period?: DashboardPeriod;
  search?: string;
  decision?: DecisionFilter;
  segment?: string;
  subsegment?: string;
}

const DASHBOARD_FILTERS_KEY = 'camply:performance-dashboard-filters';

function loadStoredFilters(): StoredDashboardFilters {
  try {
    const stored = window.sessionStorage.getItem(DASHBOARD_FILTERS_KEY);
    return stored ? JSON.parse(stored) as StoredDashboardFilters : {};
  } catch {
    return {};
  }
}

function formatCurrency(value: number, currency = 'BRL'): string {
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  }
}

function exactRangeLabel(clients: GlobalClientPerformance[]): string {
  const ranges = new Set(clients.flatMap((client) => client.accounts
    .filter((account) => account.dateStart && account.dateStop)
    .map((account) => `${account.dateStart} a ${account.dateStop} (${account.timezone || 'fuso indisponível'})`)));
  if (ranges.size === 0) return 'Período não sincronizado';
  return Array.from(ranges).join(' · ');
}

function metricLabel(metricId: string): string {
  const labels: Record<string, string> = {
    whatsapp_conversations_started: 'conversas no WhatsApp',
    messaging_conversations_started_total: 'conversas',
    messenger_conversations_started: 'conversas no Messenger',
    instagram_direct_conversations_started: 'conversas no Instagram',
    leads: 'leads',
    purchases: 'compras',
    cost_per_messaging_conversation: 'custo por conversa',
    cost_per_lead: 'custo por lead',
    cost_per_purchase: 'custo por compra',
    cpm: 'CPM',
    link_ctr: 'CTR de link',
    frequency: 'frequência',
    purchase_roas: 'ROAS',
    landing_page_views: 'visitas à página',
  };
  return metricLabels[metricId] || labels[metricId] || metricId.split('_').join(' ');
}

function formatMetricValue(metricId: string, value: number | null, currency = 'BRL'): string {
  if (value === null) return 'sem valor confiável';
  if (
    metricId === 'spend'
    || metricId === 'cpm'
    || metricId.startsWith('cost_per_')
    || metricId === 'link_cpc'
    || metricId === 'cpa'
    || metricId === 'purchase_value'
  ) {
    return formatCurrency(value, currency);
  }
  if (metricId.includes('ctr')) {
    return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  }
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function expectationText(evaluation: PerformanceEvaluation, currency: string): string {
  if (evaluation.targetKind === 'target_range' && evaluation.targetMin != null && evaluation.targetMax != null) {
    return `entre ${formatMetricValue(evaluation.metricId, evaluation.targetMin, currency)} e ${formatMetricValue(evaluation.metricId, evaluation.targetMax, currency)}`;
  }
  if (['maximum_metric', 'cost_per_result'].includes(evaluation.targetKind)) {
    return `até ${formatMetricValue(evaluation.metricId, evaluation.targetValue, currency)}`;
  }
  if (['minimum_metric', 'minimum_results'].includes(evaluation.targetKind)) {
    return `mínimo ${formatMetricValue(evaluation.metricId, evaluation.targetValue, currency)}`;
  }
  return formatMetricValue(evaluation.metricId, evaluation.targetValue, currency);
}

function statusEvidence(evaluation: PerformanceEvaluation): string {
  if (evaluation.status === 'partial_data') return 'A leitura ainda está parcial; sincronize de novo antes de decidir.';
  if (evaluation.actualValue === null) return 'Ainda não há valor confiável para esta métrica.';
  if (evaluation.differencePercent === null) return 'Meta e realizado foram comparados, mas sem diferença percentual confiável.';
  const abs = Math.abs(evaluation.differencePercent).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  if (evaluation.status === 'critical') return `Desvio crítico de ${abs}% em relação ao esperado.`;
  if (evaluation.status === 'attention') return `Desvio de atenção de ${abs}% em relação ao esperado.`;
  return 'Dentro da expectativa configurada.';
}

function evaluationDescription(client: GlobalClientPerformance, evaluation: PerformanceEvaluation): string {
  const account = client.accounts.find((item) => item.clientMetaAssetId === evaluation.clientMetaAssetId);
  const scope = evaluation.campaignId ? 'Campanha' : 'Conta';
  const currencyCode = account?.currency || 'BRL';
  const actual = formatMetricValue(evaluation.metricId, evaluation.actualValue, currencyCode);
  const target = expectationText(evaluation, currencyCode);
  return `${scope}: ${metricLabel(evaluation.metricId)} realizado em ${actual}; esperado ${target}. ${statusEvidence(evaluation)}`;
}

function recommendationFor(evaluation: PerformanceEvaluation): string {
  if (evaluation.status === 'partial_data') return 'Conclua uma sincronização completa antes de otimizar.';
  if (evaluation.metricId === 'link_ctr') return 'Revise criativo, oferta e aderência da mensagem ao público.';
  if (evaluation.metricId === 'cpm') return 'Revise público, posicionamentos e pressão do leilão.';
  if (evaluation.metricId === 'frequency') return 'Renove criativos ou amplie o público para controlar a frequência.';
  if (evaluation.metricId.startsWith('cost_per_')) return 'Abra campanhas e conjuntos com maior consumo e revise criativo, público e conversão.';
  if (evaluation.metricId === 'purchase_roas') return 'Revise valor de compra, custo de aquisição e campanhas que concentram o investimento.';
  return 'Abra a conta e identifique a campanha responsável pelo maior desvio antes de alterar orçamento.';
}

function financialImpact(client: GlobalClientPerformance, evaluation: PerformanceEvaluation): number {
  const account = client.accounts.find((item) => item.clientMetaAssetId === evaluation.clientMetaAssetId);
  const spend = account?.metrics.spend;
  return spend?.available && typeof spend.value === 'number' ? spend.value : 0;
}

function targetAge(evaluation: PerformanceEvaluation): number {
  if (!evaluation.effectiveFrom) return 0;
  const value = new Date(evaluation.effectiveFrom).getTime();
  return Number.isFinite(value) ? Date.now() - value : 0;
}

function DashboardUnavailable({
  message,
  retrying,
  onRetry,
}: {
  message: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="grid h-full place-items-center bg-brand-ink p-6">
      <div className="max-w-xl rounded-2xl border border-amber-400/30 bg-amber-400/10 p-6 text-amber-100">
        <h1 className="text-xl font-black text-white">Dashboard indisponível</h1>
        <p className="mt-2 text-sm leading-6">{message}</p>
        <p className="mt-2 text-sm leading-6">As métricas do workspace e do armazenamento local não serão usadas como substituição.</p>
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mt-4 inline-flex items-center gap-1 rounded-lg border border-amber-300/30 px-3 py-2 font-bold text-amber-100 transition hover:bg-amber-300/10 disabled:cursor-wait disabled:opacity-60"
        >
          <RefreshCw size={13} className={retrying ? 'animate-spin' : ''} /> Verificar novamente
        </button>
      </div>
    </div>
  );
}

export function OverviewView({ data, setActiveView }: OverviewViewProps) {
  const storedFilters = useMemo(loadStoredFilters, []);
  const [period, setPeriod] = useState<DashboardPeriod>(storedFilters.period || 'last_90d');
  const [clients, setClients] = useState<GlobalClientPerformance[]>([]);
  const [loading, setLoading] = useState(false);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(true);
  const [capabilityState, setCapabilityState] = useState<AnalyticsCapabilityState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [search, setSearch] = useState(storedFilters.search || '');
  const [statusFilter, setStatusFilter] = useState<DecisionFilter>(storedFilters.decision || 'all');
  const [segmentFilter, setSegmentFilter] = useState(storedFilters.segment || 'all');
  const [subsegmentFilter, setSubsegmentFilter] = useState(storedFilters.subsegment || 'all');

  useEffect(() => {
    window.sessionStorage.setItem(DASHBOARD_FILTERS_KEY, JSON.stringify({
      period,
      search,
      decision: statusFilter,
      segment: segmentFilter,
      subsegment: subsegmentFilter,
    } satisfies StoredDashboardFilters));
  }, [period, search, segmentFilter, statusFilter, subsegmentFilter]);

  const loadCapabilities = useCallback(async () => {
    setCapabilitiesLoading(true);
    const state = await loadAnalyticsCapabilities();
    setCapabilityState(state);
    if (state.mode === 'analytics') {
      setPeriod((currentPeriod) => (
        state.capabilities.supportedPeriods.includes(currentPeriod)
          ? currentPeriod
          : state.capabilities.supportedPeriods[0]
      ));
    }
    setCapabilitiesLoading(false);
  }, []);

  useEffect(() => {
    void loadCapabilities();
  }, [loadCapabilities]);

  const capabilities = capabilityState?.mode === 'analytics' ? capabilityState.capabilities : null;



  const loadDashboard = useCallback(async () => {
    if (!capabilities) return;
    setLoading(true);
    setError(null);
    try {
      const result = await loadGlobalPerformanceDashboard({
        period,
        dashboardRpc: capabilities.dashboardRpc,
      });
      
      const enrichedResult = result.map(c => {
        const workspaceClient = data.clients.find(w => w.id === c.clientId);
        return workspaceClient 
          ? { ...c, clientName: workspaceClient.company || workspaceClient.name || c.clientName }
          : c;
      });
      
      setClients(enrichedResult);
      setLastLoadedAt(new Date());
    } catch {
      setError('dashboard_unavailable');
    } finally {
      setLoading(false);
    }
  }, [capabilities, period, data.clients]);

  useEffect(() => {
    if (capabilities) void loadDashboard();
  }, [capabilities, loadDashboard]);

  const filteredClients = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
    const { summaries, pending } = buildCommercialSummaries(clients, data.clients, 'vertical');
    const selectedSummary = summaries.find((summary) => summary.key === segmentFilter);
    const segmentClientIds = segmentFilter === 'all'
      ? null
      : segmentFilter === '__pending__'
        ? new Set(pending.map((client) => client.clientId))
        : subsegmentFilter !== 'all'
          ? new Set((selectedSummary?.clients || []).filter(c => effectiveClientProfile(c)?.subsegment === subsegmentFilter).map((client) => client.clientId))
          : new Set((selectedSummary?.clients || []).map((client) => client.clientId));
    return clients.filter((client) => {
      if (segmentClientIds && !segmentClientIds.has(client.clientId)) return false;
      if (statusFilter !== 'all' && clientSeverity(client) !== statusFilter) return false;
      if (!normalizedSearch) return true;
      return client.clientName.toLocaleLowerCase('pt-BR').includes(normalizedSearch)
        || client.accounts.some((account) => account.accountName.toLocaleLowerCase('pt-BR').includes(normalizedSearch));
    });
  }, [clients, data.clients, search, segmentFilter, statusFilter, subsegmentFilter]);

  // Ordena a central por gravidade (críticos primeiro) e, dentro do mesmo
  // nível, por investimento — quem gasta mais aparece antes.
  const severityOrder: Record<ReturnType<typeof clientSeverity>, number> = { critical: 0, attention: 1, healthy: 2, no_data: 3 };
  const sortedClients = useMemo(() => [...filteredClients].sort((a, b) => {
    const bySeverity = severityOrder[clientSeverity(a)] - severityOrder[clientSeverity(b)];
    if (bySeverity !== 0) return bySeverity;
    const spendOf = (client: GlobalClientPerformance) => client.accounts.reduce((total, account) => {
      const metric = account.metrics.spend;
      return total + (metric?.available && typeof metric.value === 'number' ? metric.value : 0);
    }, 0);
    return spendOf(b) - spendOf(a);
  }), [filteredClients]);

  const priorities = useMemo(() => filteredClients
    .flatMap((client) => client.evaluations.map((evaluation) => ({ client, evaluation })))
    .filter(({ evaluation }) => ['critical', 'attention', 'partial_data'].includes(evaluation.status))
    .sort((a, b) => evaluationSeverity[b.evaluation.status] - evaluationSeverity[a.evaluation.status]
      || b.evaluation.confidence - a.evaluation.confidence
      || (b.evaluation.priorityWeight ?? 1) - (a.evaluation.priorityWeight ?? 1)
      || financialImpact(b.client, b.evaluation) - financialImpact(a.client, a.evaluation)
      || targetAge(b.evaluation) - targetAge(a.evaluation))
    .slice(0, 6), [filteredClients]);

  const activeCampaigns = data.campaigns.filter((campaign) => ['launching', 'live', 'optimize'].includes(campaign.status)).length;
  const openTasks = data.tasks.filter((task) => !task.done).length;
  const openProjects = data.projects.filter((project) => project.status !== 'done').length;
  const activeClients = data.clients.filter((client) => client.status === 'active').length;
  const pendingReceivables = data.receivables
    .filter((receivable) => receivable.status !== 'paid')
    .reduce((total, receivable) => total + receivable.amount, 0);
  const activeAlerts = data.agentAlerts.filter((alert) => alert.status === 'active').length;

  if (capabilitiesLoading || !capabilityState) {
    return (
      <div className="grid h-full place-items-center bg-brand-ink text-brand-muted">
        <div className="text-center">
          <RefreshCw className="mx-auto animate-spin text-brand-green" size={26} />
          <p className="mt-3">Verificando o contrato analítico seguro...</p>
        </div>
      </div>
    );
  }

  if (capabilityState.mode === 'compatibility') {
    return (
      <DashboardUnavailable
        message={compatibilityReasonMessage(capabilityState.reason)}
        retrying={capabilitiesLoading}
        onRetry={() => void loadCapabilities()}
      />
    );
  }

  if (error && clients.length === 0 && !loading) {
    return (
      <DashboardUnavailable
        message="A capacidade foi confirmada, mas o dashboard analítico ficou temporariamente indisponível."
        retrying={loading}
        onRetry={() => void loadDashboard()}
      />
    );
  }

  return (
    <motion.section 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="h-full overflow-y-auto bg-brand-ink px-4 py-5 sm:px-5 lg:px-8 lg:py-8"
    >
      <div className="mx-auto max-w-[1700px] space-y-6">
        <header className="glass-card rounded-2xl p-5 lg:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-brand-green">
                <CircleGauge size={18} />
                <p className="text-xs font-bold uppercase tracking-[0.2em]">Dashboard</p>
              </div>
              <h1 className="mt-3 text-3xl font-black text-white lg:text-4xl">Performance real da operação.</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-brand-muted">
                Clientes, contas, campanhas, metas e qualidade dos dados em uma leitura única. Os números desta área vêm do banco analítico e não usam o fallback antigo do workspace.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="relative min-w-[230px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" size={16} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  aria-label="Buscar cliente ou conta"
                  placeholder="Buscar cliente ou conta"
                  className="w-full rounded-xl border border-brand-line bg-brand-ink py-2.5 pl-9 pr-3 text-sm text-white outline-none transition placeholder:text-brand-muted focus:border-brand-green"
                />
              </label>
              <select
                aria-label="Período do Dashboard"
                value={period}
                onChange={(event) => setPeriod(event.target.value as DashboardPeriod)}
                className="rounded-xl border border-brand-line bg-brand-ink px-3 py-2.5 text-sm text-white outline-none focus:border-brand-green"
              >
                {capabilityState.capabilities.supportedPeriods.map((value) => (
                  <option key={value} value={value}>{periodLabels[value]}</option>
                ))}
              </select>
                <button
                  type="button"
                  onClick={() => void loadDashboard()}
                  disabled={loading}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-green px-4 py-2.5 text-sm font-black text-brand-ink transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
                >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                Atualizar Dashboard
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-brand-line pt-4 text-xs text-brand-muted">
            <span>Período: <strong className="text-white">{periodLabels[period]}</strong></span>
            <span>•</span>
            <span>Intervalo exato: <strong className="text-white">{exactRangeLabel(filteredClients)}</strong></span>
            <span>•</span>
            <span>Cobertura: <strong className="text-emerald-300">Dados carregados a partir da sincronização dos últimos 90 dias</strong></span>
            <span>•</span>
            <span>Carregado: <strong className="text-white">{lastLoadedAt ? lastLoadedAt.toLocaleString('pt-BR') : 'aguardando'}</strong></span>
            <span>•</span>
            <span>Clientes exibidos: <strong className="text-white">{filteredClients.length}</strong> de <strong className="text-white">{clients.length}</strong></span>
          </div>
        </header>

        {error && (
          <div role="alert" className="rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">
            <strong>Falha ao atualizar os dados analíticos.</strong> Os últimos dados confiáveis continuam visíveis. Tente novamente antes de tomar uma decisão.
          </div>
        )}

        {loading && clients.length === 0 ? (
          <div className="grid min-h-[320px] place-items-center rounded-2xl border border-brand-line bg-brand-surface text-brand-muted">
            <div className="text-center">
              <RefreshCw className="mx-auto animate-spin text-brand-green" size={28} />
              <p className="mt-3">Carregando contas, métricas e metas...</p>
            </div>
          </div>
        ) : (
          <>
            <ExecutiveSummary
              clients={clients}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
            />

            <ClientPerformanceTable clients={sortedClients} period={period} />

            <CollapsibleSection
              title="Análise comercial por segmento"
              subtitle="Decisão comercial por vertical e subsegmento — a seleção também filtra a central acima."
              defaultOpen={isMetaE2EMode || segmentFilter !== 'all'}
            >
              <CommercialDecisionOverview
                clients={clients}
                workspaceClients={data.clients}
                selectedSegment={segmentFilter}
                selectedSubsegment={subsegmentFilter}
                onSelectSegment={setSegmentFilter}
                onSelectSubsegment={setSubsegmentFilter}
              />
            </CollapsibleSection>

            <CollapsibleSection
              title="Métricas detalhadas do recorte"
              subtitle="CPM, ROAS, frequência, alcance, qualidade da sincronização e sinais priorizados."
              defaultOpen={isMetaE2EMode}
            >
              <GlobalSummaryCards clients={filteredClients} />
            </CollapsibleSection>

            <CollapsibleSection
              title="Workspace Meta"
              subtitle="Sincronização das contas, metas e reconciliação de métricas."
              defaultOpen={isMetaE2EMode}
            >
              <MetaOperationalWorkspace
                data={data}
                compact
                period={period}
                onPeriodChange={setPeriod}
                onDataChanged={() => void loadDashboard()}
              />
            </CollapsibleSection>

            <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
              <article className="glass-card rounded-2xl p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-brand-green">Desvios de metas</p>
                    <h2 className="mt-1 text-xl font-black text-white">Comparações que sustentam as decisões</h2>
                  </div>
                  <AlertTriangle className="text-brand-green drop-shadow-[0_0_8px_rgba(0,229,153,0.8)]" size={22} />
                </div>
                <div className="mt-4 space-y-3">
                  {priorities.length > 0 ? priorities.map(({ client, evaluation }, index) => (
                    <motion.div 
                      whileHover={{ scale: 1.01 }}
                      key={`${client.clientId}:${evaluation.clientMetaAssetId}:${evaluation.campaignId || 'account'}:${evaluation.metricId}:${index}`} 
                      className="rounded-xl border border-white/[0.03] bg-brand-surface2/40 p-4 transition-colors hover:border-brand-green/20"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="font-bold text-white">{index + 1}. {client.clientName}</p>
                          <p className="mt-1 text-xs font-bold uppercase tracking-wider text-brand-green">{client.analysisProfile?.customVertical || client.analysisProfile?.vertical || 'Segmento não configurado'} · {metricLabel(evaluation.metricId)}</p>
                          <p className="mt-1 text-sm text-brand-muted">{evaluationDescription(client, evaluation)}</p>
                          <p className="mt-2 text-xs text-brand-soft">
                            Confiança: {evaluation.confidence.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% · Investigar {evaluation.campaignId ? 'a campanha e seus conjuntos' : 'a conta e as campanhas responsáveis'}.
                          </p>
                          <p className="mt-2 text-sm font-semibold text-white">Ação recomendada: <span className="text-brand-green drop-shadow-[0_0_4px_rgba(0,229,153,0.3)]">{recommendationFor(evaluation)}</span></p>
                        </div>
                        <PerformanceStatusBadge status={evaluation.status} />
                      </div>
                    </motion.div>
                  )) : (
                    <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-brand-muted">
                      Nenhuma prioridade conclusiva para o período. Clientes sem dados continuam visíveis na tabela.
                    </div>
                  )}
                </div>
              </article>

              <article className="glass-card rounded-2xl p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-green">Operação de hoje</p>
                <h2 className="mt-1 text-xl font-black text-white">Visibilidade rápida do sistema</h2>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <QuickMetric icon={Users} label="Clientes ativos" value={activeClients} onClick={() => setActiveView('clients')} />
                  <QuickMetric icon={Megaphone} label="Campanhas ativas" value={activeCampaigns} onClick={() => setActiveView('campaigns')} />
                  <QuickMetric icon={CheckSquare2} label="Tarefas abertas" value={openTasks} onClick={() => setActiveView('projects')} />
                  <QuickMetric icon={BriefcaseBusiness} label="Projetos abertos" value={openProjects} onClick={() => setActiveView('projects')} />
                  <QuickMetric icon={AlertTriangle} label="Alertas ativos" value={activeAlerts} onClick={() => setActiveView('intelligence')} />
                  <QuickMetric icon={Banknote} label="A receber" value={formatCurrency(pendingReceivables)} onClick={() => setActiveView('personalFinance')} />
                </div>
              </article>
            </div>
          </>
        )}
      </div>
    </motion.section>
  );
}

function QuickMetric({ icon: Icon, label, value, onClick }: { icon: any; label: string; value: number | string; onClick: () => void }) {
  return (
    <motion.button
      whileHover={{ scale: 1.03, y: -2 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className="flex flex-col items-start gap-2 rounded-xl border border-white/[0.04] bg-brand-surface2/30 p-3 text-left transition hover:border-brand-green/30 hover:shadow-[0_0_15px_rgba(0,229,153,0.1)]"
    >
      <div className="flex w-full items-center justify-between">
        <Icon size={16} className="text-brand-green drop-shadow-[0_0_4px_rgba(0,229,153,0.6)]" />
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-wider text-brand-muted">{label}</p>
        <p className="mt-0.5 text-lg font-bold text-white drop-shadow-md">{value}</p>
      </div>
    </motion.button>
  );
}
