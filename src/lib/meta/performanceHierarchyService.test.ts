import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMetaHierarchy } from './performanceHierarchyService';
import { invokeFunction } from '../invokeFunction';
import { supabaseData } from '../supabase';

vi.mock('../invokeFunction', () => ({
  invokeFunction: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabaseData: {
    rpc: vi.fn(),
  },
}));

vi.mock('./metaE2ERuntime', () => ({
  isMetaE2EMode: false,
  metaE2EState: { syncedPeriods: new Set() },
  e2eMetric: vi.fn(),
}));

const invokeFunctionMock = vi.mocked(invokeFunction);
const rpcMock = vi.mocked(supabaseData!.rpc);

describe('loadMetaHierarchy', () => {
  beforeEach(() => {
    invokeFunctionMock.mockReset();
    rpcMock.mockReset();
  });

  it('falls back to the authenticated RPC when the meta-hierarchy Edge Function fails', async () => {
    invokeFunctionMock.mockRejectedValue(new Error('Edge Function unavailable'));
    rpcMock.mockResolvedValue({
      count: null,
      error: null,
      status: 200,
      statusText: 'OK',
      success: true,
      data: {
        state: 'ready',
        level: 'campaign',
        period: 'last_90d',
        page: 1,
        pageSize: 25,
        total: 1,
        items: [{
          id: 'campaign-1',
          name: 'Campanha ativa',
          status: 'ACTIVE',
          effectiveStatus: 'ACTIVE',
          metrics: {
            spend: { metricId: 'spend', value: 123, available: true },
          },
        }],
      },
    });

    const page = await loadMetaHierarchy({
      clientMetaAssetId: '42de5f2f-3ee7-485b-9d86-ced225e4bdf1',
      period: 'last_90d',
      level: 'campaign',
      page: 1,
      pageSize: 25,
    });

    expect(page.state).toBe('ready');
    expect(page.items).toHaveLength(1);
    expect(page.items[0].name).toBe('Campanha ativa');
    expect(rpcMock).toHaveBeenCalledWith('get_meta_performance_hierarchy_v2', {
      p_client_meta_asset_id: '42de5f2f-3ee7-485b-9d86-ced225e4bdf1',
      p_period: 'last_90d',
      p_date_start: expect.any(String),
      p_date_stop: expect.any(String),
      p_level: 'campaign',
      p_parent_id: null,
      p_page: 1,
      p_page_size: 25,
      p_include_historical: false,
    });
  });

  it('keeps paused campaigns with delivery visible in historical analytics mode', async () => {
    invokeFunctionMock.mockResolvedValue({
      state: 'ready',
      level: 'campaign',
      period: 'last_30d',
      page: 1,
      pageSize: 25,
      total: 1,
      items: [{
        id: 'paused-campaign',
        name: 'Campanha pausada com entrega',
        status: 'PAUSED',
        effectiveStatus: 'PAUSED',
        metrics: { spend: { metricId: 'spend', value: 500, available: true } },
      }],
    });

    const page = await loadMetaHierarchy({
      clientMetaAssetId: '42de5f2f-3ee7-485b-9d86-ced225e4bdf1',
      period: 'last_30d',
      level: 'campaign',
      includeHistorical: true,
    });

    expect(page.items.map((item) => item.id)).toEqual(['paused-campaign']);
  });
});
