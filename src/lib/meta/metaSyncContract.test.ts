import { describe, expect, it } from 'vitest';
import type { Client } from '../../types';
import {
  OFFICIAL_META_SYNC_PERIOD,
  assertMetaSyncResponse,
  buildClientMetaSyncRequest,
  buildOperationalMetaSyncRequest,
  normalizeMetaSyncOptions,
} from './metaSyncContract';

describe('Meta sync request contract', () => {
  it('normalizes legacy clients onto the official campaign period', () => {
    const options = normalizeMetaSyncOptions({ metaAdAccountId: 'act_123' } as Client);

    expect(options).toEqual({
      adAccountId: 'act_123',
      periods: [OFFICIAL_META_SYNC_PERIOD],
      requestedLevel: 'campaign',
    });
  });

  it('builds an operational request with the linked client asset as its only identity', () => {
    const request = buildOperationalMetaSyncRequest({
      clientMetaAssetId: 'link-1',
      period: 'this_month',
      requestedLevel: 'creative',
      campaignIds: ['campaign-1'],
      adsetIds: ['adset-1'],
      adIds: ['ad-1'],
      creativeIds: ['creative-1'],
    });

    expect(request).toEqual({
      payload: {
        clientMetaAssetId: 'link-1',
        periods: ['last_90d'],
        requestedLevel: 'creative',
        selectedEntityIds: {
          campaign_ids: ['campaign-1'],
          adset_ids: ['adset-1'],
          ad_ids: ['ad-1'],
          creative_ids: ['creative-1'],
        },
      },
      timeoutMs: 120_000,
    });
    expect(request.payload).not.toHaveProperty('metaAssetId');
    expect(request.payload).not.toHaveProperty('adAccountId');
  });

  it('builds the compatibility request without changing selection semantics', () => {
    const request = buildClientMetaSyncRequest({
      metaAssetId: 'asset-1',
      requestedLevel: 'adset',
      selectedCampaigns: ['campaign-1'],
      selectedAdSets: ['adset-1'],
    });

    expect(request).toMatchObject({
      payload: {
        metaAssetId: 'asset-1',
        periods: ['last_90d'],
        requestedLevel: 'adset',
        selectedCampaigns: ['campaign-1'],
        selectedAdSets: ['adset-1'],
      },
      timeoutMs: 90_000,
    });
  });
});

describe('Meta sync response contract', () => {
  it('accepts a complete response', () => {
    const response = {
      success: true,
      status: 'success',
      runId: 'run-1',
      campaigns: [],
      completenessByPeriod: {},
      failedAdsetIds: [],
      timezone: 'America/Sao_Paulo',
      currency: 'BRL',
    };

    expect(assertMetaSyncResponse(response)).toBe(response);
  });

  it.each([
    [{ status: 'success', runId: null, campaigns: [] }, 'invalid response contract'],
    [{ status: 'success', runId: 'run-1', campaigns: null }, 'invalid response contract'],
    [{ status: 'running', runId: 'run-1', campaigns: [] }, 'unknown status'],
  ])('rejects an invalid backend response %#', (response, message) => {
    expect(() => assertMetaSyncResponse(response)).toThrow(message);
  });
});
