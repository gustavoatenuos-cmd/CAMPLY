import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dashboardMigration = readFileSync(
  new URL('../../../supabase/migrations/20260725000000_fix_dashboard_zero_delivery.sql', import.meta.url),
  'utf8'
);
const syncFunction = readFileSync(
  new URL('../../../supabase/functions/meta-sync-performance/index.ts', import.meta.url),
  'utf8'
);

describe('zero-delivery contract', () => {
  it('treats zero-delivery as a valid completeness state, not a partial failure', () => {
    expect(syncFunction).toContain("status !== 'complete' && status !== 'zero_delivery'");
    expect(dashboardMigration).toContain("NOT IN ('complete', 'zero_delivery')");
  });

  it('synthesizes zero-valued metrics when a trusted successful run has no metrics in the selected period', () => {
    expect(dashboardMigration).toContain('0::numeric AS raw_metric_value');
    expect(dashboardMigration).toContain("'zero_delivery' AS completeness_status");
    expect(dashboardMigration).toContain('WHERE NOT EXISTS (');
    expect(dashboardMigration).toContain('m.sync_run_id = ls.id');
  });

  it('maps a successful trusted period with zero spend and impressions to no_delivery', () => {
    expect(dashboardMigration).toContain("THEN 'no_delivery'");
    expect(dashboardMigration).toContain("cmv.metric_id IN ('spend', 'impressions')");
    expect(dashboardMigration).toContain("COALESCE((cmj.metrics->'spend'->>'value')::numeric, 0) = 0");
    expect(dashboardMigration).toContain("COALESCE((cmj.metrics->'impressions'->>'value')::numeric, 0) = 0");
  });
});
