import type { TraceableMetric } from './traceableMetrics';

/**
 * Agregação de métricas entre múltiplas contas para a leitura global do
 * dashboard. Diferente das métricas rastreáveis por conta, um agregado não
 * tem um único escopo de origem — por isso ele carrega flags explícitas de
 * honestidade (moeda mista, dados parciais, quantas contas contribuíram) em
 * vez de fingir precisão que não existe.
 */
export interface MetricAggregate {
  value: number | null;
  available: boolean;
  /** Moeda do valor quando monetário; null para contagens e razões adimensionais. */
  currency: string | null;
  /** true quando contas com moedas diferentes impedem uma soma honesta. */
  mixedCurrency: boolean;
  /** true quando alguma conta contribuinte tem dados incompletos no período. */
  partial: boolean;
  /** Quantas contas efetivamente contribuíram com valor disponível. */
  accountsUsed: number;
}

const COMPLETE_STATUSES = new Set(['complete', 'zero_delivery']);

const EMPTY_AGGREGATE: MetricAggregate = {
  value: null,
  available: false,
  currency: null,
  mixedCurrency: false,
  partial: false,
  accountsUsed: 0,
};

export function aggregateMetricTotal(
  metrics: Array<TraceableMetric | undefined>,
  options: { monetary?: boolean } = {}
): MetricAggregate {
  const contributors = metrics.filter(
    (metric): metric is TraceableMetric =>
      Boolean(metric?.available) && typeof metric?.value === 'number' && Number.isFinite(metric.value)
  );
  if (contributors.length === 0) return EMPTY_AGGREGATE;

  const partial = contributors.some((metric) => !COMPLETE_STATUSES.has(metric.completenessStatus));
  const total = contributors.reduce((sum, metric) => sum + (metric.value as number), 0);

  if (options.monetary) {
    const currencies = new Set(contributors.map((metric) => metric.currency || 'SEM_MOEDA'));
    if (currencies.size > 1) {
      return { ...EMPTY_AGGREGATE, mixedCurrency: true, partial, accountsUsed: contributors.length };
    }
    return {
      value: total,
      available: true,
      currency: contributors[0].currency,
      mixedCurrency: false,
      partial,
      accountsUsed: contributors.length,
    };
  }

  return {
    value: total,
    available: true,
    currency: null,
    mixedCurrency: false,
    partial,
    accountsUsed: contributors.length,
  };
}

/**
 * Razão ponderada entre dois agregados (ex.: gasto total / conversas totais).
 * Quando numerador e denominador são monetários (ex.: ROAS), as moedas
 * precisam coincidir e o resultado é adimensional.
 */
export function aggregateRatio(
  numerator: MetricAggregate,
  denominator: MetricAggregate,
  multiplier = 1
): MetricAggregate {
  const partial = numerator.partial || denominator.partial;
  const accountsUsed = Math.min(numerator.accountsUsed, denominator.accountsUsed);
  const bothMonetary = Boolean(numerator.currency) && Boolean(denominator.currency);
  const mixedCurrency = numerator.mixedCurrency
    || denominator.mixedCurrency
    || (bothMonetary && numerator.currency !== denominator.currency);

  if (
    mixedCurrency
    || !numerator.available
    || !denominator.available
    || numerator.value === null
    || denominator.value === null
    || denominator.value <= 0
  ) {
    return { ...EMPTY_AGGREGATE, mixedCurrency, partial, accountsUsed };
  }

  return {
    value: (numerator.value / denominator.value) * multiplier,
    available: true,
    currency: bothMonetary ? null : numerator.currency,
    mixedCurrency: false,
    partial,
    accountsUsed,
  };
}
