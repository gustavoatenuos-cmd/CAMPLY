import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { corsHeaders } from '../_shared/cors.ts'
import { errorResponse, requireAuthenticatedUser } from '../_shared/auth.ts'
import { META_GRAPH_VERSION } from '../_shared/meta-api.ts'

async function withTimeout<T>(operation: PromiseLike<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)
  })

  try {
    return await Promise.race([Promise.resolve(operation), timeout])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { user, adminClient } = await requireAuthenticatedUser(req)
    const userId = user.id

    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const rawState = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    
    // Hash state for storage
    const msgUint8 = new TextEncoder().encode(rawState);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const stateHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    const redirectUri = Deno.env.get('META_REDIRECT_URI');
    const appId = Deno.env.get('META_APP_ID');

    if (!appId) throw new Error('META_APP_ID missing');
    if (!redirectUri) throw new Error('META_REDIRECT_URI missing');

    const scopes = ['ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement'];

    // Save state hash
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 mins

    // Expired-state cleanup is useful but not part of the critical OAuth path.
    // Do not block "Connect with Facebook" on this maintenance query.
    adminClient
      .from('meta_oauth_states')
      .delete()
      .eq('user_id', userId)
      .lt('expires_at', new Date().toISOString())
      .then(({ error }) => {
        if (error) console.warn('OAuth state cleanup skipped', error.message)
      })

    const { error: dbError } = await withTimeout(
      adminClient
        .from('meta_oauth_states')
        .insert({
          user_id: userId,
          state_hash: stateHash,
          redirect_uri: redirectUri,
          scopes: scopes,
          expires_at: expiresAt
        }),
      8_000,
      'Saving Meta OAuth state'
    );

    if (dbError) throw dbError;

    // Build Meta OAuth URL
    // Use response_type=code
    const authUrl = new URL(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
    authUrl.searchParams.append('client_id', appId);
    authUrl.searchParams.append('redirect_uri', redirectUri);
    authUrl.searchParams.append('state', rawState);
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
