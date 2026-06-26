import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { fetchMetaGraph } from '../_shared/meta-api.ts'
import { decryptToken } from '../_shared/crypto.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const authHeader = req.headers.get('Authorization')!
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token)
    
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const userId = user.id;

    // Get active integration
    const { data: integration, error: intError } = await supabaseClient
      .from('meta_integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single()

    if (intError || !integration) throw new Error('No active Meta integration found')

    const accessToken = await decryptToken(integration.access_token_encrypted)
    const appSecret = Deno.env.get('META_APP_SECRET')!

    const { targetId, type = 'campaign' } = await req.json(); // targetId can be campaignId or adAccountId

    if (!targetId) throw new Error('targetId is required');

    // Limit to 20 ads per request to avoid overwhelming Claude later and Meta API limits
    const limit = 20;
    
    // Fetch Ads with Creative and Insights
    const fields = 'id,name,status,creative{name,title,body,object_story_spec,thumbnail_url,image_url},insights.date_preset(last_90d){impressions,clicks,spend,cpc,cost_per_action_type,actions,ctr,outbound_clicks}';
    
    const endpoint = `/${targetId}/ads`;

    const adsData = await fetchMetaGraph({
      endpoint,
      accessToken,
      appSecret,
      params: { 
        fields,
        filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] }]),
        limit: limit.toString()
      }
    });

    // Normalize payload to minimize size and remove Meta Graph API cruft
    const normalizedAds = (adsData.data || []).map((ad: any) => {
      const creative = ad.creative?.data?.[0] || {};
      const insight = ad.insights?.data?.[0] || {};

      return {
        id: ad.id,
        name: ad.name,
        status: ad.status,
        creative: {
          title: creative.title || creative.object_story_spec?.link_data?.name || null,
          body: creative.body || creative.object_story_spec?.link_data?.message || null,
          thumbnail_url: creative.thumbnail_url || creative.image_url || null,
        },
        metrics: {
          spend: parseFloat(insight.spend || '0'),
          impressions: parseInt(insight.impressions || '0'),
          clicks: parseInt(insight.clicks || '0'),
          ctr: parseFloat(insight.ctr || '0'),
          cpc: parseFloat(insight.cpc || '0'),
          purchases: insight.actions?.find((a: any) => a.action_type === 'purchase')?.value || '0',
          leads: insight.actions?.find((a: any) => a.action_type === 'lead')?.value || '0',
        }
      };
    });

    return new Response(JSON.stringify({ success: true, ads: normalizedAds }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message, isError: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  }
})
