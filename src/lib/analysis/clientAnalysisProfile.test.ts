import { describe, expect, it } from 'vitest';
import {
  defaultAnalysisProfile,
  mapClientProfileRow,
} from './clientAnalysisProfile';

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
