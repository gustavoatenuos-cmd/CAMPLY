import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { corsHeaders } from '../_shared/cors.ts'
import { errorResponse, requireAuthenticatedUser } from '../_shared/auth.ts'
import { decryptToken } from '../_shared/crypto.ts'
import { fetchMetaGraph } from '../_shared/meta-api.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { user, adminClient: supabaseClient } = await requireAuthenticatedUser(req)
    const userId = user.id

    // Get active integration
    const { data: integration, error: intError } = await supabaseClient
      .from('meta_integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single()

    if (intError || !integration) throw new Error('No active Meta integration found')

    const { adAccountId } = await req.json();
    if (!adAccountId) throw new Error('adAccountId is required');

    const accessToken = await decryptToken(integration.access_token_encrypted)
    const appSecret = Deno.env.get('META_APP_SECRET')!

    // Fetch Active Campaigns
    const campaignsData = await fetchMetaGraph({
      endpoint: `/${adAccountId}/campaigns`,
      accessToken,
      appSecret,
      params: { 
        fields: 'id,name,status,objective,daily_budget,lifetime_budget',
        filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]),
        limit: '50'
      }
    });

    const activeCampaigns = campaignsData.data || [];
    
    // Fetch Insights and Active Ads for each Campaign Sequentially to avoid rate limits
    const campaignsWithInsights = [];
    for (const campaign of activeCampaigns) {
      try {
        const periods = ['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d', 'maximum'];
        const insightsResults = [];
        
        for (const preset of periods) {
          try {
            const res = await fetchMetaGraph({
              endpoint: `/${campaign.id}/insights`,
              accessToken,
              appSecret,
              params: {
                fields: 'impressions,clicks,spend,cpc,cpa,actions,ctr,cost_per_action_type',
                date_preset: preset 
              }
            });
            insightsResults.push({ preset, data: res.data && res.data.length > 0 ? res.data[0] : null });
          } catch (e: any) {
            console.warn(`Failed insight preset ${preset} for ${campaign.id}:`, e.message);
            insightsResults.push({ preset, data: null });
          }
        }

        const adsData = await fetchMetaGraph({
          endpoint: `/${campaign.id}/ads`,
          accessToken,
          appSecret,
          params: {
            fields: 'id,name,status,adset{id,name,status}',
            filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]),
            limit: '100'
          }
        }).catch((e: any) => {
          console.warn(`Failed ads for ${campaign.id}:`, e.message);
          return { data: [] };
        });
        
        const insightsByPeriod: Record<string, any> = {};
        insightsResults.forEach(res => {
          insightsByPeriod[res.preset] = res.data;
        });
        
        let activeAdSets: any[] = [];
        if (adsData.data && adsData.data.length > 0) {
          const adSetsMap = new Map();
          adsData.data.forEach((ad: any) => {
             const adsetId = ad.adset?.id || 'unknown';
             if (!adSetsMap.has(adsetId)) {
               adSetsMap.set(adsetId, {
                 id: adsetId,
                 name: ad.adset?.name || 'Grupo Desconhecido',
                 status: ad.adset?.status || 'ACTIVE',
                 ads: []
               });
             }
             adSetsMap.get(adsetId).ads.push({
               id: ad.id,
               name: ad.name,
               status: ad.status
             });
          });
          activeAdSets = Array.from(adSetsMap.values());
        }

        campaignsWithInsights.push({
          ...campaign,
          insights: insightsByPeriod['maximum'],
          insightsByPeriod,
          activeAdSets
        });
      } catch (err) {
        console.warn(`Failed to fetch insights/ads for campaign ${campaign.id}:`, err instanceof Error ? err.message : err);
        campaignsWithInsights.push({
          ...campaign,
          insights: null,
          activeAdSets: []
        });
      }
    }

    // Log sync
    await supabaseClient.from('meta_sync_logs').insert({
      integration_id: integration.id,
      sync_type: 'campaigns_and_insights',
      endpoint: `/${adAccountId}/campaigns`,
      status: 'success',
      metadata: { campaigns_count: campaignsWithInsights.length }
    });

    return new Response(JSON.stringify({ success: true, campaigns: campaignsWithInsights }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error('Meta Sync Error:', error)
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') || '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
      )
      // Attempt to log the error to the database if possible
      const reqClone = await req.clone().json().catch(() => ({}));
      if (reqClone.adAccountId) {
        const { data: intg } = await supabase.from('meta_integrations').select('id').eq('status', 'active').single();
        if (intg) {
          await supabase.from('meta_sync_logs').insert({
            integration_id: intg.id,
            sync_type: 'campaigns_and_insights',
            endpoint: `/${reqClone.adAccountId}/campaigns`,
            status: 'error',
            metadata: { error: error instanceof Error ? error.message : String(error) }
          });
        }
      }
    } catch (e) {
      console.error('Failed to write error log:', e);
    }
    return errorResponse(error, corsHeaders)
  }
})
