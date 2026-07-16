import { Ban, Edit3, Mail, Plus, RotateCcw, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { createActivityLog, money, normalizeMonthlyInvestment } from '../data/camplyStore';
import { buildOperationalView, isClientOperationallyActive, type OperationalEntry } from '../data/receivablesForecast';
import { evaluateClientOperationalReadiness, type FinanceReadinessStatus } from '../lib/operational/clientOperationalReadiness';
import { readPendingClientSelection } from '../lib/performance/pendingClientSelection';
import type { CamplyData, Client, ClientStatus } from '../types';
import { clientDisplayName, clientOptionLabel } from '../data/clientDisplay';
import { ClientFormModal } from './ClientFormModal';
import { MetaOperationalWorkspace } from './meta/MetaOperationalWorkspace';
import { ConfirmDialog } from './ui/ConfirmDialog';

type ClientLifecycleFilter = 'active' | 'inactive' | 'all';

const LIFECYCLE_FILTER_LABELS: Record<ClientLifecycleFilter, string> = {
  active: 'Ativos',
  inactive: 'Inativos',
  all: 'Todos',
};

const FINANCE_READINESS_TONE: Record<FinanceReadinessStatus, string> = {
  ready: 'bg-emerald-400/10 text-emerald-200',
  blocked: 'bg-amber-400/10 text-amber-200',
  inactive: 'bg-white/5 text-brand-muted',
};

const FINANCE_READINESS_LABEL: Record<FinanceReadinessStatus, string> = {
  ready: 'Financeiro OK',
  blocked: 'Cobrança pendente',
  inactive: 'Fora da operação',
};

export { clientDisplayName, clientOptionLabel };

interface ClientsViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
  persistClientData?: (nextData: CamplyData, clientId: string) => Promise<void>;
}

