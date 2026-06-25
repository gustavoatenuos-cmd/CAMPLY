import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd';
import { Plus } from 'lucide-react';
import { campaignColumns, campaignStatusLabels, makeId, money } from '../data/camplyStore';
import { CamplyData, CampaignStatus } from '../types';

interface CampaignsViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

export function CampaignsView({ data, updateData }: CampaignsViewProps) {
  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const status = result.destination.droppableId as CampaignStatus;
    updateData((current) => ({
      ...current,
      campaigns: current.campaigns.map((campaign) => (campaign.id === result.draggableId ? { ...campaign, status } : campaign)),
    }));
  };

  const addCampaign = () => {
    const client = data.clients[0];
    const name = window.prompt('Nome da campanha');
    if (!client || !name) return;

    updateData((current) => ({
      ...current,
      campaigns: [
        {
          id: makeId('campaign'),
          clientId: client.id,
          name,
          platform: 'Meta Ads',
          status: 'setup',
          objective: 'Definir objetivo',
          budget: 0,
          spent: 0,
          lastOptimizedAt: new Date().toISOString().slice(0, 10),
          nextAction: 'Completar briefing e preparar publicação.',
          priority: 'medium',
        },
        ...current.campaigns,
      ],
    }));
  };

  return (
    <section className="flex h-full flex-col">
      <header className="border-b border-brand-line bg-brand-ink px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-green">Campanhas</p>
            <h1 className="mt-1 text-2xl font-black text-white">Quadro operacional</h1>
          </div>
          <button onClick={addCampaign} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-green px-4 py-3 text-sm font-bold text-brand-ink">
            <Plus size={18} />
            Nova campanha
          </button>
        </div>
      </header>

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
