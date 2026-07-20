import { describe, expect, it } from 'vitest';
import { resolveSyncCoverageForPeriod, type SyncCoverageRun } from './syncCoverage';

function run(overrides: Partial<SyncCoverageRun> = {}): SyncCoverageRun {
  return {
    id: 'run-90',
    status: 'success',
    requestedPeriod: 'last_90d',
    dateStart: '2026-04-22',
    dateStop: '2026-07-20',
    startedAt: '2026-07-20T10:00:00.000Z',
    finishedAt: '2026-07-20T10:10:00.000Z',
    terminationReason: null,
    ...overrides,
  };
}

function resolve(selectedDateStart: string, selectedDateStop: string, availableRuns = [run()]) {
  return resolveSyncCoverageForPeriod({
    selectedPeriod: 'last_7d',
    selectedDateStart,
    selectedDateStop,
    availableRuns,
  });
}

describe('resolveSyncCoverageForPeriod', () => {
  it('last_90d success covers last_7d', () => {
    const coverage = resolve('2026-07-14', '2026-07-20');
    expect(coverage.status).toBe('covered');
    expect(coverage.coveringRequestedPeriod).toBe('last_90d');
    expect(coverage.canUseData).toBe(true);
  });

  it('last_90d success covers last_30d', () => {
    const coverage = resolve('2026-06-21', '2026-07-20');
    expect(coverage.status).toBe('covered');
  });

  it('last_90d success covers today', () => {
    const coverage = resolve('2026-07-20', '2026-07-20');
    expect(coverage.status).toBe('covered');
  });

  it('last_90d success covers this_month up to today', () => {
    const coverage = resolveSyncCoverageForPeriod({
      selectedPeriod: 'this_month',
      selectedDateStart: '2026-07-01',
      selectedDateStop: '2026-07-20',
      availableRuns: [run()],
    });
    expect(coverage.status).toBe('covered');
  });

  it('last_30d does not cover last_90d', () => {
    const coverage = resolveSyncCoverageForPeriod({
      selectedPeriod: 'last_90d',
      selectedDateStart: '2026-04-22',
      selectedDateStop: '2026-07-20',
      availableRuns: [run({ requestedPeriod: 'last_30d', dateStart: '2026-06-21', dateStop: '2026-07-20' })],
    });
    expect(coverage.status).toBe('not_covered');
    expect(coverage.canUseData).toBe(false);
  });

  it('this_month does not cover last_30d when last_30d starts before the month', () => {
    const coverage = resolveSyncCoverageForPeriod({
      selectedPeriod: 'last_30d',
      selectedDateStart: '2026-06-21',
      selectedDateStop: '2026-07-20',
      availableRuns: [run({ requestedPeriod: 'this_month', dateStart: '2026-07-01', dateStop: '2026-07-20' })],
    });
    expect(coverage.status).toBe('not_covered');
  });

  it('partial sync covering only part of the range becomes partial_coverage', () => {
    const coverage = resolveSyncCoverageForPeriod({
      selectedPeriod: 'last_7d',
      selectedDateStart: '2026-07-14',
      selectedDateStop: '2026-07-20',
      availableRuns: [run({ id: 'partial', status: 'partial', dateStart: '2026-07-18', dateStop: '2026-07-20' })],
    });
    expect(coverage.status).toBe('partial_coverage');
    expect(coverage.canUseData).toBe(false);
  });

  it('success covering the range plus newer partial keeps data with warning', () => {
    const coverage = resolve('2026-07-14', '2026-07-20', [
      run({ id: 'success', startedAt: '2026-07-20T10:00:00.000Z' }),
      run({ id: 'partial-newer', status: 'partial', startedAt: '2026-07-20T11:00:00.000Z' }),
    ]);
    expect(coverage.status).toBe('covered');
    expect(coverage.coveringRunId).toBe('success');
    expect(coverage.warning).toContain('tentativa mais recente incompleta');
  });

  it('returns not_covered when no run overlaps the selected range', () => {
    const coverage = resolve('2026-07-14', '2026-07-20', [
      run({ requestedPeriod: 'last_90d', dateStart: '2026-04-22', dateStop: '2026-07-10' }),
    ]);
    expect(coverage.status).toBe('not_covered');
  });
});
