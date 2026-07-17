import { Banknote, Eye, MessageCircle, ShieldCheck, ShieldAlert, ShoppingBag, UserRound } from 'lucide-react';
import type { GlobalClientPerformance } from '../../lib/performance/globalPerformanceDashboard';
import { aggregateMetricTotal } from '../../lib/performance/aggregateMetrics';
import { classifyAccountReliability } from '../../lib/performance/clientPriorityGrouping';
import { clientSeverity } from './CommercialDecisionOverview';
import type { DashboardPeriod } from '../../lib/performance/analyticsCapabilities';

export type HealthFilter = 'all' | 'healthy' | 'attention' | 'critical' | 'no_data';

interface ExecutiveSummaryProps {
  clients: GlobalClientPerformance[];
  period: DashboardPeriod;
  statusFilter: HealthFilter;
  onStatusFilterChange: (filter: HealthFilter) => void;
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

function formatCount(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('pt-BR');
}

interface SummaryCellProps {
  icon: typeof Banknote;
  label: string;
  value: string;
  detail?: string;
}

function SummaryCell({ icon: Icon, label, value, detail }: SummaryCellProps) {
  return (
    <div className="rounded-xl border border-brand-line bg-brand-ink/45 p-4">
      <div className="flex items-center gap-2">
        <Icon size={15} className="text-brand-green" />
        <p className="text-[10px] font-bold uppercase tracking-wider text-brand-muted">{label}</p>
      </div>
      <p className="mt-2 text-xl font-black text-white">{value}</p>
      {detail && <p className="mt-1 text-[11px] text-brand-muted">{detail}</p>}
    </div>
  );
}

const healthChipStyles: Record<Exclude<HealthFilter, 'all'>, { active: string; idle: string; label: string }> = {
  healthy:   { active: 'border-emerald-400/60 bg-emerald-400/15 text-emerald-200', idle: 'border-brand-line text-emerald-300/80 hover:bg-emerald-400/10', label: 'Saudáveis' },
  attention: { active: 'border-amber-400/60 bg-amber-400/15 text-amber-200',       idle: 'border-brand-line text-amber-300/80 hover:bg-amber-400/10',    label: 'Atenção' },
  critical:  { active: 'border-rose-400/60 bg-rose-400/15 text-rose-200',          idle: 'border-brand-line text-rose-300/80 hover:bg-rose-400/10',      label: 'Críticos' },
  no_data:   { active: 'border-white/30 bg-white/10 text-white',                   idle: 'border-brand-line text-brand-muted hover:bg-white/5',          label: 'Sem dados' },
};

/**
 * Faixa executiva do dashboard: apenas volume macro da operação —
 * investimento, resultados brutos e quantas contas estão com sync
 * confiável. Não mostra custo agregado (CPA/CPL/custo por conversa/ROAS):
 * esses números misturam clientes, objetivos e metas diferentes quando
 * somados globalmente, e só fazem sentido dentro do card de cada cliente,
 * onde existe o contexto da meta configurada. Os chips de saúde também
 * filtram a central abaixo.
 */
export function ExecutiveSummary({ clients, period, statusFilter, onStatusFilterChange }: ExecutiveSummaryProps) {
  const accounts = clients.flatMap((client) => client.accounts);

  const spend = aggregateMetricTotal(accounts.map((account) => account.metrics.spend), { monetary: true });
  const conversations = aggregateMetricTotal(clients.map((client) => client.metrics.messaging_conversations_started_total));
  const leads = aggregateMetricTotal(clients.map((client) => client.metrics.leads));
  const purchases = aggregateMetricTotal(clients.map((client) => client.metrics.purchases));
  const reach = aggregateMetricTotal(accounts.map((account) => account.metrics.reach));

  // Investimento por moeda: mantém a soma honesta mesmo com contas em moedas
  // diferentes (caso em que o agregado único fica indisponível).
  const currencyTotals = new Map<string, number>();
  for (const account of accounts) {
    const metric = account.metrics.spend;
    if (metric?.available && typeof metric.value === 'number') {
      const currency = account.currency || 'SEM_MOEDA';
      currencyTotals.set(currency, (currencyTotals.get(currency) || 0) + metric.value);
    }
  }
  const investmentValue = currencyTotals.size === 0
    ? '—'
    : Array.from(currencyTotals.entries())
      .map(([currency, value]) => formatCurrency(value, currency === 'SEM_MOEDA' ? null : currency))
      .join(' + ');

  const counts: Record<Exclude<HealthFilter, 'all'>, number> = { healthy: 0, attention: 0, critical: 0, no_data: 0 };
  for (const client of clients) counts[clientSeverity(client)] += 1;

  // Ausência de sync para o período não é falha do cliente — só conta como
  // "problema" quando houve uma tentativa real (classifyAccountReliability
  // separa not_synced de problem exatamente por isso).
  const reliableAccounts = accounts.filter((account) => classifyAccountReliability(account, period) === 'reliable').length;
  const problemAccounts = accounts.filter((account) => classifyAccountReliability(account, period) === 'problem').length;

  const partialNote = spend.partial || conversations.partial || purchases.partial || leads.partial || reach.partial
    ? 'Alguma conta tem dados parciais neste período — os totais podem mudar após a próxima sincronização.'
    : null;

  return (
    <section className="rounded-2xl border border-brand-line bg-brand-surface p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-green">Resumo executivo</p>
          <h2 className="mt-1 text-xl font-black text-white">Como está a operação agora</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar clientes por saúde">
          <button
            type="button"
            onClick={() => onStatusFilterChange('all')}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
              statusFilter === 'all' ? 'border-brand-green/60 bg-brand-green/15 text-brand-green' : 'border-brand-line text-brand-muted hover:bg-white/5'
            }`}
          >
            Todos · {clients.length}
          </button>
          {(Object.keys(healthChipStyles) as Array<Exclude<HealthFilter, 'all'>>).map((key) => {
            const chip = healthChipStyles[key];
            const isActive = statusFilter === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={isActive}
                onClick={() => onStatusFilterChange(isActive ? 'all' : key)}
                className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${isActive ? chip.active : chip.idle}`}
              >
                {chip.label} · {counts[key]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCell icon={Banknote} label="Investimento total" value={investmentValue} detail={`${spend.accountsUsed} conta${spend.accountsUsed === 1 ? '' : 's'} com gasto no período`} />
        <SummaryCell icon={MessageCircle} label="Conversas totais" value={formatCount(conversations.value)} />
        <SummaryCell icon={ShoppingBag} label="Compras totais" value={formatCount(purchases.value)} />
        <SummaryCell icon={UserRound} label="Leads totais" value={formatCount(leads.value)} />
        <SummaryCell icon={Eye} label="Alcance total" value={formatCount(reach.value)} />
        <SummaryCell icon={ShieldCheck} label="Contas com sync confiável" value={formatCount(reliableAccounts)} detail={`de ${accounts.length} conta${accounts.length === 1 ? '' : 's'} no recorte`} />
        <SummaryCell icon={ShieldAlert} label="Contas com problema" value={formatCount(problemAccounts)} detail="tentativa de sync com falha ou parcial" />
      </div>

      {partialNote && <p className="mt-3 text-xs text-amber-300/90">{partialNote}</p>}
    </section>
  );
}
