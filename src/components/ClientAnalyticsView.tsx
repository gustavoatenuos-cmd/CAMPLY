import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CamplyData, Client, ClientCategory } from '../types';
import { CLIENT_CATEGORY_LABELS } from '../types';
import {
  compatibilityReasonMessage,
  loadAnalyticsCapabilities,
  type AnalyticsCapabilities,
  type DashboardPeriod,
} from '../lib/performance/analyticsCapabilities';
import {
  loadGlobalPerformanceDashboard,
  type GlobalClientPerformance,
  type GlobalPerformanceAccount,
  type GlobalMetricGroup,
  type MetricContract,
} from '../lib/performance/globalPerformanceDashboard';
import type { PerformanceScore } from '../lib/performance/performanceScore';
import { metricLabels } from '../lib/analysis/clientAnalysisProfile';
import { clientDisplayName } from '../lib/clientUtils';
import { CategoryBadge } from './CategoryBadge';
import { PerformanceScoreBadge } from './performance/PerformanceScoreBadge';
import { TraceableMetricValue } from './performance/TraceableMetricValue';

interface ClientAnalyticsViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

const periodLabels: Record<DashboardPeriod, string> = {
  this_month: 'Mês atual',
  this_week: 'Semana atual',
  today: 'Hoje',
  last_7d: 'Últimos 7 dias',
  last_30d: 'Últimos 30 dias',
};

const emptyScore: PerformanceScore = {
  value: null,
  status: 'unavailable',
  confidence: 0,
  coveragePercent: 0,
  summary: 'Score indisponível: ainda não há métricas confiáveis para este cliente.',
  signals: [],
};

const statusLabels: Record<GlobalClientPerformance['clientStatus'], string> = {
  not_connected: 'Conta Meta não vinculada',
  never_synced: 'Sincronização pendente',
  syncing: 'Sincronizando',
  no_delivery: 'Sem entrega no período',
  available: 'Dados confiáveis',
  stale: 'Dados desatualizados',
  partial: 'Dados parciais',
  failed: 'Falha na sincronização',
};

const reasonLabels: Record<string, string> = {
  account_not_connected: 'Cliente sem conta Meta vinculada.',
  client_profile_missing: 'Cliente sem perfil de análise configurado.',
  meta_account_not_linked: 'Cliente sem conta Meta vinculada.',
  sync_not_started: 'A conta ainda não foi sincronizada neste período.',
  sync_failed: 'A última sincronização falhou.',
  period_not_synced: 'Este período ainda não foi sincronizado.',
  no_delivery: 'A conta não teve entrega no período.',
  target_not_configured: 'Nenhuma meta/KPI foi configurada para avaliação.',
  metrics_unavailable: 'As métricas oficiais não estão disponíveis para este recorte.',
  partial_data: 'A leitura mais recente está parcial.',
};

function reasonLabel(reason?: string | null): string {
  if (!reason) return 'Aguardando dados confiáveis.';
  return reasonLabels[reason] || reason.split('_').join(' ');
}

function metricValue(metric: MetricContract | undefined): number | null {
  return metric?.available && typeof metric.value === 'number' && Number.isFinite(metric.value)
    ? metric.value
    : null;
}

function formatNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function formatCurrency(value: number | null, currency?: string | null): string {
  if (value === null) return '—';
  if (!currency) return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${formatNumber(value)}`;
  }
}

function formatRun(run: GlobalClientPerformance['lastAttempt']): string {
  if (!run) return 'Nenhuma execução registrada';
  const finishedAt = run.finishedAt || run.startedAt;
  const timestamp = new Date(finishedAt);
  const date = Number.isNaN(timestamp.getTime()) ? finishedAt : timestamp.toLocaleString('pt-BR');
  return `${run.status} · ${date}${run.terminationReason ? ` · ${run.terminationReason}` : ''}`;
}

function OfficialScore({ score, compact = false }: { score: PerformanceScore; compact?: boolean }) {
  if (score.status === 'unavailable') {
    return (
      <span
        title={score.summary}
        className="inline-flex items-center rounded-full border border-brand-line bg-white/5 px-2.5 py-1 text-[11px] font-bold text-brand-muted"
      >
        Score indisponível
      </span>
    );
  }
  return <PerformanceScoreBadge score={score} compact={compact} />;
}

function workspaceClientById(data: CamplyData): Map<string, Client> {
  return new Map(data.clients.map((client) => [client.id, client]));
}

function missingClientPerformance(client: Client): GlobalClientPerformance {
  return {
    clientId: client.id,
    clientName: clientDisplayName(client),
    clientStatus: 'not_connected',
    accounts: [],
    metrics: {},
    metricGroups: [],
    resolvedTargets: [],
    evaluations: [],
    budgetPacing: null,
    score: emptyScore,
    dataQuality: { status: 'unavailable', reason: 'meta_account_not_linked' },
    lastSuccessfulRun: null,
    lastAttempt: null,
    hasNewerPartial: false,
    hasNewerFailure: false,
    analysisProfile: null,
  };
}

function combineOfficialAndPendingClients(
  officialClients: GlobalClientPerformance[],
  data: CamplyData
): GlobalClientPerformance[] {
  const seen = new Set(officialClients.map((client) => client.clientId));
  const pending = data.clients
    .filter((client) => client.status === 'active' && !seen.has(client.id))
    .map(missingClientPerformance);
  return [...officialClients, ...pending].sort((a, b) => a.clientName.localeCompare(b.clientName));
}

function mainCurrency(client: GlobalClientPerformance): string | null {
  return client.accounts.find((account) => account.currency)?.currency || null;
}

function primaryMetricId(client: GlobalClientPerformance): string {
  return client.analysisProfile?.primaryConversionMetric || 'messaging_conversations_started_total';
}

function metricBox(
  label: string,
  metric: MetricContract | undefined,
  formatter: (value: number | null) => string = formatNumber
) {
  const value = metricValue(metric);
  return (
    <div className="rounded-xl border border-white/8 bg-white/4 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-2 text-lg font-black text-white">
        <TraceableMetricValue metric={metric}>{formatter(value)}</TraceableMetricValue>
      </p>
      {!metric?.available && (
        <p className="mt-1 text-xs text-amber-200">{reasonLabel(metric?.unavailableReason)}</p>
      )}
    </div>
  );
}

function ClientCard({
  client,
  workspaceClient,
  isSelected,
  onSelect,
}: {
  client: GlobalClientPerformance;
  workspaceClient?: Client;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const criticalSignals = client.score.signals.filter((signal) => signal.severity === 'critical').length;
  const category = workspaceClient?.category;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xl border p-4 text-left transition-all ${
        isSelected
          ? 'border-violet-500/60 bg-violet-500/10'
          : 'border-white/8 bg-white/4 hover:border-white/15 hover:bg-white/7'
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{client.clientName}</p>
          <p className="truncate text-xs text-zinc-500">{statusLabels[client.clientStatus]}</p>
        </div>
        <OfficialScore score={client.score} compact />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <CategoryBadge category={category} size="sm" />
        {client.accounts.length > 0 && (
          <span className="rounded-full bg-white/8 px-2 py-0.5 text-xs text-zinc-400">
            {client.accounts.length} conta{client.accounts.length !== 1 ? 's' : ''}
          </span>
        )}
        {criticalSignals > 0 && (
          <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-bold text-rose-200">
            {criticalSignals} crítico{criticalSignals > 1 ? 's' : ''}
          </span>
        )}
      </div>
    </button>
  );
}

function CampaignPanel({ group }: { group: GlobalMetricGroup }) {
  const spendMetric = group.metrics.spend;
  const conversationsMetric = group.metrics.messaging_conversations_started_total;
  const leadsMetric = group.metrics.leads;
  const purchasesMetric = group.metrics.purchases;
  const cpmMetric = group.metrics.cpm;
  const primaryCurrency = group.currency;

  return (
    <div className="rounded-xl border border-white/8 bg-white/4 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-white">{group.campaignName}</h3>
          <p className="mt-1 text-xs text-zinc-500">
            {group.classifiedObjective || 'Objetivo não classificado'} · {group.destinationType || 'Destino não informado'} · {group.attributionSetting || 'Atribuição não informada'}
          </p>
        </div>
        <span className="rounded-full bg-white/8 px-2 py-1 text-[11px] font-bold text-zinc-300">
          {group.completenessStatus || 'sem status'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {metricBox('Investimento', spendMetric, (value) => formatCurrency(value, primaryCurrency))}
        {metricBox('Conversas', conversationsMetric)}
        {metricBox('Leads', leadsMetric)}
        {metricBox('Compras', purchasesMetric)}
        {metricBox('CPM', cpmMetric, (value) => formatCurrency(value, primaryCurrency))}
      </div>
    </div>
  );
}

function AccountPanel({ account, primaryMetricId }: { account: GlobalPerformanceAccount; primaryMetricId: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold text-white">{account.accountName}</p>
          <p className="mt-1 text-xs text-zinc-500">{account.adAccountId} · {account.currency || 'Moeda não informada'}</p>
        </div>
        <span className="rounded-full bg-white/8 px-2 py-1 text-[11px] font-bold text-zinc-300">
          {account.dataQuality.status}
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {metricBox('Investimento', account.metrics.spend, (value) => formatCurrency(value, account.currency))}
        {metricBox(metricLabels[primaryMetricId] || 'KPI principal', account.metrics[primaryMetricId])}
        {metricBox('CPM', account.metrics.cpm, (value) => formatCurrency(value, account.currency))}
      </div>
      <div className="mt-3 grid gap-2 text-xs text-zinc-400 lg:grid-cols-2">
        <p><span className="font-bold text-zinc-300">Último sync confiável:</span> {formatRun(account.lastSuccessfulRun)}</p>
        <p><span className="font-bold text-zinc-300">Última tentativa:</span> {formatRun(account.lastAttempt)}</p>
      </div>
      {account.dataQuality.reason && <p className="mt-2 text-xs text-amber-100">{reasonLabel(account.dataQuality.reason)}</p>}
    </div>
  );
}

export function ClientAnalyticsView({ data }: ClientAnalyticsViewProps) {
  const [period, setPeriod] = useState<DashboardPeriod>('this_month');
  const [capabilities, setCapabilities] = useState<AnalyticsCapabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [clients, setClients] = useState<GlobalClientPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<ClientCategory | 'all'>('all');

  const workspaceClients = useMemo(() => workspaceClientById(data), [data]);

  const loadCapabilities = useCallback(async () => {
    setCapabilityError(null);
    const state = await loadAnalyticsCapabilities();
    if (state.mode === 'analytics') {
      setCapabilities(state.capabilities);
      return;
    }
    setCapabilityError(compatibilityReasonMessage(state.reason));
    setCapabilities(null);
    setLoading(false);
  }, []);

  const loadDashboard = useCallback(async () => {
    if (!capabilities) return;
    setLoading(true);
    setError(null);
    try {
      const official = await loadGlobalPerformanceDashboard({
        period,
        dashboardRpc: capabilities.dashboardRpc,
      });
      setClients(combineOfficialAndPendingClients(official, data));
      setLastLoadedAt(new Date());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar analytics oficial.');
    } finally {
      setLoading(false);
    }
  }, [capabilities, data, period]);

  useEffect(() => {
    void loadCapabilities();
  }, [loadCapabilities]);

  useEffect(() => {
    if (capabilities) void loadDashboard();
  }, [capabilities, loadDashboard]);

  const filteredClients = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
    return clients.filter((client) => {
      const workspaceClient = workspaceClients.get(client.clientId);
      const matchSearch = !normalizedSearch
        || client.clientName.toLocaleLowerCase('pt-BR').includes(normalizedSearch)
        || client.accounts.some((account) => account.accountName.toLocaleLowerCase('pt-BR').includes(normalizedSearch));
      const matchCategory = filterCategory === 'all' || workspaceClient?.category === filterCategory;
      return matchSearch && matchCategory;
    });
  }, [clients, filterCategory, search, workspaceClients]);

  const selectedClient = useMemo(() => (
    filteredClients.find((client) => client.clientId === selectedClientId)
    || filteredClients[0]
    || null
  ), [filteredClients, selectedClientId]);

  const categories = useMemo(() => (
    Array.from(new Set(data.clients.map((client) => client.category).filter(Boolean))) as ClientCategory[]
  ), [data.clients]);

  const selectedPrimaryMetricId = selectedClient ? primaryMetricId(selectedClient) : 'messaging_conversations_started_total';
  const selectedCurrency = selectedClient ? mainCurrency(selectedClient) : null;
  const selectedSpend = selectedClient ? metricValue(selectedClient.metrics.spend) : null;
  const selectedPrimaryMetric = selectedClient?.metrics[selectedPrimaryMetricId];
  const selectedSignals = selectedClient?.score.signals ?? [];

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-brand-ink">
      <aside className="flex h-full w-80 flex-shrink-0 flex-col gap-3 overflow-y-auto border-r border-white/8 p-4">
        <div className="flex-shrink-0">
          <h2 className="mb-1 text-lg font-bold text-white">Analytics por Cliente</h2>
          <p className="mb-3 text-xs text-zinc-500">Fonte oficial: banco analítico, conta Meta, período e métricas rastreáveis.</p>

          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar cliente ou conta..."
            className="mb-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
          />

          {categories.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1">
              <button type="button" onClick={() => setFilterCategory('all')} className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${filterCategory === 'all' ? 'bg-violet-500 text-white' : 'bg-white/8 text-zinc-400 hover:bg-white/12'}`}>Todos</button>
              {categories.map((category) => (
                <button key={category} type="button" onClick={() => setFilterCategory(category)} className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${filterCategory === category ? 'bg-violet-500 text-white' : 'bg-white/8 text-zinc-400 hover:bg-white/12'}`}>
                  {CLIENT_CATEGORY_LABELS[category]}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {capabilityError && (
            <div className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">
              {capabilityError}
            </div>
          )}
          {loading ? (
            <div className="rounded-xl border border-white/8 bg-white/4 p-5 text-sm text-zinc-400">Carregando analytics oficial...</div>
          ) : filteredClients.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">{search ? 'Nenhum cliente encontrado' : 'Nenhum cliente ativo ou analítico encontrado'}</p>
          ) : (
            filteredClients.map((client) => (
              <ClientCard
                key={client.clientId}
                client={client}
                workspaceClient={workspaceClients.get(client.clientId)}
                isSelected={selectedClient?.clientId === client.clientId}
                onSelect={() => setSelectedClientId(client.clientId)}
              />
            ))
          )}
        </div>
      </aside>

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
        <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-white/8 bg-white/4 p-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-green">Contrato oficial</p>
            <h1 className="mt-1 text-2xl font-black text-white">Analytics oficial por cliente</h1>
            <p className="mt-1 text-sm text-zinc-400">Score só aparece quando há dado confiável; métrica ausente mostra motivo.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="text-xs font-bold text-zinc-400">
              Período
              <select value={period} onChange={(event) => setPeriod(event.target.value as DashboardPeriod)} className="mt-1 rounded-lg border border-white/10 bg-brand-ink px-3 py-2 text-sm text-white">
                {Object.entries(periodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => void loadDashboard()} disabled={!capabilities || loading} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
              <RefreshCw size={15} /> Atualizar leitura
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-100">
            {error}
          </div>
        )}

        {!selectedClient ? (
          <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-white/10 p-12">
            <p className="text-zinc-500">Selecione um cliente para ver as métricas oficiais.</p>
          </div>
        ) : (
          <>
            <section className="mb-5 rounded-2xl border border-white/8 bg-white/4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-black text-white">{selectedClient.clientName}</h2>
                    <span className="rounded-full bg-white/8 px-2 py-1 text-[11px] font-bold text-zinc-300">{statusLabels[selectedClient.clientStatus]}</span>
                  </div>
                  <p className="text-sm text-zinc-400">
                    {selectedClient.accounts.length > 0
                      ? selectedClient.accounts.map((account) => account.accountName).join(' · ')
                      : reasonLabel(selectedClient.dataQuality.reason)}
                  </p>
                  {lastLoadedAt && <p className="mt-1 text-xs text-zinc-500">Leitura carregada em {lastLoadedAt.toLocaleString('pt-BR')}</p>}
                </div>
                <OfficialScore score={selectedClient.score} />
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {metricBox('Investimento oficial', selectedClient.metrics.spend, (value) => formatCurrency(value, selectedCurrency))}
                {metricBox(metricLabels[selectedPrimaryMetricId] || 'KPI principal', selectedPrimaryMetric)}
                {metricBox('CPM', selectedClient.metrics.cpm, (value) => formatCurrency(value, selectedCurrency))}
                {metricBox('Compras', selectedClient.metrics.purchases)}
              </div>

              <div className="mt-4 rounded-xl border border-white/8 bg-black/20 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">Diagnóstico</p>
                <p className="mt-2 text-sm text-white">{selectedClient.score.summary}</p>
                {selectedClient.score.status === 'unavailable' && (
                  <p className="mt-1 text-sm text-amber-100">Motivo: {reasonLabel(selectedClient.dataQuality.reason || selectedClient.clientStatus)}</p>
                )}
                {selectedSignals.length > 0 && (
                  <div className="mt-3 grid gap-2 lg:grid-cols-2">
                    {selectedSignals.slice(0, 4).map((signal, index) => (
                      <div key={`${signal.kind}:${signal.metricId || index}`} className="rounded-lg border border-white/8 bg-white/4 p-3">
                        <p className={`text-xs font-bold ${signal.severity === 'critical' ? 'text-rose-300' : signal.severity === 'warning' ? 'text-amber-200' : 'text-sky-200'}`}>{signal.title}</p>
                        <p className="mt-1 text-xs text-zinc-400">{signal.evidence}</p>
                        <p className="mt-1 text-xs text-brand-green">{signal.nextAction}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-white/8 bg-black/20 p-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">Status do cliente</p>
                  <p className="mt-1 font-bold text-white">{statusLabels[selectedClient.clientStatus]}</p>
                </div>
                <div className="rounded-xl border border-white/8 bg-black/20 p-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">Qualidade dos dados</p>
                  <p className="mt-1 font-bold text-white">{selectedClient.dataQuality.status}</p>
                  {selectedClient.dataQuality.reason && <p className="mt-1 text-xs text-amber-100">{reasonLabel(selectedClient.dataQuality.reason)}</p>}
                </div>
                <div className="rounded-xl border border-white/8 bg-black/20 p-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">Último sync confiável</p>
                  <p className="mt-1 text-xs text-white">{formatRun(selectedClient.lastSuccessfulRun)}</p>
                </div>
                <div className="rounded-xl border border-white/8 bg-black/20 p-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">Última tentativa</p>
                  <p className="mt-1 text-xs text-white">{formatRun(selectedClient.lastAttempt)}</p>
                </div>
              </div>

              {selectedClient.evaluations.length > 0 && (
                <div className="mt-4 rounded-xl border border-white/8 bg-black/20 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">Avaliações oficiais</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedClient.evaluations.map((evaluation) => (
                      <span key={`${evaluation.metricId}:${evaluation.campaignId || 'account'}:${evaluation.targetKind}:${evaluation.targetValue}:${String(evaluation.effectiveFrom || '')}`} className="rounded-lg bg-white/5 px-3 py-2 text-xs text-zinc-300">
                        {metricLabels[evaluation.metricId] || evaluation.metricId}: <strong>{evaluation.status}</strong> · {evaluation.reason}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {selectedClient.accounts.length > 0 && (
              <section className="mb-5 space-y-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-green">Contas oficiais</p>
                  <h2 className="mt-1 text-lg font-black text-white">Métricas persistidas por conta Meta</h2>
                </div>
                {selectedClient.accounts.map((account) => (
                  <AccountPanel key={account.clientMetaAssetId} account={account} primaryMetricId={selectedPrimaryMetricId} />
                ))}
              </section>
            )}

            {selectedClient.metricGroups.length === 0 ? (
              <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 p-12 text-center">
                <div>
                  <p className="font-bold text-white">Nenhuma campanha confiável neste período.</p>
                  <p className="mt-1 text-sm text-zinc-500">{reasonLabel(selectedClient.dataQuality.reason || selectedClient.clientStatus)}</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {selectedClient.metricGroups.map((group) => (
                  <CampaignPanel key={`${group.clientMetaAssetId}:${group.campaignId}`} group={group} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
