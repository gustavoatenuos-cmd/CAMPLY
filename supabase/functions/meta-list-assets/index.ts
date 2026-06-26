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

    // Authenticate user
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

    // Fetch Ad Accounts
    const adAccountsData = await fetchMetaGraph({
      endpoint: '/me/adaccounts',
      accessToken,
      appSecret,
      params: { fields: 'id,name,account_status,currency,timezone_name' }
    });

    // Fetch Pages
    const pagesData = await fetchMetaGraph({
      endpoint: '/me/accounts',
      accessToken,
      appSecret,
      params: { fields: 'id,name,access_token,category' } // access_token here is page token (we could encrypt and save it if needed, but for MVP we just store json)
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
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
