import React, { useEffect, useState } from 'react';
import { Facebook, Link as LinkIcon, Unlink, RefreshCw, AlertTriangle, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { invokeFunction } from '../lib/invokeFunction';
import { applyMetaSyncToWorkspace } from '../lib/meta/applyMetaSyncToWorkspace';
import type { MetaSyncedCampaign, MetaSyncResponse } from '../lib/meta/metaSyncTypes';

import { CamplyData, Client, Campaign } from '../types';

interface MetaIntegrationViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

export function MetaIntegrationView({ data, updateData }: MetaIntegrationViewProps) {
  const [integration, setIntegration] = useState<any>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncedCampaigns, setSyncedCampaigns] = useState<MetaSyncedCampaign[]>([]);
  const [lastSyncResponse, setLastSyncResponse] = useState<MetaSyncResponse | null>(null);
  const [importingCampaign, setImportingCampaign] = useState<MetaSyncedCampaign | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string>('');

  const checkStatus = async () => {
    try {
      setIsLoading(true);
      const data = await invokeFunction<any>('meta-validate-token');
      if (data && data.status === 'active') {
        setIntegration(data.integration);
        if (data.assets) setAssets(data.assets);
      }
    } catch (e: any) {
      console.error(e);
      // Fail silently for status check to not block UI
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkStatus();
  }, []);

  const handleConnect = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await invokeFunction<{ url: string }>('meta-oauth-start');
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (e: any) {
      setError('Erro ao conectar: ' + e.message);
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Tem certeza que deseja desconectar a conta do Facebook? Isso parará todas as sincronizações.')) return;
    
    try {
      setIsLoading(true);
      await invokeFunction<{ success: boolean }>('meta-disconnect');
      setIntegration(null);
      setAssets([]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSyncAssets = async () => {
    try {
      setIsSyncing(true);
      setError(null);
      const data = await invokeFunction<any>('meta-list-assets');
      if (data?.assets) {
        setAssets(data.assets);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSyncAds = async (asset: { id?: string; asset_id?: string }) => {
    try {
      setIsLoading(true);
      setError(null);
      const payload = asset.id
        ? { metaAssetId: asset.id }
        : { adAccountId: asset.asset_id };
      if (!payload.metaAssetId && !payload.adAccountId) {
        throw new Error('Ativo Meta inválido para sincronização.');
      }

      const data = await invokeFunction<MetaSyncResponse>('meta-sync-ads', payload);
      
      setSyncedCampaigns(data.campaigns || []);
      setLastSyncResponse(data);
      alert(`Sucesso! ${data.campaigns?.length || 0} campanhas ativas sincronizadas.`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = () => {
    if (!importingCampaign || !selectedClientId || !lastSyncResponse) return;

    const selectedClient = data.clients.find(c => c.id === selectedClientId);
    if (!selectedClient) return;
    
    // Meta uses cents for budget
    const metaBudget = Number(importingCampaign.daily_budget || importingCampaign.lifetime_budget || 0) / 100;
    const contractBudget = selectedClient?.adInvestmentMeta || 0;
    // Determine cross-reference insights
    const newInsights: any[] = [];
    
    // 1. Budget Discrepancy Insight
    if (metaBudget * 30 > contractBudget && contractBudget > 0) {
      newInsights.push({
        id: crypto.randomUUID(),
        level: 'warning',
        title: 'Verba Meta Ads superior ao Contrato',
        description: `A campanha ${importingCampaign.name} tem orçamento que projeta R$ ${(metaBudget * 30).toFixed(2)}/mês, mas o contrato prevê R$ ${contractBudget.toFixed(2)}.`,
        recommendation: 'Reduza o orçamento da campanha na Meta ou faça um aditivo no contrato do cliente.'
      });
    }

    // 2. Financial Discrepancy (Client is paused/overdue but Campaign is LIVE)
    const hasOverdue = data.receivables.some(r => r.clientId === selectedClientId && r.status === 'overdue');
    if (hasOverdue || selectedClient?.status === 'paused') {
      newInsights.push({
        id: crypto.randomUUID(),
        level: 'critical',
        title: 'Campanha rodando com Pendência Financeira',
        description: `O cliente ${selectedClient?.name} possui pendências, mas a campanha ${importingCampaign.name} está ATIVA gerando custos.`,
        recommendation: 'Pause a campanha na Meta Ads imediatamente até a regularização do cliente.'
      });
    }

    updateData((prev) => {
      // Use standard sync application instead of manual construction
      const payload: MetaSyncResponse = {
        ...lastSyncResponse,
        campaigns: [importingCampaign],
      };
      const nextState = applyMetaSyncToWorkspace(selectedClient, payload, prev);
      
      return {
        ...nextState,
        agentLogs: newInsights.length > 0 ? [
          ...nextState.agentLogs,
          ...newInsights.map(insight => ({
            id: crypto.randomUUID(),
            relatedEntityId: nextState.campaigns.find((c: Campaign) => c.metaCampaignId === importingCampaign.id)?.id || '',
            relatedEntityType: 'campaign' as const,
            analysisType: 'Sincronização Meta Ads',
            classification: insight.level,
            reason: insight.title + ' - ' + insight.description,
            createdAt: new Date().toISOString(),
          }))
        ] : prev.agentLogs,
        agentAlerts: newInsights.length > 0 ? [
          ...prev.agentAlerts,
          ...newInsights.map(insight => ({
            id: crypto.randomUUID(),
            relatedEntityId: nextState.campaigns.find((c: Campaign) => c.metaCampaignId === importingCampaign.id)?.id || '',
            relatedEntityType: 'campaign' as const,
            clientId: selectedClientId,
            title: insight.title,
            message: insight.description,
            severity: insight.level,
            status: 'active' as const,
            suggestedAction: insight.recommendation,
            triggeredAt: new Date().toISOString(),
          }))
        ] : nextState.agentAlerts
      };
    });


    setImportingCampaign(null);
    setSelectedClientId('');
    alert('Campanha importada com sucesso para o CRM! ' + (newInsights.length > 0 ? `${newInsights.length} alertas gerados.` : ''));
  };

  return (
    <section className="flex h-full flex-col bg-brand-ink">
      <div className="flex items-center justify-between border-b border-brand-line bg-brand-surface p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600/20 text-blue-500">
            <Facebook size={24} />
          </div>
          <div>
            <h1 className="text-lg font-black text-white">Integração Meta Ads</h1>
            <p className="text-xs text-brand-muted">Conecte sua conta para gerenciar campanhas e ler dados com segurança</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 sm:p-8">
        <div className="mx-auto max-w-3xl space-y-8">
          
          {error && (
            <div className="flex items-center gap-3 rounded-lg border border-rose-500/50 bg-rose-500/10 p-4 text-rose-500">
              <AlertTriangle size={20} />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {/* Connection Status Card */}
          <div className="rounded-xl border border-brand-line bg-brand-surface p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Status da Conexão</h3>
                <p className="mt-1 text-sm text-brand-muted">
                  {integration 
                    ? `Conectado como ${integration.meta_user_name}` 
                    : 'Nenhuma conta conectada. Seus tokens ficarão criptografados e seguros.'}
                </p>
              </div>
              {integration ? (
                <div className="flex items-center gap-2 rounded-full bg-brand-green/20 px-3 py-1 text-xs font-bold text-brand-green">
                  <ShieldCheck size={14} />
                  Ativo e Seguro
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-full bg-brand-surface2 px-3 py-1 text-xs font-bold text-brand-soft">
                  <Unlink size={14} />
                  Desconectado
                </div>
              )}
            </div>

            <div className="mt-6 flex gap-3">
              {!integration ? (
                <button
                  onClick={handleConnect}
                  disabled={isLoading}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 font-bold text-white transition hover:bg-blue-700 disabled:opacity-50"
                >
                  <Facebook size={18} />
                  {isLoading ? 'Conectando...' : 'Conectar com Facebook'}
                </button>
              ) : (
                <>
                  <button
                    onClick={handleSyncAssets}
                    disabled={isSyncing}
                    className="flex items-center gap-2 rounded-lg bg-brand-green px-5 py-2.5 font-bold text-brand-ink transition disabled:opacity-50"
                  >
                    <RefreshCw size={18} className={isSyncing ? "animate-spin" : ""} />
                    Sincronizar Ativos
                  </button>
                  <button
                    onClick={handleDisconnect}
                    disabled={isLoading}
                    className="flex items-center gap-2 rounded-lg border border-brand-line px-5 py-2.5 font-bold text-rose-500 transition hover:bg-brand-surface2 disabled:opacity-50"
                  >
                    <Unlink size={18} />
                    Desconectar
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Assets Card */}
          {integration && (
            <div className="rounded-xl border border-brand-line bg-brand-surface overflow-hidden">
              <div className="border-b border-brand-line p-6">
                <h3 className="text-lg font-bold text-white">Contas de Anúncio e Páginas</h3>
                <p className="mt-1 text-sm text-brand-muted">Ativos sincronizados da sua conta Meta.</p>
              </div>
              <div className="divide-y divide-brand-line bg-brand-surface2/30">
                {assets.length === 0 ? (
                  <div className="p-8 text-center text-brand-muted">
                    Nenhum ativo sincronizado ainda. Clique em "Sincronizar Ativos" acima.
                  </div>
                ) : (
                  assets.map((asset, idx) => (
                    <div key={idx} className="flex items-center justify-between p-4 px-6 hover:bg-brand-surface2/50">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-surface border border-brand-line">
                          {asset.asset_type === 'adaccount' ? <CheckCircle2 size={14} className="text-brand-green" /> : <LinkIcon size={14} className="text-blue-400" />}
                        </div>
                        <div>
                          <p className="font-semibold text-white">{asset.asset_name}</p>
                          <p className="text-[10px] uppercase text-brand-soft">{asset.asset_type} • ID: {asset.asset_id}</p>
                        </div>
                      </div>
                      {asset.asset_type === 'adaccount' && (
                        <div className="flex gap-2">
                          <button onClick={() => handleSyncAds(asset)} className="rounded-lg bg-brand-green/10 px-3 py-1.5 text-xs font-bold text-brand-green hover:bg-brand-green/20">
                            Sincronizar Campanhas da Meta
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
              
              {/* Synced Campaigns List */}
              {syncedCampaigns.length > 0 && (
                <div className="border-t border-brand-line bg-brand-ink/50 p-6">
                  <h4 className="text-sm font-bold text-white mb-4">Campanhas Prontas para Importação</h4>
                  <div className="space-y-3">
                    {syncedCampaigns.map((camp) => {
                      const isImported = data.campaigns.some(c => c.name === camp.name && c.platform === 'Meta Ads');
                      const metrics = camp.globalMetricsByPeriod.last_7d || Object.values(camp.globalMetricsByPeriod)[0];
                      const spend = typeof metrics?.spend === 'number' ? metrics.spend : 0;
                      return (
                        <div key={camp.id} className="flex items-center justify-between rounded-lg border border-brand-line bg-brand-surface p-4">
                          <div>
                            <p className="font-bold text-white">{camp.name}</p>
                            <p className="text-xs text-brand-soft">Gasto: R$ {spend.toFixed(2)} • Meta ID: {camp.id}</p>
                            {camp.activeAdsData && camp.activeAdsData.length > 0 && (
                              <p className="mt-1 inline-flex items-center gap-1 rounded bg-brand-surface2 px-1.5 py-0.5 text-[10px] font-bold text-brand-soft">
                                {camp.activeAdsData.length} anúncios ativos
                              </p>
                            )}
                          </div>
                          <button
                            disabled={isImported}
                            onClick={() => setImportingCampaign(camp)}
                            className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            {isImported ? 'Já Importada' : 'Importar'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Security Info */}
          <div className="rounded-xl border border-brand-line/50 bg-brand-ink p-6">
            <h4 className="flex items-center gap-2 font-semibold text-brand-soft">
              <ShieldCheck size={16} className="text-brand-green" />
              Segurança e Privacidade
            </h4>
            <ul className="mt-4 space-y-3 text-sm text-brand-muted">
              <li className="flex gap-2"><div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green" /> Seu token é criptografado com AES-GCM (criptografia de grau militar) antes de ser salvo no banco de dados.</li>
              <li className="flex gap-2"><div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green" /> Nenhum token ou segredo da Meta é exposto no seu navegador ou frontend.</li>
              <li className="flex gap-2"><div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green" /> Toda comunicação com a Graph API acontece exclusivamente através de Edge Functions isoladas.</li>
              <li className="flex gap-2"><div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green" /> Usamos <code className="rounded bg-brand-surface px-1 py-0.5 text-brand-soft">appsecret_proof</code> em todas as chamadas para garantir que apenas nossos servidores autorizados consultem a Meta.</li>
            </ul>
          </div>

        </div>
      </div>

      {/* Import Modal */}
      {importingCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-brand-line bg-brand-surface p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-white">Importar Campanha</h2>
            <p className="mt-2 text-sm text-brand-muted">
              Você está importando a campanha <strong>{importingCampaign.name}</strong>.
              A qual cliente do CRM ela pertence?
            </p>

            <div className="mt-6">
              <label className="mb-2 block text-sm font-semibold text-brand-soft">Cliente</label>
              <select
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="w-full rounded-lg border border-brand-line bg-brand-ink px-4 py-3 text-white outline-none transition focus:border-brand-green"
              >
                <option value="" disabled>Selecione um cliente...</option>
                {data.clients.map(client => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </select>
            </div>

            <div className="mt-8 flex gap-3">
              <button
                onClick={() => { setImportingCampaign(null); setSelectedClientId(''); }}
                className="flex-1 rounded-lg px-4 py-3 font-bold text-brand-soft hover:bg-brand-ink"
              >
                Cancelar
              </button>
              <button
                onClick={handleImport}
                disabled={!selectedClientId}
                className="flex-1 rounded-lg bg-brand-green px-4 py-3 font-bold text-brand-ink hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Confirmar Importação
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
