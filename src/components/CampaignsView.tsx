import { FormEvent, useMemo, useState, type InputHTMLAttributes } from 'react';
import { Edit3, Megaphone, Plus } from 'lucide-react';
import { campaignColumns, campaignStatusLabels, createActivityLog, makeId, money } from '../data/camplyStore';
import { campaignPlatforms, metaCampaignObjectives } from '../data/options';
import type { Campaign, CampaignStatus, CamplyData, Priority } from '../types';
import { clientDisplayName, clientOptionLabel } from './ClientsView';
import { MetaOperationalWorkspace } from './meta/MetaOperationalWorkspace';
import { Modal } from './ui/Modal';

interface CampaignsViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

export function CampaignsView({ data, updateData }: CampaignsViewProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const operationalCampaigns = useMemo(() => data.campaigns.filter((campaign) => !campaign.metaCampaignId), [data.campaigns]);
  const editing = operationalCampaigns.find((campaign) => campaign.id === editingId);

  const saveCampaign = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const clientId = String(form.get('clientId') || '');
    const name = String(form.get('name') || '').trim();
    const client = data.clients.find((item) => item.id === clientId);
    if (!client || !name) return;
    const campaign: Campaign = {
      id: editing?.id || makeId('campaign'),
      clientId,
      name,
      platform: String(form.get('platform') || 'Meta Ads') as Campaign['platform'],
      status: String(form.get('status') || 'setup') as CampaignStatus,
      objective: String(form.get('objective') || 'Tráfego'),
      budget: Number(form.get('budget') || 0),
      spent: editing?.spent || 0,
      lastOptimizedAt: editing?.lastOptimizedAt,
      nextAction: String(form.get('nextAction') || ''),
      priority: String(form.get('priority') || 'medium') as Priority,
      isMatrix: true,
      subCampaignIds: editing?.subCampaignIds || [],
    };
    updateData((current) => ({
      ...current,
      campaigns: editing
        ? current.campaigns.map((item) => item.id === editing.id ? campaign : item)
        : [campaign, ...current.campaigns],
      activityLogs: [createActivityLog({
        action: 'campaign_created',
        title: editing ? `Campanha operacional editada: ${name}` : `Campanha operacional criada: ${name}`,
        description: `${campaign.platform} para ${clientDisplayName(client)}. Métricas oficiais permanecem na central Meta.`,
        projectId: client.projectId,
        clientId,
        campaignId: campaign.id,
        receivableId: '', taskId: '',
      }), ...current.activityLogs],
    }));
    setModalOpen(false);
    setEditingId(null);
  };

  const setStatus = (campaign: Campaign, status: CampaignStatus) => {
    updateData((current) => ({
      ...current,
      campaigns: current.campaigns.map((item) => item.id === campaign.id ? { ...item, status } : item),
      activityLogs: [createActivityLog({
        action: 'campaign_status_changed',
        title: `Campanha movida: ${campaign.name}`,
        description: `Etapa operacional alterada para ${campaignStatusLabels[status]}.`,
        projectId: '', clientId: campaign.clientId, campaignId: campaign.id, receivableId: '', taskId: '',
      }), ...current.activityLogs],
    }));
  };

  return (
    <section className="h-full overflow-y-auto bg-brand-ink p-4 sm:p-5 lg:p-8">
      <div className="mx-auto max-w-[1700px] space-y-6">
        <header className="flex flex-col gap-4 rounded-2xl border border-brand-line bg-brand-surface p-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-brand-green"><Megaphone size={17} /><p className="text-xs font-bold uppercase tracking-[0.2em]">Campanhas</p></div>
            <h1 className="mt-2 text-3xl font-black text-white">Performance Meta e operação</h1>
            <p className="mt-1 text-sm text-brand-muted">A hierarquia oficial fica na central analítica; o quadro abaixo guarda somente planejamento e execução internos.</p>
          </div>
          <button type="button" onClick={() => { setEditingId(null); setModalOpen(true); }} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-green px-4 py-3 text-sm font-black text-brand-ink"><Plus size={17} /> Nova campanha operacional</button>
        </header>

        <MetaOperationalWorkspace data={data} compact />

        <section className="rounded-2xl border border-brand-line bg-brand-surface p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-brand-green">Planejamento interno</p>
            <h2 className="mt-1 text-xl font-black text-white">Quadro operacional</h2>
            <p className="mt-1 text-sm text-brand-muted">Valores deste quadro são planejados e nunca substituem métricas coletadas da Meta.</p>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {operationalCampaigns.map((campaign) => {
              const client = data.clients.find((item) => item.id === campaign.clientId);
              return (
                <article key={campaign.id} className="rounded-xl border border-brand-line bg-brand-ink/50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="text-xs font-bold text-brand-green">{campaign.platform}</p><h3 className="mt-1 font-black text-white">{campaign.name}</h3><p className="mt-1 text-xs text-brand-muted">{clientDisplayName(client)}</p></div>
                    <button type="button" aria-label={`Editar ${campaign.name}`} onClick={() => { setEditingId(campaign.id); setModalOpen(true); }} className="rounded-lg border border-brand-line p-2 text-brand-soft"><Edit3 size={14} /></button>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-lg bg-white/[0.03] p-3"><p className="text-[10px] uppercase text-brand-muted">Verba planejada</p><p className="mt-1 font-black text-white">{money(campaign.budget)}</p></div><div className="rounded-lg bg-white/[0.03] p-3"><p className="text-[10px] uppercase text-brand-muted">Prioridade</p><p className="mt-1 font-black text-white">{campaign.priority}</p></div></div>
                  <label className="mt-3 block text-xs font-bold text-brand-soft">Etapa operacional<select value={campaign.status} onChange={(event) => setStatus(campaign, event.target.value as CampaignStatus)} className="mt-1 w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white">{campaignColumns.map((status) => <option key={status} value={status}>{campaignStatusLabels[status]}</option>)}</select></label>
                  {campaign.nextAction && <p className="mt-3 text-xs text-brand-muted">Próxima ação: <span className="text-brand-soft">{campaign.nextAction}</span></p>}
                </article>
              );
            })}
          </div>
          {operationalCampaigns.length === 0 && <div className="mt-5 rounded-xl border border-dashed border-brand-line p-8 text-center text-sm text-brand-muted">Nenhuma campanha operacional criada. As campanhas oficiais da Meta continuam visíveis acima.</div>}
        </section>

        <Modal title={editing ? 'Editar campanha operacional' : 'Nova campanha operacional'} description="Planejamento interno sem copiar métricas da plataforma." open={modalOpen} onClose={() => { setModalOpen(false); setEditingId(null); }}>
          <form key={editing?.id || 'new'} onSubmit={saveCampaign} className="space-y-4 p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Nome" name="name" defaultValue={editing?.name} required />
              <label className="text-sm font-bold text-brand-soft">Cliente<select name="clientId" defaultValue={editing?.clientId || ''} required className="mt-2 w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white"><option value="">Selecione</option>{data.clients.map((client) => <option key={client.id} value={client.id}>{clientOptionLabel(client, data.projects)}</option>)}</select></label>
              <label className="text-sm font-bold text-brand-soft">Plataforma<select name="platform" defaultValue={editing?.platform || 'Meta Ads'} className="mt-2 w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white">{campaignPlatforms.map((platform) => <option key={platform}>{platform}</option>)}</select></label>
              <label className="text-sm font-bold text-brand-soft">Objetivo<select name="objective" defaultValue={String(editing?.objective || 'Tráfego')} className="mt-2 w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white">{metaCampaignObjectives.map((objective) => <option key={objective}>{objective}</option>)}</select></label>
              <Field label="Verba planejada" name="budget" type="number" min="0" step="0.01" defaultValue={editing?.budget || 0} />
              <label className="text-sm font-bold text-brand-soft">Prioridade<select name="priority" defaultValue={editing?.priority || 'medium'} className="mt-2 w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white"><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option></select></label>
              <label className="text-sm font-bold text-brand-soft">Etapa<select name="status" defaultValue={editing?.status || 'setup'} className="mt-2 w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white">{campaignColumns.map((status) => <option key={status} value={status}>{campaignStatusLabels[status]}</option>)}</select></label>
              <Field label="Próxima ação" name="nextAction" defaultValue={editing?.nextAction} />
            </div>
            <div className="flex justify-end gap-2 border-t border-brand-line pt-4"><button type="button" onClick={() => setModalOpen(false)} className="rounded-lg border border-brand-line px-4 py-2 font-bold text-brand-soft">Cancelar</button><button className="rounded-lg bg-brand-green px-4 py-2 font-black text-brand-ink">Salvar</button></div>
          </form>
        </Modal>
      </div>
    </section>
  );
}

function Field({ label, name, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) {
  return <label className="text-sm font-bold text-brand-soft">{label}<input name={name} className="mt-2 w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white" {...props} /></label>;
}