export function ClientsView({ data, updateData, persistClientData }: ClientsViewProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState(() => {
    const pending = readPendingClientSelection();
    if (pending && data.clients.some((client) => client.id === pending)) return pending;
    return data.clients[0]?.id || '';
  });
  const [metaWorkspaceKey, setMetaWorkspaceKey] = useState(0);
  const [lifecycleFilter, setLifecycleFilter] = useState<ClientLifecycleFilter>('active');
  const [deactivatingClient, setDeactivatingClient] = useState<Client | null>(null);
  const editingClient = data.clients.find((client) => client.id === editingClientId);

  const visibleClients = useMemo(() => data.clients.filter((client) => {
    if (lifecycleFilter === 'all') return true;
    const project = data.projects.find((item) => item.id === client.projectId);
    const active = isClientOperationallyActive(client, project);
    return lifecycleFilter === 'active' ? active : !active;
  }), [data.clients, data.projects, lifecycleFilter]);

  // Só a área "finance" é computável aqui - perfil de análise e catálogo Meta
  // vivem em RPCs assíncronas que este componente não carrega (ver Analytics
  // por Cliente e Integração Meta, que já usam a camada central para essas áreas).
  const operationalView = useMemo(() => buildOperationalView(data), [data]);
  const receivableEntriesByClient = useMemo(() => {
    const map = new Map<string, OperationalEntry[]>();
    // buildOperationalView exclui linhas em atraso de currentMonthEntries (elas
    // vão para overdueCurrentMonthEntries) - sem incluir esse balde aqui, um
    // cliente com cobrança atrasada apareceria como "Financeiro OK".
    [
      ...operationalView.currentMonthEntries,
      ...operationalView.nextMonthEntries,
      ...operationalView.overdueCurrentMonthEntries,
    ].forEach((entry) => {
      if (!entry.clientId) return;
      const list = map.get(entry.clientId) ?? [];
      list.push(entry);
      map.set(entry.clientId, list);
    });
    return map;
  }, [operationalView]);

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

  const confirmDeactivate = () => {
    if (!deactivatingClient) return;
    setStatus(deactivatingClient.id, 'paused');
    setDeactivatingClient(null);
  };

  const reactivateClient = (client: Client) => setStatus(client.id, 'active');

  return (
    <section className="h-full overflow-y-auto bg-brand-ink p-4 sm:p-5 lg:p-8">
      <div className="mx-auto max-w-[1700px] space-y-6">
        <header className="flex flex-col gap-4 rounded-2xl border border-brand-line bg-brand-surface p-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-brand-green"><Users size={17} /><p className="text-xs font-bold uppercase tracking-[0.2em]">Clientes</p></div>
            <h1 className="mt-2 text-3xl font-black text-white">Base operacional e Meta Ads</h1>
            <p className="mt-1 text-sm text-brand-muted">O cadastro comercial permanece separado da fonte oficial de performance.</p>
          </div>
          <button type="button" onClick={() => { setEditingClientId(null); setModalOpen(true); }} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-green px-4 py-3 text-sm font-black text-brand-ink"><Plus size={17} /> Novo cliente</button>
        </header>

        {data.clients.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-brand-line bg-brand-surface p-10 text-center">
            <p className="font-black text-white">Nenhum cliente cadastrado</p>
            <p className="mt-1 text-sm text-brand-muted">Crie o primeiro cliente para iniciar a operação e vincular uma conta Meta.</p>
          </div>
        ) : (
          <>
            <div role="group" aria-label="Filtrar clientes por status operacional" className="flex flex-wrap items-center gap-2">
              {(Object.keys(LIFECYCLE_FILTER_LABELS) as ClientLifecycleFilter[]).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  data-testid={`client-lifecycle-filter-${filter}`}
                  aria-pressed={lifecycleFilter === filter}
                  onClick={() => setLifecycleFilter(filter)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                    lifecycleFilter === filter
                      ? 'border-brand-green/60 bg-brand-green/15 text-brand-green'
                      : 'border-brand-line text-brand-muted hover:bg-white/5'
                  }`}
                >
                  {LIFECYCLE_FILTER_LABELS[filter]} · {filter === 'all'
                    ? data.clients.length
                    : data.clients.filter((client) => {
                        const project = data.projects.find((item) => item.id === client.projectId);
                        const active = isClientOperationallyActive(client, project);
                        return filter === 'active' ? active : !active;
                      }).length}
                </button>
              ))}
            </div>

            {visibleClients.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-brand-line bg-brand-surface p-10 text-center">
                <p className="font-black text-white">Nenhum cliente neste filtro</p>
                <p className="mt-1 text-sm text-brand-muted">Troque o filtro acima para ver clientes ativos, inativos ou todos.</p>
              </div>
            ) : (
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {visibleClients.map((client) => {
              const project = data.projects.find((p) => p.id === client.projectId);
              const operationallyActive = isClientOperationallyActive(client, project);
              const readiness = evaluateClientOperationalReadiness({
                clientId: client.id,
                client,
                project,
                analysisProfile: null,
                receivableEntries: receivableEntriesByClient.get(client.id) ?? [],
              });
              return (
              <article key={client.id} className={`rounded-2xl border bg-brand-surface p-5 transition ${selectedClientId === client.id ? 'border-brand-green/60' : 'border-brand-line'}`}>
                <button type="button" onClick={() => setSelectedClientId(client.id)} className="w-full text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-brand-green">{client.segment || 'Segmento não informado'}</p>
                      <h2 className="mt-1 text-xl font-black text-white">{clientDisplayName(client)}</h2>
                      <p className="mt-1 text-sm text-brand-muted">Responsável: {client.name}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] font-bold uppercase text-brand-soft">{client.status}</span>
                      <span
                        data-testid="client-finance-readiness-badge"
                        title={[...readiness.finance.missing, ...readiness.finance.warnings].join(', ') || undefined}
                        className={`rounded-full px-2 py-1 text-[10px] font-bold ${FINANCE_READINESS_TONE[readiness.finance.status]}`}
                      >
                        {FINANCE_READINESS_LABEL[readiness.finance.status]}
                      </span>
                    </div>
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
                  {operationallyActive ? (
                    <button
                      type="button"
                      data-testid="client-deactivate-button"
                      onClick={() => setDeactivatingClient(client)}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-400/30 px-3 py-2 text-xs font-bold text-rose-200"
                    >
                      <Ban size={13} /> Desativar cliente
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-testid="client-reactivate-button"
                      onClick={() => reactivateClient(client)}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/30 px-3 py-2 text-xs font-bold text-emerald-200"
                    >
                      <RotateCcw size={13} /> Reativar cliente
                    </button>
                  )}
                  <button type="button" onClick={() => setSelectedClientId(client.id)} className="ml-auto rounded-lg bg-brand-green/10 px-3 py-2 text-xs font-black text-brand-green">Analisar Meta</button>
                </div>
              </article>
              );
            })}
          </div>
            )}
          </>
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

        <ConfirmDialog
          open={deactivatingClient !== null}
          title="Desativar cliente?"
          description="Desativar este cliente remove ele da operação ativa e da sincronização em massa, mas mantém o histórico salvo."
          confirmLabel="Desativar cliente"
          tone="danger"
          onCancel={() => setDeactivatingClient(null)}
          onConfirm={confirmDeactivate}
        />
      </div>
    </section>
  );
}
