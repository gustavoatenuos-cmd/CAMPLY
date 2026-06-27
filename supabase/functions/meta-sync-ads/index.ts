import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { corsHeaders } from '../_shared/cors.ts'
import { errorResponse, requireAuthenticatedUser } from '../_shared/auth.ts'
import { decryptToken } from '../_shared/crypto.ts'
import { fetchMetaGraphPaginated, META_BASE_URL, generateAppSecretProof } from '../_shared/meta-api.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { classifyCampaignObjective } from '../_shared/meta/campaignObjectiveClassifier.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { user, adminClient: supabaseClient } = await requireAuthenticatedUser(req)
    const userId = user.id

    const { data: integration, error: intError } = await supabaseClient
      .from('meta_integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single()

    if (intError || !integration) throw new Error('No active Meta integration found')

    const { adAccountId, syncRunId, periods = ['last_7d'] } = await req.json();
    if (!adAccountId) throw new Error('adAccountId is required');

    const accessToken = await decryptToken(integration.access_token_encrypted)
    const appSecret = Deno.env.get('META_APP_SECRET')!

    const runId = syncRunId || crypto.randomUUID();
    
    // Create Sync Run Record
    await supabaseClient.from('meta_sync_runs').insert({
      id: runId,
      user_id: userId,
      integration_id: integration.id,
      ad_account_id: adAccountId,
      graph_api_version: 'v25.0',
      requested_period: periods.join(','),
      status: 'running'
    });

    // 1. Fetch Campaigns
    const campaignsRes = await fetchMetaGraphPaginated({
      endpoint: `/${adAccountId}/campaigns`,
      accessToken,
      appSecret,
      params: { 
        fields: 'id,name,status,objective,daily_budget,lifetime_budget,effective_status',
        filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]),
        limit: '100'
      }
    });

    const activeCampaigns = campaignsRes.data || [];

    // 2. Fetch Ad Sets
    const adSetsRes = await fetchMetaGraphPaginated({
      endpoint: `/${adAccountId}/adsets`,
      accessToken,
      appSecret,
      params: {
        fields: 'id,campaign_id,name,status,effective_status,optimization_goal,destination_type,promoted_object,attribution_setting',
        filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]),
        limit: '100'
      }
    });
    
    const activeAdSets = adSetsRes.data || [];

    // 3. Fetch Insights
    // NOTE: This can be optimized by fetching at ad_account level with breakdowns, but since attribution 
    // settings might differ, fetching at campaign level is what we had. We will continue fetching at 
    // campaign level for simplicity and correctness of action attribution.
    const insightsByPeriod: Record<string, any[]> = {};
    for (const preset of periods) {
      const insightsRes = await fetchMetaGraphPaginated({
        endpoint: `/${adAccountId}/insights`,
        accessToken,
        appSecret,
        params: {
          level: 'campaign',
          fields: 'campaign_id,impressions,reach,clicks,spend,cpc,actions,action_values,ctr,cost_per_action_type,purchase_roas,outbound_clicks',
          date_preset: preset,
          limit: '100'
        }
      });
      insightsByPeriod[preset] = insightsRes.data || [];
      
      // Save Snapshot for Insights
      if (insightsRes.data.length > 0) {
        await supabaseClient.from('meta_raw_snapshots').insert({
          user_id: userId,
          sync_run_id: runId,
          ad_account_id: adAccountId,
          entity_level: 'account_period',
          entity_id: preset,
          endpoint: `/${adAccountId}/insights?date_preset=${preset}`,
          payload: insightsRes.data
        });
      }
    }

    const campaignsWithInsights = [];
    
    for (const campaign of activeCampaigns) {
      const campaignAdSets = activeAdSets.filter(a => a.campaign_id === campaign.id);
      
      // Upsert Campaign Entity
      await supabaseClient.from('meta_campaign_entities').upsert({
        user_id: userId,
        ad_account_id: adAccountId,
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        raw_objective: campaign.objective,
        meta_status: campaign.status,
        effective_status: campaign.effective_status,
        last_synced_at: new Date().toISOString()
      }, { onConflict: 'ad_account_id, campaign_id' });

      // Upsert AdSet Entities and classify
      const classifiedAdsets = [];
      for (const adset of campaignAdSets) {
        await supabaseClient.from('meta_adset_entities').upsert({
          user_id: userId,
          ad_account_id: adAccountId,
          campaign_id: campaign.id,
          adset_id: adset.id,
          adset_name: adset.name,
          optimization_goal: adset.optimization_goal,
          destination_type: adset.destination_type,
          promoted_object: adset.promoted_object,
          attribution_setting: adset.attribution_setting,
          meta_status: adset.status,
          effective_status: adset.effective_status
        }, { onConflict: 'ad_account_id, adset_id' });
        
        const cObj = classifyCampaignObjective({
           campaignObjective: campaign.objective,
           adsetOptimizationGoal: adset.optimization_goal,
           adsetDestinationType: adset.destination_type,
           adsetPromotedObject: adset.promoted_object
        });
        
        classifiedAdsets.push({ ...adset, classified_objective: cObj });
      }

      const campaignInsights: Record<string, any> = {};
      for (const preset of periods) {
        const row = insightsByPeriod[preset].find((r: any) => r.campaign_id === campaign.id);
        campaignInsights[preset] = row || null;
      }

      campaignsWithInsights.push({
        ...campaign,
        classifiedAdsets,
        insightsByPeriod: campaignInsights
      });
    }

    // Update Sync Run to Success
    await supabaseClient.from('meta_sync_runs').update({
       status: 'success',
       finished_at: new Date().toISOString(),
       records_fetched: activeCampaigns.length
    }).eq('id', runId);
    
    // Also log to the legacy meta_sync_logs to not break other views immediately
    await supabaseClient.from('meta_sync_logs').insert({
      integration_id: integration.id,
      sync_type: 'campaigns_and_insights',
      endpoint: `/${adAccountId}/campaigns`,
      status: 'success',
      metadata: { runId, campaigns_count: campaignsWithInsights.length }
    });

    return new Response(JSON.stringify({ success: true, runId, campaigns: campaignsWithInsights }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error('Meta Sync Error:', error)
    return errorResponse(error, corsHeaders)
  }
})
