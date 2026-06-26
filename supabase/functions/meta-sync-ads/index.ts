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

    const authHeader = req.headers.get('Authorization')!
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token)
    
    const userId = user?.id || 'gustavo-camply' 

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
    
    // Fetch Insights for each Campaign
    const campaignsWithInsights = await Promise.all(activeCampaigns.map(async (campaign: any) => {
      try {
        const insightsData = await fetchMetaGraph({
          endpoint: `/${campaign.id}/insights`,
          accessToken,
          appSecret,
          params: {
            fields: 'impressions,clicks,spend,cpc,cpa,actions',
            date_preset: 'maximum' 
          }
        });
        
        return {
          ...campaign,
          insights: insightsData.data && insightsData.data.length > 0 ? insightsData.data[0] : null
        };
      } catch (err) {
        console.warn(`Failed to fetch insights for campaign ${campaign.id}:`, err.message);
        return {
          ...campaign,
          insights: null
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
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
