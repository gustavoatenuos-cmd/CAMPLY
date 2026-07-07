/**
 * ClientAnalyticsView.tsx
 * Phase 1 — Main analytical view per client.
 * Shows KPIs by category/objective, campaign health scores, and cost alerts.
 */
import React, { useState, useMemo } from 'react';
import type { CamplyData, Campaign, Client, ClientCategory } from '../types';
import { CLIENT_CATEGORY_LABELS } from '../types';
import { CategoryBadge } from './CategoryBadge';
import { HealthScoreGauge } from './HealthScoreGauge';
import { AlertBadge } from './ui/AlertBadge';
import { MetricCompareCard } from './performance/MetricCompareCard';
import { selectMetricsForCampaign, formatMetricValue } from '../lib/meta/metricsSelector';
import { motion } from 'framer-motion';

interface ClientAnalyticsViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

// Derives a simple health score for a campaign based on alerts + status
function deriveCampaignHealthScore(campaign: Campaign, data: CamplyData): number {
  const alerts = (data.agentAlerts || []).filter(
    a => a.relatedEntityId === campaign.id && a.status === 'active'
  );
  let score = 100;
  score -= alerts.filter(a => a.severity === 'critical').length * 20;
  score -= alerts.filter(a => a.severity === 'warning').length * 10;
  if (campaign.status === 'paused') score -= 15;
  if (campaign.status === 'waiting') score -= 10;
  const budgetPct = campaign.budget > 0 ? (campaign.spent / campaign.budget) * 100 : 0;
  if (budgetPct >= 90) score -= 15;
  return Math.max(0, Math.min(100, score));
}

function deriveClientHealthScore(clientId: string, data: CamplyData): number {
  const clientCampaigns = data.campaigns.filter(c => c.clientId === clientId);
  if (clientCampaigns.length === 0) return 80;
  const avg = clientCampaigns.reduce((s, c) => s + deriveCampaignHealthScore(c, data), 0) / clientCampaigns.length;
  return Math.round(avg);
}

// ==================== CLIENT CARD ====================

interface ClientCardProps {
  client: Client;
  data: CamplyData;
  isSelected: boolean;
  onSelect: () => void;
}

