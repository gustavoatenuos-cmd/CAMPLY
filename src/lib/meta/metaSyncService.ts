import { supabase } from '../supabase';
import { Campaign } from '../../types';

export async function syncClientMeta(client: any, existingCampaigns: Campaign[]): Promise<{ campaigns: Campaign[], runId: string, status: string }> {
  if (!client.metaAdAccountId || !supabase) throw new Error('Client has no metaAdAccountId');
  
  const { data, error } = await supabase.functions.invoke('meta-sync-ads', {
    body: { adAccountId: client.metaAdAccountId }
  });
  
  if (error) throw new Error(error.message);
  if (!data?.campaigns) throw new Error('No campaigns returned');

  const fetchedCampaigns: Campaign[] = data.campaigns.map((c: any) => {
    // Preserve legacy operational fields
    const existing = existingCampaigns.find(ec => ec.id === c.id);
    
    return {
      id: c.id,
      name: c.name,
      status: existing?.status || 'review',
      objective: c.objective || c.raw_objective || '',
      dailyBudget: Number(c.daily_budget || 0),
      lifetimeBudget: Number(c.lifetime_budget || 0),
      spend: Number(c.insights?.spend || 0),
      amountSpent: Number(c.insights?.spend || 0),
      results: 0,
      cpr: 0,
      conversations: 0,
      insights: null,
      priority: existing?.priority || 'medium',
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString(),
      lastOptimizedAt: existing?.lastOptimizedAt || undefined, // Preserved, not overwritten
      metricsByPeriod: c.metricsByPeriod || {},
      classifiedObjective: c.classifiedObjective || 'UNCLASSIFIED',
      normalizedMetricsByPeriod: c.normalizedMetricsByPeriod || {},
      metaStatus: c.status || c.meta_status,
      metaEffectiveStatus: c.effective_status
    };
  });

  return { campaigns: fetchedCampaigns, runId: data.runId, status: data.status };
}
