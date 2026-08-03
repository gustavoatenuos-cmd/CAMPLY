import { describe, expect, it } from 'vitest';
import { buildMetaSyncCoverageView, inclusiveDateRangeDays } from './metaSyncCoverage';
import type { MetaRunSummary } from './clientMetaAssetService';

const success: MetaRunSummary = {
  id: 'run-success',
  status: 'success',
  period: 'last_90d',
  level: 'creative',
  scope: 'full_account',
  startedAt: '2026-08-03T18:00:00Z',
  finishedAt: '2026-08-03T18:05:00Z',
  dateStart: '2026-05-06',
  dateStop: '2026-08-03',
  timezone: 'America/Sao_Paulo',
  currency: 'BRL',
};

describe('metaSyncCoverage', () => {
  it('calculates real inclusive coverage instead of trusting the preset name', () => {
    expect(inclusiveDateRangeDays('2026-05-06', '2026-08-03')).toBe(90);
    expect(buildMetaSyncCoverageView(success, success)).toMatchObject({
      dateStart: '2026-05-06',
      dateStop: '2026-08-03',
      coveredDays: 90,
      status: 'complete',
    });
  });

  it('preserves the last reliable coverage when a newer attempt is partial', () => {
    const partial: MetaRunSummary = {
      ...success,
      id: 'run-partial',
      status: 'partial',
      startedAt: '2026-08-03T19:00:00Z',
      finishedAt: '2026-08-03T19:01:00Z',
      terminationReason: 'rate_limit_exhausted',
      dateStop: '2026-07-30',
    };

    expect(buildMetaSyncCoverageView(success, partial)).toMatchObject({
      dateStart: '2026-05-06',
      dateStop: '2026-08-03',
      status: 'partial',
      qualityLabel: 'Último snapshot confiável preservado',
      limitationReason: 'rate_limit_exhausted',
    });
  });
});
