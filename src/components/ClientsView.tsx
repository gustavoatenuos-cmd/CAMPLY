import { Mail, Plus } from 'lucide-react';
import { makeId, money } from '../data/camplyStore';
import { CamplyData, ClientStatus } from '../types';

interface ClientsViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

export function ClientsView({ data, updateData }: ClientsViewProps) {
  const addClient = () => {
    const name = window.prompt('Nome do cliente');
    if (!name) return;
    updateData((current) => ({
      ...current,
      clients: [
        {
          id: makeId('client'),
          name,
          segment: 'Novo segmento',
          contact: '',
          monthlyFee: 0,
          dueDay: 10,
          adInvestmentMeta: 0,
          adInvestmentGoogle: 0,
          adInvestmentYoutube: 0,
          adInvestmentTikTok: 0,
          status: 'lead',
          notes: 'Completar dados do cliente.',
        },
        ...current.clients,
      ],
    }));
  };

  const setStatus = (id: string, status: ClientStatus) => {
    updateData((current) => ({
      ...current,
      clients: current.clients.map((client) => (client.id === id ? { ...client, status } : client)),
    }));
  };

  return (
    <section className="h-full overflow-y-auto p-6 lg:p-8">
      <Header eyebrow="Clientes" title="Base comercial" action="Novo cliente" onAction={addClient} />
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {data.clients.map((client) => {
          const campaigns = data.campaigns.filter((campaign) => campaign.clientId === client.id);
          const pending = data.receivables.filter((item) => item.clientId === client.id && item.status !== 'paid');
          const totalAds =
            client.adInvestmentMeta + client.adInvestmentGoogle + client.adInvestmentYoutube + client.adInvestmentTikTok;
          return (
            <article key={client.id} className="rounded-xl border border-brand-line bg-brand-ink p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-white">{client.name}</h2>
                  <p className="mt-1 text-sm text-brand-muted">{client.segment}</p>
                </div>
                <select value={client.status} onChange={(event) => setStatus(client.id, event.target.value as ClientStatus)} className="rounded-md border border-brand-line bg-brand-surface px-2 py-1 text-xs text-white">
                  <option value="active">Ativo</option>
                  <option value="lead">Lead</option>
                  <option value="paused">Pausado</option>
                </select>
              </div>
              <p className="mt-5 flex items-center gap-2 text-sm text-brand-muted"><Mail size={15} /> {client.contact || 'Contato não informado'}</p>
              <div className="mt-5 grid grid-cols-3 gap-2">
                <Mini label="Mensalidade" value={money(client.monthlyFee)} />
                <Mini label="Vence dia" value={client.dueDay.toString()} />
                <Mini label="Campanhas" value={campaigns.length.toString()} />
              </div>
              <div className="mt-4 rounded-lg bg-brand-surface p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-muted">Investimento em tráfego</p>
                <p className="mt-1 text-lg font-black text-brand-green">{money(totalAds)}</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Mini label="Facebook/Meta" value={money(client.adInvestmentMeta)} />
                  <Mini label="Google" value={money(client.adInvestmentGoogle)} />
                  <Mini label="YouTube" value={money(client.adInvestmentYoutube)} />
                  <Mini label="TikTok" value={money(client.adInvestmentTikTok)} />
                </div>
              </div>
              <div className="mt-4 rounded-lg bg-brand-surface p-3">
                <p className="text-xs text-brand-muted">A receber</p>
                <p className="mt-1 text-lg font-black text-brand-green">{money(pending.reduce((sum, item) => sum + item.amount, 0))}</p>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-brand-muted">{client.notes}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Header({ eyebrow, title, action, onAction }: { eyebrow: string; title: string; action: string; onAction: () => void }) {
  return (
    <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-green">{eyebrow}</p>
        <h1 className="mt-1 text-2xl font-black text-white">{title}</h1>
      </div>
      <button onClick={onAction} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-green px-4 py-3 text-sm font-bold text-brand-ink">
        <Plus size={18} />
        {action}
      </button>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-brand-surface p-3">
      <p className="text-[11px] text-brand-muted">{label}</p>
      <p className="mt-1 truncate text-sm font-bold text-white">{value}</p>
    </div>
  );
}
