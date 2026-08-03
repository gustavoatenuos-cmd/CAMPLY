import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMetaHierarchy } from '../meta/performanceHierarchyService';
import { unavailableTraceableMetric } from './traceableMetrics';
import { fetchMetaPerformanceHierarchy } from './metaPerformanceHierarchy';

vi.mock('../meta/performanceHierarchyService', () => ({
  loadMetaHierarchy: vi.fn(),
}));

const loadHierarchyMock = vi.mocked(loadMetaHierarchy);

describe('fetchMetaPerformanceHierarchy', () => {
  beforeEach(() => {
    loadHierarchyMock.mockReset();
  });

  it('uses the canonical hierarchy service and preserves traceable metrics', async () => {
    loadHierarchyMock.mockResolvedValue({
      state: 'ready',
      level: 'campaign',
      period: 'last_90d',
      page: 1,
      pageSize: 50,
      total: 1,
      items: [{
        id: 'campaign-1',
        name: null,
        status: 'ACTIVE',
        effectiveStatus: 'ACTIVE',
        objective: 'OUTCOME_LEADS',
        classifiedObjective: 'LEADS',
        destinationType: 'WHATSAPP',
        attributionSetting: '7d_click_1d_view',
        creativeId: null,
        metrics: { spend: unavailableTraceableMetric('spend') },
      }],
    });

    const result = await fetchMetaPerformanceHierarchy(
      'client-meta-asset-1',
      'last_90d',
      'campaign',
      null,
      1,
      50
    );

    expect(loadHierarchyMock).toHaveBeenCalledWith({
      clientMetaAssetId: 'client-meta-asset-1',
      period: 'last_90d',
      level: 'campaign',
      parentId: undefined,
      page: 1,
      pageSize: 50,
      includeHistorical: false,
    });
    expect(result.state).toBe('ready');
    expect(result.items[0]).toMatchObject({
      id: 'campaign-1',
      name: 'campaign-1',
      effectiveStatus: 'ACTIVE',
    });
    expect(result.items[0].metrics.spend.metricId).toBe('spend');
  });
});
