import { supabase } from '../supabase';
import { isMetaE2EMode, metaE2EState } from './metaE2ERuntime';

export type PerformanceTargetKind = 'cost_per_result' | 'daily_budget' | 'monthly_budget' | 'minimum_results';

export interface PerformanceTargetHistoryItem {
  id: string;
  clientMetaAssetId: string;
  campaignId: string | null;
  metricId: string;
  targetKind: PerformanceTargetKind;
  targetValue: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
}

export async function loadTargetHistory(clientMetaAssetId: string, campaignId?: string): Promise<PerformanceTargetHistoryItem[]> {
  if (isMetaE2EMode) return (metaE2EState.targets as unknown as PerformanceTargetHistoryItem[]).filter((target) => (
    target.clientMetaAssetId === clientMetaAssetId
    && target.campaignId === (campaignId || null)
  ));
  if (!supabase) throw new Error('Backend analítico não configurado.');
  const { data, error } = await supabase.rpc('get_client_performance_target_history', {
    p_client_meta_asset_id: clientMetaAssetId,
    p_campaign_id: campaignId || null,
  });
  if (error) throw new Error('Não foi possível carregar o histórico de metas.');
  return (data || []) as PerformanceTargetHistoryItem[];
}

export async function setPerformanceTarget(input: {
  clientMetaAssetId: string;
  campaignId?: string;
  metricId: string;
  targetKind: PerformanceTargetKind;
  targetValue: number;
}): Promise<string> {
  if (isMetaE2EMode) {
    const now = new Date().toISOString();
    metaE2EState.targets.forEach((target) => {
      if (
        target.active
        && target.clientMetaAssetId === input.clientMetaAssetId
        && target.campaignId === (input.campaignId || null)
        && target.metricId === input.metricId
        && target.targetKind === input.targetKind
      ) {
        target.active = false;
        target.effectiveTo = now;
      }
    });
    const id = `target-e2e-${metaE2EState.targets.length + 1}`;
    metaE2EState.targets.unshift({
      id, clientMetaAssetId: input.clientMetaAssetId, campaignId: input.campaignId || null,
      metricId: input.metricId, targetKind: input.targetKind, targetValue: input.targetValue,
      effectiveFrom: now, effectiveTo: null, active: true,
    });
    return id;
  }
  if (!supabase) throw new Error('Backend analítico não configurado.');
  const { data, error } = await supabase.rpc('set_client_performance_target', {
    p_client_meta_asset_id: input.clientMetaAssetId,
    p_metric_id: input.metricId,
    p_target_kind: input.targetKind,
    p_target_value: input.targetValue,
    p_campaign_id: input.campaignId || null,
    p_effective_from: new Date().toISOString(),
  });
  if (error) throw new Error('Não foi possível salvar a meta.');
  return String(data);
}

export async function closePerformanceTarget(targetId: string): Promise<void> {
  if (isMetaE2EMode) {
    const target = metaE2EState.targets.find((item) => item.id === targetId);
    if (target) {
      target.active = false;
      target.effectiveTo = new Date().toISOString();
    }
    return;
  }
  if (!supabase) throw new Error('Backend analítico não configurado.');
  const { error } = await supabase.rpc('close_client_performance_target', {
    p_target_id: targetId,
    p_effective_to: new Date().toISOString(),
  });
  if (error) throw new Error('Não foi possível encerrar a meta.');
}
