import { describe, it, expect } from 'vitest';
import {
  evaluateCampaignEligibility,
  isRunStale,
  STALE_SNAPSHOT_THRESHOLD_MS,
  type CampaignEligibilityInput,
} from './campaignDecisionEligibility';

function metric(value: number | null, available = true) {
  return { value, available };
}

const freshRun = { finishedAt: new Date().toISOString(), status: 'success' };

const baseInput: CampaignEligibilityInput = {
  effectiveStatus: 'ACTIVE',
  metaStatus: 'ACTIVE',
  hasActiveAdset: true,
  adLevelCollected: false,
  hasActiveAd: false,
  metrics: { spend: metric(100) },
  classifiedObjective: 'LEADS',
  scopeStatus: 'included',
  run: freshRun,
};

describe('evaluateCampaignEligibility', () => {
  it('returns ANALYZABLE when every check passes', () => {
    const result = evaluateCampaignEligibility(baseInput);
    expect(result?.verdict).toBe('ANALYZABLE');
  });

  it('returns NOT_OPERATIONAL for excluded scope regardless of other facts', () => {
    const result = evaluateCampaignEligibility({
      ...baseInput,
      scopeStatus: 'excluded',
      hasActiveAdset: false,
      metrics: {},
      run: null,
    });
    expect(result?.verdict).toBe('NOT_OPERATIONAL');
  });

  it('returns NOT_OPERATIONAL for archived scope', () => {
    const result = evaluateCampaignEligibility({ ...baseInput, scopeStatus: 'archived' });
    expect(result?.verdict).toBe('NOT_OPERATIONAL');
  });

  it('returns STALE_SNAPSHOT only when there is no usable run at all, not merely an old one', () => {
    const noRun = evaluateCampaignEligibility({ ...baseInput, run: null });
    expect(noRun?.verdict).toBe('STALE_SNAPSHOT');

    const oldButPresentRun = evaluateCampaignEligibility({
      ...baseInput,
      run: { finishedAt: new Date(Date.now() - STALE_SNAPSHOT_THRESHOLD_MS * 10).toISOString(), status: 'success' },
    });
    expect(oldButPresentRun?.verdict).toBe('ANALYZABLE');
    expect(oldButPresentRun?.isStale).toBe(true);
  });

  it('returns ACTIVE_WITHOUT_ACTIVE_STRUCTURE when there is no active adset', () => {
    const result = evaluateCampaignEligibility({ ...baseInput, hasActiveAdset: false });
    expect(result?.verdict).toBe('ACTIVE_WITHOUT_ACTIVE_STRUCTURE');
  });

  it('returns ACTIVE_WITHOUT_ACTIVE_STRUCTURE when ad level was collected but no ad is active', () => {
    const result = evaluateCampaignEligibility({
      ...baseInput,
      adLevelCollected: true,
      hasActiveAd: false,
    });
    expect(result?.verdict).toBe('ACTIVE_WITHOUT_ACTIVE_STRUCTURE');
  });

  it('does not penalize a campaign when ad level was never collected', () => {
    const result = evaluateCampaignEligibility({
      ...baseInput,
      adLevelCollected: false,
      hasActiveAd: false,
    });
    expect(result?.verdict).toBe('ANALYZABLE');
  });

  it('returns ACTIVE_NO_DELIVERY when no real metric is positive', () => {
    const result = evaluateCampaignEligibility({ ...baseInput, metrics: { spend: metric(0) } });
    expect(result?.verdict).toBe('ACTIVE_NO_DELIVERY');
  });

  it('returns ACTIVE_NO_DELIVERY when metrics are unavailable', () => {
    const result = evaluateCampaignEligibility({
      ...baseInput,
      metrics: { spend: metric(100, false) },
    });
    expect(result?.verdict).toBe('ACTIVE_NO_DELIVERY');
  });

  it('treats any of the real metric ids as sufficient for delivery', () => {
    const result = evaluateCampaignEligibility({
      ...baseInput,
      metrics: { spend: metric(0), leads: metric(3) },
    });
    expect(result?.verdict).toBe('ANALYZABLE');
  });

  it('returns PAUSED_WITH_SPEND when not active but spend is positive', () => {
    const result = evaluateCampaignEligibility({
      ...baseInput,
      effectiveStatus: 'PAUSED',
      metaStatus: 'PAUSED',
      metrics: { spend: metric(200) },
    });
    expect(result?.verdict).toBe('PAUSED_WITH_SPEND');
  });

  it('returns null for paused campaigns with zero spend (stays invisible)', () => {
    const result = evaluateCampaignEligibility({
      ...baseInput,
      effectiveStatus: 'PAUSED',
      metaStatus: 'PAUSED',
      metrics: { spend: metric(0) },
    });
    expect(result).toBeNull();
  });

  it('returns UNCLASSIFIED_DESTINATION when objective is UNCLASSIFIED', () => {
    const result = evaluateCampaignEligibility({ ...baseInput, classifiedObjective: 'UNCLASSIFIED' });
    expect(result?.verdict).toBe('UNCLASSIFIED_DESTINATION');
  });

  it('returns UNCLASSIFIED_DESTINATION when objective is null', () => {
    const result = evaluateCampaignEligibility({ ...baseInput, classifiedObjective: null });
    expect(result?.verdict).toBe('UNCLASSIFIED_DESTINATION');
  });

  it('prioritizes structure/delivery failures over an unclassified objective', () => {
    const result = evaluateCampaignEligibility({
      ...baseInput,
      classifiedObjective: null,
      hasActiveAdset: false,
    });
    expect(result?.verdict).toBe('ACTIVE_WITHOUT_ACTIVE_STRUCTURE');
  });
});

describe('isRunStale', () => {
  it('is false when there is no run', () => {
    expect(isRunStale(null)).toBe(false);
  });

  it('is false just under the 24h threshold', () => {
    const run = { finishedAt: new Date(Date.now() - (STALE_SNAPSHOT_THRESHOLD_MS - 60_000)).toISOString(), status: 'success' };
    expect(isRunStale(run)).toBe(false);
  });

  it('is true just over the 24h threshold', () => {
    const run = { finishedAt: new Date(Date.now() - (STALE_SNAPSHOT_THRESHOLD_MS + 60_000)).toISOString(), status: 'success' };
    expect(isRunStale(run)).toBe(true);
  });
});
