import { describe, expect, it } from 'vitest';
import {
  loadAnalyticsCapabilities,
  parseAnalyticsCapabilities,
} from './analyticsCapabilities';
import {
  deriveCostMetric,
  normalizeTraceableMetric,
  unavailableTraceableMetric,
} from './traceableMetrics';

const validCapabilities = {
  contractVersion: 2,
  dashboardAvailable: true,
  dashboardRpc: 'get_global_performance_dashboard_v2',
  supportedPeriods: ['today', 'last_7d', 'last_30d'],
  supportedLevels: ['campaign', 'adset', 'ad'],
  targetsAvailable: true,
  reconciliationAvailable: true,
  traceableMetrics: true,
};

describe('analytics capability negotiation', () => {
  it('accepts the traceable v2 contract and only known values', () => {
    const result = parseAnalyticsCapabilities({
      ...validCapabilities,
      supportedPeriods: [...validCapabilities.supportedPeriods, 'unsupported'],
      supportedLevels: [...validCapabilities.supportedLevels, 'creative'],
    });

    expect(result.mode).toBe('analytics');
    if (result.mode === 'analytics') {
      expect(result.capabilities.supportedPeriods).toEqual(['today', 'last_7d', 'last_30d']);
      expect(result.capabilities.supportedLevels).toEqual(['campaign', 'adset', 'ad']);
    }
  });

  it('uses compatibility mode for an older or incomplete contract', () => {
    expect(parseAnalyticsCapabilities({ ...validCapabilities, contractVersion: 1 })).toEqual({
      mode: 'compatibility',
      reason: 'capability_contract_incompatible',
    });
    expect(parseAnalyticsCapabilities({ ...validCapabilities, contractVersion: 3 })).toEqual({
      mode: 'compatibility',
      reason: 'capability_contract_incompatible',
    });
    expect(parseAnalyticsCapabilities({ ...validCapabilities, traceableMetrics: false })).toEqual({
      mode: 'compatibility',
      reason: 'capability_contract_incompatible',
    });
  });

  it('detects a missing RPC without exposing its technical error', async () => {
    const result = await loadAnalyticsCapabilities(async () => ({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find get_analytics_capabilities in schema cache' },
    }));

    expect(result).toEqual({
      mode: 'compatibility',
      reason: 'capability_contract_missing',
    });
  });

  it('fails closed when capability verification is unavailable', async () => {
    const result = await loadAnalyticsCapabilities(async () => {
      throw new Error('sensitive backend detail');
    });

    expect(result).toEqual({
      mode: 'compatibility',
      reason: 'capability_contract_unavailable',
    });
  });
});

describe('traceable metric contract', () => {
  const base = {
    metricId: 'spend',
    value: 100,
    available: true,
    currency: 'BRL',
    dateStart: '2026-06-24',
    dateStop: '2026-06-30',
    timezone: 'America/Sao_Paulo',
    sourceLevel: 'campaign',
    attributionSetting: '7d_click',
    classifiedObjective: 'WHATSAPP',
    destinationType: 'WHATSAPP',
    syncRunId: 'run-1',
    completenessStatus: 'complete',
    collectedAt: '2026-06-30T12:00:00Z',
    clientMetaAssetId: 'link-1',
    accountId: 'act_1',
    accountName: 'Conta 1',
    campaignId: 'campaign-1',
    adsetId: null,
    adId: null,
  } as const;

  it('keeps a real zero available and never turns absence into zero', () => {
    const zero = normalizeTraceableMetric('impressions', { ...base, metricId: 'impressions', value: 0 });
    const absent = normalizeTraceableMetric('impressions', undefined);
    const unavailableWithValue = normalizeTraceableMetric('impressions', {
      ...base,
      metricId: 'impressions',
      value: 99,
      available: false,
    });

    expect(zero.value).toBe(0);
    expect(zero.available).toBe(true);
    expect(absent).toEqual(unavailableTraceableMetric('impressions'));
    expect(unavailableWithValue).toMatchObject({
      value: null,
      available: false,
      completenessStatus: 'unavailable',
    });
  });

  it('preserves partial quality with its existing value', () => {
    const partial = normalizeTraceableMetric('spend', {
      ...base,
      value: 80,
      completenessStatus: 'partial_page',
    });

    expect(partial.value).toBe(80);
    expect(partial.available).toBe(true);
    expect(partial.completenessStatus).toBe('partial_page');
  });

  it('derives cost only from metrics with the same analytical scope', () => {
    const spend = normalizeTraceableMetric('spend', base);
    const conversations = normalizeTraceableMetric('messaging_conversations_started_total', {
      ...base,
      metricId: 'messaging_conversations_started_total',
      value: 4,
    });
    const mixedAttribution = normalizeTraceableMetric('messaging_conversations_started_total', {
      ...base,
      metricId: 'messaging_conversations_started_total',
      value: 4,
      attributionSetting: '1d_click',
    });
    const mixedDestination = normalizeTraceableMetric('messaging_conversations_started_total', {
      ...base,
      metricId: 'messaging_conversations_started_total',
      value: 4,
      destinationType: 'MESSENGER',
    });

    expect(deriveCostMetric('cost_per_messaging_conversation', spend, conversations)).toMatchObject({
      value: 25,
      available: true,
    });
    expect(deriveCostMetric('cost_per_messaging_conversation', spend, mixedAttribution)).toMatchObject({
      value: null,
      available: false,
      completenessStatus: 'unavailable',
    });
    expect(deriveCostMetric('cost_per_messaging_conversation', spend, mixedDestination)).toMatchObject({
      value: null,
      available: false,
      completenessStatus: 'unavailable',
    });
  });
});
