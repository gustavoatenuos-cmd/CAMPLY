import React, { useState, useEffect } from 'react';
import { type EnrichedGlobalClientPerformance } from '../../lib/performance/usePerformanceDashboard';
import { X, ExternalLink, Loader2 } from 'lucide-react';
import { loadMetaHierarchy, type MetaHierarchyItem } from '../../lib/meta/performanceHierarchyService';
import { PerformanceStatusBadge } from '../performance/PerformanceStatusBadge';

interface ClientCampaignDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  performance: EnrichedGlobalClientPerformance | null;
  period: any;
}

export function ClientCampaignDrawer({ isOpen, onClose, performance, period }: ClientCampaignDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<MetaHierarchyItem[]>([]);

  useEffect(() => {
    if (!isOpen || !performance?.clientId) return;

    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const clientMetaAssetId = performance!.accounts?.[0]?.clientMetaAssetId;
        if (!clientMetaAssetId) {
          throw new Error('Conta Meta não encontrada para este cliente.');
        }
        const hierarchy = await loadMetaHierarchy({ clientMetaAssetId, period, level: 'campaign' });
        if (mounted) {
          setCampaigns(hierarchy.items);
        }
      } catch (err: any) {
        if (mounted) {
          console.error('[ClientCampaignDrawer] Error loading hierarchy:', err);
          setError(err.message || 'Erro ao carregar campanhas da Meta.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    load();

    return () => { mounted = false; };
  }, [isOpen, performance?.clientId, period]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-sm transition-all" onClick={onClose}>
      <div 
        className="w-full max-w-2xl h-full bg-white shadow-2xl flex flex-col transform transition-transform border-l border-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col space-y-1.5 p-6 border-b">
          <div className="flex justify-between items-center">
            <h3 className="font-semibold text-lg tracking-tight">Campanhas: {performance?.clientName}</h3>
            <button onClick={onClose} className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-sm text-muted-foreground">
            Desempenho detalhado das campanhas sincronizadas
          </p>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {loading && (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
              <span>Carregando campanhas da Meta...</span>
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-col items-center justify-center h-full text-red-500 bg-red-50 p-6 rounded-lg text-center">
              <h4 className="font-bold mb-2">Falha no carregamento</h4>
              <p className="text-sm">{error}</p>
            </div>
          )}

          {!loading && !error && campaigns.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 bg-gray-50 p-6 rounded-lg text-center border border-dashed">
              <p>Nenhuma campanha encontrada no período.</p>
            </div>
          )}

          {!loading && !error && campaigns.length > 0 && (
            <div className="space-y-4">
              {campaigns.map(camp => (
                <div key={camp.id} className="bg-white border rounded-lg p-4 hover:shadow-sm transition-shadow">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h4 className="font-medium text-gray-900 leading-tight mb-1 flex items-center gap-2">
                        {camp.name}
                        <a 
                          href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${performance?.clientId}&selected_campaign_ids=${camp.id}`}
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-gray-400 hover:text-indigo-600 transition-colors"
                          title="Abrir no Gerenciador de Anúncios"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </h4>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className={`px-2 py-0.5 rounded-full ${
                          camp.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                        }`}>
                          {camp.status}
                        </span>
                        <span>•</span>
                        <span>{camp.objective || 'Sem objetivo'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-gray-100">
                    <div>
                      <div className="text-xs text-gray-500">Gasto</div>
                      <div className="font-medium text-sm">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(camp.metrics?.spend?.value || 0)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Compras</div>
                      <div className="font-medium text-sm">
                        {camp.metrics?.purchases?.value || 0}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">CPA</div>
                      <div className="font-medium text-sm">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
                          (camp.metrics?.spend?.value || 0) / (camp.metrics?.purchases?.value || 1)
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">ROAS</div>
                      <div className="font-medium text-sm">
                        {camp.metrics?.purchase_roas?.value?.toFixed(2) || '0.00'}x
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
