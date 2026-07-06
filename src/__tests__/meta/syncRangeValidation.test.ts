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

beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: () => '' } });
  const indexStr = '../../../supabase/functions/meta-sync-performance/index.ts';
  const module = await import(indexStr);
  validateReturnedPeriodRange = module.validateReturnedPeriodRange;
});

describe('Meta sync returned period range validation', () => {
  const now = new Date('2026-07-15T15:00:00Z');

  it('accepts this_month when Meta returns the account month start and local today', () => {
    const result = validateReturnedPeriodRange(
      'this_month',
      { date_start: '2026-07-01', date_stop: '2026-07-15' },
      'America/Sao_Paulo',
      now
    );

    expect(result.status).toBe('complete');
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('keeps this_month complete when only date_stop differs, because Meta range is authoritative', () => {
    const result = validateReturnedPeriodRange(
      'this_month',
      { date_start: '2026-07-01', date_stop: '2026-07-14' },
      'America/Sao_Paulo',
      now
    );

    expect(result.status).toBe('complete');
    expect(result.errors).toEqual([]);
    expect(result.warnings.join(' ')).toContain('date_stop differs');
  });

  it('rejects missing returned dates instead of fabricating a successful sync', () => {
    const result = validateReturnedPeriodRange(
      'this_month',
      { date_start: '2026-07-01' },
      'America/Sao_Paulo',
      now
    );

    expect(result.status).toBe('validation_error');
    expect(result.errors.join(' ')).toContain('date_stop');
  });

  it('rejects validation when the account timezone is unavailable', () => {
    const result = validateReturnedPeriodRange(
      'this_month',
      { date_start: '2026-07-01', date_stop: '2026-07-15' },
      'UNKNOWN',
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
      now
    );

    expect(result.status).toBe('complete');
    expect(result.errors).toEqual([]);
    expect(result.metadata.expectedDateStart).toBe('2026-07-13');
    expect(result.metadata.expectedDateStop).toBe('2026-07-15');
  });
});
