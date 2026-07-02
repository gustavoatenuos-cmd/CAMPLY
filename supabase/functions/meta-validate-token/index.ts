import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { corsHeaders } from '../_shared/cors.ts'
import { errorResponse, HttpError, requireAuthenticatedUser } from '../_shared/auth.ts'
import { decryptToken } from '../_shared/crypto.ts'
import { META_BASE_URL } from '../_shared/meta-api.ts'
import { withDirectPostgres } from '../_shared/direct-postgres.ts'

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

async function loadSavedConnection(userId: string) {
  return await withDirectPostgres(async (sql) => {
    const integrations = await sql<Record<string, unknown>[]>`
      select *
      from public.meta_integrations
      where user_id::text = ${userId}
        and provider = 'meta'
        and status = 'active'
      order by updated_at desc nulls last, created_at desc nulls last
      limit 1
    `
    const integration = integrations[0] || null
    if (!integration) return { integration: null, assets: [] }

    const assets = await sql<Record<string, unknown>[]>`
      select id, integration_id, asset_type, asset_id, asset_name, asset_status,
             currency, timezone_name, is_selected, created_at, updated_at
      from public.meta_assets
      where integration_id = ${String(integration.id)}::uuid
      order by asset_type, asset_name
    `
    return { integration, assets }
  })
}

export async function handleRequest(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { user } = await requireAuthenticatedUser(req)
    const userId = user.id

    const { verifyRemote = false } = await optionalBody(req)

    // The stored connection is authoritative for normal page loads. Use direct
    // Postgres here because PostgREST pool exhaustion must not block OAuth.
    const { integration, assets } = await loadSavedConnection(userId)
    if (!integration) {
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

    if (!verifyRemote) {
      return jsonResponse({
        status: 'active',
        integration: safeIntegration(integration),
        assets,
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
      await withDirectPostgres(async (sql) => {
        await sql`
          update public.meta_integrations
          set status = 'expired',
              updated_at = now()
          where id = ${String(integration.id)}::uuid
        `
      })
      
      return jsonResponse({ status: 'expired', source: 'remote', remoteValidated: true })
    }

    const validatedAt = new Date().toISOString()
    await withDirectPostgres(async (sql) => {
      await sql`
        update public.meta_integrations
        set last_validated_at = ${validatedAt}::timestamptz,
            updated_at = now()
        where id = ${String(integration.id)}::uuid
      `
    })

    return jsonResponse({
      status: 'active',
      integration: safeIntegration(integration, validatedAt),
      assets,
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
