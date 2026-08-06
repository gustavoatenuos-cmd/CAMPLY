// @ts-nocheck
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('https://deno.land/std@0.177.0/http/server.ts', () => ({
  serve: vi.fn(),
}));

vi.mock('../../../supabase/functions/_shared/auth.ts', () => ({
  requireAuthenticatedUser: vi.fn(),
  HttpError: class HttpError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  errorResponse: vi.fn(),
}));

vi.mock('../../../supabase/functions/_shared/crypto.ts', () => ({
  decryptToken: vi.fn(),
}));

vi.mock('../../../supabase/functions/_shared/cors.ts', () => ({
  corsHeaders: {},
}));

vi.mock('../../../supabase/functions/_shared/direct-postgres.ts', () => ({
  withDirectPostgres: vi.fn(),
}));

vi.mock('../../../supabase/functions/_shared/meta-api.ts', () => ({
  fetchMetaGraph: vi.fn(),
  fetchMetaGraphPaginated: vi.fn(),
  META_GRAPH_VERSION: 'v25.0',
}));

let validateReturnedPeriodRange: any;
let groupAccountInsightsByDateRange: any;

beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: () => '' } });
  
  const coverageModule = await import('../../../supabase/functions/_shared/meta/syncCoverage.ts');
  validateReturnedPeriodRange = coverageModule.validateReturnedPeriodRange;
  
  const aggregationModule = await import('../../../supabase/functions/_shared/meta/aggregation.ts');
  groupAccountInsightsByDateRange = aggregationModule.groupAccountInsightsByDateRange;
});

describe('Meta sync returned period range validation', () => {
  const now = new Date('2026-07-15T15:00:00Z');

  it('accepts this_month when Meta returns the account month start and local today', () => {
    const result = validateReturnedPeriodRange(
      'this_month',
      { date_start: '2026-07-01', date_stop: '2026-07-15' },
      'America/Sao_Paulo',
      'complete',
      now
    );

    expect(result.status).toBe('complete');
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('marks this_month partial when date_stop differs, indicating missing end days', () => {
    const result = validateReturnedPeriodRange(
      'this_month',
      { date_start: '2026-07-01', date_stop: '2026-07-14' },
      'America/Sao_Paulo',
      'complete',
      now
    );

    expect(result.status).toBe('partial');
    expect(result.errors).toEqual([]);
  });

  it('rejects missing returned dates instead of fabricating a successful sync', () => {
    const result = validateReturnedPeriodRange(
      'this_month',
      { date_start: '2026-07-01' },
      'America/Sao_Paulo',
      'complete',
      now
    );

    expect(result.status).toBe('zero_delivery');
    expect(result.errors.join(' ')).not.toContain('date_stop');
  });

  it('rejects validation when the account timezone is unavailable', () => {
    const result = validateReturnedPeriodRange(
      'this_month',
      { date_start: '2026-07-01', date_stop: '2026-07-15' },
      'UNKNOWN',
      'complete',
      now
    );

    expect(result.status).toBe('validation_error');
    expect(result.errors.join(' ')).toContain('Timezone unavailable');
  });

  it('accepts this_week when Meta returns Monday through local today', () => {
    const result = validateReturnedPeriodRange(
      'this_week',
      { date_start: '2026-07-13', date_stop: '2026-07-15' },
      'America/Sao_Paulo',
      'complete',
      now
    );

    expect(result.status).toBe('complete');
    expect(result.errors).toEqual([]);
    expect(result.metadata.requestedDateStart).toBe('2026-07-13');
    expect(result.metadata.requestedDateStop).toBe('2026-07-15');
  });
});

describe('Meta account insight grouping', () => {
  it('groups duplicate account rows by exact daily range before normalization', () => {
    const groups = groupAccountInsightsByDateRange([
      { date_start: '2026-07-14', date_stop: '2026-07-14', spend: '10' },
      { date_start: '2026-07-14', date_stop: '2026-07-14', spend: '20' },
      { date_start: '2026-07-15', date_stop: '2026-07-15', spend: '30' },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(2);
    expect(groups[1]).toHaveLength(1);
  });

  it('separates rows without valid dates into their own validation buckets', () => {
    const groups = groupAccountInsightsByDateRange([
      { spend: '10' },
      { date_start: 'invalid', date_stop: null, spend: '20' },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(1);
    expect(groups[1]).toHaveLength(1);
  });
});
