import React, { useState } from 'react';
import {
  AlertTriangle,
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  Clock3,
  Database,
  RefreshCw,
  Search,
} from 'lucide-react';
import type { GlobalClientPerformance, MetricContract } from '../../lib/performance/globalPerformanceDashboard';
import type { DashboardPeriod } from '../../lib/performance/analyticsCapabilities';
import type { Client } from '../../types';
import { processClientStrategy } from '../../lib/strategy/strategyDecisionEngine';
import { ClientLogo } from '../clients/ClientLogo';
import { PerformanceStatusBadge } from './PerformanceStatusBadge';
import { CampaignHierarchicalTable } from './CampaignHierarchicalTable';
import { syncMetaAsset } from '../../lib/meta/metaSyncService';

interface ClientPerformanceCardGridProps {
  clients: GlobalClientPerformance[];
  workspaceClients: Client[];
  period: DashboardPeriod;
}

function metricValue(metric: MetricContract | undefined): number | null {
  return metric?.available && typeof metric.value === 'number' ? metric.value : null;
}

function formatCurrency(value: number | null, currency: string | null): string {
  if (value === null) return '—';
  if (!currency) return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`;
  }
}

function formatNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

export function ClientPerformanceCardGrid({ clients, workspaceClients, period }: ClientPerformanceCardGridProps) {
  if (clients.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-brand-line bg-brand-surface py-20 text-brand-muted">
        <Search size={32} className="mb-4 opacity-50" />
        <p>Nenhum cliente atende aos filtros aplicados.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {clients.map((client) => {
        const workspaceClient = workspaceClients.find(c => c.id === client.clientId);
        return (
          <ClientPerformanceCard 
            key={client.clientId} 
            client={client} 
            workspaceClient={workspaceClient} 
            period={period} 
          />
        );
      })}
    </div>
  );
}

function ClientPerformanceCard({ 
  client, 
  workspaceClient,
  period 
}: { 
  client: GlobalClientPerformance; 
  workspaceClient?: Client;
  period: DashboardPeriod;
}) {
  const [expanded, setExpanded] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Usa o Decision Engine para extrair métricas e sinais
  const decision = processClientStrategy(client, client.analysisProfile || null);
  const { macroStatus, dataStatus, strategyType, decisionSignals } = decision;

  // Header info
  const name = workspaceClient?.name || client.clientName;
  const logoUrl = workspaceClient?.logoUrl;
  const metaAccountName = client.accounts[0]?.accountName;
  const currency = client.accounts[0]?.currency || 'BRL';
  
  const lastSyncDate = client.lastSuccessfulRun?.finishedAt ? new Date(client.lastSuccessfulRun?.finishedAt) : null;
  const isStale = !client.lastSuccessfulRun;

  // Signal processing
  const topSignal = decisionSignals.sort((a, b) => {
    const weights = { critical: 1, attention: 2, info: 3 };
    return weights[a.severity] - weights[b.severity];
  })[0];

  const handleSync = async () => {
    if (!client.accounts.length) return;
    try {
      setSyncing(true);
      await Promise.all(
        client.accounts.map(acc => syncMetaAsset({ metaAssetId: acc.metaAssetId, period, requestedLevel: 'campaign' }))
      );
    } catch (e) {
      console.error('Failed to sync', e);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex flex-col rounded-2xl border border-brand-line bg-brand-surface shadow-sm transition hover:border-brand-green/30">
      
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-white/5 p-4">
        <div className="flex items-center gap-3 overflow-hidden">
          <ClientLogo name={name} logoUrl={logoUrl} size="md" />
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-black text-white text-base leading-tight" title={name}>{name}</h3>
            {metaAccountName ? (
              <p className="truncate text-[11px] font-medium text-brand-muted" title={metaAccountName}>
                Meta: {metaAccountName}
              </p>
            ) : (
              <p className="text-[11px] font-medium text-rose-400">Conta Meta não vinculada</p>
            )}
          </div>
        </div>
        <div className="shrink-0">
          <PerformanceStatusBadge 
            status={macroStatus === 'saudavel' ? 'on_track' : macroStatus === 'atencao' ? 'attention' : macroStatus === 'critico' ? 'critical' : 'insufficient_data'} 
            
          />
        </div>
      </div>

      {/* Contexto Operacional */}
      <div className="px-4 py-3 border-b border-white/5 bg-black/10">
        {(client.analysisProfile) ? (
          <div className="flex items-center gap-2 text-[11px] font-medium text-brand-soft flex-wrap">
            <span className="flex items-center gap-1"><BriefcaseBusiness size={12}/> {strategyType.replace('_', ' ')}</span>
            <span>·</span>
            <span>{decision.primaryConversion}</span>
            {(client.analysisProfile).plannedBudget && (
              <>
                <span>·</span>
                <span className="text-brand-green">Orçamento: {formatCurrency((client.analysisProfile).plannedBudget, currency)}</span>
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1 text-[11px] font-bold text-amber-200/80">
            <AlertTriangle size={12} />
            Perfil estratégico incompleto
          </div>
        )}
      </div>

      {/* Métricas (4 slots) */}
      <div className="flex-1 p-4">
        <div className="grid grid-cols-2 gap-3">
          <MetricBlock label="Investimento" value={formatCurrency(metricValue(client.accounts[0]?.metrics.spend), currency)} />
          
          {strategyType === 'venda_site' ? (
            <>
              <MetricBlock label="Compras" value={formatNumber(metricValue(client.accounts[0]?.metrics.purchases))} />
              <MetricBlock label="CPA" value={formatCurrency(metricValue(client.accounts[0]?.metrics.cpa), currency)} />
              <MetricBlock label="ROAS" value={formatNumber(metricValue(client.accounts[0]?.metrics.roas))} />
            </>
          ) : strategyType === 'leads_whatsapp' || strategyType === 'loja_fisica' ? (
            <>
              <MetricBlock label="Leads/Conversas" value={formatNumber(metricValue(client.accounts[0]?.metrics.leads) ?? metricValue(client.accounts[0]?.metrics.conversations))} />
              <MetricBlock label="Custo por Lead" value={formatCurrency(metricValue(client.accounts[0]?.metrics.cpl), currency)} />
              <MetricBlock label="CTR" value={metricValue(client.accounts[0]?.metrics.ctr) ? `${formatNumber(metricValue(client.accounts[0]?.metrics.ctr))}%` : '—'} />
            </>
          ) : strategyType === 'alcance' ? (
            <>
              <MetricBlock label="Alcance" value={formatNumber(metricValue(client.accounts[0]?.metrics.reach))} />
              <MetricBlock label="CPM" value={formatCurrency(metricValue(client.accounts[0]?.metrics.cpm), currency)} />
              <MetricBlock label="Frequência" value={formatNumber(metricValue(client.accounts[0]?.metrics.frequency))} />
            </>
          ) : (
            <>
              {/* Fallback */}
              <MetricBlock label="Resultados" value={formatNumber(metricValue(client.accounts[0]?.metrics.results))} />
              <MetricBlock label="Custo (CPR)" value={formatCurrency(metricValue(client.accounts[0]?.metrics.cpr), currency)} />
              <MetricBlock label="Cliques" value={formatNumber(metricValue(client.accounts[0]?.metrics.clicks))} />
            </>
          )}
        </div>
      </div>

      {/* Insight */}
      <div className="px-4 pb-3">
        {dataStatus === 'sem_conta' ? (
          <div className="rounded-lg bg-rose-400/10 p-2.5 text-xs text-rose-200">
            <p className="font-bold">Nenhuma conta conectada.</p>
            <p className="mt-0.5 opacity-80">Vincule no workspace local.</p>
          </div>
        ) : topSignal ? (
          <div className={`rounded-lg p-2.5 text-xs ${topSignal.severity === 'critical' ? 'bg-rose-400/10 text-rose-200' : topSignal.severity === 'attention' ? 'bg-amber-400/10 text-amber-200' : 'bg-brand-green/10 text-brand-green'}`}>
            <p className="font-bold">{topSignal.title}</p>
            <p className="mt-0.5 opacity-90 leading-tight">{topSignal.description}</p>
          </div>
        ) : (
          <div className="rounded-lg bg-white/5 p-2.5 text-xs text-brand-soft">
            <p className="font-bold">Saudável</p>
            <p className="mt-0.5 opacity-80">Métricas principais dentro do esperado.</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-brand-line bg-black/20 p-3 flex items-center justify-between gap-2 rounded-b-2xl">
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5 text-[10px] text-brand-muted">
            <Database size={10} className={isStale ? 'text-amber-400' : 'text-brand-green'} />
            {lastSyncDate ? (
              <span title={lastSyncDate.toLocaleString('pt-BR')}>
                Atualizado: {lastSyncDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            ) : (
              <span>Nunca sincronizado</span>
            )}
          </div>
          {dataStatus === 'periodo_nao_sincronizado' && (
             <span className="text-[9px] text-amber-400 mt-0.5 font-bold">Período atual s/ sync</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {(!lastSyncDate || dataStatus === 'periodo_nao_sincronizado') && client.accounts.length > 0 && (
            <button 
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1 rounded bg-brand-green/10 px-2 py-1 text-[10px] font-bold text-brand-green transition hover:bg-brand-green/20 disabled:opacity-50"
            >
              <RefreshCw size={10} className={syncing ? 'animate-spin' : ''} />
              Sincronizar
            </button>
          )}
          
          <button 
            onClick={() => setExpanded(!expanded)} 
            className="flex items-center gap-1 rounded border border-brand-line bg-brand-surface px-2 py-1 text-[10px] font-bold text-white transition hover:bg-white/5"
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Campanhas
          </button>
        </div>
      </div>

      {/* Expanded Drilldown */}
      {expanded && (
        <div className="border-t border-brand-line bg-brand-surface p-4 rounded-b-2xl">
          {client.accounts.map(acc => (
            <div key={acc.adAccountId} className="mb-4 last:mb-0">
              <h4 className="font-bold text-sm mb-2 text-white">{acc.accountName}</h4>
              <CampaignHierarchicalTable account={acc} period={period} />
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

function MetricBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">{label}</span>
      <span className="mt-0.5 text-lg font-black text-white">{value}</span>
    </div>
  );
}
