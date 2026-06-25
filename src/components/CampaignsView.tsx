import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd';
import { Plus } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { campaignColumns, campaignStatusLabels, createActivityLog, makeId, money } from '../data/camplyStore';
import { campaignPlatforms, metaCampaignObjectives } from '../data/options';
import { Modal } from './ui/Modal';
import { Campaign, CamplyData, CampaignStatus, Priority } from '../types';

interface CampaignsViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

export function CampaignsView({ data, updateData }: CampaignsViewProps) {
  const [modalOpen, setModalOpen] = useState(false);

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

  const addCampaign = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
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
      spent: Number(form.get('spent') ?? 0),
      lastOptimizedAt: String(form.get('lastOptimizedAt') ?? new Date().toISOString().slice(0, 10)),
      nextAction: String(form.get('nextAction') ?? ''),
      priority: String(form.get('priority') ?? 'medium') as Priority,
    };

    updateData((current) => ({
      ...current,
      campaigns: [campaign, ...current.campaigns],
      activityLogs: [
        createActivityLog({
          action: 'campaign_created',
          title: `Campanha criada: ${campaign.name}`,
          description: `${campaign.platform} para ${client.name}, objetivo ${campaign.objective}.`,
          projectId: client.projectId,
          clientId: client.id,
          campaignId: campaign.id,
          receivableId: '',
          taskId: '',
        }),
        ...current.activityLogs,
      ],
    }));
    setModalOpen(false);
    event.currentTarget.reset();
  };

  return (
    <section className="flex h-full flex-col">
      <header className="border-b border-brand-line bg-brand-ink px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-green">Campanhas</p>
            <h1 className="mt-1 text-2xl font-black text-white">Quadro operacional</h1>
          </div>
          <button onClick={() => setModalOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-green px-4 py-3 text-sm font-bold text-brand-ink">
            <Plus size={18} />
            Nova campanha
          </button>
        </div>
      </header>

      <Modal title="Nova campanha" description="Cadastre a campanha com objetivo, plataforma, verba, gasto e próxima ação." open={modalOpen} onClose={() => setModalOpen(false)}>
        <form onSubmit={addCampaign} className="space-y-5 p-5">
          {data.clients.length === 0 && (
            <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
              Cadastre um cliente antes de criar campanhas.
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Cliente</span>
              <select name="clientId" required className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
                <option value="">Selecione</option>
                {data.clients.map((client) => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </select>
            </label>
            <Field label="Nome da campanha" name="name" required />
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
            <Field label="Verba planejada" name="budget" type="number" min="0" step="0.01" />
            <Field label="Valor já gasto" name="spent" type="number" min="0" step="0.01" />
            <Field label="Última otimização" name="lastOptimizedAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Etapa</span>
              <select name="status" className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
                {campaignColumns.map((status) => <option key={status} value={status}>{campaignStatusLabels[status]}</option>)}
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
          </div>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-brand-soft">Próxima ação</span>
            <textarea name="nextAction" rows={3} className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green" />
          </label>
          <div className="flex justify-end gap-3 border-t border-brand-line pt-5">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg border border-brand-line px-4 py-2 font-semibold text-brand-soft">Cancelar</button>
            <button disabled={data.clients.length === 0} className="rounded-lg bg-brand-green px-4 py-2 font-bold text-brand-ink disabled:opacity-50">Salvar campanha</button>
          </div>
        </form>
      </Modal>

      <div className="flex-1 overflow-x-auto p-5">
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex h-full min-w-max gap-4">
            {campaignColumns.map((status) => {
              const cards = data.campaigns.filter((campaign) => campaign.status === status);
              return (
                <div key={status} className="flex h-full w-[300px] flex-col rounded-xl border border-brand-line bg-brand-ink">
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
                          return (
                            <Draggable key={campaign.id} draggableId={campaign.id} index={index}>
                              {(dragProvided, snapshot) => (
                                <article
                                  ref={dragProvided.innerRef}
                                  {...dragProvided.draggableProps}
                                  {...dragProvided.dragHandleProps}
                                  className={`rounded-lg border border-brand-line bg-brand-surface p-4 ${snapshot.isDragging ? 'border-brand-green' : ''}`}
                                >
                                  <p className="text-xs text-brand-muted">{client?.name}</p>
                                  <h3 className="mt-1 font-bold text-white">{campaign.name}</h3>
                                  <p className="mt-2 line-clamp-2 text-sm text-brand-muted">{campaign.nextAction}</p>
                                  <div className="mt-4 flex items-center justify-between text-xs text-brand-muted">
                                    <span>{campaign.platform}</span>
                                    <span className={campaign.priority === 'high' ? 'text-rose-400' : 'text-brand-green'}>{campaign.priority}</span>
                                  </div>
                                  <div className="mt-3 h-2 rounded-full bg-brand-surface2">
                                    <div className="h-2 rounded-full bg-brand-green" style={{ width: `${percent}%` }} />
                                  </div>
                                  <div className="mt-2 flex justify-between text-[11px] text-brand-muted">
                                    <span>{money(campaign.spent)}</span>
                                    <span>{money(campaign.budget)}</span>
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
