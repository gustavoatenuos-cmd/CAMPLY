import { useState } from 'react';
import { Edit2, Check, X } from 'lucide-react';
import { money, normalizeMonthlyInvestment } from '../data/camplyStore';
import { CamplyData, InvestmentPeriod, Client } from '../types';
import { clientDisplayName } from './ClientsView';

interface FinanceViewProps {
  data: CamplyData;
  updateData?: (updater: (data: CamplyData) => CamplyData) => void;
}

// Cores semânticas por plataforma
const platformValueColor: Record<string, string> = {
  meta:    'text-blue-400',
  google:  'text-red-400',
  youtube: 'text-rose-500',
  tiktok:  'text-pink-400',
};

export function FinanceView({ data, updateData }: FinanceViewProps) {
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    adInvestmentMeta: number;
    adInvestmentGoogle: number;
    adInvestmentYoutube: number;
    adInvestmentTikTok: number;
    adInvestmentPeriod: InvestmentPeriod;
  } | null>(null);

  const totals = data.clients.reduce(
    (acc, client) => ({
      meta:    acc.meta    + normalizeMonthlyInvestment(client.adInvestmentMeta,    client.adInvestmentPeriod),
      google:  acc.google  + normalizeMonthlyInvestment(client.adInvestmentGoogle,  client.adInvestmentPeriod),
      youtube: acc.youtube + normalizeMonthlyInvestment(client.adInvestmentYoutube, client.adInvestmentPeriod),
      tiktok:  acc.tiktok  + normalizeMonthlyInvestment(client.adInvestmentTikTok,  client.adInvestmentPeriod),
    }),
    { meta: 0, google: 0, youtube: 0, tiktok: 0 },
  );
  const total = totals.meta + totals.google + totals.youtube + totals.tiktok;

  const startEdit = (client: Client) => {
    setEditingClientId(client.id);
    setEditForm({
      adInvestmentMeta: client.adInvestmentMeta || 0,
      adInvestmentGoogle: client.adInvestmentGoogle || 0,
      adInvestmentYoutube: client.adInvestmentYoutube || 0,
      adInvestmentTikTok: client.adInvestmentTikTok || 0,
      adInvestmentPeriod: client.adInvestmentPeriod || 'monthly',
    });
  };

  const saveEdit = (clientId: string) => {
    if (!editForm || !updateData) return;
    updateData((current) => ({
      ...current,
      clients: current.clients.map((c) =>
        c.id === clientId
          ? {
              ...c,
              adInvestmentMeta: Number(editForm.adInvestmentMeta) || 0,
              adInvestmentGoogle: Number(editForm.adInvestmentGoogle) || 0,
              adInvestmentYoutube: Number(editForm.adInvestmentYoutube) || 0,
              adInvestmentTikTok: Number(editForm.adInvestmentTikTok) || 0,
              adInvestmentPeriod: editForm.adInvestmentPeriod,
            }
          : c
      ),
    }));
    setEditingClientId(null);
    setEditForm(null);
  };

  const cancelEdit = () => {
    setEditingClientId(null);
    setEditForm(null);
  };

  return (
    <section className="h-full overflow-y-auto bg-brand-ink p-4 sm:p-5 lg:p-8">
      <div className="mx-auto max-w-[1700px] space-y-6">

        {/* Header */}
        <div className="mb-0 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-green">Financeiro</p>
            <h1 className="mt-1 text-2xl font-black text-white">Verbas de mídia dos clientes</h1>
            <p className="mt-1 text-sm text-brand-muted">Distribuição de orçamentos e edição rápida de verbas por plataforma.</p>
          </div>
        </div>

        {/* KPI cards — total em verde, plataformas com cor semântica */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Total label="Total mensal estimado" value={money(total)} valueColor="text-brand-green" />
          <Total label="Meta mensal"            value={money(totals.meta)}    valueColor={platformValueColor.meta} percent={total > 0 ? (totals.meta / total) * 100 : 0} />
          <Total label="Google mensal"          value={money(totals.google)}  valueColor={platformValueColor.google} percent={total > 0 ? (totals.google / total) * 100 : 0} />
          <Total label="YouTube mensal"         value={money(totals.youtube)} valueColor={platformValueColor.youtube} percent={total > 0 ? (totals.youtube / total) * 100 : 0} />
          <Total label="TikTok mensal"          value={money(totals.tiktok)}  valueColor={platformValueColor.tiktok} percent={total > 0 ? (totals.tiktok / total) * 100 : 0} />
        </div>

        {/* Tabela de clientes — usa bg-brand-surface */}
        <div className="overflow-hidden rounded-2xl border border-brand-line bg-brand-surface">

          {/* Cabeçalho da tabela */}
          <div className="flex items-center justify-between border-b border-brand-line px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-green">Distribuição por plataforma</p>
            {updateData && <span className="text-xs text-brand-muted">Clique em "Editar" em qualquer cliente para alterar verbas</span>}
          </div>

          {/* Linha de cabeçalho das colunas (apenas xl) */}
          <div className="hidden xl:grid xl:grid-cols-[1fr_0.7fr_0.8fr_0.8fr_0.8fr_0.8fr_1fr_0.5fr] border-b border-brand-line/50 bg-brand-ink/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
            <span>Cliente</span>
            <span>Período</span>
            <span className={platformValueColor.meta}>Meta Ads</span>
            <span className={platformValueColor.google}>Google Ads</span>
            <span className={platformValueColor.youtube}>YouTube</span>
            <span className={platformValueColor.tiktok}>TikTok</span>
            <span className="text-brand-green">Total /mês</span>
            <span className="text-right">Ação</span>
          </div>

          {/* Linhas de clientes */}
          {data.clients.map((client) => {
            const isEditing = editingClientId === client.id;
            const clientTotal = isEditing && editForm
              ? editForm.adInvestmentMeta + editForm.adInvestmentGoogle + editForm.adInvestmentYoutube + editForm.adInvestmentTikTok
              : client.adInvestmentMeta + client.adInvestmentGoogle + client.adInvestmentYoutube + client.adInvestmentTikTok;
            
            const currentPeriod = isEditing && editForm ? editForm.adInvestmentPeriod : client.adInvestmentPeriod;
            const monthlyTotal = normalizeMonthlyInvestment(clientTotal, currentPeriod);
            const project = data.projects.find((item) => item.id === client.projectId);

            return (
              <div
                key={client.id}
                className={`grid gap-3 border-b border-brand-line/60 p-4 text-sm last:border-b-0 xl:grid-cols-[1fr_0.7fr_0.8fr_0.8fr_0.8fr_0.8fr_1fr_0.5fr] xl:items-center ${
                  isEditing ? 'bg-brand-ink/80 border-brand-green/30' : ''
                }`}
              >
                <div>
                  <p className="font-semibold text-white">{clientDisplayName(client)}</p>
                  {project && <p className="mt-1 text-xs font-semibold text-brand-green">Projeto: {project.name}</p>}
                  {client.company && <p className="mt-1 text-xs text-brand-muted">Responsável: {client.name}</p>}
                </div>

                {isEditing && editForm ? (
                  <>
                    <select
                      value={editForm.adInvestmentPeriod}
                      onChange={(e) => setEditForm({ ...editForm, adInvestmentPeriod: e.target.value as InvestmentPeriod })}
                      className="rounded-lg border border-brand-line bg-brand-surface px-2 py-1 text-xs text-white focus:border-brand-green focus:outline-none"
                    >
                      <option value="daily">Diário</option>
                      <option value="weekly">Semanal</option>
                      <option value="monthly">Mensal</option>
                    </select>

                    <input
                      type="number"
                      value={editForm.adInvestmentMeta}
                      onChange={(e) => setEditForm({ ...editForm, adInvestmentMeta: parseFloat(e.target.value) || 0 })}
                      className="w-full rounded-lg border border-brand-line bg-brand-surface px-2 py-1 text-xs text-blue-400 focus:border-brand-green focus:outline-none"
                    />

                    <input
                      type="number"
                      value={editForm.adInvestmentGoogle}
                      onChange={(e) => setEditForm({ ...editForm, adInvestmentGoogle: parseFloat(e.target.value) || 0 })}
                      className="w-full rounded-lg border border-brand-line bg-brand-surface px-2 py-1 text-xs text-red-400 focus:border-brand-green focus:outline-none"
                    />

                    <input
                      type="number"
                      value={editForm.adInvestmentYoutube}
                      onChange={(e) => setEditForm({ ...editForm, adInvestmentYoutube: parseFloat(e.target.value) || 0 })}
                      className="w-full rounded-lg border border-brand-line bg-brand-surface px-2 py-1 text-xs text-rose-500 focus:border-brand-green focus:outline-none"
                    />

                    <input
                      type="number"
                      value={editForm.adInvestmentTikTok}
                      onChange={(e) => setEditForm({ ...editForm, adInvestmentTikTok: parseFloat(e.target.value) || 0 })}
                      className="w-full rounded-lg border border-brand-line bg-brand-surface px-2 py-1 text-xs text-pink-400 focus:border-brand-green focus:outline-none"
                    />

                    <p className="font-bold text-brand-green">{money(monthlyTotal)}/mês</p>

                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => saveEdit(client.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-green text-brand-ink transition hover:bg-brand-green/80"
                        title="Salvar"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-brand-line bg-brand-surface text-brand-muted transition hover:text-white"
                        title="Cancelar"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-brand-muted">{periodLabel(client.adInvestmentPeriod)}</p>
                    <p className="text-white">{money(client.adInvestmentMeta)}</p>
                    <p className="text-white">{money(client.adInvestmentGoogle)}</p>
                    <p className="text-white">{money(client.adInvestmentYoutube)}</p>
                    <p className="text-white">{money(client.adInvestmentTikTok)}</p>
                    <p className="font-bold text-brand-green">{money(monthlyTotal)}/mês</p>
                    <div className="flex justify-end">
                      {updateData && (
                        <button
                          type="button"
                          onClick={() => startEdit(client)}
                          className="flex items-center gap-1 rounded-lg border border-brand-line/60 bg-brand-ink/40 px-2.5 py-1 text-xs font-medium text-brand-muted transition hover:border-brand-green/40 hover:text-white"
                        >
                          <Edit2 size={12} />
                          Editar
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function periodLabel(period: InvestmentPeriod) {
  if (period === 'daily') return 'Diário';
  if (period === 'weekly') return 'Semanal';
  return 'Mensal';
}

function Total({ label, value, valueColor, percent }: { label: string; value: string; valueColor: string; percent?: number }) {
  return (
    <div className="rounded-xl border border-brand-line bg-brand-surface p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-brand-muted">{label}</p>
        {percent !== undefined && (
          <span className="text-xs font-semibold text-brand-muted">{percent.toFixed(1)}%</span>
        )}
      </div>
      <p className={`mt-3 text-2xl font-black ${valueColor}`}>{value}</p>
    </div>
  );
}
