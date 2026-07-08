import React, { useState, useMemo, useEffect } from 'react';
import type { CamplyData, Client } from '../types';
import { CLIENT_CATEGORY_LABELS } from '../types';
import { CategoryBadge } from './CategoryBadge';
import { ClientLogo } from './clients/ClientLogo';
import { motion, AnimatePresence } from 'framer-motion';
import { usePerformanceDashboard } from '../lib/performance/usePerformanceDashboard';
import { GlobalClientPerformance } from '../lib/performance/globalPerformanceDashboard';
import { PerformanceStatusBadge } from './performance/PerformanceStatusBadge';
import { loadMetaHierarchy, type MetaHierarchyItem } from '../lib/meta/performanceHierarchyService';
import { AlertTriangle, Info, ChevronDown, ChevronRight, Activity, Loader2 } from 'lucide-react';

interface ClientAnalyticsViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

// ==================== CLIENT CARD ====================

interface ClientCardProps {
  performanceClient: GlobalClientPerformance;
  workspaceClient: Client | undefined;
  isSelected: boolean;
  onSelect: () => void;
}

function ClientCard({ performanceClient, workspaceClient, isSelected, onSelect }: ClientCardProps) {
  const displayStatus = performanceClient.score.status === 'excellent' || performanceClient.score.status === 'healthy' ? 'on_track' : performanceClient.score.status as any || 'insufficient_data';

  return (
    <motion.button
      whileHover={{ x: 4 }}
      onClick={onSelect}
      className={`w-full rounded-xl border p-4 text-left transition-all duration-300 flex items-center gap-3 ${
        isSelected
          ? 'border-brand-green/50 bg-brand-green/10 shadow-[inset_0_0_15px_rgba(0,229,153,0.1)]'
          : 'border-white/[0.05] bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]'
      }`}
    >
      <ClientLogo name={workspaceClient?.company || workspaceClient?.name || performanceClient.clientName} logoUrl={workspaceClient?.logoUrl} size="md" />
      
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-start mb-1">
          <p className="truncate text-sm font-semibold text-white">
            {workspaceClient?.company || workspaceClient?.name || performanceClient.clientName}
          </p>
          <div className="flex items-center gap-1 text-[10px] font-bold text-white bg-white/10 px-1.5 py-0.5 rounded">
            {performanceClient.score.value !== null ? performanceClient.score.value.toFixed(0) : '—'}
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          {workspaceClient?.category && <CategoryBadge category={workspaceClient.category} size="sm" />}
          <PerformanceStatusBadge status={displayStatus} />
        </div>
      </div>
    </motion.button>
  );
}

// ==================== CAMPAIGN HIERARCHY PANEL ====================

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'R$ 0,00';
  return `R$ ${value.toFixed(2).replace('.', ',')}`;
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '0';
  return value.toLocaleString('pt-BR');
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '0%';
  return `${value.toFixed(2)}%`;
}

interface CampaignRowProps {
  campaign: MetaHierarchyItem;
  clientMetaAssetId: string;
  period: any;
}

