import { describe, expect, it } from 'vitest';
import { initialData, normalizeData, sanitizeWorkspaceData } from '../../data/camplyStore';
import { reconcileTraceableMetric } from '../../lib/meta/reconciliationService';
import {
  deriveCostMetric,
  deriveScopedMetric,
  type TraceableMetric,
} from '../../lib/performance/traceableMetrics';
import type { Campaign, Client } from '../../types';

const metric = (metricId: string, value: number, overrides: Partial<TraceableMetric> = {}): TraceableMetric => ({
  metricId,
  value,
  available: true,
  currency: 'BRL',
  dateStart: '2026-06-24',
  dateStop: '2026-06-30',
  timezone: 'America/Sao_Paulo',
  sourceLevel: 'campaign',
  attributionSetting: '7d_click_1d_view',
  classifiedObjective: 'LEADS',
  destinationType: 'WHATSAPP',
  syncRunId: 'run-1',
  completenessStatus: 'complete',
  collectedAt: '2026-06-30T18:00:00Z',
  clientMetaAssetId: 'link-1',
  accountId: 'act-1',
  accountName: 'Conta 1',
  campaignId: 'campaign-1',
  adsetId: null,
  adId: null,
  unavailableReason: null,
  ...overrides,
});

const client: Client = {
  id: 'client-1', projectId: '', name: 'Responsável', company: 'Cliente', segment: 'Saúde',
  structure: '', hasProject: false, contact: '', monthlyFee: 1000, managementFeeType: 'recurring',
  dueDay: 10, adInvestmentPeriod: 'monthly', adInvestmentMeta: 2000, adInvestmentGoogle: 0,
  adInvestmentYoutube: 0, adInvestmentTikTok: 0, status: 'active',
  metaAdAccountId: 'act_legacy', metaAdAccountName: 'Conta legada',
};

const operationalCampaign: Campaign = {
  id: 'operational-1', clientId: client.id, name: 'Planejamento', platform: 'Meta Ads',
  status: 'setup', objective: 'Cadastros', budget: 2000, spent: 0, nextAction: '', priority: 'medium',
  globalMetricsByPeriod: { last_7d: {
    spend: 999,
    sourceLevel: 'campaign',
    dateStart: '2026-06-24',
    dateStop: '2026-06-30',
    timezone: 'America/Sao_Paulo',
    currency: 'BRL',
  } },
  syncRunId: 'run-legacy',
};

describe('operational analytics contracts', () => {
  it('derives cost and ratio only from metrics with the exact same trace scope', () => {
    expect(deriveCostMetric('cost_per_lead', metric('spend', 100), metric('leads', 5))).toMatchObject({
      available: true,
      value: 20,
    });
    expect(deriveScopedMetric('link_ctr', metric('link_clicks', 25), metric('impressions', 1000), 100)).toMatchObject({
      available: true,
      value: 2.5,
    });
    expect(deriveCostMetric('cost_per_messaging_conversation', metric('spend', 120), metric('messaging_conversations_started_total', 6))).toMatchObject({
      available: true,
      value: 20,
    });
    expect(deriveCostMetric('cost_per_purchase', metric('spend', 120), metric('purchases', 4))).toMatchObject({
      available: true,
      value: 30,
    });
    expect(deriveScopedMetric('frequency', metric('impressions', 1000), metric('reach', 400))).toMatchObject({
      available: true,
      value: 2.5,
    });
    expect(deriveScopedMetric('purchase_roas', metric('purchase_value', 600), metric('spend', 120))).toMatchObject({
      available: true,
      value: 5,
    });

    const incompatible = deriveCostMetric(
      'cost_per_lead',
      metric('spend', 100),
      metric('leads', 5, { dateStart: '2026-06-01', dateStop: '2026-06-07' })
    );
    expect(incompatible).toMatchObject({ available: false, unavailableReason: 'incompatible_metric_scope' });

    expect(deriveCostMetric(
      'cost_per_purchase',
      metric('spend', 100),
      metric('purchases', 5, { attributionSetting: '1d_click' })
    )).toMatchObject({ available: false, unavailableReason: 'incompatible_metric_scope' });

    expect(deriveScopedMetric(
      'purchase_roas',
      metric('purchase_value', 500, { currency: 'USD' }),
      metric('spend', 100, { currency: 'BRL' })
    )).toMatchObject({ available: false, unavailableReason: 'incompatible_metric_scope' });
  });

  it('never fabricates a cost when the result denominator is zero', () => {
    expect(deriveCostMetric('cost_per_lead', metric('spend', 100), metric('leads', 0))).toMatchObject({
      available: false,
      value: null,
      unavailableReason: 'denominator_not_positive',
    });
  });

  it('preserves partial state and distinguishes it from an unavailable metric', () => {
    const partial = deriveCostMetric(
      'cost_per_messaging_conversation',
      metric('spend', 100, { completenessStatus: 'partial_page' }),
      metric('messaging_conversations_started_total', 5, { completenessStatus: 'partial_page' })
    );
    expect(partial).toMatchObject({ available: true, value: 20, completenessStatus: 'partial_page' });

    const absent = deriveCostMetric('cost_per_purchase', undefined, metric('purchases', 5));
    expect(absent).toMatchObject({ available: false, value: null, unavailableReason: 'missing_compatible_inputs' });
  });

  it('classifies exact, tolerated, divergent and partial reconciliation states', () => {
    expect(reconcileTraceableMetric(metric('spend', 100), 100).status).toBe('reconciled');
    expect(reconcileTraceableMetric(metric('spend', 100.5), 100, 1).status).toBe('within_tolerance');
    expect(reconcileTraceableMetric(metric('spend', 110), 100, 1).status).toBe('divergent');
    expect(reconcileTraceableMetric(metric('spend', 100, { completenessStatus: 'partial_page' }), 100).status).toBe('partial');
  });

  it('removes legacy Meta links and analytics payloads from the operational workspace', () => {
    const importedMetaCampaign = { ...operationalCampaign, id: 'meta-1', metaCampaignId: 'meta-campaign-1' };
    const sanitized = sanitizeWorkspaceData({
      ...initialData,
      clients: [client],
      campaigns: [operationalCampaign, importedMetaCampaign],
    });
    expect(sanitized.clients[0].metaAdAccountId).toBeUndefined();
    expect(sanitized.campaigns).toHaveLength(1);
    expect(sanitized.campaigns[0].globalMetricsByPeriod).toBeUndefined();
    expect(sanitized.campaigns[0].syncRunId).toBeUndefined();

    const normalized = normalizeData({
      ...initialData,
      clients: [client],
      campaigns: [importedMetaCampaign],
    });
    expect(normalized.clients[0].metaAdAccountName).toBeUndefined();
    expect(normalized.campaigns).toEqual([]);
  });
});
