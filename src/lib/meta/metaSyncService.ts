import { supabase } from '../supabase';
import { Campaign } from '../../types';

export interface SyncResponse {
  campaigns: Campaign[];
  runId: string;
  status: 'success' | 'partial' | 'failed';
  message?: string;
}

export async function syncClientMeta(client: any, existingCampaigns: Campaign[]): Promise<SyncResponse> {
  if (!client.metaAdAccountId || !supabase) throw new Error('Client has no metaAdAccountId');
  
  const { data, error } = await supabase.functions.invoke('meta-sync-ads', {
    body: { adAccountId: client.metaAdAccountId }
  });
  
  if (error) throw new Error(error.message);
  if (!data?.campaigns) throw new Error('No campaigns returned');

  const fetchedCampaigns: Campaign[] = data.campaigns.map((c: any) => {
    return {
      id: c.id, // Will be overridden in applyMetaSyncToWorkspace if it exists
      clientId: client.id,
      name: c.name,
      platform: 'Meta Ads',
      status: 'setup', // Default for new campaigns
      objective: c.objective || c.raw_objective || '',
      budget: Number(c.lifetime_budget || c.daily_budget || 0) / 100, // Legacy compatibility, ideally use normalized metrics
      spent: Number(c.insightsByPeriod?.['last_7d']?.spend || 0), // Base default
      results: 0,
      cpr: 0,
      conversations: 0,
      insights: null,
      priority: 'medium',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString(),
      lastOptimizedAt: '', // Temporary, overridden by applyMetaSyncToWorkspace
      nextAction: '',      // Temporary, overridden by applyMetaSyncToWorkspace
      classifiedObjective: c.classifiedObjective || 'UNCLASSIFIED',
      normalizedMetricsByPeriod: c.normalizedMetricsByPeriod || {},
      metaStatus: c.status || c.meta_status,
      metaEffectiveStatus: c.effective_status,
      metaCampaignId: c.id,
      activeAdSets: c.classifiedAdsets || [],
      syncRunId: data.runId
    } as Campaign;
  });

  return { 
    campaigns: fetchedCampaigns, 
    runId: data.runId, 
    status: data.status,
    message: data.message
  };
}
