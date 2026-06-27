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

    const accessToken = await decryptToken(integration.access_token_encrypted)
    const appSecret = Deno.env.get('META_APP_SECRET')!

    // Fetch Ad Accounts
    const adAccountsData = await fetchMetaGraph({
      endpoint: '/me/adaccounts',
      accessToken,
      appSecret,
      params: { fields: 'id,name,account_status,currency,timezone_name', limit: '1000' }
    });

    // Fetch Pages
    const pagesData = await fetchMetaGraph({
      endpoint: '/me/accounts',
      accessToken,
      appSecret,
      params: { fields: 'id,name,category', limit: '1000' }
    });

    // Process and upsert into meta_assets
    const assetsToInsert = [];

    if (adAccountsData.data) {
      for (const account of adAccountsData.data) {
        assetsToInsert.push({
          integration_id: integration.id,
          asset_type: 'adaccount',
          asset_id: account.id,
          asset_name: account.name || account.id,
          asset_status: account.account_status?.toString(),
          currency: account.currency,
          timezone_name: account.timezone_name,
          raw_json: account
        });
      }
    }

    if (pagesData.data) {
      for (const page of pagesData.data) {
        assetsToInsert.push({
          integration_id: integration.id,
          asset_type: 'page',
          asset_id: page.id,
          asset_name: page.name,
          raw_json: page
        });
      }
    }

    if (assetsToInsert.length > 0) {
      const { error: upsertError } = await supabaseClient
        .from('meta_assets')
        .upsert(assetsToInsert, { onConflict: 'integration_id,asset_type,asset_id' })
        
      if (upsertError) throw upsertError;
    }

    // Log sync
    await supabaseClient.from('meta_sync_logs').insert({
      integration_id: integration.id,
      sync_type: 'assets',
      endpoint: '/me/adaccounts & /me/accounts',
      status: 'success',
      metadata: { ad_accounts_count: adAccountsData.data?.length || 0, pages_count: pagesData.data?.length || 0 }
    });

    return new Response(JSON.stringify({ success: true, assets: assetsToInsert }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    return errorResponse(error, corsHeaders)
  }
})
