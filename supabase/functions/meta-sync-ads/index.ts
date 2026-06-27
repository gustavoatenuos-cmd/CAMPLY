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

    // 2. Fetch all active ads for the account in one call
    let allAds = [];
    try {
      const adsRes = await fetchMetaGraph({
        endpoint: `/${adAccountId}/ads`,
        accessToken,
        appSecret,
        params: {
          fields: 'campaign_id,id,name,status,adset{id,name,status}',
          filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]),
          limit: '500'
        }
      });
      allAds = adsRes.data || [];
    } catch (e: any) {
      console.warn('Failed to fetch ads for account', e.message);
    }

    // Group ads by campaign
    const adsByCampaign = new Map();
    allAds.forEach((ad: any) => {
      const cid = ad.campaign_id;
      if (!adsByCampaign.has(cid)) adsByCampaign.set(cid, []);
      adsByCampaign.get(cid).push(ad);
    });

    // 3. Fetch insights for all campaigns in 7 calls
    const periods = ['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d', 'maximum'];
    const accountInsightsByPeriod: Record<string, any[]> = {};
    
    for (const preset of periods) {
      try {
        const res = await fetchMetaGraph({
          endpoint: `/${adAccountId}/insights`,
          accessToken,
          appSecret,
          params: {
            level: 'campaign',
            fields: 'campaign_id,impressions,clicks,spend,cpc,actions,ctr,cost_per_action_type',
            date_preset: preset,
            limit: '500'
          }
        });
        accountInsightsByPeriod[preset] = res.data || [];
      } catch (e: any) {
        console.warn(`Failed account insights for ${preset}`, e.message);
        accountInsightsByPeriod[preset] = [];
      }
    }

    // 4. Assemble campaignsWithInsights
    const campaignsWithInsights = [];
    for (const campaign of activeCampaigns) {
      // Build activeAdSets from grouped ads
      const campaignAds = adsByCampaign.get(campaign.id) || [];
      const adSetsMap = new Map();
      campaignAds.forEach((ad: any) => {
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
      const activeAdSets = Array.from(adSetsMap.values());

      // Build insightsByPeriod
      const insightsByPeriod: Record<string, any> = {};
      for (const preset of periods) {
        const row = accountInsightsByPeriod[preset].find((r: any) => r.campaign_id === campaign.id);
        insightsByPeriod[preset] = row || null;
      }

      campaignsWithInsights.push({
        ...campaign,
        insightsByPeriod,
        activeAdSets
      });
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
        const { data: intg } = await supabase.from('integrations').select('id').eq('platform', 'meta').single();
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
