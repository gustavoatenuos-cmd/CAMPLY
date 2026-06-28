import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd';
import { Target, MessageSquare, TrendingUp, TrendingDown, Eye, CheckCircle2, PlayCircle, BarChart3, Edit3, Image as ImageIcon, Plus, ShieldAlert, History, ExternalLink, Loader2, Link as LinkIcon } from 'lucide-react';
import { FormEvent, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { campaignColumns, campaignStatusLabels, createActivityLog, makeId, money, formatDate } from '../data/camplyStore';
import { campaignPlatforms, metaCampaignObjectives } from '../data/options';
import { Modal } from './ui/Modal';
import { Campaign, CamplyData, CampaignStatus, Priority } from '../types';
import { clientDisplayName, clientOptionLabel } from './ClientsView';
import { CampaignObjectiveBlocks } from './meta/CampaignObjectiveBlocks';
import { ReconciliationModal } from './meta/ReconciliationModal';

interface CampaignsViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

export function CampaignsView({ data, updateData }: CampaignsViewProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [creativesModalCampaignId, setCreativesModalCampaignId] = useState<string | null>(null);
  const [reconciliationSyncRunId, setReconciliationSyncRunId] = useState<string | null>(null);
  const [creativesData, setCreativesData] = useState<any[]>([]);
  const [isLoadingCreatives, setIsLoadingCreatives] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('maximum');

  const editingCampaign = data.campaigns.find((c) => c.id === editingCampaignId);
  const creativesCampaign = data.campaigns.find((c) => c.id === creativesModalCampaignId);
  const isEditingMatrix = editingCampaign?.isMatrix || (!editingCampaign?.metaCampaignId && !!editingCampaign);
  const subCampaigns = isEditingMatrix ? data.campaigns.filter(c => editingCampaign?.subCampaignIds?.includes(c.id)) : [];
  
  let activeMetrics = editingCampaign?.globalMetricsByPeriod?.[selectedPeriod] || editingCampaign?.normalizedMetricsByPeriod?.[selectedPeriod] || editingCampaign || {} as any;
  let aggregatedAdSets = editingCampaign?.activeAdSets || [];
  
  if (isEditingMatrix) {
    let spent = 0;
    let activeCreatives = 0;
    let allAdSets: any[] = [];
    
    subCampaigns.forEach(sub => {
       const subMetrics = sub.globalMetricsByPeriod?.[selectedPeriod] || sub.normalizedMetricsByPeriod?.[selectedPeriod] || sub;
       spent += ((subMetrics as any).spend || (subMetrics as any).spent || 0);
       activeCreatives += (sub.activeCreatives || 0);
       if (sub.activeAdSets) {
         allAdSets = [...allAdSets, ...sub.activeAdSets];
       }
    });
    
    activeMetrics = {
      ...activeMetrics,
      spend: spent,
    };
    aggregatedAdSets = allAdSets;
  }

  useEffect(() => {
    setSelectedPeriod('maximum');
  }, [editingCampaignId]);

  useEffect(() => {
    if (creativesModalCampaignId && creativesCampaign?.metaCampaignId) {
      setIsLoadingCreatives(true);
      setCreativesData([]);
      if (supabase) {
        supabase.functions.invoke('meta-fetch-creatives', {
          body: { targetId: creativesCampaign.metaCampaignId, type: 'campaign' }
        }).then(({ data, error }) => {
          setIsLoadingCreatives(false);
          if (data?.ads) {
            setCreativesData(data.ads);
          }
        });
      }
    }
  }, [creativesModalCampaignId, creativesCampaign?.metaCampaignId]);

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const status = result.destination.droppableId as CampaignStatus;
    const campaign = data.campaigns.find((item) => item.id === result.draggableId);
    const client = data.clients.find((item) => item.id === campaign?.clientId);
    updateData((current) => ({
      ...current,
      campaigns: current.campaigns.map((campaign) => (campaign.id === result.draggableId ? { ...campaign, status } : campaign)),
      activityLogs: campaign
        ? [
            createActivityLog({
              action: 'campaign_status_changed',
              title: `Campanha movida: ${campaign.name}`,
              description: `Campanha alterada para ${campaignStatusLabels[status]}.`,
              projectId: client?.projectId ?? '',
              clientId: campaign.clientId,
              campaignId: campaign.id,
              receivableId: '',
              taskId: '',
            }),
            ...current.activityLogs,
          ]
        : current.activityLogs,
    }));
  };

  const saveCampaign = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    
    if (editingCampaign) {
      const isMatrix = editingCampaign.isMatrix || (!editingCampaign.metaCampaignId);
      const spent = isMatrix ? (activeMetrics.spend || 0) : Number(form.get('spent') ?? editingCampaign.spent);
      const activeCreatives = isMatrix ? subCampaigns.reduce((acc, sub) => acc + (sub.activeCreatives || 0), 0) : Number(form.get('activeCreatives') ?? editingCampaign.activeCreatives ?? 0);
      const subCampaignIds = form.getAll('subCampaignIds').map(String);
      
      const updatedCampaign: Campaign = {
        ...editingCampaign,
        name: String(form.get('name') ?? editingCampaign.name),
        budget: Number(form.get('budget') ?? editingCampaign.budget),
        spent,
        activeCreatives,
        targetResults: Number(form.get('targetResults') ?? editingCampaign.targetResults ?? 0),
        targetCPA: Number(form.get('targetCPA') ?? editingCampaign.targetCPA ?? 0),
        lastOptimizedAt: String(form.get('lastOptimizedAt') ?? editingCampaign.lastOptimizedAt),
        nextAction: String(form.get('nextAction') ?? editingCampaign.nextAction),
        status: String(form.get('status') ?? editingCampaign.status) as CampaignStatus,
        priority: String(form.get('priority') ?? editingCampaign.priority) as Priority,
        isMatrix,
        subCampaignIds: isMatrix ? subCampaignIds : editingCampaign.subCampaignIds,
      };

      updateData((current) => ({
        ...current,
        campaigns: current.campaigns.map((item) => (item.id === editingCampaign.id ? updatedCampaign : item)),
        activityLogs: [
          createActivityLog({
            action: 'campaign_updated' as any,
            title: `Dashboard de campanha atualizado: ${updatedCampaign.name}`,
            description: `Métricas operacionais, resultados e próxima ação ajustados.`,
            projectId: '',
            clientId: updatedCampaign.clientId,
            campaignId: updatedCampaign.id,
            receivableId: '',
            taskId: '',
          }),
          ...current.activityLogs,
        ],
      }));
    } else {
      const clientId = String(form.get('clientId') ?? '');
      const name = String(form.get('name') ?? '').trim();
      const client = data.clients.find((item) => item.id === clientId);
      if (!client || !name) return;

      const campaign: Campaign = {
        id: makeId('campaign'),
        clientId: client.id,
        name,
        platform: String(form.get('platform') ?? 'Meta Ads') as 'Meta Ads',
        status: String(form.get('status') ?? 'setup') as CampaignStatus,
        objective: String(form.get('objective') ?? 'Tráfego'),
        budget: Number(form.get('budget') ?? 0),
        spent: 0,
        lastOptimizedAt: undefined,
        nextAction: '',
        priority: String(form.get('priority') ?? 'medium') as Priority,
        isMatrix: true,
      };

      updateData((current) => ({
        ...current,
        campaigns: [campaign, ...current.campaigns],
        activityLogs: [
          createActivityLog({
            action: 'campaign_created',
            title: `Campanha criada: ${campaign.name}`,
            description: `${campaign.platform} para ${clientDisplayName(client)}, objetivo ${campaign.objective}.`,
            projectId: client.projectId,
            clientId: client.id,
            campaignId: campaign.id,
            receivableId: '',
            taskId: '',
          }),
          ...current.activityLogs,
        ],
      }));
    }

    setModalOpen(false);
    setEditingCampaignId(null);
  };

  return (
    <section className="flex h-full flex-col">
      <header className="border-b border-brand-line bg-brand-ink px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-green">Campanhas</p>
            <h1 className="mt-1 text-2xl font-black text-white">Quadro operacional</h1>
          </div>
          <button onClick={() => { setEditingCampaignId(null); setModalOpen(true); }} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-green px-4 py-3 text-sm font-bold text-brand-ink">
            <Plus size={18} />
            Startar campanha
          </button>
        </div>
      </header>

      <Modal title="Startar campanha" description="Configure os dados base para a campanha nascer no quadro operacional." open={modalOpen && !editingCampaignId} onClose={() => setModalOpen(false)}>
        <form onSubmit={saveCampaign} className="space-y-5 p-5">
          {data.clients.length === 0 && (
            <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
              Cadastre um cliente antes de criar campanhas.
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block md:col-span-2">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Cliente</span>
              <select name="clientId" required className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
                <option value="">Selecione</option>
                {data.clients.map((client) => (
                  <option key={client.id} value={client.id}>{clientOptionLabel(client, data.projects)}</option>
                ))}
              </select>
            </label>
            <Field label="Nome da campanha" name="name" placeholder="Ex: [C01] Captação de Leads" required />
            <Field label="Verba planejada" name="budget" type="number" min="0" step="0.01" />
            
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Plataforma</span>
              <select name="platform" className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
                {campaignPlatforms.map((platform) => <option key={platform}>{platform}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Objetivo</span>
              <select name="objective" className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
                {metaCampaignObjectives.map((objective) => <option key={objective}>{objective}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Prioridade</span>
              <select name="priority" className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
                <option value="low">Baixa</option>
                <option value="medium">Média</option>
                <option value="high">Alta</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Etapa</span>
              <select name="status" className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
                {campaignColumns.map((status) => <option key={status} value={status}>{campaignStatusLabels[status]}</option>)}
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-3 border-t border-brand-line pt-5">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg border border-brand-line px-4 py-2 font-semibold text-brand-soft">Cancelar</button>
            <button disabled={data.clients.length === 0} className="rounded-lg bg-brand-green px-4 py-2 font-bold text-brand-ink disabled:opacity-50">Salvar campanha</button>
          </div>
        </form>
      </Modal>

      <Modal title="Dashboard da campanha" description="Gerencie a inteligência, performance e próxima ação de otimização." open={!!editingCampaignId} onClose={() => setEditingCampaignId(null)}>
        {editingCampaign && (
          <form key={`${editingCampaign.id}-${selectedPeriod}`} onSubmit={saveCampaign} className="space-y-6 p-5">
            <div className="rounded-xl border border-brand-line bg-brand-surface p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-white">{editingCampaign.name}</h3>
                    <span className="rounded-full bg-brand-ink px-2.5 py-1 text-xs font-semibold text-brand-soft">{editingCampaign.platform}</span>
                  </div>
                  <p className="mt-1 text-sm text-brand-muted">{clientDisplayName(data.clients.find(c => c.id === editingCampaign.clientId))} • {editingCampaign.objective}</p>
                </div>
                <div className="flex items-center gap-2">
                  {editingCampaign.syncRunId && (
                    <button
                      type="button"
                      onClick={() => setReconciliationSyncRunId(editingCampaign.syncRunId || null)}
                      className="flex items-center gap-1.5 rounded-lg border border-brand-line bg-brand-surface2 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-line transition-colors"
                    >
                      <History size={14} />
                      Conciliar último completo
                    </button>
                  )}
                  {editingCampaign.partialSyncRunId && editingCampaign.partialSyncRunId !== editingCampaign.syncRunId && (
                    <button
                      type="button"
                      onClick={() => setReconciliationSyncRunId(editingCampaign.partialSyncRunId || null)}
                      className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-500/20 transition-colors"
                    >
                      <ShieldAlert size={14} />
                      Conciliar parcial
                    </button>
                  )}
                  {(editingCampaign.globalMetricsByPeriod || editingCampaign.normalizedMetricsByPeriod || editingCampaign.metricsByPeriod) && (
                    <select 
                      value={selectedPeriod} 
                      onChange={(e) => setSelectedPeriod(e.target.value)}
                      className="rounded-lg border border-brand-line bg-brand-ink px-3 py-1.5 text-sm text-white outline-none focus:border-brand-green"
                    >
                      {Object.keys(editingCampaign.globalMetricsByPeriod || editingCampaign.normalizedMetricsByPeriod || editingCampaign.metricsByPeriod || {}).map(period => (
                        <option key={period} value={period}>
                          {period === 'maximum' ? 'Desde o início' :
                           period === 'today' ? 'Hoje' :
                           period === 'yesterday' ? 'Ontem' :
                           period === 'last_3d' ? 'Últimos 3 dias' :
                           period === 'last_7d' ? 'Últimos 7 dias' :
                           period === 'last_14d' ? 'Últimos 14 dias' :
                           period === 'last_30d' ? 'Últimos 30 dias' : period}
                        </option>
                      ))}
                      {Object.keys(editingCampaign.globalMetricsByPeriod || editingCampaign.normalizedMetricsByPeriod || editingCampaign.metricsByPeriod || {}).length === 0 && (
                        <option value="maximum">Desde o início</option>
                      )}
                    </select>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-4">
                <div className="flex items-center gap-2 border-b border-brand-line pb-2">
                  <Target size={16} className="text-brand-green" />
                  <h4 className="font-semibold text-white">Inteligência Operacional</h4>
                </div>
                <Field label="Criativos no ar" name="activeCreatives" type="number" min="0" value={activeMetrics?.activeCreatives || editingCampaign.activeCreatives || 0} readOnly={isEditingMatrix} placeholder="Quantos anúncios ativos?" />
                <Field label="Meta de Resultados (Volume)" name="targetResults" type="number" min="0" defaultValue={editingCampaign.targetResults} placeholder="Ex: 50 leads" />
                <MoneyField label="Custo Desejado (CPA Alvo)" name="targetCPA" defaultValue={editingCampaign.targetCPA} />
                <MoneyField label="Verba Planejada" name="budget" defaultValue={editingCampaign.budget} />
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2 border-b border-brand-line pb-2">
                  <BarChart3 size={16} className="text-sky-400" />
                  <h4 className="font-semibold text-white">Performance Atual</h4>
                </div>
                <MoneyField label="Valor já gasto" name="spent" value={activeMetrics?.spend || activeMetrics?.spent || 0} readOnly={isEditingMatrix} />
                
                {isEditingMatrix ? (
                  <div className="space-y-3 pt-2">
                    {Object.entries(
                      subCampaigns.reduce((acc, sub) => {
                        const obj = sub.classifiedObjective || 'UNCLASSIFIED';
                        if (!acc[obj]) acc[obj] = [];
                        acc[obj].push(sub);
                        return acc;
                      }, {} as Record<string, typeof subCampaigns>)
                    ).map(([obj, campaigns]) => (
                      <div key={obj} className="space-y-2">
                        {campaigns.map(sub => (
                          <div key={sub.id} className="border border-brand-line/50 rounded-lg p-3 bg-brand-ink/50">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-[10px] font-bold text-white truncate max-w-[150px]">{sub.name}</h4>
                            </div>
                            <CampaignObjectiveBlocks 
                              campaign={sub} 
                              period={selectedPeriod} 
                            />
                          </div>
                        ))}
                      </div>
                    ))}
                    {subCampaigns.length === 0 && (
                      <p className="text-xs text-brand-muted">Nenhuma subcampanha vinculada.</p>
                    )}
                  </div>
                ) : (
                  <CampaignObjectiveBlocks 
                    campaign={editingCampaign} 
                    period={selectedPeriod} 
                  />
                )}
              </div>
            </div>

            {isEditingMatrix && (
              <div className="space-y-4 pt-2">
                <div className="flex items-center gap-2 border-b border-brand-line pb-2">
                  <LinkIcon size={16} className="text-indigo-400" />
                  <h4 className="font-semibold text-white">Vincular Subcampanhas (Facebook Ads)</h4>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-2 rounded-lg border border-brand-line/50 bg-brand-surface/30 p-3">
                  {data.campaigns.filter(c => c.clientId === editingCampaign.clientId && c.metaCampaignId).length === 0 ? (
                    <p className="text-sm text-brand-muted">Nenhuma campanha sincronizada do Facebook para este cliente.</p>
                  ) : (
                    data.campaigns
                      .filter(c => c.clientId === editingCampaign.clientId && c.metaCampaignId)
                      .map(sub => (
                        <label key={sub.id} className="flex items-center gap-3 rounded bg-brand-surface p-2 border border-brand-line/50 cursor-pointer">
                          <input 
                            type="checkbox" 
                            name="subCampaignIds" 
                            value={sub.id} 
                            defaultChecked={editingCampaign.subCampaignIds?.includes(sub.id)}
                            className="h-4 w-4 rounded border-brand-line bg-brand-ink text-brand-green focus:ring-brand-green focus:ring-offset-brand-surface"
                          />
                          <div>
                            <p className="text-xs font-bold text-white">{sub.name}</p>
                            <p className="text-[10px] text-brand-muted">{sub.objective} • {money(sub.spent)} gasto</p>
                          </div>
                        </label>
                      ))
                  )}
                </div>
              </div>
            )}

            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-2 border-b border-brand-line pb-2">
                <CheckCircle2 size={16} className="text-amber-400" />
                <h4 className="font-semibold text-white">Gestão da Campanha</h4>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Nome da campanha" name="name" defaultValue={editingCampaign.name} required />
                <Field label="Última otimização" name="lastOptimizedAt" type="date" defaultValue={editingCampaign.lastOptimizedAt} />
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-brand-soft">Etapa no Kanban</span>
                  <select name="status" defaultValue={editingCampaign.status} className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
                    {campaignColumns.map((status) => <option key={status} value={status}>{campaignStatusLabels[status]}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-brand-soft">Prioridade</span>
                  <select name="priority" defaultValue={editingCampaign.priority} className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
                    <option value="low">Baixa</option>
                    <option value="medium">Média</option>
                    <option value="high">Alta</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-brand-soft">Próxima ação</span>
                <textarea name="nextAction" defaultValue={editingCampaign.nextAction} rows={3} placeholder="Descreva o que precisa ser feito ou testado na próxima otimização" className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green" />
              </label>
            </div>

            {(() => {
              if (!editingCampaign.activeAdSets || editingCampaign.activeAdSets.length === 0) return null;
              
              return (
                <div className="space-y-4 pt-2">
                  <div className="flex items-center gap-2 border-b border-brand-line pb-2">
                    <ImageIcon size={16} className="text-brand-green" />
                    <h4 className="font-semibold text-white">Estrutura de Anúncios Sincronizados ({editingCampaign.activeAdSets.reduce((acc, set) => acc + (set.ads?.length || 0), 0)})</h4>
                  </div>
                  <div className="max-h-64 overflow-y-auto space-y-3 rounded-lg border border-brand-line/50 bg-brand-surface/30 p-3">
                    {editingCampaign.activeAdSets.map(adset => (
                      <div key={adset.id} className="rounded-lg bg-brand-ink border border-brand-line overflow-hidden">
                        <div className="flex items-center justify-between p-3 border-b border-brand-line/50 bg-brand-surface/50">
                          <div>
                            <p className="text-xs font-bold text-white uppercase tracking-wide">GRUPO: {adset.name}</p>
                            <p className="text-[10px] text-brand-muted mt-0.5">{adset.ads?.length || 0} criativos</p>
                          </div>
                          <span className={`text-[10px] font-bold ${adset.status === 'ACTIVE' ? 'text-brand-green' : 'text-amber-400'}`}>
                            {adset.status === 'ACTIVE' ? 'ATIVO' : adset.status}
                          </span>
                        </div>
                        {adset.ads && adset.ads.length > 0 && (
                          <div className="p-3 space-y-2">
                            {adset.ads.map(ad => (
                              <div key={ad.id} className="flex justify-between items-center rounded bg-brand-surface p-2 border border-brand-line/50">
                                <p className="text-xs font-medium text-white truncate max-w-[200px] sm:max-w-[300px]">{ad.name}</p>
                                <span className={`text-[9px] font-bold ${ad.status === 'ACTIVE' ? 'text-brand-green' : 'text-brand-muted'}`}>
                                  {ad.status === 'ACTIVE' ? 'ATIVO' : ad.status}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {(() => {
              const campaignLogs = data.activityLogs.filter(log => log.campaignId === editingCampaign.id);
              if (campaignLogs.length === 0) return null;
              
              return (
                <div className="space-y-4 pt-2">
                  <div className="flex items-center gap-2 border-b border-brand-line pb-2">
                    <History size={16} className="text-brand-muted" />
                    <h4 className="font-semibold text-white">Histórico de Movimentação</h4>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-3 rounded-lg border border-brand-line/50 bg-brand-surface/30 p-3">
                    {campaignLogs.map(log => (
                      <div key={log.id} className="relative pl-4 border-l-2 border-brand-line">
                        <div className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-brand-green" />
                        <p className="text-xs font-bold text-white">{log.title}</p>
                        <p className="text-[10px] text-brand-muted mt-0.5">{log.description}</p>
                        <p className="text-[9px] text-brand-soft mt-1">{new Date(log.createdAt).toLocaleString('pt-BR')}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div className="flex justify-end gap-3 border-t border-brand-line pt-5">
              <button type="button" onClick={() => setEditingCampaignId(null)} className="rounded-lg border border-brand-line px-4 py-2 font-semibold text-brand-soft">Cancelar</button>
              <button className="rounded-lg bg-brand-green px-4 py-2 font-bold text-brand-ink">Salvar alterações</button>
            </div>
          </form>
        )}
      </Modal>

      <div className="min-h-0 flex-1 overflow-x-auto p-4 sm:p-5">
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex h-full min-w-max gap-4">
            {campaignColumns.map((status) => {
              const cards = data.campaigns.filter((campaign) => campaign.status === status && (campaign.isMatrix || !campaign.metaCampaignId));
              return (
                <div key={status} className="flex h-full w-[280px] flex-col rounded-xl border border-brand-line bg-brand-ink xl:w-[300px]">
                  <div className="flex items-center justify-between border-b border-brand-line p-4">
                    <h2 className="text-sm font-bold text-white">{campaignStatusLabels[status]}</h2>
                    <span className="rounded-full bg-brand-surface px-2 py-1 text-xs text-brand-muted">{cards.length}</span>
                  </div>
                  <Droppable droppableId={status}>
                    {(provided) => (
                      <div ref={provided.innerRef} {...provided.droppableProps} className="flex-1 space-y-3 overflow-y-auto p-3">
                        {cards.map((campaign, index) => {
                          const client = data.clients.find((item) => item.id === campaign.clientId);
                          const percent = campaign.budget ? Math.min(100, Math.round((campaign.spent / campaign.budget) * 100)) : 0;
                          
                          const currentCPA = campaign.results && campaign.results > 0 ? (campaign.spent / campaign.results) : 0;
                          const hasTarget = campaign.targetCPA && campaign.targetCPA > 0;
                          const cpaGood = hasTarget && currentCPA <= campaign.targetCPA!;
                          
                          return (
                            <Draggable key={campaign.id} draggableId={campaign.id} index={index}>
                              {(dragProvided, snapshot) => (
                                <article
                                  ref={dragProvided.innerRef}
                                  {...dragProvided.draggableProps}
                                  {...dragProvided.dragHandleProps}
                                  onClick={() => setEditingCampaignId(campaign.id)}
                                  className={`rounded-lg cursor-pointer border border-brand-line bg-brand-surface p-4 transition hover:border-brand-green ${snapshot.isDragging ? 'border-brand-green ring-2 ring-brand-green/20' : ''}`}
                                >
                                  <div className="flex justify-between items-start gap-2">
                                    <p className="text-xs text-brand-muted truncate">{clientDisplayName(client)}</p>
                                    <span className={`shrink-0 text-[10px] uppercase font-bold tracking-wider ${campaign.priority === 'high' ? 'text-rose-400' : campaign.priority === 'medium' ? 'text-amber-400' : 'text-brand-green'}`}>{campaign.priority}</span>
                                  </div>
                                  
                                  <h3 className="mt-1 font-bold text-white">{campaign.name}</h3>

                                  {data.agentAlerts?.some(a => a.relatedEntityId === campaign.id && a.status === 'active') && (
                                    <div className="mt-2 flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-400/10 px-2 py-1 rounded-full w-fit">
                                      <ShieldAlert size={12} />
                                      Alerta da IA
                                    </div>
                                  )}
                                  
                                  {campaign.activeAdSets && campaign.activeAdSets.length > 0 ? (
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-green bg-brand-green/10 w-fit px-2 py-0.5 rounded-full">
                                        <ImageIcon size={10} />
                                        {campaign.activeAdSets.length} anúncios
                                      </div>
                                      {campaign.metaCampaignId && (
                                        <button 
                                          onClick={(e) => { e.stopPropagation(); setCreativesModalCampaignId(campaign.id); }}
                                          className="flex items-center gap-1 text-[10px] font-bold text-sky-400 hover:text-sky-300 transition-colors bg-sky-400/10 px-2 py-0.5 rounded-full"
                                        >
                                          <ExternalLink size={10} />
                                          Ver Criativos
                                        </button>
                                      )}
                                    </div>
                                  ) : campaign.activeCreatives ? (
                                    <div className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-sky-300 bg-sky-400/10 w-fit px-2 py-0.5 rounded-full">
                                      <ImageIcon size={10} />
                                      {campaign.activeCreatives} criativos ativos
                                    </div>
                                  ) : null}

                                      {/* Removed legacy CPA/Results display from card */}

                                  <p className={`mt-3 line-clamp-2 text-xs text-brand-muted ${currentCPA > 0 ? '' : 'border-t border-brand-line pt-3'}`}>
                                    <span className="font-semibold text-brand-soft">Próxima ação:</span> {campaign.nextAction || 'Não definida'}
                                  </p>

                                  <div className="mt-4 h-1.5 rounded-full bg-brand-surface2 overflow-hidden flex">
                                    <div className="h-full bg-brand-green" style={{ width: `${percent}%` }} />
                                  </div>
                                  <div className="mt-1.5 flex justify-between text-[10px] text-brand-muted">
                                    <span>Gasto: {money(campaign.spent)}</span>
                                    <span>Verba: {money(campaign.budget)}</span>
                                  </div>
                                </article>
                              )}
                            </Draggable>
                          );
                        })}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>
        </DragDropContext>
      </div>

      <Modal 
        title="Galeria de Criativos" 
        description={creativesCampaign ? `Visualizando anúncios da campanha: ${creativesCampaign.name}` : ''}
        open={!!creativesModalCampaignId} 
        onClose={() => setCreativesModalCampaignId(null)}
      >
        <div className="p-5 max-h-[70vh] overflow-y-auto">
          {isLoadingCreatives ? (
            <div className="flex flex-col items-center justify-center py-12 text-brand-muted">
              <Loader2 className="animate-spin mb-4" size={32} />
              <p className="text-sm">Buscando criativos na Meta...</p>
            </div>
          ) : creativesData.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {creativesData.map((ad, idx) => (
                <div key={idx} className="rounded-xl border border-brand-line bg-brand-surface overflow-hidden flex flex-col">
                  {ad.creative?.thumbnail_url ? (
                    <img src={ad.creative.thumbnail_url} alt="Creative" className="w-full h-40 object-cover border-b border-brand-line" />
                  ) : (
                    <div className="w-full h-40 bg-brand-surface2 flex items-center justify-center border-b border-brand-line">
                      <ImageIcon size={32} className="text-brand-muted" />
                    </div>
                  )}
                  <div className="p-3 flex-1 flex flex-col">
                    <p className="text-xs font-bold text-white mb-1 line-clamp-1" title={ad.name}>{ad.name}</p>
                    <p className="text-[10px] text-brand-muted mb-2"><span className={ad.status === 'ACTIVE' ? 'text-brand-green font-bold' : ''}>{ad.status}</span></p>
                    
                    {ad.creative?.title && <p className="text-xs font-semibold text-white mb-1 line-clamp-1">{ad.creative.title}</p>}
                    {ad.creative?.body && <p className="text-[10px] text-brand-soft line-clamp-3 mb-3 flex-1">{ad.creative.body}</p>}
                    
                    <div className="grid grid-cols-3 gap-1 mt-auto pt-2 border-t border-brand-line">
                      <div className="text-center">
                        <p className="text-[9px] text-brand-muted uppercase">Gasto</p>
                        <p className="text-xs font-bold text-white">{money(ad.metrics?.spend || 0)}</p>
                      </div>
                      <div className="text-center border-x border-brand-line">
                        <p className="text-[9px] text-brand-muted uppercase">Cliques</p>
                        <p className="text-xs font-bold text-white">{ad.metrics?.clicks || 0}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[9px] text-brand-muted uppercase">Leads</p>
                        <p className="text-xs font-bold text-sky-400">{ad.metrics?.leads || 0}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center text-brand-muted">
              Nenhum criativo encontrado para esta campanha.
            </div>
          )}
        </div>
      </Modal>

      {reconciliationSyncRunId && (
        <ReconciliationModal 
          isOpen={!!reconciliationSyncRunId} 
          onClose={() => setReconciliationSyncRunId(null)} 
          syncRunId={reconciliationSyncRunId} 
        />
      )}
    </section>
  );
}

function Field({ label, name, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-brand-soft">{label}</span>
      <input name={name} className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green" {...props} />
    </label>
  );
}

function MoneyField({ label, name, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-brand-soft">{label}</span>
      <div className="flex rounded-lg border border-brand-line bg-brand-surface focus-within:border-brand-green">
        <span className="grid place-items-center border-r border-brand-line px-3 text-sm font-bold text-brand-green">R$</span>
        <input name={name} type="number" min="0" step="0.01" className="w-full bg-transparent px-3 py-2 text-white outline-none" {...props} />
      </div>
    </label>
  );
}
