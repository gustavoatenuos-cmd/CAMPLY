import { describe, expect, it } from 'vitest';
import { reconcileNormalizedMetric } from '../../lib/meta/reconciliation';

const snapshots = [{
  id: 'snapshot-1',
  entity_level: 'campaign',
  payload: [{
    campaign_id: 'campaign-1',
    date_start: '2026-06-01',
    date_stop: '2026-06-07',
    spend: '100',
    impressions: '1000',
    inline_link_clicks: '50',
    actions: [{ action_type: 'purchase', value: '4' }],
    action_values: [{ action_type: 'purchase', value: '300' }],
  }],
}] as const;

describe('normalized metric reconciliation', () => {
  it('calculates a real raw/normalized difference from the matching snapshot', () => {
    const result = reconcileNormalizedMetric({
      id: 'metric-1',
      campaign_id: 'campaign-1',
      adset_id: null,
      metric_id: 'spend',
      metric_value: 90,
      action_type: null,
      source_field: 'spend',
      date_start: '2026-06-01',
      date_stop: '2026-06-07',
      source_level: 'campaign',
      attribution_setting: null,
      completeness_status: 'complete',
    }, [...snapshots], []);

    expect(result.rawValue).toBe(100);
    expect(result.normalizedValue).toBe(90);
    expect(result.absoluteDifference).toBe(-10);
    expect(result.percentageDifference).toBe(-10);
  });

  it('recalculates ROAS from raw purchase value and spend', () => {
    const result = reconcileNormalizedMetric({
      id: 'metric-2',
      campaign_id: 'campaign-1',
      adset_id: null,
      metric_id: 'purchase_roas',
      metric_value: 3,
      action_type: null,
      source_field: null,
      date_start: '2026-06-01',
      date_stop: '2026-06-07',
      source_level: 'campaign',
      attribution_setting: null,
      completeness_status: 'complete',
      calculation_metadata: { formula: 'purchase_value / spend' },
    }, [...snapshots], []);

    expect(result.rawValue).toBe(3);
    expect(result.absoluteDifference).toBe(0);
    expect(result.formula).toBe('purchase_value / spend');
  });
});
