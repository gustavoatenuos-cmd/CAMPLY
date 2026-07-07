import { supabase } from '../supabase';
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

export async function fetchMetaPerformanceHierarchy(
  clientMetaAssetId: string,
  period: DashboardPeriod,
  level: HierarchyLevel,
  parentId: string | null = null,
  page: number = 1,
  pageSize: number = 50
): Promise<HierarchicalMetricNode[]> {
  if (!supabase) {
    throw new Error('Supabase client not initialized');
  }

  const { data, error } = await supabase.rpc('get_meta_performance_hierarchy', {
    p_client_meta_asset_id: clientMetaAssetId,
    p_period: period,
    p_level: level,
    p_parent_id: parentId,
    p_page: page,
    p_page_size: pageSize,
  });

  if (error) {
    console.error('Error fetching meta performance hierarchy:', error);
    throw new Error(`Falha ao buscar a hierarquia de métricas (${level}): ${error.message}`);
  }

  // The RPC returns a JSONB array directly or empty array.
  return (data as unknown as HierarchicalMetricNode[]) || [];
}
