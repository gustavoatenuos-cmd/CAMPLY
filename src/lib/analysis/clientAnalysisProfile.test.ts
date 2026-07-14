import { describe, expect, it } from 'vitest';
import {
  defaultAnalysisProfile,
  mapClientProfileRow,
  primaryConversionMetrics,
} from './clientAnalysisProfile';

// Mirrors public.is_allowed_performance_metric (see
// supabase/migrations/20260627000015_multiclient_performance_foundation.sql).
// upsert_client_analysis_profile rejects primary_conversion_metric with
// "primary_conversion_metric is not allowed" for anything outside this set,
// so every value the "Conversão principal"/"Conversão secundária" pickers can
// produce must stay inside it.
const RPC_ALLOWED_PERFORMANCE_METRICS = new Set([
  'spend', 'impressions', 'cpm', 'link_clicks', 'link_ctr', 'link_cpc', 'cpa',
  'whatsapp_conversations_started', 'messenger_conversations_started',
  'instagram_direct_conversations_started', 'messaging_conversations_started_generic',
  'messaging_conversations_started_total', 'cost_per_messaging_conversation',
  'purchases', 'purchase_value', 'purchase_roas', 'leads', 'landing_page_views',
  'page_load_rate', 'profile_visits', 'video_views', 'thru_plays',
]);

describe('client analysis profile', () => {
  it('keeps decision gates explicit in the default profile', () => {
    expect(defaultAnalysisProfile('client-1')).toMatchObject({
      clientId: 'client-1',
      minimumEvaluationSpend: 0,
      minimumImpressions: 0,
      minimumResults: 0,
      attributionDelayHours: 24,
      analysisEnabled: true,
    });
  });

  it('defaults primaryConversionMetric to an RPC-allowed metric id', () => {
    expect(RPC_ALLOWED_PERFORMANCE_METRICS.has(defaultAnalysisProfile('client-1').primaryConversionMetric)).toBe(true);
  });

  it('never offers a primary conversion metric option the RPC would reject', () => {
    for (const option of primaryConversionMetrics) {
      expect(RPC_ALLOWED_PERFORMANCE_METRICS.has(option.value)).toBe(true);
    }
  });

  it('maps custom segment and persisted thresholds without losing values', () => {
    expect(mapClientProfileRow({
      client_id: 'client-2',
      vertical: 'Outros',
      subsegment: 'Outros',
      custom_vertical: 'Turismo',
      custom_subsegment: 'Agência de viagens',
      business_model: 'geração de leads',
      primary_conversion_metric: 'leads',
      secondary_metrics: ['cost_per_lead'],
      primary_channel: 'Site',
      budget_period: 'monthly',
      planned_budget: '3000',
      minimum_evaluation_spend: '250',
      minimum_impressions: 1000,
      minimum_results: 8,
      attribution_delay_hours: 48,
    })).toMatchObject({
      customVertical: 'Turismo',
      customSubsegment: 'Agência de viagens',
      plannedBudget: 3000,
      minimumEvaluationSpend: 250,
      minimumImpressions: 1000,
      minimumResults: 8,
      attributionDelayHours: 48,
    });
  });
});
