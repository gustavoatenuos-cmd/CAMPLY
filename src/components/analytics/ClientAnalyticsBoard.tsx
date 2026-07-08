import React, { useState, useMemo } from 'react';
import { type EnrichedGlobalClientPerformance } from '../../lib/performance/usePerformanceDashboard';
import { ClientAnalyticsCard } from './ClientAnalyticsCard';
import { ClientCampaignDrawer } from './ClientCampaignDrawer';
import { Search, Filter } from 'lucide-react';
import { resolveClientDecision } from '../../lib/performance/clientDecisionState';

interface ClientAnalyticsBoardProps {
  clients: EnrichedGlobalClientPerformance[];
  period: any;
  loading: boolean;
}

type FilterStatus = 'ALL' | 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'NO_DATA' | 'NO_ACCOUNT';

export function ClientAnalyticsBoard({ clients, period, loading }: ClientAnalyticsBoardProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('ALL');
  
  const [selectedPerformance, setSelectedPerformance] = useState<EnrichedGlobalClientPerformance | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const filteredClients = useMemo(() => {
    return clients.filter(c => {
      // 1. Search term
      const matchesSearch = c.clientName.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;

      // 2. Status filter
      if (statusFilter !== 'ALL') {
        const decision = resolveClientDecision({ performance: c });
        const macro = decision.macroStatus;
        
        if (statusFilter === 'NO_ACCOUNT' && macro !== 'not_connected') return false;
        if (statusFilter === 'NO_DATA' && macro !== 'no_data' && macro !== 'not_connected') return false;
        if (statusFilter === 'HEALTHY' && macro !== 'healthy') return false;
        if (statusFilter === 'WARNING' && macro !== 'attention' && macro !== 'not_configured') return false;
        if (statusFilter === 'CRITICAL' && macro !== 'critical') return false;
      }

      return true;
    });
  }, [clients, searchTerm, statusFilter]);

  const handleOpenCampaigns = (performance: EnrichedGlobalClientPerformance) => {
    setSelectedPerformance(performance);
    setIsDrawerOpen(true);
  };

  const handleOpenDetails = (performance: EnrichedGlobalClientPerformance) => {
    // For now we just open campaigns drawer. Future expansion for real detail view.
    handleOpenCampaigns(performance);
  };

  return (
    <div className="flex flex-col h-full bg-gray-50/30">
      {/* Header section with filters */}
      <div className="bg-white border-b px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-4 shrink-0">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Analytics por Cliente</h2>
          <p className="text-sm text-gray-500">Acompanhamento de orçamento e performance</p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
            <input 
              type="text"
              placeholder="Buscar cliente..." 
              className="pl-9 bg-gray-50 flex h-10 w-full rounded-md border border-input px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <div className="w-[180px] relative">
            <Filter className="absolute left-2.5 top-3 h-4 w-4 text-gray-400" />
            <select 
              className="pl-8 bg-gray-50 flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            Carregando analytics de clientes...
          </div>
        ) : filteredClients.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 bg-white border border-dashed rounded-lg p-12">
            <Filter className="w-10 h-10 mb-3 opacity-20" />
            <p className="text-lg font-medium text-gray-700">Nenhum cliente encontrado</p>
            <p className="text-sm">Tente ajustar a busca ou os filtros.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-20">
            {filteredClients.map(c => (
              <ClientAnalyticsCard 
                key={c.clientId} 
                performance={c} 
                onOpenCampaigns={handleOpenCampaigns}
                onOpenDetails={handleOpenDetails}
              />
            ))}
          </div>
        )}
      </div>

      <ClientCampaignDrawer 
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        performance={selectedPerformance}
        period={period}
      />
    </div>
  );
}
