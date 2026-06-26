import { money, normalizeMonthlyInvestment } from '../data/camplyStore';
import { CamplyData, InvestmentPeriod } from '../types';
import { clientDisplayName } from './ClientsView';

interface FinanceViewProps {
  data: CamplyData;
}

export function FinanceView({ data }: FinanceViewProps) {
  const totals = data.clients.reduce(
    (acc, client) => ({
      meta: acc.meta + normalizeMonthlyInvestment(client.adInvestmentMeta, client.adInvestmentPeriod),
      google: acc.google + normalizeMonthlyInvestment(client.adInvestmentGoogle, client.adInvestmentPeriod),
      youtube: acc.youtube + normalizeMonthlyInvestment(client.adInvestmentYoutube, client.adInvestmentPeriod),
      tiktok: acc.tiktok + normalizeMonthlyInvestment(client.adInvestmentTikTok, client.adInvestmentPeriod),
    }),
    { meta: 0, google: 0, youtube: 0, tiktok: 0 },
  );
  const total = totals.meta + totals.google + totals.youtube + totals.tiktok;

  return (
    <section className="h-full overflow-y-auto p-4 sm:p-5 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-green">Financeiro</p>
          <h1 className="mt-1 text-2xl font-black text-white">Verbas de mídia dos clientes</h1>
        </div>
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Total label="Total mensal estimado" value={money(total)} />
        <Total label="Meta mensal" value={money(totals.meta)} />
        <Total label="Google mensal" value={money(totals.google)} />
        <Total label="YouTube mensal" value={money(totals.youtube)} />
        <Total label="TikTok mensal" value={money(totals.tiktok)} />
      </div>
      <div className="overflow-hidden rounded-xl border border-brand-line bg-brand-ink">
        {data.clients.map((client) => {
          const clientTotal = client.adInvestmentMeta + client.adInvestmentGoogle + client.adInvestmentYoutube + client.adInvestmentTikTok;
          const monthlyTotal = normalizeMonthlyInvestment(clientTotal, client.adInvestmentPeriod);
          return (
            <div key={client.id} className="grid gap-3 border-b border-brand-line p-4 text-sm last:border-b-0 xl:grid-cols-[1fr_0.7fr_0.8fr_0.8fr_0.8fr_0.8fr_1fr] xl:items-center">
              <p className="font-semibold text-white">{clientDisplayName(client)}</p>
              <p className="text-brand-muted">{periodLabel(client.adInvestmentPeriod)}</p>
              <p className="text-brand-muted">{money(client.adInvestmentMeta)}</p>
              <p className="text-brand-muted">{money(client.adInvestmentGoogle)}</p>
              <p className="text-brand-muted">{money(client.adInvestmentYoutube)}</p>
              <p className="text-brand-muted">{money(client.adInvestmentTikTok)}</p>
              <p className="font-bold text-brand-green">{money(monthlyTotal)}/mês</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function periodLabel(period: InvestmentPeriod) {
  if (period === 'daily') return 'Diário';
  if (period === 'weekly') return 'Semanal';
  return 'Mensal';
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-brand-line bg-brand-ink p-5">
      <p className="text-sm text-brand-muted">{label}</p>
      <p className="mt-3 text-2xl font-black text-white">{value}</p>
    </div>
  );
}
