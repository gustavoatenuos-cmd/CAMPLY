/**
 * ClientAnalyticsView.tsx
 * Phase 1 — Main analytical view per client.
 * Shows KPIs from official Meta contract with proper score handling.
 */
import React, { useState, useMemo, useCallback } from 'react';
import type { CamplyData } from '../types';
import { loadGlobalPerformanceDashboard, type GlobalClientPerformance } from '../lib/performance/globalPerformanceDashboard';
import { loadAnalyticsCapabilities, type AnalyticsCapabilityState } from '../lib/performance/analyticsCapabilities';
import { CategoryBadge } from './CategoryBadge';
import { AlertBadge } from './ui/AlertBadge';
import { RefreshCw } from 'lucide-react';

interface ClientAnalyticsViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

function formatMetricValue(metricId: string, value: number | null): string {
  if (value === null) return '—';
  if (
    metricId === 'spend'
    || metricId === 'cpm'
    || metricId.startsWith('cost_per_')
    || metricId === 'link_cpc'
  ) {
    return value.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: 2,
    });
  }
  if (metricId.includes('ctr')) {
    return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  }
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function ScoreStatus({ client }: { client: GlobalClientPerformance }) {
  if (client.score.status === 'unavailable') {
    return (
      <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
        <p className="text-sm font-bold text-amber-100">Score indisponível</p>
        <p className="text-xs text-amber-100/70 mt-1">{client.score.summary}</p>
        {client.dataQuality.reason && (
          <p className="text-xs text-amber-100/70 mt-1">Motivo: {client.dataQuality.reason}</p>
        )}
      </div>
    );
  }

  const statusColor = client.score.status === 'critical'
    ? 'bg-rose-500/10 border-rose-500/30 text-rose-100'
    : client.score.status === 'attention'
      ? 'bg-amber-500/10 border-amber-500/30 text-amber-100'
      : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-100';

  return (
    <div className={`rounded-lg border p-3 ${statusColor}`}>
      <p className="text-sm font-bold">
        Score: {client.score.value !== null ? Math.round(client.score.value) : '—'}
      </p>
      <p className="text-xs mt-1 opacity-80">{client.score.summary}</p>
    </div>
  );
}

