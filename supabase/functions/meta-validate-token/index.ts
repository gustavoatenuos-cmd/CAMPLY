import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { corsHeaders } from '../_shared/cors.ts'
import { errorResponse, HttpError, requireAuthenticatedUser } from '../_shared/auth.ts'
import { decryptToken } from '../_shared/crypto.ts'
import { META_BASE_URL } from '../_shared/meta-api.ts'

const jsonResponse = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  status,
})

const safeIntegration = (integration: Record<string, unknown>, lastValidatedAt?: string) => ({
  id: integration.id,
  meta_user_id: integration.meta_user_id,
  meta_user_name: integration.meta_user_name,
  status: integration.status,
  granted_scopes: integration.granted_scopes,
  token_expires_at: integration.token_expires_at,
  last_validated_at: lastValidatedAt ?? integration.last_validated_at,
  last_sync_at: integration.last_sync_at,
})

async function optionalBody(req: Request): Promise<{ verifyRemote?: boolean }> {
  try {
    return await req.json()
  } catch {
    return {}
  }
}

export async function handleRequest(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { user, adminClient: supabaseClient } = await requireAuthenticatedUser(req)
    const userId = user.id

    const { verifyRemote = false } = await optionalBody(req)

    // The stored connection is authoritative for normal page loads. A remote
    // token check only happens after an explicit user action.
    const { data: integration, error: intError } = await supabaseClient
      .from('meta_integrations')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (intError || !integration) {
      return jsonResponse({ status: 'none', source: 'database' })
    }

    if (integration.status !== 'active') {
      return jsonResponse({
        status: integration.status,
        integration: safeIntegration(integration),
        assets: [],
        source: 'database',
      })
    }

    const { data: assets, error: assetsError } = await supabaseClient
      .from('meta_assets')
      .select('id,integration_id,asset_type,asset_id,asset_name,asset_status,currency,timezone_name,is_selected,created_at,updated_at')
      .eq('integration_id', integration.id)
      .order('asset_type')
      .order('asset_name')

    if (assetsError) throw new HttpError('Não foi possível carregar os ativos Meta salvos.', 503)

    if (!verifyRemote) {
      return jsonResponse({
        status: 'active',
        integration: safeIntegration(integration),
        assets: assets || [],
        source: 'database',
        remoteValidated: false,
      })
    }

    const accessToken = await decryptToken(integration.access_token_encrypted)
    const appSecret = Deno.env.get('META_APP_SECRET')
    const appId = Deno.env.get('META_APP_ID')
    if (!appSecret || !appId) throw new HttpError('A validação Meta não está configurada.', 503)

    let debugRes: Response
    let debugData: { data?: { is_valid?: boolean } }

    try {
      const debugUrl = new URL(`${META_BASE_URL}/debug_token`);
      debugUrl.searchParams.append('input_token', accessToken);
      debugUrl.searchParams.append('access_token', `${appId}|${appSecret}`);

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10_000)
      try {
        debugRes = await fetch(debugUrl.toString(), { signal: controller.signal })
        debugData = await debugRes.json()
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (error) {
      console.error('Explicit Meta token validation unavailable', error)
      throw new HttpError('O Facebook não respondeu à validação. A conexão salva foi preservada.', 503)
    }

    if (!debugRes.ok || typeof debugData.data?.is_valid !== 'boolean') {
      throw new HttpError('O Facebook não confirmou o estado do token. A conexão salva foi preservada.', 503)
    }

    if (!debugData.data.is_valid) {
      await supabaseClient
        .from('meta_integrations')
        .update({ status: 'expired' })
        .eq('id', integration.id);
      
      return jsonResponse({ status: 'expired', source: 'remote', remoteValidated: true })
    }

    const validatedAt = new Date().toISOString()
    const { error: updateError } = await supabaseClient
      .from('meta_integrations')
      .update({ last_validated_at: validatedAt })
      .eq('id', integration.id);
    if (updateError) throw new HttpError('A validação foi concluída, mas não pôde ser registrada.', 503)

    return jsonResponse({
      status: 'active',
      integration: safeIntegration(integration, validatedAt),
      assets: assets || [],
      source: 'remote',
      remoteValidated: true,
    })

  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse({
        success: false,
        status: 'failed',
        error: { code: 'META_VALIDATION_FAILED', message: error.message },
      }, error.status)
    }
    return errorResponse(error, corsHeaders, null, 'META_VALIDATION_FAILED')
  }
}

serve(handleRequest)
