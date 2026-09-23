import type { ClientBenchmarks } from '../../types';
import type { CampaignMetricCell } from '../performance/campaignMetricCells';

type Direction = 'lower' | 'higher';

const CELL_BENCHMARK: Record<string, { key: keyof ClientBenchmarks; direction: Direction }> = {
  cpa: { key: 'cpa', direction: 'lower' },
  cost_per_lead: { key: 'cpl', direction: 'lower' },
  cost_per_conversation: { key: 'cpr', direction: 'lower' },
  cost_per_profile_visit: { key: 'cpr', direction: 'lower' },
  cpc: { key: 'cpc', direction: 'lower' },
  link_cpc: { key: 'cpc', direction: 'lower' },
  cpm: { key: 'cpm', direction: 'lower' },
  purchase_roas: { key: 'roas', direction: 'higher' },
  ctr: { key: 'ctr', direction: 'higher' },
  link_ctr: { key: 'ctr', direction: 'higher' },
};

export interface BenchmarkComparison {
  target: number;
  status: 'good' | 'bad';
}

/**
 * Compares a campaign metric cell with the client's reference value (Cadastro
 * do cliente → Analytics & Alertas). Returns null when there is no reference or
 * the metric has no real value, so the card never invents a verdict.
 */
export function compareCellWithBenchmark(
  cell: CampaignMetricCell,
  benchmarks: ClientBenchmarks | undefined,
): BenchmarkComparison | null {
  const rule = CELL_BENCHMARK[cell.key];
  if (!rule || !benchmarks) return null;
  const target = benchmarks[rule.key];
  if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0) return null;
  const value = cell.metric?.available ? cell.metric.value : null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const good = rule.direction === 'lower' ? value <= target : value >= target;
  return { target, status: good ? 'good' : 'bad' };
}
