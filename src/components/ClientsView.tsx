import { Edit3, Mail, Plus, RefreshCw, Link as LinkIcon } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { createActivityLog, makeId, money, normalizeMonthlyInvestment } from '../data/camplyStore';
import { billingTypes, investmentPeriods } from '../data/options';
import { Modal } from './ui/Modal';
import { BillingType, CamplyData, ClientStatus, InvestmentPeriod } from '../types';

function MetaAccountSelector({ accounts, defaultValue }: { accounts: {id: string, name: string}[], defaultValue: string }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  
  const initialSelected = accounts.find(a => a.id === defaultValue);
  const [selectedId, setSelectedId] = useState(defaultValue);
  const [selectedName, setSelectedName] = useState(initialSelected?.name || '');

  const filtered = accounts.filter(acc => acc.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="relative">
      <input type="hidden" name="metaAdAccountId" value={selectedId} />
      <div 
        className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green flex items-center justify-between cursor-pointer"
        onClick={() => setOpen(!open)}
      >
        <span className={selectedName ? 'text-white' : 'text-gray-400 truncate'}>
          {selectedName || 'Selecionar conta Meta Ads...'}
        </span>
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-brand-line bg-brand-surface p-2 shadow-xl" onMouseLeave={() => setOpen(false)}>
          <input 
            type="text" 
            placeholder="Buscar conta..." 
            className="mb-2 w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-sm text-white outline-none"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="max-h-48 overflow-y-auto">
            <div 
              className="cursor-pointer rounded px-2 py-1 text-sm hover:bg-white/10"
              onClick={() => {
                setSelectedId('');
                setSelectedName('');
                setOpen(false);
                setQuery('');
              }}
            >
              Sem vínculo
            </div>
            {filtered.map(acc => (
              <div 
                key={acc.id}
                className="cursor-pointer rounded px-2 py-1 text-sm hover:bg-white/10 truncate"
                onClick={() => {
                  setSelectedId(acc.id);
                  setSelectedName(acc.name);
                  setOpen(false);
                  setQuery('');
                }}
              >
                {acc.name}
              </div>
            ))}
            {filtered.length === 0 && <div className="px-2 py-1 text-sm text-gray-400">Nenhuma conta encontrada.</div>}
          </div>
        </div>
      )}
    </div>
  )
}

interface ClientsViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

