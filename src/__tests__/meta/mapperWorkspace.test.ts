import { describe, expect, it } from 'vitest';
import { applyMetaSyncToWorkspace } from '../../lib/meta/applyMetaSyncToWorkspace';
import { mapMetaCampaigns } from '../../lib/meta/metaSyncMapper';
import type { MetaSyncResponse, MetaSyncedCampaign } from '../../lib/meta/metaSyncTypes';
import type { Campaign, CamplyData, Client } from '../../types';

const client: Client = {
  id: 'client-1',
  projectId: 'project-1',
  name: 'Client',
  company: 'Company',
  segment: 'Retail',
  structure: 'Ads',
  hasProject: true,
  contact: 'contact@example.com',
  monthlyFee: 1000,
  managementFeeType: 'recurring',
  dueDay: 10,
  adInvestmentPeriod: 'monthly',
  adInvestmentMeta: 1000,
  adInvestmentGoogle: 0,
  adInvestmentYoutube: 0,
  adInvestmentTikTok: 0,
  status: 'active',
  metaAdAccountId: 'act_1',
};

const syncedCampaign = (overrides: Partial<MetaSyncedCampaign> = {}): MetaSyncedCampaign => ({
  id: 'meta-1',
  name: 'Meta Campaign',
  status: 'ACTIVE',
  effective_status: 'ACTIVE',
  objective: 'OUTCOME_SALES',
  daily_budget: '10000',
  classifiedObjective: 'SALES',
  classifiedAdsets: [],
  structuralMixedAttribution: false,
  mixedAttribution: false,
  mixedAttributionByPeriod: { last_7d: false },
  mixedObjective: false,
  mixedDestination: false,
  globalMetricsByPeriod: {
    last_7d: {
      spend: 55,
      impressions: 1000,
      reach: 800,
      sourceLevel: 'campaign',
      dateStart: '2026-06-01',
      dateStop: '2026-06-07',
      timezone: 'America/New_York',
      currency: 'USD',
    },
  },
  attributionGroupsByPeriod: { last_7d: [] },
  completenessByPeriod: {
    last_7d: {
      status: 'complete',
      sourceLevel: 'campaign',
      missingAdsetIds: [],
      failedAdsetIds: [],
      dateStart: '2026-06-01',
      dateStop: '2026-06-07',
      timezone: 'America/New_York',
      currency: 'USD',
    },
  },
  trendAvailabilityByPeriod: { last_7d: { available: false, reason: 'Previous equivalent period is unavailable' } },
  trendAvailable: false,
  trendUnavailableReason: 'Previous equivalent period is unavailable',
  ...overrides,
});

const response = (status: MetaSyncResponse['status'], campaigns = [syncedCampaign()]): MetaSyncResponse => ({
  success: status === 'success',
  status,
  runId: status === 'partial' ? 'partial-run' : 'complete-run',
  campaigns,
  completenessByPeriod: { last_7d: status === 'partial' ? 'partial_page' : 'complete' },
  failedAdsetIds: status === 'partial' ? ['a2'] : [],
  timezone: 'America/New_York',
  currency: 'USD',
});

const existing: Campaign = {
  id: 'crm-1',
  clientId: client.id,
  name: 'Old name',
  platform: 'Meta Ads',
  status: 'optimize',
  objective: 'SALES',
  budget: 50,
  spent: 40,
  priority: 'high',
  metaCampaignId: 'meta-1',
  lastOptimizedAt: '2026-05-01',
  nextAction: 'Review creative',
  syncRunId: 'previous-complete-run',
  globalMetricsByPeriod: syncedCampaign().globalMetricsByPeriod,
  attributionGroupsByPeriod: syncedCampaign().attributionGroupsByPeriod,
  completenessByPeriod: syncedCampaign().completenessByPeriod,
};

const workspace = (campaigns: Campaign[] = [existing]): CamplyData => ({
  clients: [client],
  campaigns,
  receivables: [],
  projects: [],
  tasks: [],
  activityLogs: [],
  agentRules: [],
  agentAlerts: [],
  agentLogs: [],
});

describe('Meta mapper and workspace application', () => {
  it('does not invent lastOptimizedAt or a nextAction', () => {
    const [mapped] = mapMetaCampaigns(response('success'), client.id);
    expect(mapped.lastOptimizedAt).toBeUndefined();
    expect(mapped.nextAction).toBe('');
    expect(mapped.status).toBe('setup');
    expect(mapped.metaEffectiveStatus).toBe('ACTIVE');
  });

  it('preserves the last complete snapshot when a sync is partial', () => {
    const previousMetrics = existing.globalMetricsByPeriod;
    const next = applyMetaSyncToWorkspace(
      client,
      response('partial', [syncedCampaign({ globalMetricsByPeriod: {
        last_7d: { ...syncedCampaign().globalMetricsByPeriod.last_7d, spend: 999 },
      } })]),
      workspace()
    );
    const campaign = next.campaigns[0];

    expect(campaign.globalMetricsByPeriod).toBe(previousMetrics);
    expect(campaign.syncRunId).toBe('previous-complete-run');
    expect(campaign.partialSyncRunId).toBe('partial-run');
    expect(campaign.lastSyncAttemptRunId).toBe('partial-run');
    expect(campaign.lastSyncStatus).toBe('partial');
  });

  it('marks a campaign discovered only in a partial sync as partial data', () => {
    const next = applyMetaSyncToWorkspace(client, response('partial'), workspace([]));
    expect(next.campaigns[0]).toMatchObject({
      dataIsPartial: true,
      syncRunId: undefined,
      partialSyncRunId: 'partial-run',
      trendAvailable: false,
    });
  });

  it('updates complete metrics while preserving CRM operational fields', () => {
    const next = applyMetaSyncToWorkspace(client, response('success'), workspace());
    const campaign = next.campaigns[0];
    expect(campaign.name).toBe('Meta Campaign');
    expect(campaign.spent).toBe(55);
    expect(campaign.syncRunId).toBe('complete-run');
    expect(campaign.status).toBe('optimize');
    expect(campaign.lastOptimizedAt).toBe('2026-05-01');
    expect(campaign.nextAction).toBe('Review creative');
  });
});
