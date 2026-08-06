import { describe, it, expect } from 'vitest';
import { buildVerifiedScopeCoverage } from './syncCoverage';

describe('buildVerifiedScopeCoverage', () => {
  it('returns complete when collection is complete, no gaps, and no errors', () => {
    const result = buildVerifiedScopeCoverage({
      requestedDateStart: '2026-08-01',
      requestedDateStop: '2026-08-03',
      returnedRows: [
        { date_start: '2026-08-01', date_stop: '2026-08-01' } as any,
        { date_start: '2026-08-02', date_stop: '2026-08-02' } as any,
        { date_start: '2026-08-03', date_stop: '2026-08-03' } as any,
      ],
      completionStatus: 'complete',
      hasCollectionErrors: false,
    });

    expect(result.status).toBe('complete');
    expect(result.reason).toBe(null);
    expect(result.coveredDateStart).toBe('2026-08-01');
    expect(result.coveredDateStop).toBe('2026-08-03');
    expect(result.missingDates).toEqual([]);
    expect(result.expectedDays).toBe(3);
    expect(result.coveredDays).toBe(3);
  });

  it('returns zero_delivery when collection is complete but no rows returned', () => {
    const result = buildVerifiedScopeCoverage({
      requestedDateStart: '2026-08-01',
      requestedDateStop: '2026-08-03',
      returnedRows: [],
      completionStatus: 'complete',
      hasCollectionErrors: false,
    });

    expect(result.status).toBe('zero_delivery');
    expect(result.reason).toBe(null);
    expect(result.coveredDateStart).toBe('2026-08-01');
    expect(result.coveredDateStop).toBe('2026-08-03');
    expect(result.missingDates).toEqual([]);
    expect(result.expectedDays).toBe(3);
    expect(result.coveredDays).toBe(3);
  });

  it('returns partial with missing_days when there is an inner gap', () => {
    const result = buildVerifiedScopeCoverage({
      requestedDateStart: '2026-08-01',
      requestedDateStop: '2026-08-03',
      returnedRows: [
        { date_start: '2026-08-01', date_stop: '2026-08-01' } as any,
        { date_start: '2026-08-03', date_stop: '2026-08-03' } as any,
      ],
      completionStatus: 'complete',
      hasCollectionErrors: false,
    });

    expect(result.status).toBe('partial');
    expect(result.reason).toBe('missing_days');
    expect(result.missingDates).toEqual(['2026-08-02']);
    expect(result.expectedDays).toBe(3);
    expect(result.coveredDays).toBe(2);
  });

  it('returns partial when collection is complete but has errors and has rows', () => {
    const result = buildVerifiedScopeCoverage({
      requestedDateStart: '2026-08-01',
      requestedDateStop: '2026-08-03',
      returnedRows: [
        { date_start: '2026-08-01', date_stop: '2026-08-01' } as any,
      ],
      completionStatus: 'complete',
      hasCollectionErrors: true,
    });

    expect(result.status).toBe('partial');
    expect(result.reason).toBe('collection_errors');
  });

  it('returns unavailable when collection is complete but has errors and NO rows', () => {
    const result = buildVerifiedScopeCoverage({
      requestedDateStart: '2026-08-01',
      requestedDateStop: '2026-08-03',
      returnedRows: [],
      completionStatus: 'complete',
      hasCollectionErrors: true,
    });

    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('collection_errors');
  });

  it('returns unavailable when completionStatus is validation_error', () => {
    const result = buildVerifiedScopeCoverage({
      requestedDateStart: '2026-08-01',
      requestedDateStop: '2026-08-03',
      returnedRows: [],
      completionStatus: 'validation_error',
      hasCollectionErrors: false,
    });

    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('validation_error');
  });

  it('returns partial when completionStatus is validation_error but has rows', () => {
    const result = buildVerifiedScopeCoverage({
      requestedDateStart: '2026-08-01',
      requestedDateStop: '2026-08-03',
      returnedRows: [
        { date_start: '2026-08-01', date_stop: '2026-08-01' } as any,
      ],
      completionStatus: 'validation_error',
      hasCollectionErrors: false,
    });

    expect(result.status).toBe('partial');
    expect(result.reason).toBe('validation_error');
  });

  it('returns partial when completionStatus is rate_limit_exhausted', () => {
    const result = buildVerifiedScopeCoverage({
      requestedDateStart: '2026-08-01',
      requestedDateStop: '2026-08-03',
      returnedRows: [
        { date_start: '2026-08-01', date_stop: '2026-08-01' } as any,
      ],
      completionStatus: 'rate_limit_exhausted',
      hasCollectionErrors: false,
    });

    expect(result.status).toBe('partial');
    expect(result.reason).toBe('rate_limit_exhausted');
  });
});
