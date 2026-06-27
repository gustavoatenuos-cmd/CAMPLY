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

    // Fetch Campaigns for specific ad account
    const campaignsData = await fetchMetaGraph({
      endpoint: `/${adAccountId}/campaigns`,
      accessToken,
      appSecret,
      params: { 
        fields: 'id,name,status,objective,daily_budget,lifetime_budget,spend_cap',
        limit: '50'
      }
    });

    // Log sync
    await supabaseClient.from('meta_sync_logs').insert({
      integration_id: integration.id,
      sync_type: 'campaigns',
      endpoint: `/${adAccountId}/campaigns`,
      status: 'success',
      metadata: { campaigns_count: campaignsData.data?.length || 0 }
    });

    return new Response(JSON.stringify({ success: true, campaigns: campaignsData.data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    return errorResponse(error, corsHeaders)
  }
})
