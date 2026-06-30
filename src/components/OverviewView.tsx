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
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CamplyData, Insight, ViewId } from '../types';
import {
  loadGlobalPerformanceDashboard,
  type DashboardPeriod,
  type GlobalClientPerformance,
} from '../lib/performance/globalPerformanceDashboard';
import type { PerformanceEvaluation, PerformanceStatus } from '../lib/performance/types';
import { GlobalSummaryCards } from './performance/GlobalSummaryCards';
import { ClientPerformanceTable } from './performance/ClientPerformanceTable';
import { PerformanceStatusBadge } from './performance/PerformanceStatusBadge';
import { TodayView } from './TodayView';

interface OverviewViewProps {
  data: CamplyData;
  insights: Insight[];
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
  setActiveView: (view: ViewId) => void;
}

const periodLabels: Record<DashboardPeriod, string> = {
  today: 'Hoje',
  last_7d: 'Últimos 7 dias',
  last_30d: 'Últimos 30 dias',
};

const statusLabels: Record<GlobalClientPerformance['clientStatus'], string> = {
  not_connected: 'Conta não conectada',
  never_synced: 'Nunca sincronizado',
  syncing: 'Sincronizando',
  no_delivery: 'Sem entrega',
  available: 'Atualizado',
  stale: 'Desatualizado',
  partial: 'Parcial',
  failed: 'Falhou',
};

const evaluationSeverity: Record<PerformanceStatus, number> = {
  critical: 6,
  attention: 5,
  partial_data: 4,
  insufficient_data: 3,
  unavailable: 2,
  on_track: 1,
};

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

function metricLabel(metricId: string): string {
  const labels: Record<string, string> = {
    whatsapp_conversations_started: 'conversas no WhatsApp',
    messaging_conversations_started_total: 'conversas',
    messenger_conversations_started: 'conversas no Messenger',
    instagram_direct_conversations_started: 'conversas no Instagram',
    leads: 'leads',
    purchases: 'compras',
    landing_page_views: 'visitas à página',
  };
  return labels[metricId] || metricId.split('_').join(' ');
}

function evaluationDescription(client: GlobalClientPerformance, evaluation: PerformanceEvaluation): string {
  const account = client.accounts.find((item) => item.clientMetaAssetId === evaluation.clientMetaAssetId);
  const scope = evaluation.campaignId ? 'Campanha' : 'Conta';
  const actual = evaluation.actualValue === null ? 'sem valor confiável' : formatCurrency(evaluation.actualValue, account?.currency || 'BRL');
  const target = formatCurrency(evaluation.targetValue, account?.currency || 'BRL');
  return `${scope}: ${metricLabel(evaluation.metricId)} em ${actual}; meta ${target}.`;
}

function isMissingAnalyticsSchema(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('could not find the function')
    || normalized.includes('get_global_performance_dashboard')
    || normalized.includes('schema cache')
    || normalized.includes('pgrst202');
}

