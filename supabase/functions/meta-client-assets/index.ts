import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { corsHeaders } from '../_shared/cors.ts'
import { requireAuthenticatedUser } from '../_shared/auth.ts'
import { withDirectPostgres } from '../_shared/direct-postgres.ts'

type MutationBody = {
  action?: 'link' | 'unlink'
  clientId?: string
  metaAssetId?: string
  clientMetaAssetId?: string
}

class SafeMutationError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message)
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

async function parseBody(req: Request): Promise<MutationBody> {
  try {
    return await req.json()
  } catch {
    throw new SafeMutationError('INVALID_REQUEST', 'A solicitação de vínculo é inválida.')
  }
}

function requiredText(value: unknown, code: string, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new SafeMutationError(code, message)
  return value.trim()
}

function requiredUuid(value: unknown, code: string, message: string): string {
  const parsed = requiredText(value, code, message)
  if (!UUID_PATTERN.test(parsed)) throw new SafeMutationError(code, message)
  return parsed
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Método não permitido.' } }, 405)

  try {
    const { user } = await requireAuthenticatedUser(req)
    const body = await parseBody(req)
    const userId = requiredUuid(user.id, 'INVALID_USER', 'A sessão atual é inválida.')

    if (body.action === 'link') {
      const clientId = requiredText(body.clientId, 'CLIENT_REQUIRED', 'Selecione um cliente.')
      const metaAssetId = requiredUuid(body.metaAssetId, 'ASSET_REQUIRED', 'Selecione uma conta Meta válida.')

      const clientMetaAssetId = await withDirectPostgres((sql) => sql.begin(async (transaction) => {
        await transaction`select pg_advisory_xact_lock(hashtextextended(${`${userId}:${metaAssetId}`}, 0))`

        const clients = await transaction<{ client_id: string }[]>`
          select client_id
          from public.client_identity
          where user_id = ${userId}::uuid
            and client_id = ${clientId}
            and archived_at is null
          limit 1
        `
        if (clients.length === 0) {
          throw new SafeMutationError('CLIENT_NOT_FOUND', 'Este cliente não existe mais ou foi arquivado.', 404)
        }

        const assets = await transaction<{ id: string }[]>`
          select ma.id
          from public.meta_assets ma
          join public.meta_integrations mi on mi.id = ma.integration_id
          where ma.id = ${metaAssetId}::uuid
            and mi.user_id::text = ${userId}
            and ma.asset_type = 'adaccount'
          limit 1
        `
        if (assets.length === 0) {
          throw new SafeMutationError('ASSET_NOT_FOUND', 'Esta conta Meta não pertence à integração conectada.', 404)
        }

        const existing = await transaction<{ id: string; client_id: string }[]>`
          select id, client_id
          from public.client_meta_assets
          where user_id = ${userId}::uuid
            and meta_asset_id = ${metaAssetId}::uuid
            and unlinked_at is null
          limit 1
          for update
        `
        if (existing[0]) {
          if (existing[0].client_id === clientId) return existing[0].id
          throw new SafeMutationError(
            'ACCOUNT_ALREADY_LINKED',
            'Esta conta Meta já está vinculada a outro cliente. Desvincule-a antes de continuar.',
            409,
          )
        }

        const inserted = await transaction<{ id: string }[]>`
          insert into public.client_meta_assets (user_id, client_id, meta_asset_id)
          values (${userId}::uuid, ${clientId}, ${metaAssetId}::uuid)
          returning id
        `
        return inserted[0].id
      }))

      console.log('[meta-client-assets] linked', { userId, clientId, metaAssetId, clientMetaAssetId })
      return jsonResponse({ success: true, clientMetaAssetId })
    }

    if (body.action === 'unlink') {
      const clientMetaAssetId = requiredUuid(
        body.clientMetaAssetId,
        'LINK_REQUIRED',
        'O vínculo selecionado é inválido.',
      )

      await withDirectPostgres((sql) => sql.begin(async (transaction) => {
        await transaction`select pg_advisory_xact_lock(hashtextextended(${`${userId}:${clientMetaAssetId}`}, 0))`
        const updated = await transaction<{ id: string }[]>`
          update public.client_meta_assets
          set unlinked_at = now(), updated_at = now()
          where id = ${clientMetaAssetId}::uuid
            and user_id = ${userId}::uuid
            and unlinked_at is null
          returning id
        `
        if (updated.length === 0) {
          throw new SafeMutationError('LINK_NOT_FOUND', 'Este vínculo já foi removido ou não está disponível.', 404)
        }

        await transaction`
          update public.client_performance_targets
          set effective_to = now()
          where user_id = ${userId}::uuid
            and client_meta_asset_id = ${clientMetaAssetId}::uuid
            and effective_to is null
            and effective_from < now()
        `
      }))

      console.log('[meta-client-assets] unlinked', { userId, clientMetaAssetId })
      return jsonResponse({ success: true })
    }

    throw new SafeMutationError('INVALID_ACTION', 'A operação de vínculo é inválida.')
  } catch (error) {
    if (error instanceof SafeMutationError) {
      console.warn('[meta-client-assets] rejected', { code: error.code, status: error.status })
      return jsonResponse({ success: false, error: { code: error.code, message: error.message } }, error.status)
    }

    const postgresCode = typeof error === 'object' && error && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : ''
    console.error('[meta-client-assets] failed', {
      code: postgresCode || 'UNKNOWN',
      message: error instanceof Error ? error.message : String(error),
    })
    const message = postgresCode === '23503'
      ? 'O cliente ou a conta Meta não está mais disponível. Recarregue os dados e tente novamente.'
      : postgresCode === '23505'
        ? 'Esta conta Meta já possui um vínculo ativo. Recarregue os dados salvos.'
        : 'Não foi possível salvar o vínculo no banco agora. Tente novamente em alguns segundos.'
    return jsonResponse({ success: false, error: { code: 'META_CLIENT_ASSET_FAILED', message } }, 500)
  }
})
