import { describe, it, expect, vi } from 'vitest';
import { applyMetaSyncToWorkspace } from '../../../src/lib/meta/applyMetaSyncToWorkspace';
import { Campaign, CamplyData } from '../../../src/types';

describe('Advanced Meta Flows: Partial Sync & Mixed Attribution', () => {
  it('should preserve active status for campaigns missing in a partial sync', () => {
    const mockClient = { id: 'client-1', metaAdAccountId: 'act_123' } as any;
    const existingCampaign: Campaign = {
      id: 'camp-old',
      clientId: 'client-1',
      name: 'Existing Campaign',
      platform: 'Meta Ads',
      status: 'live', // Should remain live
      objective: 'SALES',
      budget: 100,
      spent: 50,
      priority: 'high',
      metaCampaignId: 'meta-1',
      metaMissingFromLatestSync: false,
      lastOptimizedAt: '',
      nextAction: ''
    };

    const mockWorkspace: CamplyData = {
      clients: [mockClient],
      projects: [],
      tasks: [],
      receivables: [],
      activityLogs: [],
      campaigns: [existingCampaign],
      agentAlerts: [],
      agentRules: [],
      agentLogs: []
    };

    // Simulate partial sync where existing campaign is missing
    const syncedCampaigns: Campaign[] = [];

    const updatedWorkspace = applyMetaSyncToWorkspace(mockClient, { runId: 'r1', status: 'success', completenessByPeriod: {}, failedAdsetIds: [], campaigns: syncedCampaigns }, mockWorkspace);

    const checkCamp = updatedWorkspace.campaigns.find(c => c.id === 'camp-old');
    expect(checkCamp).toBeDefined();
    expect(checkCamp?.status).toBe('live');
    expect(checkCamp?.metaMissingFromLatestSync).toBe(true); // Flag added
  });

  it('should reset metaMissingFromLatestSync if campaign appears again', () => {
    const mockClient = { id: 'client-1', metaAdAccountId: 'act_123' } as any;
    const existingCampaign: Campaign = {
      id: 'camp-old',
      clientId: 'client-1',
      name: 'Existing Campaign',
      platform: 'Meta Ads',
      status: 'live',
      objective: 'SALES',
      budget: 100,
      spent: 50,
      priority: 'high',
      metaCampaignId: 'meta-1',
      metaMissingFromLatestSync: true, // Initially missing
      lastOptimizedAt: '',
      nextAction: ''
    };

    const mockWorkspace: CamplyData = {
      clients: [mockClient],
      projects: [],
      tasks: [],
      receivables: [],
      activityLogs: [],
      campaigns: [existingCampaign],
      agentAlerts: [],
      agentRules: [],
      agentLogs: []
    };

    const syncedCampaigns: Campaign[] = [
      {
        ...existingCampaign,
        name: 'Existing Campaign - Appeared Again',
        metaMissingFromLatestSync: false // Should be overridden by applyMetaSyncToWorkspace
      } as any
    ];

    const updatedWorkspace = applyMetaSyncToWorkspace(mockClient, { runId: 'r1', status: 'success', completenessByPeriod: {}, failedAdsetIds: [], campaigns: syncedCampaigns }, mockWorkspace);
    
    const checkCamp = updatedWorkspace.campaigns.find(c => c.id === 'camp-old');
    expect(checkCamp).toBeDefined();
    expect(checkCamp?.name).toBe('Existing Campaign - Appeared Again');
    expect(checkCamp?.metaMissingFromLatestSync).toBe(false); // Should be reset to false
  });
});
