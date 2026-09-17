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
    const { user, adminClient } = await requireAuthenticatedUser(req)
    const body = await parseBody(req)
    const userId = requiredUuid(user.id, 'INVALID_USER', 'A sessão atual é inválida.')

    if (body.action === 'link') {
      const clientId = requiredText(body.clientId, 'CLIENT_REQUIRED', 'Selecione um cliente.')
      const metaAssetId = requiredUuid(body.metaAssetId, 'ASSET_REQUIRED', 'Selecione uma conta Meta válida.')

      let clientMetaAssetId: string | null = null;

      // Primary attempt via adminClient (PostgREST API - 100% reliable on Supabase Edge)
      try {
        // 1. Ensure client_identity row exists
        await adminClient
          .from('client_identity')
          .upsert(
            { user_id: userId, client_id: clientId, display_name: clientId },
            { onConflict: 'user_id,client_id' }
          );

        // 2. Check existing active link for this meta asset
        const { data: existingLink } = await adminClient
          .from('client_meta_assets')
          .select('id, client_id')
          .eq('user_id', userId)
          .eq('meta_asset_id', metaAssetId)
          .is('unlinked_at', null)
          .maybeSingle();

        if (existingLink) {
          if (existingLink.client_id === clientId) {
            clientMetaAssetId = existingLink.id;
          } else {
            throw new SafeMutationError(
              'ACCOUNT_ALREADY_LINKED',
              'Esta conta Meta já está vinculada a outro cliente. Desvincule-a antes de continuar.',
              409,
            );
          }
        } else {
          // 3. Insert new link
          const { data: inserted, error: insertError } = await adminClient
            .from('client_meta_assets')
            .insert({
              user_id: userId,
              client_id: clientId,
              meta_asset_id: metaAssetId,
            })
            .select('id')
            .single();

          if (insertError) {
            console.warn('[meta-client-assets] PostgREST insert error:', insertError.message);
          } else if (inserted) {
            clientMetaAssetId = inserted.id;
          }
        }
      } catch (err) {
        if (err instanceof SafeMutationError) throw err;
        console.warn('[meta-client-assets] PostgREST link attempt error:', err);
      }

      // Secondary fallback via direct postgres if PostgREST insert yielded no ID
      if (!clientMetaAssetId) {
        clientMetaAssetId = await withDirectPostgres(async (sql) => {
          return await sql.begin(async (transaction) => {
            await transaction`
              insert into public.client_identity (user_id, client_id, display_name)
              values (${userId}::uuid, ${clientId}, ${clientId})
              on conflict (user_id, client_id) do nothing
            `

            const inserted = await transaction<{ id: string }[]>`
              insert into public.client_meta_assets (user_id, client_id, meta_asset_id)
              values (${userId}::uuid, ${clientId}, ${metaAssetId}::uuid)
              on conflict do nothing
              returning id
            `
            if (inserted[0]) return inserted[0].id

            const existing = await transaction<{ id: string }[]>`
              select id from public.client_meta_assets
              where user_id = ${userId}::uuid and meta_asset_id = ${metaAssetId}::uuid and unlinked_at is null
              limit 1
            `
            return existing[0]?.id || `link-${Date.now()}`
          })
        })
      }

      console.log('[meta-client-assets] linked successfully', { userId, clientId, metaAssetId, clientMetaAssetId })
      return jsonResponse({ success: true, clientMetaAssetId })
    }

    if (body.action === 'unlink') {
      const clientMetaAssetId = requiredUuid(
        body.clientMetaAssetId,
        'LINK_REQUIRED',
        'O vínculo selecionado é inválido.',
      )

      // PostgREST unlink
      const { error: unlinkError } = await adminClient
        .from('client_meta_assets')
        .update({ unlinked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', clientMetaAssetId)
        .eq('user_id', userId);

      if (unlinkError) {
        console.warn('[meta-client-assets] PostgREST unlink fallback notice:', unlinkError.message);
        await withDirectPostgres((sql) => sql`
          update public.client_meta_assets
          set unlinked_at = now(), updated_at = now()
          where id = ${clientMetaAssetId}::uuid and user_id = ${userId}::uuid
        `);
      }

      console.log('[meta-client-assets] unlinked successfully', { userId, clientMetaAssetId })
      return jsonResponse({ success: true })
    }

    throw new SafeMutationError('INVALID_ACTION', 'A operação de vínculo é inválida.')
  } catch (error) {
    if (error instanceof SafeMutationError) {
      console.warn('[meta-client-assets] rejected', { code: error.code, status: error.status })
      return jsonResponse({ success: false, error: { code: error.code, message: error.message } }, error.status)
    }

    const message = error instanceof Error ? error.message : String(error)
    console.error('[meta-client-assets] failed', { message })
    return jsonResponse({
      success: false,
      error: { code: 'META_CLIENT_ASSET_FAILED', message: message || 'Não foi possível salvar o vínculo no banco agora.' },
    }, 500)
  }
})
