import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { corsHeaders } from '../_shared/cors.ts'
import { errorResponse, requireAuthenticatedUser } from '../_shared/auth.ts'
import { META_GRAPH_VERSION } from '../_shared/meta-api.ts'

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function signStatePayload(payload: Record<string, unknown>): Promise<string> {
  const secret = Deno.env.get('META_TOKEN_ENCRYPTION_KEY') || Deno.env.get('META_APP_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!secret) throw new Error('OAuth state signing secret missing')

  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)))
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encodedPayload)))
  return `${encodedPayload}.${base64UrlEncode(signature)}`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { user } = await requireAuthenticatedUser(req)
    const userId = user.id

    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const rawState = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');

    const redirectUri = Deno.env.get('META_REDIRECT_URI');
    const appId = Deno.env.get('META_APP_ID');

    if (!appId) throw new Error('META_APP_ID missing');
    if (!redirectUri) throw new Error('META_REDIRECT_URI missing');

    const scopes = ['ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement'];

    const signedState = await signStatePayload({
      user_id: userId,
      redirect_uri: redirectUri,
      scopes,
      nonce: rawState,
      exp: Math.floor(Date.now() / 1000) + (10 * 60),
    })

    // Build Meta OAuth URL
    // Use response_type=code
    const authUrl = new URL(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
    authUrl.searchParams.append('client_id', appId);
    authUrl.searchParams.append('redirect_uri', redirectUri);
    authUrl.searchParams.append('state', signedState);
    authUrl.searchParams.append('scope', scopes.join(','));
    authUrl.searchParams.append('response_type', 'code');

    return new Response(
      JSON.stringify({ url: authUrl.toString() }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    return errorResponse(error, corsHeaders)
  }
})
