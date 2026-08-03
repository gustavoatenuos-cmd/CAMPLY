import {
  loadMetaHierarchy,
  type MetaHierarchyItem,
} from '../meta/performanceHierarchyService';
import type { DashboardPeriod } from './analyticsCapabilities';
import type { MetricContract } from './globalPerformanceDashboard';

export type HierarchyLevel = 'campaign' | 'adset' | 'ad' | 'creative';

export interface HierarchicalMetricNode {
  id: string;
  name: string;
  status: string;
  effectiveStatus: string;
  objective: string | null;
  classifiedObjective: string | null;
  destinationType: string | null;
  attributionSetting: string | null;
  creativeId: string | null;
  metrics: Record<string, MetricContract>;
}

export interface HierarchyResponse {
  state: 'empty' | 'ready' | 'period_not_synced' | 'unauthorized';
  items: HierarchicalMetricNode[];
  total: number;
}

function mapHierarchyItem(item: MetaHierarchyItem): HierarchicalMetricNode {
  return {
    id: item.id,
    name: item.name || item.id,
    status: item.status || '',
    effectiveStatus: item.effectiveStatus || item.status || '',
    objective: item.objective || null,
    classifiedObjective: item.classifiedObjective || null,
    destinationType: item.destinationType || null,
    attributionSetting: item.attributionSetting || null,
    creativeId: item.creativeId || null,
    metrics: item.metrics,
  };
}

export async function fetchMetaPerformanceHierarchy(
  clientMetaAssetId: string,
  period: DashboardPeriod,
  level: HierarchyLevel,
  parentId: string | null = null,
  page: number = 1,
  pageSize: number = 50
): Promise<HierarchyResponse> {
  const response = await loadMetaHierarchy({
    clientMetaAssetId,
    period,
    level,
    parentId: parentId || undefined,
    page,
    pageSize,
  });

  return {
    state: response.state,
    total: response.total,
    items: response.items.map(mapHierarchyItem),
  };
}
