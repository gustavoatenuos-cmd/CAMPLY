import { describe, expect, it } from 'vitest';
import {
  applyAnalysisTemplate,
  analysisTemplates,
  defaultAnalysisProfile,
  mapClientProfileRow,
  primaryObjectiveConfig,
  suggestedGoalsForObjective,
} from './clientAnalysisProfile';

describe('client analysis profile', () => {
  it('provides editable templates for health, delivery and local retail', () => {
    expect(analysisTemplates.map((template) => template.id)).toEqual(expect.arrayContaining([
      'clinica-odontologica',
      'delivery',
      'loja-calcados',
      'produtos-fisicos',
    ]));
  });

  it('creates a profile without forcing a suggested model', () => {
    expect(defaultAnalysisProfile('client-1')).toMatchObject({
      clientId: 'client-1',
      vertical: 'Outros',
      subsegment: 'Outros',
      primaryObjective: null,
      performanceGoals: [],
      minimumEvaluationSpend: 0,
      minimumImpressions: 0,
      minimumResults: 0,
      attributionDelayHours: 24,
      analysisEnabled: true,
    });
  });

  it('infers the official first subsegment when an existing client only has a segment', () => {
    expect(defaultAnalysisProfile('client-health', { vertical: 'Saúde' })).toMatchObject({
      vertical: 'Saúde',
      subsegment: 'Odontologia',
    });
  });

  it.each([
    ['whatsapp_messages', 'messaging_conversations_started_total', 'cost_per_messaging_conversation'],
    ['leads', 'leads', 'cost_per_lead'],
    ['registrations', 'registrations', 'cost_per_registration'],
    ['sales', 'purchases', 'cost_per_purchase'],
    ['website_sales', 'purchases', 'purchase_roas'],
  ] as const)('suggests dynamic goals for %s', (objective, primaryMetric, expectedMetric) => {
    expect(primaryObjectiveConfig(objective).primaryMetric).toBe(primaryMetric);
    expect(suggestedGoalsForObjective(objective).map((item) => item.metricId)).toContain(expectedMetric);
  });

  it('applies a suggested model without mutating the original blank profile', () => {
    const blank = defaultAnalysisProfile('client-template');
    const applied = applyAnalysisTemplate(blank, analysisTemplates[0]);
    expect(blank.primaryObjective).toBeNull();
    expect(applied.primaryObjective).toBe('whatsapp_messages');
    expect(applied.performanceGoals?.length).toBeGreaterThan(0);
  });

  it('maps custom segment and persisted thresholds without losing values', () => {
    expect(mapClientProfileRow({
      client_id: 'client-2',
      vertical: 'Outros',
      subsegment: 'Outros',
      custom_vertical: 'Turismo',
      custom_subsegment: 'Agência de viagens',
      business_model: 'geração de leads',
      primary_objective: null,
      primary_conversion_metric: 'leads',
      secondary_metrics: ['cost_per_lead'],
      primary_channel: 'Site',
      budget_period: 'monthly',
      planned_budget: '3000',
      minimum_evaluation_spend: '250',
      minimum_impressions: 1000,
      minimum_results: 8,
      attribution_delay_hours: 48,
      performance_goals: [{ id: 'goal-1', metricId: 'cpm', expectationType: 'maximum', value: 25, minValue: null, maxValue: null, warningTolerancePercent: 10, criticalTolerancePercent: 25, weight: 1 }],
      budget_platform: 'meta',
    })).toMatchObject({
      customVertical: 'Turismo',
      customSubsegment: 'Agência de viagens',
      plannedBudget: 3000,
      minimumEvaluationSpend: 250,
      minimumImpressions: 1000,
      minimumResults: 8,
      attributionDelayHours: 48,
      primaryObjective: 'leads',
      budgetPlatform: 'meta',
    });
  });
});
