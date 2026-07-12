import { describe, expect, it } from 'vitest';
import { describeDataQualityReason } from './dataQualityReason';

describe('describeDataQualityReason', () => {
  it('translates known reason codes into specific, actionable sentences', () => {
    expect(describeDataQualityReason('partial_page')).toMatch(/número máximo de páginas/);
    expect(describeDataQualityReason('rate_limit_exhausted')).toMatch(/limitou a taxa de requisições/);
    expect(describeDataQualityReason('no_successful_run')).toMatch(/Nenhuma sincronização concluída/);
  });

  it('falls back to the raw reason for unrecognized codes instead of a generic message', () => {
    expect(describeDataQualityReason('Meta API Error [190]: token expired')).toBe('Meta API Error [190]: token expired');
  });

  it('returns null for empty input', () => {
    expect(describeDataQualityReason(null)).toBeNull();
    expect(describeDataQualityReason(undefined)).toBeNull();
    expect(describeDataQualityReason('')).toBeNull();
  });
});
