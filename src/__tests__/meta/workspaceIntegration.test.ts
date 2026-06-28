import { describe, it, expect } from 'vitest';
import { applyMetaSyncToWorkspace } from '../../lib/meta/applyMetaSyncToWorkspace';
import { Campaign, CamplyData } from '../../types';

describe('Workspace Compatibility, Operational Status, Idempotency', () => {
  const mockClient = { id: 'c1', name: 'Test Client', metaAdAccountId: 'act_1' };
  
  const existingCampaign: Campaign = {
    id: 'camp_int_1',
    clientId: 'c1',
    name: 'Old Campaign',
    platform: 'Meta Ads',
    status: 'optimize',
    objective: 'Tráfego',
    budget: 100,
    spent: 50,
    metaCampaignId: 'meta_c1',
    activeAdSets: [],
    lastOptimizedAt: '2023-01-01',
    nextAction: 'Scale up',
    priority: 'high',
    createdAt: '2022-12-01',
    updatedAt: '2022-12-01'
  };

  const initialWorkspace: CamplyData = {
    clients: [mockClient as any],
    campaigns: [existingCampaign],
    activityLogs: [],
    agentLogs: [],
    agentAlerts: [],
    projects: [],
    receivables: [],
    tasks: [],
    goals: []
  };

  const fetchedCampaign: Campaign = {
    id: 'temp_meta_c1', // Should be discarded in favor of camp_int_1
    clientId: 'c1',
    name: 'Updated Name by Meta',
    platform: 'Meta Ads',
    status: 'review', // Meta sync tries to set to review, but it's already 'optimize'
    objective: 'Traffic',
    budget: 200,
    spent: 80,
    metaCampaignId: 'meta_c1',
    activeAdSets: [],
    lastOptimizedAt: '', // Sync doesn't know this
    nextAction: '',      // Sync doesn't know this
    priority: 'medium',
    createdAt: '2023-01-01',
  };

  const newCampaign: Campaign = {
    id: 'temp_meta_c2',
    clientId: 'c1',
    name: 'Brand New Meta Campaign',
    platform: 'Meta Ads',
    status: 'review',
    objective: 'Sales',
    budget: 500,
    spent: 0,
    metaCampaignId: 'meta_c2',
    activeAdSets: [],
    lastOptimizedAt: '',
    nextAction: '',
    priority: 'medium',
    createdAt: '2023-01-02',
  };

  it('updates existing campaigns preserving operational status', () => {
    const nextData = applyMetaSyncToWorkspace(mockClient, [fetchedCampaign], initialWorkspace);
    
    expect(nextData.campaigns).toHaveLength(1);
    
    const updated = nextData.campaigns[0];
    // Meta updates
    expect(updated.name).toBe('Updated Name by Meta');
    expect(updated.budget).toBe(200);
    expect(updated.spent).toBe(80);
    
    // CRM Preserves
    expect(updated.id).toBe('camp_int_1');
    expect(updated.status).toBe('optimize'); // Kept original
    expect(updated.lastOptimizedAt).toBe('2023-01-01');
    expect(updated.nextAction).toBe('Scale up');
    expect(updated.priority).toBe('high');
    expect(updated.createdAt).toBe('2022-12-01');
  });

  it('inserts new campaigns from meta', () => {
    const nextData = applyMetaSyncToWorkspace(mockClient, [fetchedCampaign, newCampaign], initialWorkspace);
    expect(nextData.campaigns).toHaveLength(2);
    
    const inserted = nextData.campaigns.find(c => c.metaCampaignId === 'meta_c2');
    expect(inserted).toBeDefined();
    expect(inserted?.id).toBeDefined();
    expect(inserted?.status).toBe('review');
  });

  it('is idempotent when run twice with same fetched campaigns', () => {
    const step1 = applyMetaSyncToWorkspace(mockClient, [fetchedCampaign, newCampaign], initialWorkspace);
    const step2 = applyMetaSyncToWorkspace(mockClient, [fetchedCampaign, newCampaign], step1);
    
    expect(step1.campaigns).toHaveLength(2);
    expect(step2.campaigns).toHaveLength(2);
    
    const camp1Step1 = step1.campaigns.find(c => c.metaCampaignId === 'meta_c1');
    const camp1Step2 = step2.campaigns.find(c => c.metaCampaignId === 'meta_c1');
    expect(camp1Step1?.id).toBe(camp1Step2?.id);
    
    const camp2Step1 = step1.campaigns.find(c => c.metaCampaignId === 'meta_c2');
    const camp2Step2 = step2.campaigns.find(c => c.metaCampaignId === 'meta_c2');
    expect(camp2Step1?.id).toBe(camp2Step2?.id);
  });
  
  it('pauses campaigns that are no longer returned by Meta', () => {
    // We fetched nothing, so camp_int_1 should be paused
    const nextData = applyMetaSyncToWorkspace(mockClient, [], initialWorkspace);
    expect(nextData.campaigns).toHaveLength(1);
    expect(nextData.campaigns[0].status).toBe('paused');
  });
});