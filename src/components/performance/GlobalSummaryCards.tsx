import { Activity, CircleDollarSign, MessageCircle, ShieldCheck } from 'lucide-react';
import type { GlobalClientPerformance, MetricContract } from '../../lib/performance/globalPerformanceDashboard';
import type { PerformanceStatus } from '../../lib/performance/types';

function metricValue(metric: MetricContract | undefined): number | null {
  return metric?.available && typeof metric.value === 'number' ? metric.value : null;
}

function addAvailableMetric(total: number | null, metric: MetricContract | undefined): number | null {
  const value = metricValue(metric);
  return value === null ? total : (total ?? 0) + value;
}

function formatCount(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('pt-BR');
}

function formatCurrency(value: number, currency: string | null): string {
  if (!currency) return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`;
  }
}

const severity: Record<PerformanceStatus, number> = {
  unavailable: 0,
  insufficient_data: 1,
  on_track: 2,
  partial_data: 3,
  attention: 4,
  critical: 5,
};

function clientEvaluationStatus(client: GlobalClientPerformance): PerformanceStatus {
  if (client.evaluations.length === 0) return 'unavailable';
  return client.evaluations.reduce<PerformanceStatus>((worst, evaluation) => (
    severity[evaluation.status] > severity[worst] ? evaluation.status : worst
  ), 'unavailable');
}

export function GlobalSummaryCards({ clients }: { clients: GlobalClientPerformance[] }) {
  const currencyTotals = new Map<string, number>();
  let conversations: number | null = null;
  let leads: number | null = null;
  let purchases: number | null = null;

  for (const client of clients) {
    for (const account of client.accounts) {
      const spend = metricValue(account.metrics.spend);
      if (spend !== null) {
        const currency = account.currency || 'SEM_MOEDA';
        currencyTotals.set(currency, (currencyTotals.get(currency) || 0) + spend);
      }
    }
    conversations = addAvailableMetric(conversations, client.metrics.messaging_conversations_started_total);
    leads = addAvailableMetric(leads, client.metrics.leads);
    purchases = addAvailableMetric(purchases, client.metrics.purchases);
  }

  const statuses = clients.reduce<Record<PerformanceStatus, number>>((acc, client) => {
    const status = clientEvaluationStatus(client);
    acc[status] += 1;
    return acc;
  }, {
    on_track: 0,
    attention: 0,
    critical: 0,
    insufficient_data: 0,
    partial_data: 0,
    unavailable: 0,
  });

  const synchronized = clients.filter((client) => client.clientStatus === 'available').length;
  const syncing = clients.filter((client) => client.clientStatus === 'syncing').length;
  const incomplete = clients.filter((client) => ['partial', 'failed', 'stale'].includes(client.clientStatus)).length;
  const withoutData = clients.filter((client) => ['not_connected', 'never_synced', 'no_delivery'].includes(client.clientStatus)).length;

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <article className="rounded-2xl border border-brand-line bg-brand-surface p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-muted">Investimento real</p>
            <p className="mt-1 text-sm text-brand-soft">Separado por moeda</p>
          </div>
          <CircleDollarSign className="text-brand-green" size={22} />
        </div>
        <div className="mt-4 space-y-2">
          {currencyTotals.size === 0 ? (
            <p className="text-2xl font-black text-white">—</p>
          ) : Array.from(currencyTotals.entries()).map(([currency, value]) => (
            <div key={currency} className="flex items-baseline justify-between gap-3">
              <span className="text-xs font-bold text-brand-muted">{currency === 'SEM_MOEDA' ? 'Moeda não informada' : currency}</span>
              <span className="text-lg font-black text-white">{formatCurrency(value, currency === 'SEM_MOEDA' ? null : currency)}</span>
            </div>
          ))}
        </div>
      </article>

      <article className="rounded-2xl border border-brand-line bg-brand-surface p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-muted">Situação das metas</p>
            <p className="mt-1 text-sm text-brand-soft">Prioridade de decisão</p>
          </div>
          <Activity className="text-brand-green" size={22} />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-emerald-400/10 p-2">
            <p className="text-xl font-black text-emerald-300">{statuses.on_track}</p>
            <p className="text-[10px] text-emerald-200/70">Na meta</p>
          </div>
          <div className="rounded-xl bg-amber-400/10 p-2">
            <p className="text-xl font-black text-amber-300">{statuses.attention}</p>
            <p className="text-[10px] text-amber-200/70">Atenção</p>
          </div>
          <div className="rounded-xl bg-rose-400/10 p-2">
            <p className="text-xl font-black text-rose-300">{statuses.critical}</p>
            <p className="text-[10px] text-rose-200/70">Críticos</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-brand-muted">{statuses.insufficient_data + statuses.partial_data + statuses.unavailable} clientes ainda sem avaliação conclusiva.</p>
      </article>

      <article className="rounded-2xl border border-brand-line bg-brand-surface p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-muted">Resultados disponíveis</p>
            <p className="mt-1 text-sm text-brand-soft">Sem transformar ausência em zero</p>
          </div>
          <MessageCircle className="text-brand-green" size={22} />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-xl font-black text-white">{formatCount(conversations)}</p>
            <p className="text-[10px] text-brand-muted">Conversas</p>
          </div>
          <div>
            <p className="text-xl font-black text-white">{formatCount(leads)}</p>
            <p className="text-[10px] text-brand-muted">Leads</p>
          </div>
          <div>
            <p className="text-xl font-black text-white">{formatCount(purchases)}</p>
            <p className="text-[10px] text-brand-muted">Compras</p>
          </div>
        </div>
      </article>

      <article className="rounded-2xl border border-brand-line bg-brand-surface p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-muted">Qualidade da sincronização</p>
            <p className="mt-1 text-sm text-brand-soft">Estado real das contas</p>
          </div>
          <ShieldCheck className="text-brand-green" size={22} />
        </div>
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-brand-muted">Atualizados</span><strong className="text-emerald-300">{synchronized}</strong></div>
          <div className="flex justify-between"><span className="text-brand-muted">Sincronizando</span><strong className="text-sky-300">{syncing}</strong></div>
          <div className="flex justify-between"><span className="text-brand-muted">Parcial, falha ou antigo</span><strong className="text-amber-300">{incomplete}</strong></div>
          <div className="flex justify-between"><span className="text-brand-muted">Sem dados confiáveis</span><strong className="text-brand-soft">{withoutData}</strong></div>
        </div>
      </article>
    </div>
  );
}
