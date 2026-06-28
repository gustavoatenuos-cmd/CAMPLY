// @ts-nocheck
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260627000003_mixed_attribution_support.sql', import.meta.url),
  'utf8'
);

describe('mixed attribution migration safety', () => {
  it('is rerunnable and deduplicates before creating the idempotency index', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS');
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS');
    expect(migration).toContain('row_number() OVER');
    expect(migration.indexOf('ranked_duplicates')).toBeLessThan(migration.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS'));
    expect(migration).toContain('NULLS NOT DISTINCT');
  });

  it('keeps unknown analytics values nullable and constrains finite statuses', () => {
    expect(migration).not.toContain("SET adset_id = 'N/A'");
    expect(migration).not.toContain("SET date_start = '2000-01-01'");
    expect(migration).not.toContain("SET timezone = 'UTC'");
    expect(migration).toContain('meta_normalized_metrics_source_level_check');
    expect(migration).toContain('meta_normalized_metrics_completeness_check');
  });
});
