import { describe, expect, it } from 'vitest';
import {
  buildCampaignPeriodAnalytics,
  evaluateTrendAvailability,
  type MetaAdSetDefinition,
  type MetaInsightRow,
  type TrendPeriodSignature,
} from '../../../supabase/functions/_shared/meta/analyticsEngine.ts';
import {
  analyzeCampaignMix,
  insightHasDelivery,
} from '../../../supabase/functions/_shared/meta/mixedAttributionDetector.ts';

const adset = (overrides: Partial<MetaAdSetDefinition> = {}): MetaAdSetDefinition => ({
  id: 'a1',
  campaign_id: 'c1',
  attribution_setting: '7d_click_1d_view',
  destination_type: 'WEBSITE',
  optimization_goal: 'OFFSITE_CONVERSIONS',
  classified_objective: 'SALES',
  ...overrides,
});

const insight = (overrides: Partial<MetaInsightRow> = {}): MetaInsightRow => ({
  adset_id: 'a1',
  campaign_id: 'c1',
  spend: '10',
  impressions: '100',
  inline_link_clicks: '5',
  date_start: '2026-06-01',
  date_stop: '2026-06-07',
  actions: [],
  action_values: [],
  ...overrides,
});

const context = {
  campaignCollectionStatus: 'complete' as const,
  adsetCollectionStatus: 'complete' as const,
  timezone: 'America/New_York',
  currency: 'USD',
};

describe('Meta analytics campaign mixing and period engine', () => {
  it('keeps same attribution and objective unmixed', () => {
    const result = analyzeCampaignMix(
      [adset(), adset({ id: 'a2' })],
      'OUTCOME_SALES',
      [insight(), insight({ adset_id: 'a2' })]
    );
    expect(result.structuralMixedAttribution).toBe(false);
    expect(result.effectiveMixedAttribution).toBe(false);
    expect(result.mixedObjective).toBe(false);
  });

  it('separates mixed attribution from an unchanged objective', () => {
    const result = analyzeCampaignMix(
      [adset(), adset({ id: 'a2', attribution_setting: '1d_click' })],
      'OUTCOME_SALES',
      [insight(), insight({ adset_id: 'a2' })]
    );
    expect(result.structuralMixedAttribution).toBe(true);
    expect(result.effectiveMixedAttribution).toBe(true);
    expect(result.mixedObjective).toBe(false);
    expect(result.classifiedObjectives).toEqual(['SALES']);
  });

  it('treats known attribution plus UNKNOWN as mixed', () => {
    const result = analyzeCampaignMix(
      [adset(), adset({ id: 'a2', attribution_setting: null })],
      'OUTCOME_SALES'
    );
    expect(result.structuralMixedAttribution).toBe(true);
    expect(result.attributionSettings).toEqual(['7d_click_1d_view', 'UNKNOWN']);
  });

  it('separates mixed objective from unchanged attribution', () => {
    const result = analyzeCampaignMix([
      adset({ classified_objective: 'WHATSAPP', destination_type: 'WHATSAPP' }),
      adset({ id: 'a2', classified_objective: 'LEADS', destination_type: 'WEBSITE' }),
    ], 'OUTCOME_LEADS');
    expect(result.structuralMixedAttribution).toBe(false);
    expect(result.mixedObjective).toBe(true);
    expect(result.mixedDestination).toBe(true);
  });

  it('reports objective and attribution mix independently when both change', () => {
    const result = analyzeCampaignMix([
      adset({ classified_objective: 'WHATSAPP', destination_type: 'WHATSAPP' }),
      adset({ id: 'a2', attribution_setting: '1d_click', classified_objective: 'LEADS' }),
    ], 'OUTCOME_LEADS');
    expect(result.structuralMixedAttribution).toBe(true);
    expect(result.mixedObjective).toBe(true);
  });

  it('does not consider an action with value zero to be delivery', () => {
    expect(insightHasDelivery(insight({
      spend: '0',
      impressions: '0',
      actions: [{ value: '0' }],
    }))).toBe(false);
  });

  it('classifies zero delivery without marking collection partial', () => {
    const result = buildCampaignPeriodAnalytics(
      { id: 'c1', objective: 'OUTCOME_SALES' },
      [adset()],
      insight({ adset_id: 'c1', spend: '0', impressions: '0', actions: [{ value: '0' }] }),
      [],
      context
    );
    expect(result.completeness.status).toBe('zero_delivery');
  });

  it('keeps the period complete when one Ad Set delivered and another had zero delivery', () => {
    const result = buildCampaignPeriodAnalytics(
      { id: 'c1', objective: 'OUTCOME_SALES' },
      [adset(), adset({ id: 'a2', attribution_setting: '1d_click' })],
      insight({ adset_id: 'c1', spend: '25', impressions: '250' }),
      [
        insight({ spend: '25', impressions: '250' }),
        insight({ adset_id: 'a2', spend: '0', impressions: '0', inline_link_clicks: '0' }),
      ],
      context
    );

    expect(result.completeness.status).toBe('complete');
    expect(result.attributionGroups.find((group) => group.adsetIds.includes('a2'))?.completeness)
      .toBe('zero_delivery');
  });

  it('treats an omitted Ad Set row as zero delivery when pagination completed', () => {
    const result = buildCampaignPeriodAnalytics(
      { id: 'c1', objective: 'OUTCOME_SALES' },
      [adset(), adset({ id: 'a2', attribution_setting: '1d_click' })],
      insight({ adset_id: 'c1', spend: '10', impressions: '100' }),
      [insight()],
      context
    );

    expect(result.completeness.status).toBe('complete');
    expect(result.completeness.missingAdsetIds).toEqual([]);
    expect(result.attributionGroups.find((group) => group.adsetIds.includes('a2'))?.completeness)
      .toBe('zero_delivery');
  });

  it('marks an omitted Ad Set as incomplete when pagination is partial', () => {
    const result = buildCampaignPeriodAnalytics(
      { id: 'c1', objective: 'OUTCOME_SALES' },
      [adset(), adset({ id: 'a2', attribution_setting: '1d_click' })],
      insight({ adset_id: 'c1', spend: '10', impressions: '100' }),
      [insight()],
      { ...context, adsetCollectionStatus: 'partial_page' as const }
    );

    expect(result.completeness.status).toBe('partial_page');
    expect(result.completeness.missingAdsetIds).toEqual(['a2']);
  });

  it('keeps a fully collected campaign at zero delivery when no Ad Set has a row', () => {
    const result = buildCampaignPeriodAnalytics(
      { id: 'c1', objective: 'OUTCOME_SALES' },
      [adset(), adset({ id: 'a2', attribution_setting: '1d_click' })],
      insight({ adset_id: 'c1', spend: '0', impressions: '0' }),
      [],
      context
    );

    expect(result.completeness.status).toBe('zero_delivery');
    expect(result.completeness.missingAdsetIds).toEqual([]);
    expect(result.attributionGroups.every((group) => group.completeness === 'zero_delivery')).toBe(true);
  });

  it('normalizes a structurally mixed campaign with the objective that delivered', () => {
    const adsets = [
      adset({ classified_objective: 'WHATSAPP', destination_type: 'WHATSAPP' }),
      adset({ id: 'a2', classified_objective: 'LEADS', destination_type: 'WEBSITE' }),
    ];
    const result = buildCampaignPeriodAnalytics(
      { id: 'c1', objective: 'OUTCOME_LEADS' },
      adsets,
      insight({ adset_id: 'c1', spend: '20', impressions: '200' }),
      [
        insight({ actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '2' }] }),
        insight({ adset_id: 'a2', spend: '0', impressions: '0' }),
      ],
      context
    );
    expect(result.classifiedObjective).toBe('MIXED');
    expect(result.mix.effectiveMixedAttribution).toBe(false);
    expect(result.attributionGroups.find((group) => group.classifiedObjective === 'WHATSAPP')?.metrics.whatsapp_conversations_started).toBe(2);
  });

  it('preserves attribution settings that contain underscores', () => {
    const result = buildCampaignPeriodAnalytics(
      { id: 'c1', objective: 'OUTCOME_LEADS' },
      [
        adset({ classified_objective: 'WHATSAPP', destination_type: 'WHATSAPP' }),
        adset({ id: 'a2', classified_objective: 'LEADS' }),
      ],
      insight({ adset_id: 'c1' }),
      [insight(), insight({ adset_id: 'a2' })],
      context
    );
    expect(result.attributionGroups.every((group) => group.attributionSetting === '7d_click_1d_view')).toBe(true);
  });

  it('does not duplicate campaign totals with Ad Set groups', () => {
    const result = buildCampaignPeriodAnalytics(
      { id: 'c1', objective: 'OUTCOME_SALES' },
      [adset(), adset({ id: 'a2', attribution_setting: '1d_click' })],
      insight({ adset_id: 'c1', spend: '100', impressions: '1000' }),
      [insight({ spend: '60' }), insight({ adset_id: 'a2', spend: '40' })],
      context
    );
    const groupedSpend = result.attributionGroups.reduce((total, group) => total + Number(group.metrics.spend || 0), 0);
    expect(result.globalMetrics?.spend).toBe(100);
    expect(groupedSpend).toBe(100);
  });

  it('marks unavailable account timezone as a validation error', () => {
    const result = buildCampaignPeriodAnalytics(
      { id: 'c1', objective: 'OUTCOME_SALES' },
      [adset()],
      insight({ adset_id: 'c1' }),
      [],
      { ...context, timezone: 'UNKNOWN' }
    );
    expect(result.completeness.status).toBe('validation_error');
  });
});

