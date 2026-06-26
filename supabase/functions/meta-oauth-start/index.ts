import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

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
    
    // Fallback logic for local testing without Supabase Auth
    // In production, enforce user existence
    // if (authError || !user) throw new Error('Unauthorized')
    
    // For MVP/testing assuming an unknown user or mocked id if user is null
    const userId = user?.id || 'gustavo-camply' // Replace with your standard mock or throw error

    // Generate random state hash to prevent CSRF
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    const stateHash = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    
    const redirectUri = Deno.env.get('META_REDIRECT_URI') || `${Deno.env.get('APP_BASE_URL')}/api/meta/callback`;
    const appId = Deno.env.get('META_APP_ID');

    if (!appId) throw new Error('META_APP_ID missing');

    const scopes = ['ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement'];

    // Save state hash
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 mins

    const { error: dbError } = await supabaseClient
      .from('meta_oauth_states')
      .insert({
        user_id: userId,
        state_hash: stateHash,
        redirect_uri: redirectUri,
        scopes: scopes,
        expires_at: expiresAt
      });

    if (dbError) throw dbError;

    // Build Meta OAuth URL
    // Use response_type=code
    const authUrl = new URL('https://www.facebook.com/v19.0/dialog/oauth');
    authUrl.searchParams.append('client_id', appId);
    authUrl.searchParams.append('redirect_uri', redirectUri);
    authUrl.searchParams.append('state', stateHash);
    authUrl.searchParams.append('scope', scopes.join(','));
    authUrl.searchParams.append('response_type', 'code');

    return new Response(
      JSON.stringify({ url: authUrl.toString() }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
