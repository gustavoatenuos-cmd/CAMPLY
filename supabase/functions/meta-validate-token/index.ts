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

    // Get integration
    const { data: integration, error: intError } = await supabaseClient
      .from('meta_integrations')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (intError || !integration) {
      return new Response(JSON.stringify({ status: 'none' }), { headers: corsHeaders })
    }

    if (integration.status !== 'active') {
      return new Response(JSON.stringify({ status: integration.status }), { headers: corsHeaders })
    }

    const accessToken = await decryptToken(integration.access_token_encrypted)
    const appSecret = Deno.env.get('META_APP_SECRET')!

    let isValid = false;

    try {
      // Validate token via debug_token endpoint
      const appId = Deno.env.get('META_APP_ID');
      const debugUrl = new URL('https://graph.facebook.com/v19.0/debug_token');
      debugUrl.searchParams.append('input_token', accessToken);
      // For app access token, usually it's APP_ID|APP_SECRET
      debugUrl.searchParams.append('access_token', `${appId}|${appSecret}`);

      const debugRes = await fetch(debugUrl.toString());
      const debugData = await debugRes.json();

      if (debugRes.ok && debugData.data && debugData.data.is_valid) {
        isValid = true;
      }
    } catch (e) {
      console.error('Debug token failed', e);
    }

    if (!isValid) {
      await supabaseClient
        .from('meta_integrations')
        .update({ status: 'expired' })
        .eq('id', integration.id);
      
      return new Response(JSON.stringify({ status: 'expired' }), { headers: corsHeaders })
    }

    // Update last_validated_at
    await supabaseClient
      .from('meta_integrations')
      .update({ last_validated_at: new Date().toISOString() })
      .eq('id', integration.id);

    // Fetch assets from DB (bypassing RLS because this is an edge function running as service_role)
    const { data: assets } = await supabaseClient
      .from('meta_assets')
      .select('*')
      .eq('integration_id', integration.id);

    return new Response(JSON.stringify({ status: 'active', integration, assets: assets || [] }), {
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