export function ClientsView({ data, updateData }: ClientsViewProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [metaAdAccounts, setMetaAdAccounts] = useState<{id: string, name: string}[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const editingClient = data.clients.find((client) => client.id === editingClientId);

  useEffect(() => {
    async function fetchMetaAccounts() {
      if (!supabase) return;
      const { data, error } = await supabase
        .from('meta_assets')
        .select('asset_id, asset_name')
        .eq('asset_type', 'adaccount');
        
      if (!error && data) {
        setMetaAdAccounts(data.map((d: any) => ({ id: d.asset_id, name: d.asset_name })));
      }
    }
    fetchMetaAccounts();
  }, []);

  const saveClient = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    if (!name) return;
    const nextClient = {
      id: editingClient?.id ?? makeId('client'),
      projectId: String(form.get('projectId') ?? ''),
      name,
      company: String(form.get('company') ?? ''),
      segment: String(form.get('segment') ?? ''),
      structure: String(form.get('structure') ?? ''),
      hasProject: form.get('hasProject') === 'on',
      contact: String(form.get('contact') ?? ''),
      monthlyFee: Number(form.get('monthlyFee') ?? 0),
      managementFeeType: String(form.get('managementFeeType') ?? 'recurring') as BillingType,
      dueDay: Number(form.get('dueDay') ?? 10),
      adInvestmentPeriod: String(form.get('adInvestmentPeriod') ?? 'monthly') as InvestmentPeriod,
      adInvestmentMeta: Number(form.get('adInvestmentMeta') ?? 0),
      adInvestmentGoogle: Number(form.get('adInvestmentGoogle') ?? 0),
      adInvestmentYoutube: Number(form.get('adInvestmentYoutube') ?? 0),
      adInvestmentTikTok: Number(form.get('adInvestmentTikTok') ?? 0),
      status: String(form.get('status') ?? 'lead') as ClientStatus,
      notes: String(form.get('notes') ?? ''),
      metaAdAccountId: String(form.get('metaAdAccountId') ?? ''),
      metaAdAccountName: metaAdAccounts.find(acc => acc.id === String(form.get('metaAdAccountId')))?.name,
    };

    // Always sync if a meta account is linked when saving, to allow forcing updates
    const shouldSyncMeta = !!nextClient.metaAdAccountId;

    if (shouldSyncMeta && supabase) {
      setIsSyncing(true);
      // Fetch active campaigns from edge function
      supabase.functions.invoke('meta-sync-ads', {
        body: { adAccountId: nextClient.metaAdAccountId }
      }).then(({ data, error }) => {
        setIsSyncing(false);
        if (data?.campaigns && Array.isArray(data.campaigns)) {
          const numCampaigns = data.campaigns.length;
          // Se tiver só 1 campanha, entra como 'live' (ativa). Se tiver mais, entram como 'optimize' (em otimização).
          const assignedStatus = numCampaigns > 1 ? 'optimize' : 'live';

          const fetchedCampaigns = data.campaigns.map((c: any) => {
            // const isConversion = (type: string) => type === 'lead' || type === 'purchase' || type.includes('conversion') || type.includes('messaging');
            
            const spend = Number(c.insights?.spend || 0);
            const results = c.results || 0; // Legacy fallback
            const cpr = results > 0 ? spend / results : 0;

            const metricsByPeriod: Record<string, any> = {};
            if (c.insightsByPeriod) {
              for (const [period, pInsights] of Object.entries(c.insightsByPeriod)) {
                if (!pInsights) continue;
                const pSpend = Number((pInsights as any).spend || 0);
                const pResults = c.metricsByPeriod?.["last_7d"]?.results || 0; // Legacy fallback
                
                metricsByPeriod[period] = {
                  spent: pSpend,
                  results: pResults,
                  ctr: Number((pInsights as any).ctr || 0),
                  cpc: Number((pInsights as any).cpc || 0),
                  cpr: pResults > 0 ? pSpend / pResults : 0,
                  pageViews: Number((pInsights as any).actions?.find((a: any) => a.action_type === 'landing_page_view' || a.action_type === 'view_content')?.value || 0),
                  checkouts: Number((pInsights as any).actions?.find((a: any) => a.action_type === 'initiate_checkout')?.value || 0),
                  purchases: Number((pInsights as any).actions?.find((a: any) => a.action_type === 'purchase')?.value || 0),
                  impressions: Number((pInsights as any).impressions || 0)
                };
              }
            }

            return {
              id: makeId('campaign'),
              clientId: nextClient.id,
              name: c.name,
              platform: 'Meta Ads' as const,
              status: assignedStatus,
              objective: c.objective,
              budget: Number(c.lifetime_budget || c.daily_budget || 0) / 100,
              spent: spend,
              results: results,
              ctr: Number(c.insights?.ctr || 0),
              cpc: Number(c.insights?.cpc || 0),
              cpr: cpr,
              pageViews: Number(c.insights?.actions?.find((a: any) => a.action_type === 'landing_page_view' || a.action_type === 'view_content')?.value || 0),
              checkouts: Number(c.insights?.actions?.find((a: any) => a.action_type === 'initiate_checkout')?.value || 0),
              purchases: Number(c.insights?.actions?.find((a: any) => a.action_type === 'purchase')?.value || 0),
              metricsByPeriod,
              activeCreatives: c.activeAdSets?.reduce((acc: number, set: any) => acc + (set.ads?.length || 0), 0) || 0,
              lastOptimizedAt: new Date().toISOString().slice(0, 10),
              nextAction: '',
              priority: 'medium' as const,
              metaCampaignId: c.id,
              activeAdSets: c.activeAdSets || []
            };
          });
          updateData(curr => {
            const updatedCampaigns = curr.campaigns.map((c: any) => {
              if (c.clientId === nextClient.id && c.platform === 'Meta Ads') {
                const fc = fetchedCampaigns.find((f: any) => f.metaCampaignId === c.metaCampaignId);
                if (fc) {
                  return { ...fc, id: c.id, status: c.status !== 'launching' ? c.status : fc.status }; // if it was already active in crm, keep its system status like 'optimize', else fc.status
                } else {
                  return { ...c, status: 'paused' };
                }
              }
              return c;
            });
            
            const newCampaignsToInsert = fetchedCampaigns
              .filter((fc: any) => !curr.campaigns.some((c: any) => c.metaCampaignId === fc.metaCampaignId))
              .map((fc: any) => ({
                ...fc,
                id: makeId('campaign'),
                clientId: nextClient.id
              }));

            return {
            ...curr,
            campaigns: [...newCampaignsToInsert, ...updatedCampaigns],
            activityLogs: [
              createActivityLog({
                action: 'campaign_created',
                title: `${fetchedCampaigns.length} Campanhas importadas da Meta`,
                description: `Foram sincronizadas as campanhas ativas da conta ${nextClient.metaAdAccountName}.`,
                projectId: nextClient.projectId,
                clientId: nextClient.id,
                campaignId: '',
                receivableId: '',
                taskId: '',
              }),
              ...curr.activityLogs
            ]
          };
          });
        }
      });
    }

    updateData((current) => ({
      ...current,
      clients: editingClient
        ? current.clients.map((client) => (client.id === editingClient.id ? nextClient : client))
        : [nextClient, ...current.clients],
      activityLogs: [
        createActivityLog({
          action: editingClient ? 'client_updated' : 'client_created',
          title: editingClient ? `Cliente editado: ${nextClient.name}` : `Cliente criado: ${nextClient.name}`,
          description: editingClient
            ? 'Dados comerciais, financeiros ou operacionais do cliente foram atualizados.'
            : `${nextClient.company || nextClient.segment || 'Cliente sem empresa informada'} entrou na base operacional.`,
          projectId: nextClient.projectId,
          clientId: nextClient.id,
          campaignId: '',
          receivableId: '',
          taskId: '',
        }),
        ...current.activityLogs,
      ],
    }));
    setModalOpen(false);
    setEditingClientId(null);
    event.currentTarget.reset();
  };

  const setStatus = (id: string, status: ClientStatus) => {
    const client = data.clients.find((item) => item.id === id);
    updateData((current) => ({
      ...current,
      clients: current.clients.map((client) => (client.id === id ? { ...client, status } : client)),
      activityLogs: client
        ? [
            createActivityLog({
              action: 'client_status_changed',
              title: `Status alterado: ${client.name}`,
              description: `Cliente movido para ${status}.`,
              projectId: client.projectId,
              clientId: client.id,
              campaignId: '',
              receivableId: '',
              taskId: '',
            }),
            ...current.activityLogs,
          ]
        : current.activityLogs,
    }));
  };

  return (
    <section className="h-full overflow-y-auto p-4 sm:p-5 lg:p-8">
      <Header
        eyebrow="Clientes"
        title="Base comercial"
        action="Novo cliente"
        onAction={() => {
          setEditingClientId(null);
          setModalOpen(true);
        }}
      />
      <Modal
        title={editingClient ? 'Editar cliente' : 'Novo cliente'}
        description="Cadastre a empresa, estrutura trabalhada, investimento de mídia e dados operacionais."
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingClientId(null);
        }}
      >
        <form key={editingClient?.id ?? 'new-client'} onSubmit={saveClient} className="space-y-5 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome do responsável" name="name" defaultValue={editingClient?.name} required />
            <Field label="Empresa / marca" name="company" defaultValue={editingClient?.company} />
            <Field label="Segmento" name="segment" defaultValue={editingClient?.segment} placeholder="Ex: clínica, infoproduto, ecommerce" />
            <Field label="Contato principal" name="contact" defaultValue={editingClient?.contact} placeholder="E-mail, telefone ou WhatsApp" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Projeto guarda-chuva</span>
              <select name="projectId" defaultValue={editingClient?.projectId ?? ''} className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
                <option value="">Sem projeto</option>
                {data.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft flex items-center gap-2"><LinkIcon size={14} className="text-[#0064e0]" /> Conta Meta Ads (Sincronização)</span>
              <MetaAccountSelector accounts={metaAdAccounts} defaultValue={editingClient?.metaAdAccountId ?? ''} />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Tipo de serviço</span>
              <select name="managementFeeType" defaultValue={editingClient?.managementFeeType ?? 'recurring'} className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
                {billingTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-brand-soft">Estrutura trabalhada</span>
            <textarea name="structure" defaultValue={editingClient?.structure} rows={3} className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green" placeholder="Ex: landing page, WhatsApp, criativos, CRM, checkout, pixel, Google Tag Manager..." />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <MoneyField label="Valor da gestão" name="monthlyFee" defaultValue={editingClient?.monthlyFee} />
            <Field label="Dia de vencimento" name="dueDay" type="number" min="1" max="31" defaultValue={editingClient?.dueDay ?? 10} />
          </div>

          <div>
            <div className="mb-3 grid gap-4 md:grid-cols-[1fr_220px] md:items-end">
              <p className="text-sm font-semibold text-brand-soft">Investimento em anúncios</p>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-brand-soft">Período do investimento</span>
                <select name="adInvestmentPeriod" defaultValue={editingClient?.adInvestmentPeriod ?? 'monthly'} className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
                  {investmentPeriods.map((period) => (
                    <option key={period.value} value={period.value}>
                      {period.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              <MoneyField label="Facebook/Meta" name="adInvestmentMeta" defaultValue={editingClient?.adInvestmentMeta} />
              <MoneyField label="Google" name="adInvestmentGoogle" defaultValue={editingClient?.adInvestmentGoogle} />
              <MoneyField label="YouTube" name="adInvestmentYoutube" defaultValue={editingClient?.adInvestmentYoutube} />
              <MoneyField label="TikTok" name="adInvestmentTikTok" defaultValue={editingClient?.adInvestmentTikTok} />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Status</span>
              <select name="status" className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green" defaultValue={editingClient?.status ?? 'lead'}>
                <option value="lead">Lead</option>
                <option value="active">Ativo</option>
                <option value="paused">Pausado</option>
              </select>
            </label>
            <label className="flex items-center gap-3 rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-sm font-semibold text-brand-soft">
              <input name="hasProject" type="checkbox" defaultChecked={editingClient?.hasProject || !!editingClient?.projectId} className="h-4 w-4 accent-brand-green" />
              Cliente vinculado a uma estrutura de projeto
            </label>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-brand-soft">Observações</span>
            <textarea name="notes" defaultValue={editingClient?.notes} rows={3} className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green" />
          </label>

          <div className="flex justify-end gap-3 border-t border-brand-line pt-5">
            <button
              type="button"
              onClick={() => {
                setModalOpen(false);
                setEditingClientId(null);
              }}
              className="rounded-lg border border-brand-line px-4 py-2 font-semibold text-brand-soft"
            >
              Cancelar
            </button>
            <button disabled={isSyncing} className="rounded-lg bg-brand-green px-4 py-2 font-bold text-brand-ink disabled:opacity-50 inline-flex items-center gap-2">
              {isSyncing && <RefreshCw size={16} className="animate-spin" />}
              {editingClient ? 'Salvar alterações' : 'Salvar cliente'}
            </button>
          </div>
        </form>
      </Modal>
      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        {data.clients.map((client) => {
          const campaigns = data.campaigns.filter((campaign) => campaign.clientId === client.id);
          const pending = data.receivables.filter((item) => item.clientId === client.id && item.status !== 'paid');
          const totalAds =
            client.adInvestmentMeta + client.adInvestmentGoogle + client.adInvestmentYoutube + client.adInvestmentTikTok;
          const monthlyAds = normalizeMonthlyInvestment(totalAds, client.adInvestmentPeriod);
          const project = data.projects.find((item) => item.id === client.projectId);
          const displayCompany = client.company || client.segment || client.name || 'Sem empresa informada';
          return (
            <article key={client.id} className="rounded-xl border border-brand-line bg-brand-ink p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-white">{displayCompany}</h2>
                  {project && <p className="mt-1 text-xs font-semibold text-brand-green">Projeto: {project.name}</p>}
                  {client.company && <p className="mt-1 text-xs text-brand-muted">Responsável: {client.name}</p>}
                </div>
                <select value={client.status} onChange={(event) => setStatus(client.id, event.target.value as ClientStatus)} className="rounded-md border border-brand-line bg-brand-surface px-2 py-1 text-xs text-white">
                  <option value="active">Ativo</option>
                  <option value="lead">Lead</option>
                  <option value="paused">Pausado</option>
                </select>
              </div>
              <button
                onClick={() => {
                  setEditingClientId(client.id);
                  setModalOpen(true);
                }}
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-brand-line px-3 py-2 text-sm font-semibold text-brand-soft transition hover:border-brand-green hover:text-white"
              >
                <Edit3 size={15} />
                Editar dados
              </button>
              <p className="mt-5 flex items-center gap-2 text-sm text-brand-muted"><Mail size={15} /> {client.contact || 'Contato não informado'}</p>
              {client.structure && <p className="mt-3 text-sm leading-relaxed text-brand-muted">{client.structure}</p>}
              <div className="mt-5 grid gap-2 sm:grid-cols-3">
                <Mini label={client.managementFeeType === 'recurring' ? 'Mensalidade' : 'Pontual'} value={money(client.monthlyFee)} />
                <Mini label="Vence dia" value={client.dueDay.toString()} />
                <Mini label="Campanhas" value={campaigns.length.toString()} />
              </div>
              <div className="mt-4 rounded-lg bg-brand-surface p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-muted">Investimento em tráfego</p>
                <p className="mt-1 text-lg font-black text-brand-green">{money(totalAds)} <span className="text-xs text-brand-muted">/{periodLabel(client.adInvestmentPeriod)}</span></p>
                <p className="text-xs text-brand-muted">Equivalente mensal estimado: {money(monthlyAds)}</p>
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

function periodLabel(period: InvestmentPeriod) {
  if (period === 'daily') return 'dia';
  if (period === 'weekly') return 'semana';
  return 'mês';
}

export function clientDisplayName(client?: { name: string; company: string; segment: string }) {
  if (!client) return 'Cliente';
  return client.company || client.segment || client.name;
}

export function clientOptionLabel(
  client: { name: string; company: string; segment: string; projectId?: string },
  projects?: { id: string; name: string }[]
) {
  const display = clientDisplayName(client);
  if (projects && client.projectId) {
    const project = projects.find((p) => p.id === client.projectId);
    if (project) {
      return `${display} (${project.name})`;
    }
  }
  return client.name && client.name !== display ? `${display} (${client.name})` : display;
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