describe('Trend availability', () => {
  const signature = (overrides: Partial<TrendPeriodSignature> = {}): TrendPeriodSignature => ({
    period: 'current',
    attributionSettings: ['7d_click_1d_view'],
    sourceLevel: 'adset',
    timezone: 'America/New_York',
    objectiveGroups: ['SALES'],
    completenessStatus: 'complete',
    dateStart: '2026-06-08',
    dateStop: '2026-06-14',
    metricDefinitionVersion: 'v1',
    ...overrides,
  });

  it('blocks trends when attribution changes between snapshots', () => {
    const result = evaluateTrendAvailability(
      signature(),
      signature({ period: 'previous', attributionSettings: ['1d_click'], dateStart: '2026-06-01', dateStop: '2026-06-07' })
    );
    expect(result).toMatchObject({ available: false, reason: 'Attribution settings changed' });
  });

  it('blocks trends for incompatible timezone or period length', () => {
    expect(evaluateTrendAvailability(
      signature(),
      signature({ period: 'previous', timezone: 'UTC', dateStart: '2026-06-01', dateStop: '2026-06-07' })
    ).reason).toBe('Timezone is unavailable or changed');
    expect(evaluateTrendAvailability(
      signature(),
      signature({ period: 'previous', dateStart: '2026-06-01', dateStop: '2026-06-05' })
    ).reason).toBe('Date ranges are not equivalent');
  });

  it('allows a trend only for equivalent complete snapshots', () => {
    const result = evaluateTrendAvailability(
      signature(),
      signature({ period: 'previous', dateStart: '2026-06-01', dateStop: '2026-06-07' })
    );
    expect(result).toEqual({ available: true, reason: null, comparedWith: 'previous' });
  });
});
