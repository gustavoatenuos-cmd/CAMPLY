import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from '../_shared/cors.ts'
import { errorResponse, HttpError, requireAuthenticatedUser } from '../_shared/auth.ts'
import { fetchMetaGraph } from '../_shared/meta-api.ts'
import { decryptToken } from '../_shared/crypto.ts'

type CreativeTargetType = 'adaccount' | 'campaign';

export async function handleRequest(req: Request) {
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

    const accessToken = await decryptToken(integration.access_token_encrypted)
    const appSecret = Deno.env.get('META_APP_SECRET')!

    const { targetId, type = 'campaign' } = await req.json() as {
      targetId?: unknown;
      type?: unknown;
    };

    if (typeof targetId !== 'string' || !targetId.trim()) {
      throw new HttpError('targetId is required', 400);
    }
    if (type !== 'campaign' && type !== 'adaccount') {
      throw new HttpError('Invalid creative target type', 400);
    }

    const requestedTargetId = targetId.trim();
    if (!/^[A-Za-z0-9_:-]{1,128}$/.test(requestedTargetId)) {
      throw new HttpError('Invalid creative target identifier', 400);
    }

    let graphTargetId = requestedTargetId;
    const targetType = type as CreativeTargetType;

    if (targetType === 'adaccount') {
      const { data: asset, error: assetError } = await supabaseClient
        .from('meta_assets')
        .select('id,asset_id')
        .eq('integration_id', integration.id)
        .eq('asset_type', 'adaccount')
        .or(`id.eq.${requestedTargetId},asset_id.eq.${requestedTargetId}`)
        .single();

      if (assetError || !asset) {
        throw new HttpError('Conta de anúncio não autorizada para este usuário', 403);
      }
      graphTargetId = asset.asset_id;
    } else {
      const { data: campaign, error: campaignError } = await supabaseClient
        .from('meta_campaign_entities')
        .select('campaign_id')
        .eq('user_id', userId)
        .eq('integration_id', integration.id)
        .eq('campaign_id', requestedTargetId)
        .single();

      if (campaignError || !campaign) {
        throw new HttpError('Campanha não autorizada para este usuário', 403);
      }
      graphTargetId = campaign.campaign_id;
    }

    // Limit to 20 ads per request to avoid overwhelming Claude later and Meta API limits
    const limit = 20;
    
    // Fetch Ads with Creative and Insights
    const fields = 'id,name,status,creative{name,title,body,object_story_spec,thumbnail_url,image_url},insights.date_preset(last_90d){impressions,clicks,spend,cpc,cost_per_action_type,actions,ctr,outbound_clicks}';
    
    const endpoint = `/${graphTargetId}/ads`;

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

  } catch (error) {
    return errorResponse(error, corsHeaders)
  }
}

serve(handleRequest)
