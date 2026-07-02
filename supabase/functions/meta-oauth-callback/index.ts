import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { encryptToken } from '../_shared/crypto.ts'
import { META_BASE_URL } from '../_shared/meta-api.ts'
import { errorResponse, HttpError } from '../_shared/auth.ts'

interface MetaOAuthStateData {
  user_id: string;
  redirect_uri: string;
  scopes: string[] | null;
}

function isMetaOAuthStateData(value: unknown): value is MetaOAuthStateData {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state.user_id === 'string' &&
    typeof state.redirect_uri === 'string' &&
    (state.scopes === null || (Array.isArray(state.scopes) && state.scopes.every((scope) => typeof scope === 'string')))
  );
}

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
    
    // Removed logs as requested by security constraints

    // 2. Consume via Atomic RPC
    const { data: stateData, error: stateError } = await supabaseClient
      .rpc('consume_meta_oauth_state', { p_state_hash: stateHash })
      .single();

    if (stateError || !stateData) {
      console.log('RPC Error:', stateError);
      throw new HttpError('Invalid, expired, or already used state parameter', 400);
    }
    if (!isMetaOAuthStateData(stateData)) {
      throw new HttpError('Invalid state payload returned by OAuth state store', 400);
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
    let tokenData;
    try { tokenData = await tokenRes.json(); } catch (e) { tokenData = {}; }

    if (!tokenRes.ok) {
      console.error('Token fetch failed! Status:', tokenRes.status);
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
    let longTokenData;
    try { longTokenData = await longTokenRes.json(); } catch (e) { longTokenData = {}; }

    if (!longTokenRes.ok) {
      console.error('Long token fetch failed! Status:', longTokenRes.status);
      throw new HttpError('Meta long token exchange failed', 502);
    }
    
    if (longTokenData.access_token) {
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
    let meData;
    try { meData = await meRes.json(); } catch (e) { meData = {}; }

    if (!meRes.ok) {
      console.error('User profile fetch failed! Status:', meRes.status);
      throw new HttpError('Failed to fetch Meta user profile', 502);
    }

    // 5. Encrypt token
    const encryptedToken = await encryptToken(accessToken);

    // 6. Save or Update Integration
    const { data: existingInt, error: searchError } = await supabaseClient
      .from('meta_integrations')
      .select('id')
      .eq('user_id', stateData.user_id)
      .eq('meta_user_id', meData.id)
      .maybeSingle();
      
    if (searchError) {
      console.error('Database search error for integration');
      throw new HttpError('Database operation failed', 500);
    }

    if (existingInt) {
      const { error: updateError } = await supabaseClient
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
        
      if (updateError) {
        console.error('Database update error for integration');
        throw new HttpError('Database operation failed', 500);
      }
    } else {
      const { error: insertError } = await supabaseClient
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
        
      if (insertError) {
        console.error('Database insert error for integration');
        throw new HttpError('Database operation failed', 500);
      }
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