export function ClientAnalyticsView({ data }: ClientAnalyticsViewProps) {
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [clients, setClients] = useState<GlobalClientPerformance[]>([]);
  const [capabilityState, setCapabilityState] = useState<AnalyticsCapabilityState | null>(null);
  const [loading, setLoading] = useState(true);

  const loadCapabilities = useCallback(async () => {
    setLoading(true);
    try {
      const state = await loadAnalyticsCapabilities();
      setCapabilityState(state);
      if (state.mode === 'analytics') {
        const dashboard = await loadGlobalPerformanceDashboard({
          period: 'this_month',
          dashboardRpc: state.capabilities.dashboardRpc,
        });
        setClients(dashboard);
      }
    } catch (error) {
      console.error('Failed to load analytics:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadCapabilities();
  }, [loadCapabilities]);

  const filteredClients = useMemo(() => {
    const normalizedSearch = search.toLowerCase();
    return clients.filter((client) =>
      client.clientName.toLowerCase().includes(normalizedSearch)
      || client.accounts.some((a) => a.accountName.toLowerCase().includes(normalizedSearch))
    );
  }, [clients, search]);

  const selectedClient = useMemo(
    () => filteredClients.find((c) => c.clientId === selectedClientId) || filteredClients[0],
    [selectedClientId, filteredClients]
  );

  if (loading || !capabilityState) {
    return (
      <div className="flex h-full items-center justify-center bg-brand-ink">
        <div className="text-center">
          <RefreshCw className="mx-auto animate-spin text-brand-green mb-3" size={28} />
          <p className="text-brand-muted">Carregando dados analíticos...</p>
        </div>
      </div>
    );
  }

  if (capabilityState.mode === 'compatibility') {
    return (
      <div className="flex h-full items-center justify-center bg-brand-ink p-6">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-6 max-w-md">
          <p className="text-amber-100 font-bold">Analytics indisponível</p>
          <p className="text-amber-100/70 text-sm mt-2">
            O contrato analítico não está disponível neste momento.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-brand-ink">
      {/* Sidebar: client list */}
      <aside className="flex h-full w-72 flex-shrink-0 flex-col gap-3 overflow-y-auto border-r border-white/8 p-4">
        <div className="flex-shrink-0">
          <h2 className="mb-3 text-lg font-bold text-white">Analytics por Cliente</h2>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cliente ou conta..."
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-brand-green focus:outline-none"
          />
        </div>

        {/* Client list */}
        <div className="flex flex-col gap-2">
          {filteredClients.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">Nenhum cliente encontrado</p>
          ) : (
            filteredClients.map((client) => {
              const workspaceClient = data.clients.find((c) => c.id === client.clientId);
              return (
                <button
                  key={client.clientId}
                  onClick={() => setSelectedClientId(client.clientId)}
                  className={`w-full rounded-xl border p-3 text-left transition-all ${
                    selectedClient?.clientId === client.clientId
                      ? 'border-brand-green/60 bg-brand-green/10'
                      : 'border-white/8 bg-white/4 hover:border-white/15'
                  }`}
                >
                  <p className="truncate text-sm font-semibold text-white">{client.clientName}</p>
                  {workspaceClient?.company && (
                    <p className="truncate text-xs text-zinc-500">{workspaceClient.company}</p>
                  )}
                  {client.accounts.length > 0 && (
                    <p className="text-xs text-zinc-400 mt-1">{client.accounts.length} conta(s)</p>
                  )}
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
        {!selectedClient ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-zinc-500">Selecione um cliente para ver as métricas analíticas</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Header */}
            <div>
              <div className="flex items-start gap-3 mb-2">
                <div>
                  <h1 className="text-2xl font-bold text-white">{selectedClient.clientName}</h1>
                  {data.clients.find((c) => c.id === selectedClient.clientId)?.company && (
                    <p className="text-sm text-zinc-400">
                      {data.clients.find((c) => c.id === selectedClient.clientId)?.company}
                    </p>
                  )}
                </div>
                {data.clients.find((c) => c.id === selectedClient.clientId)?.category && (
                  <CategoryBadge
                    category={data.clients.find((c) => c.id === selectedClient.clientId)?.category}
                    size="md"
                  />
                )}
              </div>
            </div>

            {/* Score status */}
            <ScoreStatus client={selectedClient} />

            {/* Accounts */}
            {selectedClient.accounts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/10 p-6 text-center">
                <p className="text-zinc-500">Nenhuma conta Meta vinculada</p>
              </div>
            ) : (
              <div className="space-y-4">
                {selectedClient.accounts.map((account) => (
                  <div key={account.clientMetaAssetId} className="rounded-lg border border-white/8 bg-white/4 p-4">
                    <h3 className="font-bold text-white mb-2">{account.accountName}</h3>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      {Object.entries(account.metrics).slice(0, 6).map(([metricId, metric]) => (
                        <div key={metricId} className="rounded bg-black/20 p-2">
                          <p className="text-xs text-zinc-400">{metricId}</p>
                          <p className="font-bold text-white mt-1">
                            {metric.available ? formatMetricValue(metricId, metric.value as number) : '—'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Metric groups / Campaigns */}
            {selectedClient.metricGroups.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/10 p-6 text-center">
                <p className="text-zinc-500">Nenhuma campanha com métricas</p>
              </div>
            ) : (
              <div className="space-y-3">
                <h3 className="font-bold text-white">Campanhas e Grupos de Métrica</h3>
                {selectedClient.metricGroups.map((group) => (
                  <div key={group.campaignId} className="rounded-lg border border-white/8 bg-white/4 p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <p className="font-bold text-white">{group.campaignName}</p>
                        <p className="text-xs text-zinc-400">{group.classifiedObjective || 'Objetivo não classificado'}</p>
                      </div>
                      {group.spend !== null && (
                        <p className="text-sm font-bold text-white">{formatMetricValue('spend', group.spend)}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
