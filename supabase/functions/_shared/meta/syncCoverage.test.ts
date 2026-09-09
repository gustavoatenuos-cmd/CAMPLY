import { describe, it, expect } from 'vitest';
import { buildVerifiedScopeCoverage } from './syncCoverage';
import type { MetaInsightRow } from './aggregation';

describe('buildVerifiedScopeCoverage', () => {
  it('returns complete when collection is complete, no gaps, and no errors', () => {
    const result = buildVerifiedScopeCoverage({
      requestedDateStart: '2026-08-01',
      requestedDateStop: '2026-08-03',
      returnedRows: [
        { date_start: '2026-08-01', date_stop: '2026-08-01', spend: '1' } as unknown as MetaInsightRow,
        { date_start: '2026-08-02', date_stop: '2026-08-02', spend: '1' } as unknown as MetaInsightRow,
        { date_start: '2026-08-03', date_stop: '2026-08-03', spend: '1' } as unknown as MetaInsightRow,
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
        { date_start: '2026-08-01', date_stop: '2026-08-01', spend: '1' } as unknown as MetaInsightRow,
        { date_start: '2026-08-03', date_stop: '2026-08-03', spend: '1' } as unknown as MetaInsightRow,
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
        { date_start: '2026-08-01', date_stop: '2026-08-01', spend: '1' } as unknown as MetaInsightRow,
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
        { date_start: '2026-08-01', date_stop: '2026-08-01', spend: '1' } as unknown as MetaInsightRow,
      ],
      completionStatus: 'rate_limit_exhausted',
      hasCollectionErrors: false,
    });

    expect(result.status).toBe('partial');
    expect(result.reason).toBe('rate_limit_exhausted');
  });

  it('returns zero_delivery when completionStatus is zero_delivery with empty rows', () => {
    const result = buildVerifiedScopeCoverage({
      requestedDateStart: '2026-08-01',
      requestedDateStop: '2026-08-03',
      returnedRows: [],
      completionStatus: 'zero_delivery',
      hasCollectionErrors: false,
    });

    expect(result.status).toBe('zero_delivery');
    expect(result.reason).toBe(null);
  });

  it('returns zero_delivery when completionStatus is complete but all returned rows have zero delivery metrics', () => {
    const result = buildVerifiedScopeCoverage({
      requestedDateStart: '2026-08-01',
      requestedDateStop: '2026-08-03',
      returnedRows: [
        { date_start: '2026-08-01', date_stop: '2026-08-01', spend: '0', impressions: '0' } as unknown as MetaInsightRow,
        { date_start: '2026-08-02', date_stop: '2026-08-02', spend: '0', impressions: '0' } as unknown as MetaInsightRow,
      ],
      completionStatus: 'complete',
      hasCollectionErrors: false,
    });

    expect(result.status).toBe('zero_delivery');
    expect(result.reason).toBe(null);
  });

  it('returns partial and partial_page when completionStatus is partial_page and there are some rows', () => {
    const result = buildVerifiedScopeCoverage({
      requestedDateStart: '2026-08-01',
      requestedDateStop: '2026-08-03',
      returnedRows: [
        { date_start: '2026-08-01', date_stop: '2026-08-01', spend: '1' } as unknown as MetaInsightRow,
      ],
      completionStatus: 'partial_page',
      hasCollectionErrors: false,
    });

    expect(result.status).toBe('partial');
    expect(result.reason).toBe('partial_page');
  });

  it('returns unavailable and partial_page when completionStatus is partial_page and there are no rows', () => {
    const result = buildVerifiedScopeCoverage({
      requestedDateStart: '2026-08-01',
      requestedDateStop: '2026-08-03',
      returnedRows: [],
      completionStatus: 'partial_page',
      hasCollectionErrors: false,
    });

    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('partial_page');
  });

  it('returns partial and timeout when completionStatus is timeout and there are some rows', () => {
    const result = buildVerifiedScopeCoverage({
      requestedDateStart: '2026-08-01',
      requestedDateStop: '2026-08-03',
      returnedRows: [
        { date_start: '2026-08-01', date_stop: '2026-08-01', spend: '1' } as unknown as MetaInsightRow,
      ],
      completionStatus: 'timeout',
      hasCollectionErrors: false,
    });

    expect(result.status).toBe('partial');
    expect(result.reason).toBe('timeout');
  });

  it('returns unavailable and timeout when completionStatus is timeout and there are no rows', () => {
    const result = buildVerifiedScopeCoverage({
      requestedDateStart: '2026-08-01',
      requestedDateStop: '2026-08-03',
      returnedRows: [],
      completionStatus: 'timeout',
      hasCollectionErrors: false,
    });

    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('timeout');
  });

  it('returns partial and api_error when completionStatus is api_error and there are some rows', () => {
    const result = buildVerifiedScopeCoverage({
      requestedDateStart: '2026-08-01',
      requestedDateStop: '2026-08-03',
      returnedRows: [
        { date_start: '2026-08-01', date_stop: '2026-08-01', spend: '1' } as unknown as MetaInsightRow,
      ],
      completionStatus: 'api_error',
      hasCollectionErrors: false,
    });

    expect(result.status).toBe('partial');
    expect(result.reason).toBe('api_error');
  });

  it('returns unavailable and api_error when completionStatus is api_error and there are no rows', () => {
    const result = buildVerifiedScopeCoverage({
      requestedDateStart: '2026-08-01',
      requestedDateStop: '2026-08-03',
      returnedRows: [],
      completionStatus: 'api_error',
      hasCollectionErrors: false,
    });

    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('api_error');
  });

  it('returns unavailable and missing_insight_row when completionStatus is missing_insight_row and there are no rows', () => {
    const result = buildVerifiedScopeCoverage({
      requestedDateStart: '2026-08-01',
      requestedDateStop: '2026-08-03',
      returnedRows: [],
      completionStatus: 'missing_insight_row',
      hasCollectionErrors: false,
    });

    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('missing_insight_row');
  });

  it('never returns complete when completionStatus is missing_insight_row even with rows', () => {
    const result = buildVerifiedScopeCoverage({
      requestedDateStart: '2026-08-01',
      requestedDateStop: '2026-08-03',
      returnedRows: [
        { date_start: '2026-08-01', date_stop: '2026-08-01', spend: '1' } as unknown as MetaInsightRow,
      ],
      completionStatus: 'missing_insight_row',
      hasCollectionErrors: false,
    });

    expect(result.status).not.toBe('complete');
    expect(result.reason).toBe('missing_insight_row');
  });

  it('never returns complete when completionStatus is validation_error even with rows', () => {
    const result = buildVerifiedScopeCoverage({
      requestedDateStart: '2026-08-01',
      requestedDateStop: '2026-08-03',
      returnedRows: [
        { date_start: '2026-08-01', date_stop: '2026-08-01', spend: '1' } as unknown as MetaInsightRow,
        { date_start: '2026-08-02', date_stop: '2026-08-02', spend: '1' } as unknown as MetaInsightRow,
        { date_start: '2026-08-03', date_stop: '2026-08-03', spend: '1' } as unknown as MetaInsightRow,
      ],
      completionStatus: 'validation_error',
      hasCollectionErrors: false,
    });

    expect(result.status).not.toBe('complete');
    expect(result.reason).toBe('validation_error');
  });
});
