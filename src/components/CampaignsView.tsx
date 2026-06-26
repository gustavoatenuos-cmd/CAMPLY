import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd';
import { Target, MessageSquare, TrendingUp, TrendingDown, Eye, CheckCircle2, PlayCircle, BarChart3, Edit3, Image, Plus, ShieldAlert } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { campaignColumns, campaignStatusLabels, createActivityLog, makeId, money } from '../data/camplyStore';
import { campaignPlatforms, metaCampaignObjectives } from '../data/options';
import { Modal } from './ui/Modal';
import { Campaign, CamplyData, CampaignStatus, Priority } from '../types';
import { clientDisplayName, clientOptionLabel } from './ClientsView';

interface CampaignsViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

export function CampaignsView({ data, updateData }: CampaignsViewProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);

  const editingCampaign = data.campaigns.find((c) => c.id === editingCampaignId);

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
      const spent = Number(form.get('spent') ?? editingCampaign.spent);
      const results = Number(form.get('results') ?? editingCampaign.results ?? 0);
      
      const updatedCampaign: Campaign = {
        ...editingCampaign,
        name: String(form.get('name') ?? editingCampaign.name),
        budget: Number(form.get('budget') ?? editingCampaign.budget),
        spent,
        results,
        activeCreatives: Number(form.get('activeCreatives') ?? editingCampaign.activeCreatives ?? 0),
        targetResults: Number(form.get('targetResults') ?? editingCampaign.targetResults ?? 0),
        targetCPA: Number(form.get('targetCPA') ?? editingCampaign.targetCPA ?? 0),
        lastOptimizedAt: String(form.get('lastOptimizedAt') ?? editingCampaign.lastOptimizedAt),
        nextAction: String(form.get('nextAction') ?? editingCampaign.nextAction),
        status: String(form.get('status') ?? editingCampaign.status) as CampaignStatus,
        priority: String(form.get('priority') ?? editingCampaign.priority) as Priority,
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
        lastOptimizedAt: new Date().toISOString().slice(0, 10),
        nextAction: '',
        priority: String(form.get('priority') ?? 'medium') as Priority,
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
          <form key={editingCampaign.id} onSubmit={saveCampaign} className="space-y-6 p-5">
            <div className="rounded-xl border border-brand-line bg-brand-surface p-4">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white">{editingCampaign.name}</h3>
                <span className="rounded-full bg-brand-ink px-2.5 py-1 text-xs font-semibold text-brand-soft">{editingCampaign.platform}</span>
              </div>
              <p className="mt-1 text-sm text-brand-muted">{clientDisplayName(data.clients.find(c => c.id === editingCampaign.clientId))} • {editingCampaign.objective}</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-4">
                <div className="flex items-center gap-2 border-b border-brand-line pb-2">
                  <Target size={16} className="text-brand-green" />
                  <h4 className="font-semibold text-white">Inteligência Operacional</h4>
                </div>
                <Field label="Criativos no ar" name="activeCreatives" type="number" min="0" defaultValue={editingCampaign.activeCreatives} placeholder="Quantos anúncios ativos?" />
                <Field label="Meta de Resultados (Volume)" name="targetResults" type="number" min="0" defaultValue={editingCampaign.targetResults} placeholder="Ex: 50 leads" />
                <MoneyField label="Custo Desejado (CPA Alvo)" name="targetCPA" defaultValue={editingCampaign.targetCPA} />
                <MoneyField label="Verba Planejada" name="budget" defaultValue={editingCampaign.budget} />
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2 border-b border-brand-line pb-2">
                  <BarChart3 size={16} className="text-sky-400" />
                  <h4 className="font-semibold text-white">Performance Atual</h4>
                </div>
                <MoneyField label="Valor já gasto" name="spent" defaultValue={editingCampaign.spent} />
                <Field label="Resultados Obtidos" name="results" type="number" min="0" defaultValue={editingCampaign.results} />
                
                {editingCampaign.results && editingCampaign.results > 0 ? (
                  <div className="rounded-lg bg-brand-surface p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-brand-soft">CPA Atual (Custo/Resultado)</p>
                    <div className="mt-2 flex items-end gap-2">
                      <p className={`text-2xl font-black ${
                        (editingCampaign.targetCPA && (editingCampaign.spent / editingCampaign.results) <= editingCampaign.targetCPA) 
                        ? 'text-brand-green' 
                        : (editingCampaign.targetCPA && (editingCampaign.spent / editingCampaign.results) > editingCampaign.targetCPA)
                        ? 'text-rose-400'
                        : 'text-white'
                      }`}>
                        {money(editingCampaign.spent / editingCampaign.results)}
                      </p>
                      {editingCampaign.targetCPA ? (
                        <p className="mb-1 text-xs text-brand-muted">alvo: {money(editingCampaign.targetCPA)}</p>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-brand-line bg-brand-surface/50 p-3 text-sm text-brand-muted">
                    Insira o número de resultados e gastos para ver o CPA Atual.
                  </div>
                )}
              </div>
            </div>

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
              const cards = data.campaigns.filter((campaign) => campaign.status === status);
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
                                  
                                  {campaign.activeCreatives ? (
                                    <div className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-sky-300 bg-sky-400/10 w-fit px-2 py-0.5 rounded-full">
                                      <Image size={10} />
                                      {campaign.activeCreatives} criativos ativos
                                    </div>
                                  ) : null}

                                  {currentCPA > 0 && (
                                    <div className="mt-3 grid grid-cols-2 gap-2 border-t border-brand-line pt-3">
                                      <div>
                                        <p className="text-[10px] text-brand-muted uppercase">CPA Atual</p>
                                        <p className={`text-sm font-bold ${hasTarget ? (cpaGood ? 'text-brand-green' : 'text-rose-400') : 'text-white'}`}>
                                          {money(currentCPA)}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-[10px] text-brand-muted uppercase">Resultados</p>
                                        <p className="text-sm font-bold text-white">
                                          {campaign.results} <span className="text-brand-muted text-xs font-normal">/ {campaign.targetResults || '-'}</span>
                                        </p>
                                      </div>
                                    </div>
                                  )}

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
