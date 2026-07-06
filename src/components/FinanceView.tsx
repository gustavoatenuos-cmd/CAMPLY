import { money, normalizeMonthlyInvestment } from '../data/camplyStore';
import { CamplyData, InvestmentPeriod } from '../types';
import { clientDisplayName } from './ClientsView';

interface FinanceViewProps {
  data: CamplyData;
}

// Cores semânticas por plataforma
const platformValueColor: Record<string, string> = {
  meta:    'text-blue-400',
  google:  'text-red-400',
  youtube: 'text-rose-500',
  tiktok:  'text-pink-400',
};

export function FinanceView({ data }: FinanceViewProps) {
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

  return (
    // bg-brand-ink garante fundo consistente com as outras views
    <section className="h-full overflow-y-auto bg-brand-ink p-4 sm:p-5 lg:p-8">
      <div className="mx-auto max-w-[1700px] space-y-6">

        {/* Header */}
        <div className="mb-0 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-green">Financeiro</p>
            <h1 className="mt-1 text-2xl font-black text-white">Verbas de mídia dos clientes</h1>
          </div>
        </div>

        {/* KPI cards — total em verde, plataformas com cor semântica */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Total label="Total mensal estimado" value={money(total)} valueColor="text-brand-green" />
          <Total label="Meta mensal"            value={money(totals.meta)}    valueColor={platformValueColor.meta} />
          <Total label="Google mensal"          value={money(totals.google)}  valueColor={platformValueColor.google} />
          <Total label="YouTube mensal"         value={money(totals.youtube)} valueColor={platformValueColor.youtube} />
          <Total label="TikTok mensal"          value={money(totals.tiktok)}  valueColor={platformValueColor.tiktok} />
        </div>

        {/* Tabela de clientes — usa bg-brand-surface (contraste correto sobre bg-brand-ink) */}
        <div className="overflow-hidden rounded-2xl border border-brand-line bg-brand-surface">

          {/* Cabeçalho da tabela */}
          <div className="border-b border-brand-line px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-green">Distribuição por plataforma</p>
          </div>

          {/* Linha de cabeçalho das colunas (apenas xl) */}
          <div className="hidden xl:grid xl:grid-cols-[1fr_0.7fr_0.8fr_0.8fr_0.8fr_0.8fr_1fr] border-b border-brand-line/50 bg-brand-ink/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
            <span>Cliente</span>
            <span>Período</span>
            <span className={platformValueColor.meta}>Meta Ads</span>
            <span className={platformValueColor.google}>Google Ads</span>
            <span className={platformValueColor.youtube}>YouTube</span>
            <span className={platformValueColor.tiktok}>TikTok</span>
            <span className="text-brand-green">Total /mês</span>
          </div>

          {/* Linhas de clientes */}
          {data.clients.map((client) => {
            const clientTotal = client.adInvestmentMeta + client.adInvestmentGoogle + client.adInvestmentYoutube + client.adInvestmentTikTok;
            const monthlyTotal = normalizeMonthlyInvestment(clientTotal, client.adInvestmentPeriod);
            const project = data.projects.find((item) => item.id === client.projectId);
            return (
              <div
                key={client.id}
                className="grid gap-3 border-b border-brand-line/60 p-4 text-sm last:border-b-0 xl:grid-cols-[1fr_0.7fr_0.8fr_0.8fr_0.8fr_0.8fr_1fr] xl:items-center"
              >
                <div>
                  <p className="font-semibold text-white">{clientDisplayName(client)}</p>
                  {project && <p className="mt-1 text-xs font-semibold text-brand-green">Projeto: {project.name}</p>}
                  {client.company && <p className="mt-1 text-xs text-brand-muted">Responsável: {client.name}</p>}
                </div>
                <p className="text-brand-muted">{periodLabel(client.adInvestmentPeriod)}</p>
                {/* Valores de plataforma em branco (legíveis), não mais em cinza */}
                <p className="text-white">{money(client.adInvestmentMeta)}</p>
                <p className="text-white">{money(client.adInvestmentGoogle)}</p>
                <p className="text-white">{money(client.adInvestmentYoutube)}</p>
                <p className="text-white">{money(client.adInvestmentTikTok)}</p>
                <p className="font-bold text-brand-green">{money(monthlyTotal)}/mês</p>
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

function Total({ label, value, valueColor }: { label: string; value: string; valueColor: string }) {
  return (
    <div className="rounded-xl border border-brand-line bg-brand-surface p-5">
      <p className="text-sm text-brand-muted">{label}</p>
      <p className={`mt-3 text-2xl font-black ${valueColor}`}>{value}</p>
    </div>
  );
}
