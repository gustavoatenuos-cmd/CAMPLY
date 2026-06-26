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

    // Fetch Active Ads
    const adsData = await fetchMetaGraph({
      endpoint: `/${adAccountId}/ads`,
      accessToken,
      appSecret,
      params: { 
        fields: 'id,name,status,creative',
        filtering: JSON.stringify([{ field: 'status', operator: 'IN', value: ['ACTIVE'] }]),
        limit: '50'
      }
    });

    const activeAds = adsData.data || [];
    
    // Fetch Insights for each Ad
    // Optimization: Depending on volume, this could be batched, but for simplicity we fetch sequentially or in small parallel batches.
    const adsWithInsights = await Promise.all(activeAds.map(async (ad: any) => {
      try {
        const insightsData = await fetchMetaGraph({
          endpoint: `/${ad.id}/insights`,
          accessToken,
          appSecret,
          params: {
            fields: 'impressions,clicks,spend,ctr,cpc',
            date_preset: 'maximum' // Or last_30d, today, etc based on CRM needs
          }
        });
        
        return {
          ...ad,
          insights: insightsData.data && insightsData.data.length > 0 ? insightsData.data[0] : null
        };
      } catch (err) {
        console.warn(`Failed to fetch insights for ad ${ad.id}:`, err.message);
        return {
          ...ad,
          insights: null
        };
      }
    }));

    // Log sync
    await supabaseClient.from('meta_sync_logs').insert({
      integration_id: integration.id,
      sync_type: 'ads_and_insights',
      endpoint: `/${adAccountId}/ads`,
      status: 'success',
      metadata: { ads_count: adsWithInsights.length }
    });

    return new Response(JSON.stringify({ success: true, ads: adsWithInsights }), {
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
