import { describe, expect, it } from 'vitest';
import { canonicalMetricIds, metricCatalog, resolveMetricId } from './metricCatalog';

describe('canonical metric catalog', () => {
  it('defines every canonical id once with unit and direction', () => {
    expect(Object.keys(metricCatalog)).toHaveLength(canonicalMetricIds.length);
    for (const id of canonicalMetricIds) {
      expect(metricCatalog[id].metricId).toBe(id);
      expect(metricCatalog[id].unit).toBeTruthy();
      expect(metricCatalog[id].direction).toBeTruthy();
    }
  });

  it.each([['spent', 'spend'], ['ctr', 'link_ctr'], ['cpc', 'link_cpc'], ['roas', 'purchase_roas'], ['pageViews', 'landing_page_views']])(
    'maps safe alias %s', (alias, expected) => expect(resolveMetricId(alias)).toMatchObject({ status: 'resolved', metricId: expected })
  );

  it.each(['cpa', 'cpr', 'results'])('does not guess ambiguous alias %s', (alias) => {
    expect(resolveMetricId(alias)).toEqual({ status: 'insufficient_context', metricId: null, source: 'ambiguous_alias' });
  });
});
