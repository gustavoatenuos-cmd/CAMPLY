import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { corsHeaders } from '../_shared/cors.ts'
import { errorResponse, requireAuthenticatedUser } from '../_shared/auth.ts'
import { decryptToken } from '../_shared/crypto.ts'
import { fetchMetaGraphPaginated, META_BASE_URL, generateAppSecretProof } from '../_shared/meta-api.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { classifyCampaignObjective, classifyAdSetObjective } from '../_shared/meta/campaignObjectiveClassifier.ts'
import { normalizeMetaMetrics } from '../_shared/meta/metaNormalizer.ts'
import { getStructuralMixedAttribution, getEffectiveMixedAttribution } from '../_shared/meta/mixedAttributionDetector.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const runId = crypto.randomUUID();
  let syncStatus = 'success';
  let isPartialSync = false;
  let errorMessage = '';
  let completenessByPeriod: Record<string, any> = {};
  let failedAdsetIds: string[] = [];

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

    const usedRunId = syncRunId || runId;

    const accessToken = await decryptToken(integration.access_token_encrypted)
    const appSecret = Deno.env.get('META_APP_SECRET')!

    await supabaseClient.from('meta_sync_runs').insert({
      id: usedRunId,
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

    if (campaignsRes.isPartial) {
       isPartialSync = true;
       errorMessage += 'Campaign fetch was partial. ';
    }
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
    
    if (adSetsRes.isPartial) {
       isPartialSync = true;
       errorMessage += 'AdSet fetch was partial. ';
    }
    const activeAdSets = adSetsRes.data || [];

    // Identify structural mixed campaigns
    const structuralMixedCampaignIds = new Set<string>();
    
    for (const campaign of activeCampaigns) {
      const campaignAdSets = activeAdSets.filter((a: any) => a.campaign_id === campaign.id);
      if (getStructuralMixedAttribution(campaignAdSets, campaign.objective)) {
        structuralMixedCampaignIds.add(campaign.id);
      }
    }

    // 3. Fetch Insights (Dual Strategy)
    const insightsCampaignByPeriod: Record<string, any[]> = {};
    const insightsAdSetByPeriod: Record<string, any[]> = {};

    for (const preset of periods) {
      completenessByPeriod[preset] = 'complete';

      // Campaign Level
      const campRes = await fetchMetaGraphPaginated({
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
      
      if (campRes.isPartial) {
         isPartialSync = true;
         errorMessage += `Campaign Insights fetch for ${preset} was partial. `;
         completenessByPeriod[preset] = 'partial_page';
      }
      insightsCampaignByPeriod[preset] = campRes.data || [];
      
      if (campRes.data.length > 0) {
        await supabaseClient.from('meta_raw_snapshots').insert({
          user_id: userId,
          sync_run_id: usedRunId,
          ad_account_id: adAccountId,
          entity_level: 'campaign',
          entity_id: preset,
          endpoint: `/${adAccountId}/insights?level=campaign&date_preset=${preset}`,
          payload: campRes.data
        });
      }

      // AdSet Level (only if needed)
      if (structuralMixedCampaignIds.size > 0) {
        // We could filter by campaign_id, but it's simpler to fetch all active adsets insights
        const adsetRes = await fetchMetaGraphPaginated({
          endpoint: `/${adAccountId}/insights`,
          accessToken,
          appSecret,
          params: {
            level: 'adset',
            fields: 'adset_id,campaign_id,impressions,reach,clicks,spend,cpc,actions,action_values,ctr,cost_per_action_type,purchase_roas,outbound_clicks',
            date_preset: preset,
            limit: '100'
          }
        });
        
        if (adsetRes.isPartial) {
           isPartialSync = true;
           errorMessage += `AdSet Insights fetch for ${preset} was partial. `;
           completenessByPeriod[preset] = 'partial_page';
        }
        
        // Filter locally
        const filteredAdSetInsights = (adsetRes.data || []).filter((r: any) => structuralMixedCampaignIds.has(r.campaign_id));
        insightsAdSetByPeriod[preset] = filteredAdSetInsights;

        if (filteredAdSetInsights.length > 0) {
          await supabaseClient.from('meta_raw_snapshots').insert({
            user_id: userId,
            sync_run_id: usedRunId,
            ad_account_id: adAccountId,
            entity_level: 'adset',
            entity_id: preset,
            endpoint: `/${adAccountId}/insights?level=adset&date_preset=${preset}`,
            payload: filteredAdSetInsights
          });
        }
      } else {
        insightsAdSetByPeriod[preset] = [];
      }
    }

    const campaignsWithInsights = [];
    
    for (const campaign of activeCampaigns) {
      const campaignAdSets = activeAdSets.filter((a: any) => a.campaign_id === campaign.id);
      
      const classifiedAdsets = [];
      for (const adset of campaignAdSets) {
        const cObj = classifyAdSetObjective({
           campaignObjective: campaign.objective,
           adsetOptimizationGoal: adset.optimization_goal,
           adsetDestinationType: adset.destination_type,
           adsetPromotedObject: adset.promoted_object
        });
        
        classifiedAdsets.push({ ...adset, classified_objective: cObj });

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
        }, { onConflict: 'user_id, ad_account_id, adset_id' });
      }

      const contexts = classifiedAdsets.map(a => ({
        campaignObjective: campaign.objective,
        adsetOptimizationGoal: a.optimization_goal,
        adsetDestinationType: a.destination_type,
        adsetPromotedObject: a.promoted_object
      }));
      
      const campaignClassifiedObjective = classifyCampaignObjective(contexts);

      await supabaseClient.from('meta_campaign_entities').upsert({
        user_id: userId,
        ad_account_id: adAccountId,
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        raw_objective: campaign.objective,
        classified_objective: campaignClassifiedObjective,
        meta_status: campaign.status,
        effective_status: campaign.effective_status,
        last_synced_at: new Date().toISOString()
      }, { onConflict: 'user_id, ad_account_id, campaign_id' });

      const isStructuralMixed = structuralMixedCampaignIds.has(campaign.id);
      
      let isEffectiveMixed = false;
      const globalMetricsByPeriod: Record<string, any> = {};
      const attributionGroupsByPeriod: Record<string, any[]> = {};
      
      for (const preset of periods) {
        const campInsight = insightsCampaignByPeriod[preset].find((r: any) => r.campaign_id === campaign.id);
        const adsetInsights = insightsAdSetByPeriod[preset].filter((r: any) => r.campaign_id === campaign.id);
        
        // Effective Mixed Check
        if (isStructuralMixed && getEffectiveMixedAttribution(classifiedAdsets, adsetInsights)) {
           isEffectiveMixed = true;
        }

        if (campInsight) {
           const normalizedCamp = normalizeMetaMetrics([campInsight], campaignClassifiedObjective, campaign.id);
           
           globalMetricsByPeriod[preset] = {
              reach: normalizedCamp.reach || 0,
              impressions: normalizedCamp.impressions || 0,
              frequency: normalizedCamp.frequency || 0,
              spend: normalizedCamp.spend || 0
           };
           
           if (!isEffectiveMixed) {
              // Not mixed, use campaign level for everything
              for (const [metricId, mResult] of Object.entries(normalizedCamp)) {
                 await supabaseClient.from('meta_normalized_metrics').upsert({
                   user_id: userId,
                   sync_run_id: usedRunId,
                   ad_account_id: adAccountId,
                   campaign_id: campaign.id,
                   adset_id: 'N/A',
                   metric_id: metricId,
                   metric_value: mResult.value,
                   action_type: mResult.metadata?.action_type || 'N/A',
                   source_field: 'N/A',
                   date_start: campInsight.date_start,
                   date_stop: campInsight.date_stop,
                   timezone: 'America/Sao_Paulo',
                   attribution_setting: classifiedAdsets[0]?.attribution_setting || 'UNKNOWN',
                   source_level: 'campaign',
                   completeness_status: 'complete',
                   calculation_metadata: mResult.metadata
                 }, { onConflict: 'user_id,sync_run_id,ad_account_id,campaign_id,adset_id,metric_id,date_start,date_stop,attribution_setting,source_level' });
              }
              
              // Map back to flat values for the frontend
              const flatCampMetrics: Record<string, number> = {};
              for (const [k, v] of Object.entries(normalizedCamp)) flatCampMetrics[k] = v.value;

              attributionGroupsByPeriod[preset] = [{
                 attributionSetting: classifiedAdsets[0]?.attribution_setting || 'UNKNOWN',
                 classifiedObjective: campaignClassifiedObjective,
                 adsetIds: classifiedAdsets.map(a => a.id),
                 metrics: flatCampMetrics,
                 sourceLevel: 'campaign',
                 dateStart: campInsight.date_start,
                 dateStop: campInsight.date_stop,
                 timezone: 'America/Sao_Paulo',
                 completeness: 'complete'
              }];
           } else {
              // It is mixed! We use AdSet level.
              // We do not save conversions at campaign level to avoid duplication.
              
              const groups: Record<string, { metrics: any[], adsetIds: string[], classifiedObjective: string }> = {};
              
              for (const adsetInsight of adsetInsights) {
                 const adsetDef = classifiedAdsets.find(a => a.id === adsetInsight.adset_id);
                 if (!adsetDef) continue;
                 
                 const adsetAttr = adsetDef.attribution_setting || 'UNKNOWN';
                 const adsetObj = adsetDef.classified_objective;
                 
                 const normalizedAdset = normalizeMetaMetrics([adsetInsight], adsetObj, campaign.id, adsetDef.id);
                 
                 const flatAdsetMetrics: Record<string, number> = {};
                 for (const [k, v] of Object.entries(normalizedAdset)) flatAdsetMetrics[k] = v.value;

                 const groupKey = `${adsetAttr}_${adsetObj}`;
                 if (!groups[groupKey]) {
                    groups[groupKey] = { metrics: [], adsetIds: [], classifiedObjective: adsetObj };
                 }
                 
                 groups[groupKey].metrics.push(flatAdsetMetrics);
                 groups[groupKey].adsetIds.push(adsetDef.id);
                 
                 for (const [metricId, mResult] of Object.entries(normalizedAdset)) {
                    await supabaseClient.from('meta_normalized_metrics').upsert({
                      user_id: userId,
                      sync_run_id: usedRunId,
                      ad_account_id: adAccountId,
                      campaign_id: campaign.id,
                      adset_id: adsetDef.id,
                      metric_id: metricId,
                      metric_value: mResult.value,
                      action_type: mResult.metadata?.action_type || 'N/A',
                      source_field: 'N/A',
                      date_start: adsetInsight.date_start,
                      date_stop: adsetInsight.date_stop,
                      timezone: 'America/Sao_Paulo',
                      attribution_setting: adsetAttr,
                      source_level: 'adset',
                      completeness_status: 'complete',
                      calculation_metadata: mResult.metadata
                    }, { onConflict: 'user_id,sync_run_id,ad_account_id,campaign_id,adset_id,metric_id,date_start,date_stop,attribution_setting,source_level' });
                 }
              }
              
              const finalGroups = [];
              for (const [key, data] of Object.entries(groups)) {
                 const attr = key.split('_')[0];
                 const obj = data.classifiedObjective;
                 
                 // Aggregate metrics for this group (this is safe because they share attribution and objective)
                 const aggregatedMetrics: Record<string, number> = {};
                 for (const m of data.metrics) {
                    for (const [mId, mVal] of Object.entries(m)) {
                       if (!aggregatedMetrics[mId]) aggregatedMetrics[mId] = 0;
                       aggregatedMetrics[mId] += (mVal as number);
                    }
                 }
                 
                 finalGroups.push({
                    attributionSetting: attr,
                    classifiedObjective: obj,
                    adsetIds: data.adsetIds,
                    metrics: aggregatedMetrics, // grouped sum
                    sourceLevel: 'adset',
                    dateStart: campInsight.date_start,
                    dateStop: campInsight.date_stop,
                    timezone: 'America/Sao_Paulo',
                    completeness: 'complete'
                 });
              }
              
              attributionGroupsByPeriod[preset] = finalGroups;
           }
        }
      }

      campaignsWithInsights.push({
        ...campaign,
        classifiedAdsets,
        classifiedObjective: campaignClassifiedObjective,
        mixedAttribution: isEffectiveMixed,
        mixedObjective: campaignClassifiedObjective === 'MIXED',
        globalMetricsByPeriod,
        attributionGroupsByPeriod,
        completenessByPeriod,
        trendAvailable: true,
        trendUnavailableReason: null
      });
    }

    syncStatus = isPartialSync ? 'partial' : 'success';

    await supabaseClient.from('meta_sync_runs').update({
       status: syncStatus,
       finished_at: new Date().toISOString(),
       records_fetched: activeCampaigns.length,
       metadata: { error_message: errorMessage, failed_adsets: failedAdsetIds }
    }).eq('id', usedRunId);
    
    return new Response(JSON.stringify({ 
      success: true, 
      status: syncStatus,
      runId: usedRunId, 
      campaigns: campaignsWithInsights,
      message: errorMessage,
      completenessByPeriod,
      failedAdsetIds
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error: any) {
    console.error('Meta Sync Error:', error)
    
    const { user, adminClient: supabaseClient } = await requireAuthenticatedUser(req).catch(() => ({ user: null, adminClient: null }));
    if (supabaseClient) {
      await supabaseClient.from('meta_sync_runs').update({
         status: 'failed',
         finished_at: new Date().toISOString(),
         metadata: { error_message: error.message }
      }).eq('id', runId);
    }
    
    return errorResponse(error, corsHeaders)
  }
})
