import { Edit3, Mail, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from './ui/EmptyState';
import { createActivityLog, money, normalizeMonthlyInvestment } from '../data/camplyStore';
import type { CamplyData, Client, ClientStatus, Project } from '../types';
import { ClientFormModal } from './ClientFormModal';
import { MetaOperationalWorkspace } from './meta/MetaOperationalWorkspace';

interface ClientsViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
  persistClientData?: (nextData: CamplyData, clientId: string) => Promise<void>;
}

export function ClientsView({ data, updateData, persistClientData }: ClientsViewProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState(data.clients[0]?.id || '');
  const [metaWorkspaceKey, setMetaWorkspaceKey] = useState(0);
  const editingClient = data.clients.find((client) => client.id === editingClientId);

  const setStatus = (id: string, status: ClientStatus) => {
    const selected = data.clients.find((client) => client.id === id);
    updateData((current) => ({
      ...current,
      clients: current.clients.map((client) => client.id === id ? { ...client, status } : client),
      activityLogs: selected ? [createActivityLog({
        action: 'client_status_changed',
        title: `Status alterado: ${selected.name}`,
        description: `Cliente movido para ${status}.`,
        projectId: selected.projectId,
        clientId: selected.id,
        campaignId: '', receivableId: '', taskId: '',
      }), ...current.activityLogs] : current.activityLogs,
    }));
  };

  return (
    <section className="h-full overflow-y-auto bg-brand-ink p-4 sm:p-5 lg:p-8">
      <div className="mx-auto max-w-[1700px] space-y-6">
        <header className="glass-panel flex animate-fade-in flex-col gap-4 rounded-2xl p-5 sm:flex-row sm:items-end sm:justify-between lg:p-6">
          <div>
            <div className="flex items-center gap-2 text-brand-green"><Users size={17} /><p className="text-xs font-bold uppercase tracking-[0.2em]">Clientes</p></div>
            <h1 className="mt-2 text-3xl font-black text-white">Base operacional e Meta Ads</h1>
            <p className="mt-1 text-sm text-brand-muted">O cadastro comercial permanece separado da fonte oficial de performance.</p>
          </div>
          <button type="button" onClick={() => { setEditingClientId(null); setModalOpen(true); }} className="btn-primary shrink-0"><Plus size={17} /> Novo cliente</button>
        </header>

        {data.clients.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Nenhum cliente cadastrado"
            description="Crie o primeiro cliente para iniciar a operação e vincular uma conta Meta."
            action={<button type="button" onClick={() => { setEditingClientId(null); setModalOpen(true); }} className="btn-primary"><Plus size={15} /> Criar cliente</button>}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {data.clients.map((client) => (
              <article key={client.id} className={`rounded-2xl border bg-brand-surface p-5 transition ${selectedClientId === client.id ? 'border-brand-green/60' : 'border-brand-line'}`}>
                <button type="button" onClick={() => setSelectedClientId(client.id)} className="w-full text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-brand-green">{client.segment || 'Segmento não informado'}</p>
                      <h2 className="mt-1 text-xl font-black text-white">{clientDisplayName(client)}</h2>
                      <p className="mt-1 text-sm text-brand-muted">Responsável: {client.name}</p>
                    </div>
                    <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] font-bold uppercase text-brand-soft">{client.status}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl bg-brand-ink/50 p-3"><p className="text-xs text-brand-muted">Gestão</p><p className="mt-1 font-black text-white">{money(client.monthlyFee)}</p></div>
                    <div className="rounded-xl bg-brand-ink/50 p-3"><p className="text-xs text-brand-muted">Mídia Meta/mês</p><p className="mt-1 font-black text-white">{money(normalizeMonthlyInvestment(client.adInvestmentMeta, client.adInvestmentPeriod))}</p></div>
                  </div>
                  {client.contact && <p className="mt-3 inline-flex items-center gap-2 text-xs text-brand-muted"><Mail size={13} /> {client.contact}</p>}
                </button>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-brand-line pt-4">
                  <button type="button" onClick={() => { setEditingClientId(client.id); setModalOpen(true); }} className="inline-flex items-center gap-1 rounded-lg border border-brand-line px-3 py-2 text-xs font-bold text-brand-soft"><Edit3 size={13} /> Editar</button>
                  <select value={client.status} onChange={(event) => setStatus(client.id, event.target.value as ClientStatus)} className="rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-xs font-bold text-white">
                    <option value="lead">Lead</option><option value="active">Ativo</option><option value="paused">Pausado</option>
                  </select>
                  <button type="button" onClick={() => setSelectedClientId(client.id)} className="ml-auto rounded-lg bg-brand-green/10 px-3 py-2 text-xs font-black text-brand-green">Analisar Meta</button>
                </div>
              </article>
            ))}
          </div>
        )}

        <MetaOperationalWorkspace key={`${selectedClientId}-${metaWorkspaceKey}`} data={data} initialClientId={selectedClientId} />

        <ClientFormModal
          data={data}
          updateData={updateData}
          persistClientData={persistClientData}
          editingClient={editingClient}
          open={modalOpen}
          onClientPersisted={(clientId) => {
            setSelectedClientId(clientId);
            setMetaWorkspaceKey((current) => current + 1);
          }}
          onClose={() => { setModalOpen(false); setEditingClientId(null); }}
        />
      </div>
    </section>
  );
}

export function clientDisplayName(client?: Pick<Client, 'name' | 'company' | 'segment'>): string {
  if (!client) return 'Cliente não encontrado';
  return client.company || client.name || client.segment || 'Cliente sem nome';
}

export function clientOptionLabel(client: Pick<Client, 'name' | 'company' | 'segment'>, _projects: Project[]): string {
  const displayName = clientDisplayName(client);
  return client.name && client.name !== displayName ? `${displayName} · ${client.name}` : displayName;
}
