import React, { useState } from 'react';
import {
  AlertTriangle,
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  Clock3,
  Database,
  ExternalLink,
} from 'lucide-react';
import type { GlobalClientPerformance, MetricContract, GlobalPerformanceAccount } from '../../lib/performance/globalPerformanceDashboard';
import type { DashboardPeriod } from '../../lib/performance/analyticsCapabilities';
import type { Client } from '../../types';
import { ClientLogo } from '../clients/ClientLogo';
import { PerformanceStatusBadge } from './PerformanceStatusBadge';
import { CampaignHierarchicalTable } from './CampaignHierarchicalTable';
import { calculateObjectiveScopedCosts } from '../../lib/performance/objectiveScopedMetrics';

interface ClientPerformanceCardGridProps {
  clients: GlobalClientPerformance[];
  workspaceClients: Client[];
  period: DashboardPeriod;
}

export function ClientPerformanceCardGrid({
  clients,
  workspaceClients,
  period,
}: ClientPerformanceCardGridProps) {
  const [expandedClients, setExpandedClients] = useState<Record<string, boolean>>({});

  const toggleClient = (clientId: string) => {
    setExpandedClients((prev) => ({
      ...prev,
      [clientId]: !prev[clientId],
    }));
  };

  if (clients.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-brand-line bg-brand-ink/30 p-8 text-center">
        <AlertTriangle className="mb-4 text-brand-muted" size={32} />
        <h3 className="text-sm font-bold text-white">Nenhum cliente atende aos filtros aplicados.</h3>
        <p className="mt-1 text-xs text-brand-muted">Tente remover alguns filtros ou selecionar outro período.</p>
      </div>
    );
  }

  function getMetric(client: GlobalClientPerformance, metricName: string) {
    const metric = client.metrics?.[metricName];
    return metric?.available && typeof metric.value === 'number' ? metric.value : null;
  }

  function formatCurrency(val: number | null, currency = 'BRL') {
    if (val === null) return '—';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(val);
  }

  function formatNumber(val: number | null) {
    if (val === null) return '—';
    return new Intl.NumberFormat('pt-BR').format(val);
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {clients.map((client) => {
        const workspaceClient = workspaceClients.find((c) => c.id === client.clientId);
        const logoUrl = workspaceClient?.logoUrl;
        const currency = client.accounts[0]?.currency || 'BRL';

        // Metricas agregadas do cliente
        const spend = getMetric(client, 'spend');

        // CPA, CPL, custo por conversa e ROAS vêm do gasto e do resultado das
        // campanhas do MESMO objetivo (metricGroups), nunca do gasto total do
        // cliente — ver src/lib/performance/objectiveScopedMetrics.ts.
        const objectiveCosts = calculateObjectiveScopedCosts(client.metricGroups);

        // Conversões (Vendas)
        const purchases = getMetric(client, 'purchases');
        const costPerPurchase = objectiveCosts.costPerPurchase;
        const purchaseRoas = objectiveCosts.purchaseRoas.available ? objectiveCosts.purchaseRoas.value : null;

        // Conversões (Leads/Conversas)
        const conversations = getMetric(client, 'messaging_conversations_started_total');
        const costPerConversation = objectiveCosts.costPerMessagingConversation;

        // Engajamento
        const linkClicks = getMetric(client, 'link_clicks');
        const linkCtr = getMetric(client, 'link_ctr');

        const isExpanded = !!expandedClients[client.clientId];

        return (
          <div
            key={client.clientId}
            className="flex flex-col rounded-xl border border-brand-line bg-brand-ink shadow-sm transition-all overflow-hidden"
          >
            {/* Header / Basic Info */}
            <div className="flex items-start justify-between border-b border-brand-line/50 p-4">
              <div className="flex items-center gap-3">
                <ClientLogo name={workspaceClient?.name || client.clientName} logoUrl={logoUrl} />
                <div>
                  <h3 className="font-bold text-white text-base leading-tight truncate max-w-[200px]">
                    {workspaceClient?.name || client.clientName}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-brand-muted flex items-center gap-1">
                      <BriefcaseBusiness size={12} />
                      {workspaceClient?.segment || 'Multinicho'}
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="flex flex-col items-end gap-1">
                <PerformanceStatusBadge status={client.score?.status === 'excellent' || client.score?.status === 'healthy' ? 'on_track' : client.score?.status as any || 'insufficient_data'} />
                {client.score && (
                  <span className="text-[10px] font-bold text-white bg-white/10 px-1.5 py-0.5 rounded">
                    Score: {client.score.value?.toFixed(0) || '—'}
                  </span>
                )}
              </div>
            </div>

            {/* Performance Overview */}
            <div className="grid grid-cols-2 gap-px bg-brand-line/50 p-px">
              {/* Investimento (sempre útil) */}
              <div className="bg-brand-ink p-3 flex flex-col justify-center">
                <p className="text-[10px] uppercase font-bold text-brand-muted mb-0.5">Investimento Total</p>
                <p className="text-lg font-black text-white">{formatCurrency(spend, currency)}</p>
              </div>

              {/* Vendas ou Conversas */}
              <div className="bg-brand-ink p-3 flex flex-col justify-center">
                {purchases && purchases > 0 ? (
                  <>
                    <p className="text-[10px] uppercase font-bold text-brand-muted mb-0.5">Compras (ROAS)</p>
                    <p className="text-lg font-black text-white">
                      {formatNumber(purchases)} <span className="text-xs font-normal text-emerald-400">({purchaseRoas !== null ? purchaseRoas.toFixed(2) + 'x' : '—'})</span>
                    </p>
                    <p className="text-[10px] text-brand-muted mt-0.5">Custo: {formatCurrency(costPerPurchase.available ? costPerPurchase.value : null, currency)}</p>
                  </>
                ) : conversations && conversations > 0 ? (
                  <>
                    <p className="text-[10px] uppercase font-bold text-brand-muted mb-0.5">Conversas (Mensagens)</p>
                    <p className="text-lg font-black text-white">{formatNumber(conversations)}</p>
                    <p className="text-[10px] text-brand-muted mt-0.5">Custo: {formatCurrency(costPerConversation.available ? costPerConversation.value : null, currency)}</p>
                  </>
                ) : (
                  <>
                    <p className="text-[10px] uppercase font-bold text-brand-muted mb-0.5">Cliques no Link (CTR)</p>
                    <p className="text-lg font-black text-white">
                      {formatNumber(linkClicks)} <span className="text-xs font-normal text-brand-muted">({linkCtr !== null ? linkCtr.toFixed(2) + '%' : '—'})</span>
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* Status Sync */}
            <div className="flex items-center justify-between bg-brand-surface/30 px-4 py-2 border-t border-brand-line/50">
              <div className="flex items-center gap-1.5 text-[10px] text-brand-muted">
                {client.dataQuality.status === 'complete' ? (
                  <Database size={10} className="text-emerald-400" />
                ) : (
                  <Clock3 size={10} className="text-amber-400" />
                )}
                <span>
                  {client.lastSuccessfulRun?.finishedAt 
                    ? new Date(client.lastSuccessfulRun.finishedAt).toLocaleString('pt-BR') 
                    : 'Sem sincronização'}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-px bg-brand-line/50 p-px mt-auto">
              <button
                onClick={() => toggleClient(client.clientId)}
                className="flex flex-1 items-center justify-center gap-2 bg-brand-ink py-2.5 text-xs font-bold text-brand-soft hover:bg-white/[0.03] hover:text-white transition-colors"
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                Ver Campanhas
              </button>
              
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); /* Navegar para workspace futuramente */ }}
                className="flex items-center justify-center gap-2 bg-brand-ink px-4 py-2.5 text-xs font-bold text-brand-muted hover:bg-white/[0.03] hover:text-white transition-colors"
                title="Abrir no Workspace Meta"
              >
                <ExternalLink size={14} />
              </a>
            </div>

            {/* Expanded Content (Micro-drilldown) */}
            {isExpanded && (
              <div className="border-t border-brand-line bg-brand-ink/50 p-4 overflow-x-auto">
                {client.accounts.length === 0 ? (
                  <p className="text-xs text-brand-muted text-center py-4">Nenhuma conta com dados ativos no período.</p>
                ) : (
                  client.accounts.map(acc => (
                    <div key={acc.adAccountId} className="mb-4 last:mb-0">
                      <h4 className="font-bold text-xs mb-2 text-white opacity-80">{acc.accountName}</h4>
                      <CampaignHierarchicalTable account={acc} period={period} />
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