function ClientCard({ client, data, isSelected, onSelect }: ClientCardProps) {
  const healthScore = deriveClientHealthScore(client.id, data);
  const activeCampaigns = data.campaigns.filter(
    c => c.clientId === client.id && !['paused', 'setup'].includes(c.status)
  ).length;
  const criticalAlerts = (data.agentAlerts || []).filter(
    a => a.clientId === client.id && a.status === 'active' && a.severity === 'critical'
  ).length;

  return (
    <motion.button
      whileHover={{ x: 4 }}
      onClick={onSelect}
      className={`w-full rounded-xl border p-4 text-left transition-all duration-300 ${
        isSelected
          ? 'border-brand-green/50 bg-brand-green/10 shadow-[inset_0_0_15px_rgba(0,229,153,0.1)]'
          : 'border-white/[0.05] bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]'
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{client.company || client.name}</p>
          {client.company && client.name && (
            <p className="truncate text-xs text-zinc-500">{client.name}</p>
          )}
        </div>
        <HealthScoreGauge score={healthScore} size="sm" showLabel={false} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <CategoryBadge category={client.category} size="sm" />
        {activeCampaigns > 0 && (
          <span className="rounded-full bg-white/8 px-2 py-0.5 text-xs text-zinc-400">
            {activeCampaigns} campanha{activeCampaigns !== 1 ? 's' : ''} ativa{activeCampaigns !== 1 ? 's' : ''}
          </span>
        )}
        {criticalAlerts > 0 && (
          <AlertBadge severity="critical" label={`${criticalAlerts} crítico${criticalAlerts > 1 ? 's' : ''}`} />
        )}
      </div>
    </motion.button>
  );
}

// ==================== CAMPAIGN METRICS PANEL ====================

interface CampaignPanelProps {
  campaign: Campaign;
  client: Client;
  data: CamplyData;
}

function CampaignPanel({ campaign, client, data }: CampaignPanelProps) {
  const healthScore = deriveCampaignHealthScore(campaign, data);
  const metrics = selectMetricsForCampaign(campaign.objective, client.category, 6);
  const alerts = (data.agentAlerts || []).filter(
    a => a.relatedEntityId === campaign.id && a.status === 'active'
  );

  // Build metric value map from campaign data
  const metricValues: Record<string, number | undefined> = {
    spent: campaign.spent,
    ctr: campaign.ctr,
    cpc: campaign.cpc,
    cpr: campaign.cpr,
    impressions: campaign.impressions,
    pageViews: campaign.pageViews,
    checkouts: campaign.checkouts,
    purchases: campaign.purchases,
    results: campaign.results,
  };

  const budgetPct = campaign.budget > 0 ? Math.round((campaign.spent / campaign.budget) * 100) : 0;
  const daysSinceOptimized = campaign.lastOptimizedAt
    ? Math.floor((Date.now() - new Date(campaign.lastOptimizedAt).getTime()) / 86400000)
    : null;

  const statusColors: Record<string, string> = {
    live:     'bg-emerald-500/20 text-emerald-300',
    optimize: 'bg-amber-500/20 text-amber-300',
    launching:'bg-sky-500/20 text-sky-300',
    setup:    'bg-zinc-500/20 text-zinc-300',
    waiting:  'bg-orange-500/20 text-orange-300',
    paused:   'bg-zinc-500/20 text-zinc-400',
  };

  return (
    <motion.article 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card flex flex-col gap-4 rounded-xl p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.05] pb-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-bold text-white">{campaign.name}</h3>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[campaign.status] ?? 'bg-zinc-500/20 text-zinc-300'}`}>
              {campaign.status === 'live' ? 'No ar' :
               campaign.status === 'optimize' ? 'Otimizar' :
               campaign.status === 'launching' ? 'Subindo' :
               campaign.status === 'setup' ? 'Setup' :
               campaign.status === 'waiting' ? 'Aguardando' : 'Pausada'}
            </span>
            <span className="rounded-full bg-white/8 px-2 py-0.5 text-xs text-zinc-400">
              {campaign.platform}
            </span>
            <span className="rounded-full bg-white/8 px-2 py-0.5 text-xs text-zinc-400">
              {campaign.objective}
            </span>
          </div>
          {daysSinceOptimized !== null && (
            <p className={`text-xs ${daysSinceOptimized >= 3 ? 'text-amber-400' : 'text-zinc-500'}`}>
              {daysSinceOptimized === 0
                ? 'Otimizada hoje'
                : `Última otimização: ${daysSinceOptimized}d atrás`}
            </p>
          )}
        </div>
        <div className="flex flex-col items-center gap-1">
          <HealthScoreGauge score={healthScore} size="md" />
        </div>
      </header>

      {/* Budget bar */}
      {campaign.budget > 0 && (
        <div className="mb-4">
          <div className="mb-1 flex justify-between text-xs text-zinc-400">
            <span>Budget {campaign.budget >= 1000 ? `R$ ${(campaign.budget / 1000).toFixed(1)}k` : `R$ ${campaign.budget.toFixed(0)}`}</span>
            <span className={budgetPct >= 90 ? 'text-rose-400 font-semibold' : budgetPct >= 70 ? 'text-amber-400' : 'text-zinc-400'}>
              {budgetPct}% consumido
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/8">
            <div
              className={`h-full rounded-full transition-all ${
                budgetPct >= 90 ? 'bg-rose-500' : budgetPct >= 70 ? 'bg-amber-500' : 'bg-violet-500'
              }`}
              style={{ width: `${Math.min(100, budgetPct)}%` }}
            />
          </div>
        </div>
      )}

      {/* Metrics grid */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {metrics.map(metric => (
          <MetricCompareCard
            key={metric.key}
            metric={metric}
            currentValue={metricValues[metric.key]}
            benchmarkValue={client.benchmarks?.[metric.key as keyof typeof client.benchmarks]}
            compact
          />
        ))}
      </div>

      {/* Active alerts */}
      {alerts.length > 0 && (
        <div className="space-y-1.5">
          {alerts.map(alert => (
            <div
              key={alert.id}
              className={`flex items-start gap-2 rounded-lg p-2.5 text-xs ${
                alert.severity === 'critical' ? 'bg-rose-500/10 text-rose-200' :
                alert.severity === 'warning' ? 'bg-amber-500/10 text-amber-200' :
                'bg-sky-500/10 text-sky-200'
              }`}
            >
              <AlertBadge severity={alert.severity as any} showDot size="sm" />
              <div>
                <p className="font-medium">{alert.title}</p>
                <p className="text-zinc-400">{alert.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.article>
  );
}

// ==================== MAIN VIEW ====================

export function ClientAnalyticsView({ data }: ClientAnalyticsViewProps) {
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<ClientCategory | 'all'>('all');

  const activeClients = useMemo(
    () => data.clients.filter(c => c.status === 'active'),
    [data.clients]
  );

  const filteredClients = useMemo(() => {
    return activeClients.filter(c => {
      const matchSearch =
        !search ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.company.toLowerCase().includes(search.toLowerCase());
      const matchCategory =
        filterCategory === 'all' || c.category === filterCategory;
      return matchSearch && matchCategory;
    });
  }, [activeClients, search, filterCategory]);

  const selectedClient = useMemo(
    () => activeClients.find(c => c.id === selectedClientId) ?? (filteredClients[0] || null),
    [selectedClientId, activeClients, filteredClients]
  );

  const selectedClientCampaigns = useMemo(() => {
    if (!selectedClient) return [];
    return data.campaigns
      .filter(c => c.clientId === selectedClient.id)
      .sort((a, b) => {
        const order = { live: 0, optimize: 1, launching: 2, waiting: 3, setup: 4, paused: 5 };
        return (order[a.status] ?? 9) - (order[b.status] ?? 9);
      });
  }, [selectedClient, data.campaigns]);

  const categories = useMemo(() => {
    const used = new Set(activeClients.map(c => c.category).filter(Boolean));
    return Array.from(used) as ClientCategory[];
  }, [activeClients]);

  // Summary stats
  const totalSpent = useMemo(() => {
    if (!selectedClient) return 0;
    return selectedClientCampaigns.reduce((s, c) => s + (c.spent || 0), 0);
  }, [selectedClient, selectedClientCampaigns]);

  const totalAlerts = useMemo(() => {
    if (!selectedClient) return 0;
    return (data.agentAlerts || []).filter(
      a => a.clientId === selectedClient.id && a.status === 'active'
    ).length;
  }, [selectedClient, data.agentAlerts]);

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* ── Sidebar: client list ── */}
      <aside className="flex h-full w-72 flex-shrink-0 flex-col gap-3 overflow-y-auto border-r border-white/8 p-4">
        <div className="flex-shrink-0">
          <h2 className="mb-3 text-lg font-bold text-white">Analytics por Cliente</h2>

          {/* Search */}
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar cliente..."
            className="mb-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
          />

          {/* Category filter */}
          {categories.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1">
              <button
                onClick={() => setFilterCategory('all')}
                className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${
                  filterCategory === 'all'
                    ? 'bg-violet-500 text-white'
                    : 'bg-white/8 text-zinc-400 hover:bg-white/12'
                }`}
              >
                Todos
              </button>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(cat)}
                  className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${
                    filterCategory === cat
                      ? 'bg-violet-500 text-white'
                      : 'bg-white/8 text-zinc-400 hover:bg-white/12'
                  }`}
                >
                  {CLIENT_CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Client list */}
        <div className="flex flex-col gap-2">
          {filteredClients.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              {search ? 'Nenhum cliente encontrado' : 'Nenhum cliente ativo'}
            </p>
          ) : (
            filteredClients.map(client => (
              <ClientCard
                key={client.id}
                client={client}
                data={data}
                isSelected={selectedClient?.id === client.id}
                onSelect={() => setSelectedClientId(client.id)}
              />
            ))
          )}
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
        {!selectedClient ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-zinc-500">Selecione um cliente para ver as métricas</p>
          </div>
        ) : (
          <>
            {/* Client header */}
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold text-white">{selectedClient.company || selectedClient.name}</h1>
                  <CategoryBadge category={selectedClient.category} size="md" />
                </div>
                {selectedClient.company && selectedClient.name && (
                  <p className="text-sm text-zinc-400">{selectedClient.name}</p>
                )}
              </div>

              {/* Summary stats */}
              <div className="flex gap-4">
                <div className="glass-card rounded-xl px-4 py-3 text-center min-w-[120px]">
                  <p className="text-xs text-brand-muted">Gasto Total</p>
                  <p className="text-lg font-bold text-white drop-shadow-md">
                    {formatMetricValue('spent', totalSpent)}
                  </p>
                </div>
                <div className="glass-card rounded-xl px-4 py-3 text-center min-w-[120px]">
                  <p className="text-xs text-brand-muted">Campanhas</p>
                  <p className="text-lg font-bold text-white drop-shadow-md">{selectedClientCampaigns.length}</p>
                </div>
                {totalAlerts > 0 && (
                  <div className="rounded-xl border border-rose-500/20 bg-rose-500/8 px-4 py-3 text-center">
                    <p className="text-xs text-rose-400">Alertas</p>
                    <p className="text-lg font-bold text-rose-300">{totalAlerts}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Benchmarks (if set) */}
            {selectedClient.benchmarks && Object.keys(selectedClient.benchmarks).length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                <span className="text-xs text-zinc-500">Benchmarks:</span>
                {Object.entries(selectedClient.benchmarks).map(([k, v]) => (
                  v !== undefined && (
                    <span key={k} className="rounded-full bg-white/8 px-2.5 py-0.5 text-xs text-zinc-400">
                      {k.toUpperCase()}: {formatMetricValue(k, v as number)}
                    </span>
                  )
                ))}
              </div>
            )}

            {/* Campaigns */}
            {selectedClientCampaigns.length === 0 ? (
              <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 p-12">
                <p className="text-zinc-500">Nenhuma campanha encontrada para este cliente.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {selectedClientCampaigns.map(campaign => (
                  <CampaignPanel
                    key={campaign.id}
                    campaign={campaign}
                    client={selectedClient}
                    data={data}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
