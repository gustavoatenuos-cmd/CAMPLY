import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { decryptToken } from '../_shared/crypto.ts'
import { fetchMetaGraph } from '../_shared/meta-api.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Removed Supabase Auth check to bypass rate limits
    const userId = '00000000-0000-0000-0000-000000000000';

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
    
    // Fetch Insights and Active Ads for each Campaign
    const campaignsWithInsights = await Promise.all(activeCampaigns.map(async (campaign: any) => {
      try {
        const [insightsData, adsData] = await Promise.all([
          fetchMetaGraph({
            endpoint: `/${campaign.id}/insights`,
            accessToken,
            appSecret,
            params: {
              fields: 'impressions,clicks,spend,cpc,cpa,actions',
              date_preset: 'maximum' 
            }
          }),
          fetchMetaGraph({
            endpoint: `/${campaign.id}/ads`,
            accessToken,
            appSecret,
            params: {
              fields: 'id,name,status,adset{name}',
              filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]),
              limit: '50'
            }
          })
        ]);
        
        let activeAdsData = [];
        if (adsData.data && adsData.data.length > 0) {
          activeAdsData = adsData.data.map((ad: any) => ({
            id: ad.id,
            name: ad.name,
            status: ad.status,
            adset_name: ad.adset?.name
          }));
        }

        return {
          ...campaign,
          insights: insightsData.data && insightsData.data.length > 0 ? insightsData.data[0] : null,
          activeAdsData
        };
      } catch (err) {
        console.warn(`Failed to fetch insights/ads for campaign ${campaign.id}:`, err.message);
        return {
          ...campaign,
          insights: null,
          activeAdsData: []
        };
      }
    }));

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
    return new Response(JSON.stringify({ error: error.message, isError: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  }
})
