import { money } from '../data/camplyStore';
import { CamplyData } from '../types';

interface FinanceViewProps {
  data: CamplyData;
}

export function FinanceView({ data }: FinanceViewProps) {
  const totals = data.clients.reduce(
    (acc, client) => ({
      meta: acc.meta + client.adInvestmentMeta,
      google: acc.google + client.adInvestmentGoogle,
      youtube: acc.youtube + client.adInvestmentYoutube,
      tiktok: acc.tiktok + client.adInvestmentTikTok,
    }),
    { meta: 0, google: 0, youtube: 0, tiktok: 0 },
  );
  const total = totals.meta + totals.google + totals.youtube + totals.tiktok;

  return (
    <section className="h-full overflow-y-auto p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-green">Financeiro</p>
          <h1 className="mt-1 text-2xl font-black text-white">Verbas de mídia dos clientes</h1>
        </div>
      </div>
      <div className="mb-6 grid gap-4 md:grid-cols-5">
        <Total label="Total mídia" value={money(total)} />
        <Total label="Facebook/Meta" value={money(totals.meta)} />
        <Total label="Google" value={money(totals.google)} />
        <Total label="YouTube" value={money(totals.youtube)} />
        <Total label="TikTok" value={money(totals.tiktok)} />
      </div>
      <div className="overflow-hidden rounded-xl border border-brand-line bg-brand-ink">
        {data.clients.map((client) => {
          const clientTotal = client.adInvestmentMeta + client.adInvestmentGoogle + client.adInvestmentYoutube + client.adInvestmentTikTok;
          return (
            <div key={client.id} className="grid gap-3 border-b border-brand-line p-4 text-sm last:border-b-0 md:grid-cols-[1fr_0.8fr_0.8fr_0.8fr_0.8fr_0.9fr] md:items-center">
              <p className="font-semibold text-white">{client.name}</p>
              <p className="text-brand-muted">{money(client.adInvestmentMeta)}</p>
              <p className="text-brand-muted">{money(client.adInvestmentGoogle)}</p>
              <p className="text-brand-muted">{money(client.adInvestmentYoutube)}</p>
              <p className="text-brand-muted">{money(client.adInvestmentTikTok)}</p>
              <p className="font-bold text-brand-green">{money(clientTotal)}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-brand-line bg-brand-ink p-5">
      <p className="text-sm text-brand-muted">{label}</p>
      <p className="mt-3 text-2xl font-black text-white">{value}</p>
    </div>
  );
}
