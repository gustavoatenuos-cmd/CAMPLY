import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { encryptToken } from '../_shared/crypto.ts'
import { META_BASE_URL } from '../_shared/meta-api.ts'
import { errorResponse, HttpError } from '../_shared/auth.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code || !state) {
      throw new HttpError('Code or State missing in URL parameters', 400);
    }

    // 1. Hash the incoming state
    const msgUint8 = new TextEncoder().encode(state);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const stateHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    
    console.log('Incoming state:', state);
    console.log('Generated hash:', stateHash);

    // 2. Consume via Atomic RPC
    const { data: stateData, error: stateError } = await supabaseClient
      .rpc('consume_meta_oauth_state', { p_state_hash: stateHash })
      .single();

    if (stateError || !stateData) {
      console.log('RPC Error:', stateError);
      throw new HttpError('Invalid, expired, or already used state parameter', 400);
    }

    // 2. Exchange code for user access token
    const appId = Deno.env.get('META_APP_ID');
    const appSecret = Deno.env.get('META_APP_SECRET');
    
    if (!appId || !appSecret) throw new Error('Meta credentials missing from env');

    const tokenUrl = new URL(`${META_BASE_URL}/oauth/access_token`);
    tokenUrl.searchParams.append('client_id', appId);
    tokenUrl.searchParams.append('redirect_uri', stateData.redirect_uri);
    tokenUrl.searchParams.append('client_secret', appSecret);
    tokenUrl.searchParams.append('code', code);

    const tokenRes = await fetch(tokenUrl.toString());
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      throw new HttpError('Meta token exchange failed', 502);
    }

    let accessToken = tokenData.access_token;

    // 3. Exchange short-lived token for long-lived token
    const longTokenUrl = new URL(`${META_BASE_URL}/oauth/access_token`);
    longTokenUrl.searchParams.append('grant_type', 'fb_exchange_token');
    longTokenUrl.searchParams.append('client_id', appId);
    longTokenUrl.searchParams.append('client_secret', appSecret);
    longTokenUrl.searchParams.append('fb_exchange_token', accessToken);

    const longTokenRes = await fetch(longTokenUrl.toString());
    const longTokenData = await longTokenRes.json();

    if (longTokenRes.ok && longTokenData.access_token) {
      accessToken = longTokenData.access_token;
    }
    const expiresIn = longTokenData.expires_in || tokenData.expires_in;
    const tokenExpiresAt = expiresIn
      ? new Date(Date.now() + Number(expiresIn) * 1000).toISOString()
      : null;

    // 4. Fetch user profile
    const meUrl = new URL(`${META_BASE_URL}/me`);
    meUrl.searchParams.append('access_token', accessToken);
    
    const meRes = await fetch(meUrl.toString());
    const meData = await meRes.json();

    if (!meRes.ok) throw new HttpError('Failed to fetch Meta user profile', 502);

    // 5. Encrypt token
    const encryptedToken = await encryptToken(accessToken);

    // 6. Save or Update Integration
    const { data: existingInt, error: searchError } = await supabaseClient
      .from('meta_integrations')
      .select('id')
      .eq('user_id', stateData.user_id)
      .eq('meta_user_id', meData.id)
      .maybeSingle();

    if (existingInt) {
      await supabaseClient
        .from('meta_integrations')
        .update({
          access_token_encrypted: encryptedToken,
          meta_user_name: meData.name,
          granted_scopes: stateData.scopes,
          token_expires_at: tokenExpiresAt,
          status: 'active',
          last_validated_at: new Date().toISOString(),
        })
        .eq('id', existingInt.id);
    } else {
      await supabaseClient
        .from('meta_integrations')
        .insert({
          user_id: stateData.user_id,
          meta_user_id: meData.id,
          meta_user_name: meData.name,
          access_token_encrypted: encryptedToken,
          granted_scopes: stateData.scopes,
          token_expires_at: tokenExpiresAt,
          status: 'active',
          last_validated_at: new Date().toISOString(),
        });
    }

    // 7. Redirect back to frontend
    const appBaseUrl = Deno.env.get('APP_BASE_URL');
    if (!appBaseUrl) throw new Error('APP_BASE_URL missing');
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: `${appBaseUrl}?meta_sync=success`
      },
    })

  } catch (error) {
    return errorResponse(error, corsHeaders, null, 'META_OAUTH_FAILED');
  }
})