export function OverviewView({ data, insights, updateData, setActiveView }: OverviewViewProps) {
  const [period, setPeriod] = useState<DashboardPeriod>('last_7d');
  const [clients, setClients] = useState<GlobalClientPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | GlobalClientPerformance['clientStatus']>('all');

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadGlobalPerformanceDashboard({ period });
      setClients(result);
      setLastLoadedAt(new Date());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a visão geral.');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const filteredClients = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
    return clients.filter((client) => {
      if (statusFilter !== 'all' && client.clientStatus !== statusFilter) return false;
      if (!normalizedSearch) return true;
      return client.clientName.toLocaleLowerCase('pt-BR').includes(normalizedSearch)
        || client.accounts.some((account) => account.accountName.toLocaleLowerCase('pt-BR').includes(normalizedSearch));
    });
  }, [clients, search, statusFilter]);

  const priorities = useMemo(() => clients
    .flatMap((client) => client.evaluations.map((evaluation) => ({ client, evaluation })))
    .filter(({ evaluation }) => ['critical', 'attention', 'partial_data'].includes(evaluation.status))
    .sort((a, b) => evaluationSeverity[b.evaluation.status] - evaluationSeverity[a.evaluation.status])
    .slice(0, 6), [clients]);

  const activeCampaigns = data.campaigns.filter((campaign) => ['launching', 'live', 'optimize'].includes(campaign.status)).length;
  const openTasks = data.tasks.filter((task) => !task.done).length;
  const openProjects = data.projects.filter((project) => project.status !== 'done').length;
  const activeClients = data.clients.filter((client) => client.status === 'active').length;
  const pendingReceivables = data.receivables
    .filter((receivable) => receivable.status !== 'paid')
    .reduce((total, receivable) => total + receivable.amount, 0);
  const activeAlerts = data.agentAlerts.filter((alert) => alert.status === 'active').length;

  if (error && clients.length === 0 && !loading) {
    const missingSchema = isMissingAnalyticsSchema(error);
    return (
      <div className="h-full overflow-y-auto bg-brand-ink">
        <div className="border-b border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100 sm:px-6 lg:px-8">
          <strong>{missingSchema ? 'A nova Visão geral ainda não está ativa no banco.' : 'A nova Visão geral ficou temporariamente indisponível.'}</strong>{' '}
          Para não interromper o sistema, a visão anterior foi restaurada automaticamente. Nenhuma métrica nova será exibida como confiável até a estrutura analítica estar disponível.
          <button
            type="button"
            onClick={() => void loadDashboard()}
            className="ml-3 inline-flex items-center gap-1 rounded-lg border border-amber-300/30 px-2.5 py-1 font-bold text-amber-100 transition hover:bg-amber-300/10"
          >
            <RefreshCw size={13} /> Tentar novamente
          </button>
        </div>
        <TodayView
          data={data}
          insights={insights}
          updateData={updateData}
          setActiveView={setActiveView}
        />
      </div>
    );
  }

  return (
    <section className="h-full overflow-y-auto bg-brand-ink px-4 py-5 sm:px-5 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-[1700px] space-y-6">
        <header className="rounded-2xl border border-brand-line bg-brand-surface p-5 shadow-brand lg:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-brand-green">
                <CircleGauge size={18} />
                <p className="text-xs font-bold uppercase tracking-[0.2em]">Visão geral</p>
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
                  placeholder="Buscar cliente ou conta"
                  className="w-full rounded-xl border border-brand-line bg-brand-ink py-2.5 pl-9 pr-3 text-sm text-white outline-none transition placeholder:text-brand-muted focus:border-brand-green"
                />
              </label>
              <select
                value={period}
                onChange={(event) => setPeriod(event.target.value as DashboardPeriod)}
                className="rounded-xl border border-brand-line bg-brand-ink px-3 py-2.5 text-sm text-white outline-none focus:border-brand-green"
              >
                {Object.entries(periodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <button
                type="button"
                onClick={() => void loadDashboard()}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-green px-4 py-2.5 text-sm font-black text-brand-ink transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                Atualizar visão
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-brand-line pt-4 text-xs text-brand-muted">
            <span>Período: <strong className="text-white">{periodLabels[period]}</strong></span>
            <span>•</span>
            <span>Carregado: <strong className="text-white">{lastLoadedAt ? lastLoadedAt.toLocaleString('pt-BR') : 'aguardando'}</strong></span>
            <span>•</span>
            <span>Clientes retornados: <strong className="text-white">{clients.length}</strong></span>
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
            <GlobalSummaryCards clients={clients} />

            <div className="flex flex-col gap-3 rounded-2xl border border-brand-line bg-brand-surface p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-bold text-white">Filtrar a central</p>
                <p className="text-xs text-brand-muted">O filtro altera a tabela, sem modificar os totais consolidados acima.</p>
              </div>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
                className="rounded-xl border border-brand-line bg-brand-ink px-3 py-2 text-sm text-white outline-none focus:border-brand-green"
              >
                <option value="all">Todos os estados</option>
                {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>

            <ClientPerformanceTable clients={filteredClients} />

            <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
              <article className="rounded-2xl border border-brand-line bg-brand-surface p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-brand-green">Prioridades</p>
                    <h2 className="mt-1 text-xl font-black text-white">Clientes que exigem decisão</h2>
                  </div>
                  <AlertTriangle className="text-amber-300" size={22} />
                </div>
                <div className="mt-4 space-y-3">
                  {priorities.length > 0 ? priorities.map(({ client, evaluation }, index) => (
                    <div key={`${client.clientId}:${evaluation.clientMetaAssetId}:${evaluation.campaignId || 'account'}:${evaluation.metricId}:${index}`} className="rounded-xl border border-brand-line bg-brand-ink/50 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="font-bold text-white">{index + 1}. {client.clientName}</p>
                          <p className="mt-1 text-sm text-brand-muted">{evaluationDescription(client, evaluation)}</p>
                          <p className="mt-2 text-xs text-brand-soft">Motivo técnico: {evaluation.reason}</p>
                        </div>
                        <PerformanceStatusBadge status={evaluation.status} />
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-xl border border-dashed border-brand-line p-8 text-center text-sm text-brand-muted">
                      Nenhuma prioridade conclusiva para o período. Clientes sem dados continuam visíveis na tabela.
                    </div>
                  )}
                </div>
              </article>

              <article className="rounded-2xl border border-brand-line bg-brand-surface p-5">
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
    </section>
  );
}

function QuickMetric({
  icon: Icon,
  label,
  value,
  onClick,
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="rounded-xl border border-brand-line bg-brand-ink/50 p-4 text-left transition hover:border-brand-green/50 hover:bg-white/[0.03]">
      <Icon size={17} className="text-brand-green" />
      <p className="mt-3 text-xl font-black text-white">{value}</p>
      <p className="mt-1 text-xs text-brand-muted">{label}</p>
    </button>
  );
}
