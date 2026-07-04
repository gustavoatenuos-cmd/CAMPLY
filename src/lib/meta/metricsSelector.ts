/** @deprecated Compatibility adapter. The canonical source is metricCatalog.ts. */
import type { ClientCategory, MetaCampaignObjective } from '../../types';
import { metricCatalog, type CanonicalMetricId } from '../metrics/metricCatalog';

export interface MetricDefinition {
  key: CanonicalMetricId;
  label: string;
  format: 'currency' | 'percent' | 'number' | 'multiplier';
  description: string;
  higherIsBetter: boolean;
}

const format = (id: CanonicalMetricId): MetricDefinition['format'] => {
  const unit = metricCatalog[id].unit;
  return unit === 'percentage' ? 'percent' : unit === 'ratio' ? 'multiplier' : unit;
};
const definition = (id: CanonicalMetricId): MetricDefinition => ({
  key: id, label: metricCatalog[id].label, description: metricCatalog[id].description,
  format: format(id), higherIsBetter: metricCatalog[id].direction === 'higher_is_better',
});
export const METRIC_DEFINITIONS = Object.fromEntries(
  (Object.keys(metricCatalog) as CanonicalMetricId[]).map((id) => [id, definition(id)])
) as Record<CanonicalMetricId, MetricDefinition>;

const objectiveMetrics: Record<string, CanonicalMetricId[]> = {
  Reconhecimento: ['spend', 'impressions', 'reach', 'frequency', 'cpm', 'link_ctr'],
  Tráfego: ['spend', 'link_cpc', 'link_ctr', 'landing_page_views', 'cpm', 'reach'],
  Engajamento: ['spend', 'reach', 'impressions', 'frequency', 'cpm', 'link_ctr'],
  Cadastros: ['spend', 'registrations', 'cost_per_registration', 'link_ctr', 'link_cpc', 'cpm'],
  Vendas: ['spend', 'purchase_roas', 'purchases', 'cost_per_purchase', 'link_ctr', 'cpm'],
  UNCLASSIFIED: ['spend', 'impressions', 'reach', 'link_ctr', 'link_cpc', 'cpm'],
};

export function selectMetricsForCampaign(objective: MetaCampaignObjective | string | undefined, _category: ClientCategory | undefined, maxMetrics = 6): MetricDefinition[] {
  return (objectiveMetrics[objective ?? ''] ?? objectiveMetrics.UNCLASSIFIED).slice(0, maxMetrics).map(definition);
}
export function getAllMetricsForCampaign(objective: MetaCampaignObjective | string | undefined, category: ClientCategory | undefined) {
  const primary = selectMetricsForCampaign(objective, category); const ids = new Set(primary.map((item) => item.key));
  return { primary, secondary: (Object.keys(metricCatalog) as CanonicalMetricId[]).filter((id) => !ids.has(id)).map(definition) };
}
export function formatMetricValue(key: string, value: number | undefined | null): string {
  if (value == null) return '—'; const metric = metricCatalog[key as CanonicalMetricId];
  if (!metric) return String(value);
  if (metric.unit === 'currency') return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  if (metric.unit === 'percentage') return `${value.toFixed(2)}%`;
  if (metric.unit === 'ratio') return `${value.toFixed(2)}x`;
  return value.toLocaleString('pt-BR');
}
export function calcTrend(current: number | undefined, previous: number | undefined, higherIsBetter: boolean): 'up_good' | 'up_bad' | 'down_good' | 'down_bad' | 'neutral' {
  if (current == null || previous == null || previous === 0) return 'neutral'; const delta = (current - previous) / previous * 100;
  if (Math.abs(delta) < 2) return 'neutral'; if (delta > 0) return higherIsBetter ? 'up_good' : 'up_bad';
  return higherIsBetter ? 'down_bad' : 'down_good';
}