function CampaignRow({ campaign, clientMetaAssetId, period }: CampaignRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [adsets, setAdsets] = useState<MetaHierarchyItem[]>([]);
  const [loading, setLoading] = useState(false);

  const toggleExpand = async () => {
    if (!expanded && adsets.length === 0) {
      setLoading(true);
      try {
        const result = await loadMetaHierarchy({
          clientMetaAssetId,
          period: period as any,
          level: 'adset',
          parentId: campaign.id,
          page: 1,
          pageSize: 50
        });
        setAdsets(result.items);
      } catch (e) {
        console.error('Failed to load adsets', e);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(!expanded);
  };

  const spent = campaign.metrics?.['spend']?.value || 0;
  
  // Base metrics for any block
  let mainMetrics = (
    <>
      <div className="flex flex-col"><span className="text-[10px] text-zinc-500">Gasto</span><span className="text-sm font-medium">{formatMoney(spent)}</span></div>
    </>
  );

  if (campaign.classifiedObjective === 'SALES') {
    const purchases = campaign.metrics?.['purchases']?.value || 0;
    const cpa = purchases > 0 ? spent / purchases : 0;
    const roas = campaign.metrics?.['purchase_roas']?.value || 0;
    const purchaseValue = campaign.metrics?.['purchase_value']?.value || 0;
    
    mainMetrics = (
      <>
        {mainMetrics}
        <div className="flex flex-col"><span className="text-[10px] text-zinc-500">Compras</span><span className="text-sm font-medium">{formatNumber(purchases)}</span></div>
        <div className="flex flex-col"><span className="text-[10px] text-zinc-500">CPA</span><span className="text-sm font-medium">{formatMoney(cpa)}</span></div>
        <div className="flex flex-col"><span className="text-[10px] text-zinc-500">ROAS</span><span className="text-sm font-medium">{formatNumber(roas)}x</span></div>
        <div className="flex flex-col"><span className="text-[10px] text-zinc-500">Valor</span><span className="text-sm font-medium text-emerald-400">{formatMoney(purchaseValue)}</span></div>
      </>
    );
  } else if (campaign.classifiedObjective === 'LEADS' || campaign.classifiedObjective === 'MESSAGING') {
    const leads = campaign.metrics?.['leads']?.value || 0;
    const conv = campaign.metrics?.['messaging_conversations_started_total']?.value || 0;
    const cpl = leads > 0 ? spent / leads : 0;
    const cpcv = conv > 0 ? spent / conv : 0;

    mainMetrics = (
      <>
        {mainMetrics}
        {campaign.classifiedObjective === 'LEADS' ? (
          <>
            <div className="flex flex-col"><span className="text-[10px] text-zinc-500">Leads</span><span className="text-sm font-medium">{formatNumber(leads)}</span></div>
            <div className="flex flex-col"><span className="text-[10px] text-zinc-500">CPL</span><span className="text-sm font-medium">{formatMoney(cpl)}</span></div>
          </>
        ) : (
          <>
            <div className="flex flex-col"><span className="text-[10px] text-zinc-500">Conversas</span><span className="text-sm font-medium">{formatNumber(conv)}</span></div>
            <div className="flex flex-col"><span className="text-[10px] text-zinc-500">CP Conversa</span><span className="text-sm font-medium">{formatMoney(cpcv)}</span></div>
          </>
        )}
      </>
    );
  } else if (campaign.classifiedObjective === 'AWARENESS' || campaign.classifiedObjective === 'REACH') {
    const reach = campaign.metrics?.['reach']?.value || 0;
    const imp = campaign.metrics?.['impressions']?.value || 0;
    const cpm = campaign.metrics?.['cpm']?.value || 0;
    const freq = campaign.metrics?.['frequency']?.value || 0;

    mainMetrics = (
      <>
        {mainMetrics}
        <div className="flex flex-col"><span className="text-[10px] text-zinc-500">Alcance</span><span className="text-sm font-medium">{formatNumber(reach)}</span></div>
        <div className="flex flex-col"><span className="text-[10px] text-zinc-500">Impr.</span><span className="text-sm font-medium">{formatNumber(imp)}</span></div>
        <div className="flex flex-col"><span className="text-[10px] text-zinc-500">CPM</span><span className="text-sm font-medium">{formatMoney(cpm)}</span></div>
        <div className="flex flex-col"><span className="text-[10px] text-zinc-500">Freq.</span><span className="text-sm font-medium">{formatNumber(freq)}</span></div>
      </>
    );
  } else {
    const clicks = campaign.metrics?.['link_clicks']?.value || 0;
    const ctr = campaign.metrics?.['ctr']?.value || 0;
    const cpc = campaign.metrics?.['cpc']?.value || 0;
    const lpv = campaign.metrics?.['landing_page_views']?.value || 0;

    mainMetrics = (
      <>
        {mainMetrics}
        <div className="flex flex-col"><span className="text-[10px] text-zinc-500">Cliques</span><span className="text-sm font-medium">{formatNumber(clicks)}</span></div>
        <div className="flex flex-col"><span className="text-[10px] text-zinc-500">CTR</span><span className="text-sm font-medium">{formatPercent(ctr)}</span></div>
        <div className="flex flex-col"><span className="text-[10px] text-zinc-500">CPC</span><span className="text-sm font-medium">{formatMoney(cpc)}</span></div>
        <div className="flex flex-col"><span className="text-[10px] text-zinc-500">Views Page</span><span className="text-sm font-medium">{formatNumber(lpv)}</span></div>
      </>
    );
  }

  return (
    <div className="border border-white/5 bg-white/[0.02] rounded-lg overflow-hidden mb-2">
      <div 
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-white/[0.04]"
        onClick={toggleExpand}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <button className="text-zinc-400 hover:text-white p-1">
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <div className={`w-2 h-2 rounded-full ${campaign.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
          <span className="font-medium text-sm text-zinc-200 truncate">{campaign.name}</span>
        </div>
        <div className="flex items-center gap-6 text-right shrink-0">
          {mainMetrics}
        </div>
      </div>
      
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-white/5 bg-black/20 p-3"
          >
            {loading ? (
              <div className="flex justify-center p-4"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>
            ) : adsets.length === 0 ? (
              <div className="text-center text-xs text-zinc-500 p-2">Nenhum conjunto encontrado com entrega neste período.</div>
            ) : (
              <div className="flex flex-col gap-1 pl-4">
                {adsets.map(adset => (
                  <div key={adset.id} className="flex items-center justify-between py-1.5 text-xs text-zinc-400 border-b border-white/5 last:border-0">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className={`w-1.5 h-1.5 rounded-full ${adset.status === 'ACTIVE' ? 'bg-emerald-500/50' : 'bg-zinc-600/50'}`} />
                      <span className="truncate">{adset.name}</span>
                    </div>
                    <div className="flex items-center gap-4 text-right">
                      <span className="w-20">Gasto: {formatMoney(adset.metrics?.['spend']?.value)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ==================== MAIN VIEW ====================

export function ClientAnalyticsView({ data }: ClientAnalyticsViewProps) {
  const { clients, loading, period, setPeriod } = usePerformanceDashboard(data);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [metaCampaigns, setMetaCampaigns] = useState<MetaHierarchyItem[]>([]);

  // Filtering sidebar clients
  const filteredClients = useMemo(() => {
    return clients.filter(c => {
      const matchSearch =
        !search ||
        c.clientName.toLowerCase().includes(search.toLowerCase());
      return matchSearch;
    });
  }, [clients, search]);

  const selectedClient = useMemo(
    () => clients.find(c => c.clientId === selectedClientId) ?? (filteredClients[0] || null),
    [selectedClientId, clients, filteredClients]
  );
  
  const workspaceClient = useMemo(
    () => selectedClient ? data.clients.find(c => c.id === selectedClient.clientId) : undefined,
    [selectedClient, data.clients]
  );

  useEffect(() => {
    if (!selectedClient || !workspaceClient?.metaAdAccountId) {
      setMetaCampaigns([]);
      return;
    }

    const loadCampaigns = async () => {
      setCampaignsLoading(true);
      setCampaignsError(null);
      try {
        const result = await loadMetaHierarchy({
          clientMetaAssetId: workspaceClient.metaAdAccountId!,
          period: period as any,
          level: 'campaign',
          page: 1,
          pageSize: 100
        });
        setMetaCampaigns(result.items);
      } catch (err) {
        console.error('Failed to load client campaigns:', err);
        setCampaignsError('Não foi possível carregar campanhas da Meta agora.');
      } finally {
        setCampaignsLoading(false);
      }
    };

    void loadCampaigns();
  }, [selectedClient, workspaceClient?.metaAdAccountId, period]);

  // Group campaigns by objective
  const groupedCampaigns = useMemo(() => {
    const groups: Record<string, MetaHierarchyItem[]> = {
      SALES: [],
      LEADS: [],
      AWARENESS: [],
      TRAFFIC: [],
      OTHER: []
    };

    metaCampaigns.forEach(campaign => {
      if (campaign.classifiedObjective === 'SALES') {
        groups.SALES.push(campaign);
      } else if (campaign.classifiedObjective === 'LEADS' || campaign.classifiedObjective === 'MESSAGING') {
        groups.LEADS.push(campaign);
      } else if (campaign.classifiedObjective === 'AWARENESS' || campaign.classifiedObjective === 'REACH') {
        groups.AWARENESS.push(campaign);
      } else if (campaign.classifiedObjective === 'TRAFFIC' || campaign.classifiedObjective === 'ENGAGEMENT') {
        groups.TRAFFIC.push(campaign);
      } else {
        groups.OTHER.push(campaign);
      }
    });

    return groups;
  }, [metaCampaigns]);

  // Main UI empty states
  let mainContent;
  if (!selectedClient) {
    mainContent = (
      <div className="flex h-full items-center justify-center">
        <p className="text-zinc-500">Selecione um cliente para ver as métricas reais da Meta</p>
      </div>
    );
  } else if (!workspaceClient?.metaAdAccountId) {
    mainContent = (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <p className="text-zinc-300 font-medium">Conta Meta não vinculada.</p>
          <p className="text-zinc-500 text-sm mt-1">Conecte o ad account nas configurações do cliente.</p>
        </div>
      </div>
    );
  } else if (selectedClient.clientStatus === 'never_synced') {
    mainContent = (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Activity className="w-10 h-10 text-zinc-500 mx-auto mb-3" />
          <p className="text-zinc-300 font-medium">Nunca sincronizado.</p>
        </div>
      </div>
    );
  } else if (selectedClient.clientStatus === 'period_not_synced') {
    mainContent = (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Info className="w-10 h-10 text-sky-500 mx-auto mb-3" />
          <p className="text-zinc-300 font-medium">Período atual ainda não sincronizado.</p>
        </div>
      </div>
    );
  } else if (campaignsLoading) {
    mainContent = (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-8 h-8 text-brand-green animate-spin" />
      </div>
    );
  } else if (campaignsError) {
    mainContent = (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-rose-400">
          <AlertTriangle className="w-10 h-10 mx-auto mb-3" />
          <p>{campaignsError}</p>
        </div>
      </div>
    );
  } else if (metaCampaigns.length === 0) {
    mainContent = (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Info className="w-10 h-10 text-zinc-500 mx-auto mb-3" />
          <p className="text-zinc-400">Nenhuma campanha com entrega neste período.</p>
        </div>
      </div>
    );
  } else {
    // Render grouped campaigns
    mainContent = (
      <div className="flex flex-col gap-8 pb-10">
        {groupedCampaigns.SALES.length > 0 && (
          <section>
            <h3 className="text-sm font-bold text-emerald-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              Campanhas de Vendas
            </h3>
            {groupedCampaigns.SALES.map(c => <CampaignRow key={c.id} campaign={c} period={period} clientMetaAssetId={workspaceClient.metaAdAccountId!} />)}
          </section>
        )}
        
        {groupedCampaigns.LEADS.length > 0 && (
          <section>
            <h3 className="text-sm font-bold text-sky-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-sky-400" />
              Campanhas de Leads / Conversas
            </h3>
            {groupedCampaigns.LEADS.map(c => <CampaignRow key={c.id} campaign={c} period={period} clientMetaAssetId={workspaceClient.metaAdAccountId!} />)}
          </section>
        )}

        {groupedCampaigns.AWARENESS.length > 0 && (
          <section>
            <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-400" />
              Campanhas de Alcance
            </h3>
            {groupedCampaigns.AWARENESS.map(c => <CampaignRow key={c.id} campaign={c} period={period} clientMetaAssetId={workspaceClient.metaAdAccountId!} />)}
          </section>
        )}

        {groupedCampaigns.TRAFFIC.length > 0 && (
          <section>
            <h3 className="text-sm font-bold text-violet-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400" />
              Campanhas de Tráfego / Engajamento
            </h3>
            {groupedCampaigns.TRAFFIC.map(c => <CampaignRow key={c.id} campaign={c} period={period} clientMetaAssetId={workspaceClient.metaAdAccountId!} />)}
          </section>
        )}

        {groupedCampaigns.OTHER.length > 0 && (
          <section>
            <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-zinc-400" />
              Outras Campanhas
            </h3>
            {groupedCampaigns.OTHER.map(c => <CampaignRow key={c.id} campaign={c} period={period} clientMetaAssetId={workspaceClient.metaAdAccountId!} />)}
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* ── Sidebar: client list ── */}
      <aside className="flex h-full w-[340px] flex-shrink-0 flex-col gap-3 overflow-y-auto border-r border-white/8 p-4">
        <div className="flex-shrink-0">
          <h2 className="mb-3 text-lg font-bold text-white">Analytics por Cliente</h2>

          {/* Search */}
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar cliente..."
            className="mb-4 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
          />
        </div>

        {/* Client list */}
        <div className="flex flex-col gap-2">
          {loading ? (
             <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>
          ) : filteredClients.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              {search ? 'Nenhum cliente encontrado' : 'Nenhum cliente ativo sincronizado'}
            </p>
          ) : (
            filteredClients.map(client => {
              const wsClient = data.clients.find(c => c.id === client.clientId);
              return (
                <ClientCard
                  key={client.clientId}
                  performanceClient={client}
                  workspaceClient={wsClient}
                  isSelected={selectedClient?.clientId === client.clientId}
                  onSelect={() => setSelectedClientId(client.clientId)}
                />
              );
            })
          )}
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6 bg-black/20">
        {selectedClient && workspaceClient && (
           <div className="mb-8 border-b border-white/10 pb-6 flex items-start justify-between">
              <div className="flex items-center gap-4">
                <ClientLogo name={workspaceClient.company || workspaceClient.name} logoUrl={workspaceClient.logoUrl} size="lg" />
                <div>
                  <h1 className="text-3xl font-bold text-white mb-1">{workspaceClient.company || workspaceClient.name}</h1>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-zinc-400 flex items-center gap-1">
                      ID Meta: <span className="text-zinc-300 font-mono text-xs">{workspaceClient.metaAdAccountId || 'Não configurado'}</span>
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-4">
                <select 
                  value={period}
                  onChange={(e) => setPeriod(e.target.value as any)}
                  className="bg-white/5 border border-white/10 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-brand-green/50"
                >
                  <option value="last_7d">Últimos 7 dias</option>
                  <option value="last_30d">Últimos 30 dias</option>
                  <option value="last_90d">Últimos 90 dias</option>
                  <option value="this_month">Mês atual</option>
                  <option value="today">Hoje</option>
                </select>
                
                <div className="glass-card flex flex-col items-end justify-center px-4 py-2 rounded-xl">
                   <span className="text-xs text-zinc-400">Score Real</span>
                   <span className="text-xl font-bold text-white">{selectedClient.score.value !== null ? selectedClient.score.value.toFixed(0) : '—'}</span>
                </div>
              </div>
           </div>
        )}
        
        {mainContent}
      </main>
    </div>
  );
}
