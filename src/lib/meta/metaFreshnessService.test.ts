import { describe, expect, it } from 'vitest';
import {
  META_REPORTING_LAG_TOLERANCE_DAYS,
  META_STRUCTURE_MAX_AGE_MINUTES,
  normalizeMetaFreshnessItem,
  type MetaFreshnessItem,
} from './metaFreshnessService';

const NOW = Date.parse('2026-09-28T16:00:00.000Z');

function item(overrides: Partial<MetaFreshnessItem> = {}): MetaFreshnessItem {
  return {
    clientId: 'client-1',
    clientMetaAssetId: 'link-1',
    accountId: 'act_1',
    accountName: 'Conta',
    timezone: 'America/Sao_Paulo',
    localToday: '2026-09-28',
    structureLastSyncedAt: '2026-09-28T15:30:00.000Z',
    structureDateStop: '2026-09-28',
    creativeLastSyncedAt: null,
    creativeDateStop: null,
    structureFresh: false,
    creativeFresh: false,
    needsStructureRefresh: true,
    needsCreativeRefresh: true,
    ...overrides,
  };
}

describe('normalizeMetaFreshnessItem', () => {
  it('accepts a recent one-day Meta reporting lag as fresh', () => {
    const normalized = normalizeMetaFreshnessItem(item({ structureDateStop: '2026-09-27' }), NOW);

    expect(normalized.structureFresh).toBe(true);
    expect(normalized.needsStructureRefresh).toBe(false);
  });

  it('accepts the configured two-day Meta reporting lag tolerance', () => {
    const normalized = normalizeMetaFreshnessItem(item({ structureDateStop: '2026-09-26' }), NOW);

    expect(META_REPORTING_LAG_TOLERANCE_DAYS).toBe(2);
    expect(normalized.structureFresh).toBe(true);
    expect(normalized.needsStructureRefresh).toBe(false);
  });

  it('refreshes when the returned range is older than the reporting tolerance', () => {
    const normalized = normalizeMetaFreshnessItem(item({ structureDateStop: '2026-09-25' }), NOW);

    expect(normalized.structureFresh).toBe(false);
    expect(normalized.needsStructureRefresh).toBe(true);
  });

  it('refreshes again after the hourly freshness window expires', () => {
    const old = new Date(NOW - (META_STRUCTURE_MAX_AGE_MINUTES + 1) * 60_000).toISOString();
    const normalized = normalizeMetaFreshnessItem(item({
      structureLastSyncedAt: old,
      structureDateStop: '2026-09-28',
    }), NOW);

    expect(normalized.structureFresh).toBe(false);
    expect(normalized.needsStructureRefresh).toBe(true);
  });

  it('preserves a server-confirmed fresh state', () => {
    const normalized = normalizeMetaFreshnessItem(item({
      structureFresh: true,
      needsStructureRefresh: false,
      structureDateStop: null,
      localToday: null,
    }), NOW);

    expect(normalized.structureFresh).toBe(true);
    expect(normalized.needsStructureRefresh).toBe(false);
  });
});
