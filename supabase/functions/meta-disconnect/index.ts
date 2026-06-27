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

    // Revoke token at Meta (best practice)
    try {
      await fetchMetaGraph({
        endpoint: `/${integration.meta_user_id}/permissions`,
        method: 'DELETE',
        accessToken,
        appSecret
      });
    } catch (e) {
      console.error('Failed to revoke Meta permissions (maybe already revoked):', e);
    }

    // Mark as revoked and clear sensitive data
    const { error: updateError } = await supabaseClient
      .from('meta_integrations')
      .update({
        status: 'revoked',
        access_token_encrypted: 'REVOKED', // clear the token
        granted_scopes: []
      })
      .eq('id', integration.id);

    if (updateError) throw updateError;

    // Log sync
    await supabaseClient.from('meta_sync_logs').insert({
      integration_id: integration.id,
      sync_type: 'disconnect',
      endpoint: '/permissions',
      status: 'success'
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    return errorResponse(error, corsHeaders)
  }
})
