import React, { useEffect, useRef, useState, useMemo } from 'react';
import { type EnrichedGlobalClientPerformance } from '../../lib/performance/usePerformanceDashboard';
import { readPendingClientSelection } from '../../lib/performance/pendingClientSelection';
import type { DashboardPeriod } from '../../lib/performance/analyticsCapabilities';
import { ClientAnalyticsCard } from './ClientAnalyticsCard';
import { ClientCampaignDrawer } from './ClientCampaignDrawer';
import { ClientAnalyticsDetailDrawer } from './ClientAnalyticsDetailDrawer';
import { Search, Filter } from 'lucide-react';

interface ClientAnalyticsBoardProps {
  clients: EnrichedGlobalClientPerformance[];
  period: DashboardPeriod;
  loading: boolean;
  onEditClient?: (clientId: string) => void;
  onOpenMetaIntegration?: () => void;
}

type FilterStatus = 'ALL' | 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'NO_DATA' | 'NO_ACCOUNT';

export function ClientAnalyticsBoard({ clients, period, loading, onEditClient, onOpenMetaIntegration }: ClientAnalyticsBoardProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('ALL');

  const [selectedPerformance, setSelectedPerformance] = useState<EnrichedGlobalClientPerformance | null>(null);
  const [isCampaignDrawerOpen, setIsCampaignDrawerOpen] = useState(false);
  const [selectedDetailPerformance, setSelectedDetailPerformance] = useState<EnrichedGlobalClientPerformance | null>(null);
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = useState(false);

  // Aplica o cliente vindo do card "Ver análise" (OverviewView) assim que os
  // clientes carregarem — só uma vez, para não sobrescrever uma busca que o
  // usuário já tenha digitado manualmente depois disso.
  const appliedPendingSelection = useRef(false);
  useEffect(() => {
    if (appliedPendingSelection.current || clients.length === 0) return;
    const pendingClientId = readPendingClientSelection();
    const match = pendingClientId && clients.find((client) => client.clientId === pendingClientId);
    if (match) setSearchTerm(match.clientName);
    appliedPendingSelection.current = true;
  }, [clients]);

  const filteredClients = useMemo(() => {
    return clients.filter(c => {
      // 1. Search term
      const matchesSearch = c.clientName.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;

      // 2. Status filter
      if (statusFilter !== 'ALL') {
        const status = c.clientStatus;
        const score = c.score?.value;
        
        if (statusFilter === 'NO_ACCOUNT' && status !== 'not_connected') return false;
        
        if (statusFilter === 'NO_DATA' && 
            status !== 'never_synced' && 
            status !== 'period_not_synced' && 
            status !== 'not_connected') {
          return false;
        }

        if (statusFilter === 'HEALTHY' && (!score || score < 80)) return false;
        if (statusFilter === 'WARNING' && (!score || score < 50 || score >= 80)) return false;
        if (statusFilter === 'CRITICAL' && (!score || score >= 50)) return false;
      }

      return true;
    });
  }, [clients, searchTerm, statusFilter]);

  const handleOpenCampaigns = (performance: EnrichedGlobalClientPerformance) => {
    setSelectedPerformance(performance);
    setIsCampaignDrawerOpen(true);
  };

  const handleOpenDetails = (performance: EnrichedGlobalClientPerformance) => {
    setSelectedDetailPerformance(performance);
    setIsDetailDrawerOpen(true);
  };

  return (
    <div className="flex h-full flex-col bg-brand-ink">
      {/* Header section with filters */}
      <div className="flex shrink-0 flex-col gap-4 border-b border-brand-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-7">
        <div>
          <h2 className="text-lg font-semibold text-white">Analytics por Cliente</h2>
          <p className="mt-0.5 text-sm text-brand-muted">Acompanhamento de orçamento e performance</p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-brand-muted" />
            <input 
              type="text"
              placeholder="Buscar cliente..." 
              className="flex h-9 w-full rounded-lg border border-brand-line bg-brand-surface py-2 pl-9 pr-3 text-sm text-white outline-none placeholder:text-brand-muted focus:border-white/20"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <div className="w-[180px] relative">
            <Filter className="absolute left-2.5 top-3 h-4 w-4 text-brand-muted" />
            <select 
              className="flex h-9 w-full rounded-lg border border-brand-line bg-brand-surface py-2 pl-8 pr-3 text-sm text-white outline-none focus:border-white/20"
              value={statusFilter} 
              onChange={(e: any) => setStatusFilter(e.target.value as FilterStatus)}
            >
              <option value="ALL">Todos os clientes</option>
              <option value="HEALTHY">Saudáveis (&gt; 80)</option>
              <option value="WARNING">Atenção (50-79)</option>
              <option value="CRITICAL">Críticos (&lt; 50)</option>
              <option value="NO_DATA">Sem dados</option>
              <option value="NO_ACCOUNT">Sem conta Meta</option>
            </select>
          </div>
        </div>
      </div>

      {/* Grid section */}
      <div className="flex-1 overflow-auto px-5 py-5 lg:px-7">
        {loading ? (
          <div className="flex h-full items-center justify-center text-brand-muted">
            Carregando analytics de clientes...
          </div>
        ) : filteredClients.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-brand-line bg-brand-surface p-12 text-brand-muted">
            <Filter className="w-10 h-10 mb-3 opacity-20" />
            <p className="text-base font-semibold text-white">Nenhum cliente encontrado</p>
            <p className="text-sm">Tente ajustar a busca ou os filtros.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 pb-16 md:grid-cols-2 2xl:grid-cols-3">
            {filteredClients.map(c => (
              <ClientAnalyticsCard
                key={c.clientId}
                performance={c}
                period={period}
                onOpenCampaigns={handleOpenCampaigns}
                onOpenDetails={handleOpenDetails}
                onOpenMetaIntegration={onOpenMetaIntegration}
              />
            ))}
          </div>
        )}
      </div>

      <ClientCampaignDrawer
        isOpen={isCampaignDrawerOpen}
        onClose={() => setIsCampaignDrawerOpen(false)}
        performance={selectedPerformance}
        period={period}
      />
      <ClientAnalyticsDetailDrawer
        isOpen={isDetailDrawerOpen}
        onClose={() => setIsDetailDrawerOpen(false)}
        performance={selectedDetailPerformance}
        period={period}
        onOpenCampaigns={handleOpenCampaigns}
        onEditClient={onEditClient}
      />
    </div>
  );
}
