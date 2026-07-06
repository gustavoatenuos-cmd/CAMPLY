import { Activity, ArrowRight, CircleDollarSign, MessageCircle, ShieldCheck } from 'lucide-react';
import type { GlobalClientPerformance, MetricContract } from '../../lib/performance/globalPerformanceDashboard';
import type { DecisionSignal } from '../../lib/performance/performanceScore';
import { deriveCostMetric, deriveScopedMetric } from '../../lib/performance/traceableMetrics';
import { aggregateMetricTotal, aggregateRatio, type MetricAggregate } from '../../lib/performance/aggregateMetrics';
import { PerformanceScoreBadge } from './PerformanceScoreBadge';

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

function formatDecimal(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function completenessLabel(metrics: Array<MetricContract | undefined>): string {
  const available = metrics.filter((metric) => metric?.available);
  if (available.length === 0) return 'Período não sincronizado';
  return available.some((metric) => !['complete', 'zero_delivery'].includes(metric?.completenessStatus || ''))
    ? 'Dados parciais'
    : 'Dados completos';
}

function signalStyle(signal: DecisionSignal): string {
  if (signal.severity === 'critical') return 'border-rose-400/30 bg-rose-400/10';
  if (signal.severity === 'warning') return 'border-amber-400/30 bg-amber-400/10';
  return 'border-sky-400/30 bg-sky-400/10';
}

function signalMetricLabel(signal: DecisionSignal): string {
  if (signal.kind === 'pacing') return 'Ritmo de investimento';
  if (signal.targetKind === 'cost_per_result') {
    if (signal.metricId === 'messaging_conversations_started_total') return 'Custo por conversa';
    if (signal.metricId === 'leads') return 'Custo por lead';
    if (signal.metricId === 'purchases') return 'Custo por compra';
  }
  const labels: Record<string, string> = {
    cpm: 'CPM',
    link_ctr: 'CTR de link',
    frequency: 'Frequência',
    purchases: 'Compras',
    leads: 'Leads',
    messaging_conversations_started_total: 'Conversas iniciadas',
    purchase_roas: 'ROAS',
    purchase_value: 'Valor de compras',
    spend: 'Investimento',
  };
  return signal.metricId ? labels[signal.metricId] || signal.metricId.split('_').join(' ') : 'Qualidade dos dados';
}

function signalValue(value: number | null | undefined, signal: DecisionSignal, currency: string | null): string {
  if (value == null) return 'Indisponível';
  if (signal.kind === 'pacing' || signal.targetKind === 'cost_per_result' || ['cpm', 'purchase_value'].includes(signal.metricId || '')) {
    return formatCurrency(value, currency);
  }
  if ((signal.metricId || '').includes('ctr')) return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function clientFinancialImpact(client: GlobalClientPerformance): number {
  return client.accounts.reduce((total, account) => total + (metricValue(account.metrics.spend) ?? 0), 0);
}

function signalAge(signal: DecisionSignal): number {
  if (!signal.effectiveFrom) return 0;
  const timestamp = new Date(signal.effectiveFrom).getTime();
  return Number.isFinite(timestamp) ? Date.now() - timestamp : 0;
}

const signalWeight: Record<DecisionSignal['severity'], number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

function SummaryMetric({
  label,
  value,
  unavailable = false,
}: {
  label: string;
  value: string;
  unavailable?: boolean;
}) {
  return (
    <div className="rounded-xl border border-brand-line bg-brand-ink/45 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-brand-muted">{label}</p>
      <p className="mt-2 text-lg font-black text-white">{unavailable ? '—' : value}</p>
    </div>
  );
}

function CurrencyMetric({ label, values }: { label: string; values: Map<string, number> }) {
  return (
    <div className="rounded-xl border border-brand-line bg-brand-ink/45 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-brand-muted">{label}</p>
      {values.size === 0 ? <p className="mt-2 text-lg font-black text-white">—</p> : (
        <div className="mt-2 space-y-1">
          {Array.from(values.entries()).map(([currency, value]) => (
            <p key={currency} className="text-sm font-black text-white">
              {formatCurrency(value, currency === 'SEM_MOEDA' ? null : currency)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function GlobalSummaryCards({ clients }: { clients: GlobalClientPerformance[] }) {
  const currencyTotals = new Map<string, number>();
  let conversations: number | null = null;
  let leads: number | null = null;
  let purchases: number | null = null;
  let impressions: number | null = null;
  let linkClicks: number | null = null;
  let landingPageViews: number | null = null;
  const purchaseValueTotals = new Map<string, number>();
  const accounts = clients.flatMap((client) => client.accounts);

  for (const client of clients) {
    for (const account of client.accounts) {
      const spend = metricValue(account.metrics.spend);
      if (spend !== null) {
        const currency = account.currency || 'SEM_MOEDA';
        currencyTotals.set(currency, (currencyTotals.get(currency) || 0) + spend);
      }
      const purchaseValue = metricValue(account.metrics.purchase_value);
      if (purchaseValue !== null) {
        const currency = account.currency || 'SEM_MOEDA';
        purchaseValueTotals.set(currency, (purchaseValueTotals.get(currency) || 0) + purchaseValue);
      }
      impressions = addAvailableMetric(impressions, account.metrics.impressions);
      linkClicks = addAvailableMetric(linkClicks, account.metrics.link_clicks);
      landingPageViews = addAvailableMetric(landingPageViews, account.metrics.landing_page_views);
    }
    conversations = addAvailableMetric(conversations, client.metrics.messaging_conversations_started_total);
    leads = addAvailableMetric(leads, client.metrics.leads);
    purchases = addAvailableMetric(purchases, client.metrics.purchases);
  }

  const singleAccount = accounts.length === 1 ? accounts[0] : null;

  // Com várias contas no recorte, os custos médios são agregados de forma
  // ponderada (soma dos gastos ÷ soma dos resultados), com bloqueio de moeda
  // mista — em vez do antigo placeholder "Por conta" que escondia a leitura.
  const spendAgg = aggregateMetricTotal(accounts.map((account) => account.metrics.spend), { monetary: true });
  const conversationsAgg = aggregateMetricTotal(accounts.map((account) => account.metrics.messaging_conversations_started_total));
  const purchasesAgg = aggregateMetricTotal(accounts.map((account) => account.metrics.purchases));
  const purchaseValueAgg = aggregateMetricTotal(accounts.map((account) => account.metrics.purchase_value), { monetary: true });
  const impressionsAgg = aggregateMetricTotal(accounts.map((account) => account.metrics.impressions));
  const reachAgg = aggregateMetricTotal(accounts.map((account) => account.metrics.reach));
  const aggCostPerConversation = aggregateRatio(spendAgg, conversationsAgg);
  const aggCostPerPurchase = aggregateRatio(spendAgg, purchasesAgg);
  const aggCpm = aggregateRatio(spendAgg, impressionsAgg, 1000);
  const aggRoas = aggregateRatio(purchaseValueAgg, spendAgg);
  const aggFrequency = aggregateRatio(impressionsAgg, reachAgg);

  const aggregateCurrencyValue = (aggregate: MetricAggregate): string =>
    aggregate.available && aggregate.value !== null ? formatCurrency(aggregate.value, aggregate.currency) : '—';
  const aggregateDecimalValue = (aggregate: MetricAggregate): string =>
    aggregate.available ? formatDecimal(aggregate.value) : '—';
  const costPerConversation = singleAccount
    ? deriveCostMetric('cost_per_messaging_conversation', singleAccount.metrics.spend, singleAccount.metrics.messaging_conversations_started_total)
    : undefined;
  const costPerPurchase = singleAccount
    ? deriveCostMetric('cost_per_purchase', singleAccount.metrics.spend, singleAccount.metrics.purchases)
    : undefined;
  const frequency = singleAccount
    ? deriveScopedMetric('frequency', singleAccount.metrics.impressions, singleAccount.metrics.reach)
    : undefined;
  const cpm = singleAccount
    ? deriveScopedMetric('cpm', singleAccount.metrics.spend, singleAccount.metrics.impressions, 1000)
    : undefined;
  const roas = singleAccount
    ? deriveScopedMetric('purchase_roas', singleAccount.metrics.purchase_value, singleAccount.metrics.spend)
    : undefined;
  const primaryMetrics = accounts.flatMap((account) => [
    account.metrics.spend,
    account.metrics.messaging_conversations_started_total,
    account.metrics.purchases,
    account.metrics.purchase_value,
    account.metrics.reach,
    account.metrics.impressions,
    account.metrics.link_clicks,
    account.metrics.landing_page_views,
  ]);

  const scoredClients = clients.filter((client) => client.score.value !== null);
  const averageScore = scoredClients.length > 0
    ? Math.round(scoredClients.reduce((total, client) => total + (client.score.value ?? 0), 0) / scoredClients.length)
    : null;
  const healthy = clients.filter((client) => ['excellent', 'healthy'].includes(client.score.status)).length;
  const attention = clients.filter((client) => client.score.status === 'attention').length;
  const critical = clients.filter((client) => client.score.status === 'critical').length;
  const unavailable = clients.filter((client) => client.score.status === 'unavailable').length;

  const synchronized = clients.filter((client) => client.clientStatus === 'available').length;
  const syncing = clients.filter((client) => client.clientStatus === 'syncing').length;
  const incomplete = clients.filter((client) => ['partial', 'failed', 'stale'].includes(client.clientStatus)).length;
  const withoutData = clients.filter((client) => ['not_connected', 'never_synced', 'no_delivery'].includes(client.clientStatus)).length;

  const priorities = clients
    .flatMap((client) => client.score.signals.map((signal) => ({ client, signal })))
    .filter(({ client, signal }) => {
      if (signal.kind === 'performance' || signal.kind === 'pacing') return true;
      if (signal.kind !== 'data_quality') return false;
      return client.dataQuality.status === 'partial'
        && client.accounts.some((account) => account.dataQuality.status !== 'unavailable');
    })
    .sort((a, b) => signalWeight[b.signal.severity] - signalWeight[a.signal.severity]
      || b.signal.confidence - a.signal.confidence
      || (b.signal.priorityWeight ?? 1) - (a.signal.priorityWeight ?? 1)
      || clientFinancialImpact(b.client) - clientFinancialImpact(a.client)
      || signalAge(b.signal) - signalAge(a.signal))
    .slice(0, 6);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-brand-line bg-brand-surface p-5">
        <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-green">Métricas mensais oficiais</p>
            <h2 className="mt-1 text-xl font-black text-white">Leitura oficial do recorte</h2>
          </div>
          <p className="text-xs text-brand-muted">{completenessLabel(primaryMetrics)}{accounts.length > 1 ? ` · custos médios agregam ${spendAgg.accountsUsed} de ${accounts.length} contas · alcance e frequência somam contas e podem contar a mesma pessoa mais de uma vez` : ''}</p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          <CurrencyMetric label="Investimento" values={currencyTotals} />
          <SummaryMetric label="Conversas iniciadas" value={formatCount(conversations)} />
          <SummaryMetric label="Custo por conversa" value={singleAccount ? formatCurrency(metricValue(costPerConversation) || 0, singleAccount.currency) : aggregateCurrencyValue(aggCostPerConversation)} unavailable={singleAccount ? !costPerConversation?.available : !aggCostPerConversation.available} />
          <SummaryMetric label="Compras" value={formatCount(purchases)} />
          <SummaryMetric label="Custo por compra" value={singleAccount ? formatCurrency(metricValue(costPerPurchase) || 0, singleAccount.currency) : aggregateCurrencyValue(aggCostPerPurchase)} unavailable={singleAccount ? !costPerPurchase?.available : !aggCostPerPurchase.available} />
          <CurrencyMetric label="Valor de compras" values={purchaseValueTotals} />
          <SummaryMetric label="ROAS" value={singleAccount ? formatDecimal(metricValue(roas)) : aggregateDecimalValue(aggRoas)} unavailable={singleAccount ? !roas?.available : !aggRoas.available} />
          <SummaryMetric label="Alcance" value={singleAccount ? formatCount(metricValue(singleAccount.metrics.reach)) : formatCount(reachAgg.value)} unavailable={singleAccount ? false : !reachAgg.available} />
          <SummaryMetric label="Impressões" value={formatCount(impressions)} />
          <SummaryMetric label="Frequência" value={singleAccount ? formatDecimal(metricValue(frequency)) : aggregateDecimalValue(aggFrequency)} unavailable={singleAccount ? !frequency?.available : !aggFrequency.available} />
          <SummaryMetric label="CPM" value={singleAccount ? formatCurrency(metricValue(cpm) || 0, singleAccount.currency) : aggregateCurrencyValue(aggCpm)} unavailable={singleAccount ? !cpm?.available : !aggCpm.available} />
          <SummaryMetric label="Cliques no link" value={formatCount(linkClicks)} />
          <SummaryMetric label="Visualizações da página de destino" value={formatCount(landingPageViews)} />
        </div>
      </div>

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
              <p className="text-xs font-semibold uppercase tracking-wider text-brand-muted">Score da operação</p>
              <p className="mt-1 text-sm text-brand-soft">Metas, pacing e confiança dos dados</p>
            </div>
            <Activity className="text-brand-green" size={22} />
          </div>
          <div className="mt-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-3xl font-black text-white">{averageScore ?? '—'}<span className="text-sm text-brand-muted">/100</span></p>
              <p className="mt-1 text-xs text-brand-muted">{scoredClients.length} de {clients.length} clientes pontuáveis</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-emerald-400/10 px-2 py-1.5"><p className="font-black text-emerald-300">{healthy}</p><p className="text-[9px] text-emerald-200/70">Saudáveis</p></div>
              <div className="rounded-lg bg-amber-400/10 px-2 py-1.5"><p className="font-black text-amber-300">{attention}</p><p className="text-[9px] text-amber-200/70">Atenção</p></div>
              <div className="rounded-lg bg-rose-400/10 px-2 py-1.5"><p className="font-black text-rose-300">{critical}</p><p className="text-[9px] text-rose-200/70">Críticos</p></div>
            </div>
          </div>
          <p className="mt-3 text-xs text-brand-muted">{unavailable} clientes ainda sem metas ou dados suficientes para uma pontuação confiável.</p>
        </article>

        <article className="rounded-2xl border border-brand-line bg-brand-surface p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-brand-muted">Conversas, leads e compras</p>
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

      <article className="rounded-2xl border border-brand-line bg-brand-surface p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-green">Leitura executiva</p>
            <h2 className="mt-1 text-xl font-black text-white">O que exige ação agora</h2>
            <p className="mt-1 text-sm text-brand-muted">Prioridades ordenadas por gravidade e confiança. Falta de dados fica na qualidade da sincronização, não como sugestão de otimização.</p>
          </div>
          <p className="text-xs text-brand-muted">{priorities.length} sinais prioritários</p>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {priorities.length > 0 ? priorities.map(({ client, signal }, index) => {
            const account = signal.campaignId
              ? client.accounts.find((item) => client.metricGroups.some((group) => group.clientMetaAssetId === item.clientMetaAssetId && group.campaignId === signal.campaignId))
              : client.accounts[0];
            const difference = signal.differencePercent == null
              ? 'Indisponível'
              : `${signal.differencePercent > 0 ? '+' : ''}${signal.differencePercent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
            return <div key={`${client.clientId}:${signal.kind}:${signal.metricId || 'general'}:${index}`} className={`rounded-xl border p-4 ${signalStyle(signal)}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-brand-muted">{client.clientName}</p>
                  <p className="mt-1 font-black text-white">{signal.title}</p>
                  <p className="mt-1 text-xs text-brand-muted">{client.analysisProfile?.customVertical || client.analysisProfile?.vertical || 'Segmento não configurado'} · {signalMetricLabel(signal)}</p>
                </div>
                <PerformanceScoreBadge score={client.score} compact />
              </div>
              {(signal.expectedValue != null || signal.actualValue != null) && (
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg bg-black/20 p-2"><p className="text-[9px] uppercase text-brand-muted">Esperado</p><p className="mt-1 font-black text-white">{signalValue(signal.expectedValue, signal, account?.currency || null)}</p></div>
                  <div className="rounded-lg bg-black/20 p-2"><p className="text-[9px] uppercase text-brand-muted">Realizado</p><p className="mt-1 font-black text-white">{signalValue(signal.actualValue, signal, account?.currency || null)}</p></div>
                  <div className="rounded-lg bg-black/20 p-2"><p className="text-[9px] uppercase text-brand-muted">Diferença</p><p className="mt-1 font-black text-white">{difference}</p></div>
                </div>
              )}
              <p className="mt-3 text-sm leading-6 text-brand-soft">{signal.evidence}</p>
              <div className="mt-4 border-t border-white/10 pt-3">
                <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-brand-muted"><ArrowRight size={12} /> Investigar em {signal.campaignId ? 'campanha, conjuntos e criativos' : signal.kind === 'pacing' ? 'orçamento e entrega da conta' : 'conta e campanhas'}</p>
                <p className="mt-1 text-sm leading-6 text-white">{signal.nextAction}</p>
              </div>
              <p className="mt-3 text-[10px] text-brand-muted">Confiança da leitura: {signal.confidence}%</p>
            </div>;
          }) : (
            <div className="rounded-xl border border-dashed border-brand-line p-8 text-center text-sm text-brand-muted lg:col-span-2 xl:col-span-3">
              Nenhum sinal conclusivo está disponível. Configure metas e sincronize o período para liberar a leitura operacional.
            </div>
          )}
        </div>
      </article>
    </div>
  );
}
