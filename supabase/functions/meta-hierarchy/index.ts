import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { corsHeaders } from '../_shared/cors.ts'
import { HttpError, requireAuthenticatedUser } from '../_shared/auth.ts'
import { withDirectPostgres } from '../_shared/direct-postgres.ts'

type HierarchyBody = {
  clientMetaAssetId?: unknown
  period?: unknown
  level?: unknown
  parentId?: unknown
  page?: unknown
  pageSize?: unknown
}

const VALID_PERIODS = new Set(['this_month', 'this_week', 'today', 'last_7d', 'last_30d'])
const VALID_LEVELS = new Set(['campaign', 'adset', 'ad', 'creative'])

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

function asPositiveInteger(value: unknown, fallback: number): number {
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : fallback
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { user } = await requireAuthenticatedUser(req)
    const body = await req.json().catch(() => ({})) as HierarchyBody

    const clientMetaAssetId = typeof body.clientMetaAssetId === 'string' ? body.clientMetaAssetId : ''
    const period = typeof body.period === 'string' ? body.period : ''
    const level = typeof body.level === 'string' ? body.level : ''
    const parentId = typeof body.parentId === 'string' && body.parentId.trim() ? body.parentId.trim() : null
    const page = asPositiveInteger(body.page, 1)
    const pageSize = Math.min(asPositiveInteger(body.pageSize, 25), 100)

    if (!clientMetaAssetId) throw new HttpError('clientMetaAssetId é obrigatório.', 400)
    if (!VALID_PERIODS.has(period)) throw new HttpError('Período de hierarquia inválido.', 400)
    if (!VALID_LEVELS.has(level)) throw new HttpError('Nível de hierarquia inválido.', 400)
    if (level !== 'campaign' && !parentId) throw new HttpError('parentId é obrigatório para este nível.', 400)

    const result = await withDirectPostgres(async (sql) => sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({
        sub: user.id,
        is_anonymous: false,
      })}, true)`

      const rows = await tx<{ hierarchy: unknown }[]>`
        select public.get_meta_performance_hierarchy(
          ${clientMetaAssetId}::uuid,
          ${period},
          ${level},
          ${parentId},
          ${page},
          ${pageSize}
        ) as hierarchy
      `

      return rows[0]?.hierarchy
    }))

    if (!result || typeof result !== 'object') {
      throw new HttpError('A hierarquia Meta não retornou dados válidos.', 503)
    }

    return jsonResponse(result)
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse({
        success: false,
        status: 'failed',
        error: { code: 'META_HIERARCHY_FAILED', message: error.message },
      }, error.status)
    }
    console.error('[meta-hierarchy] Failed to load saved hierarchy:', error)
    return jsonResponse({
      success: false,
      status: 'failed',
      error: { code: 'META_HIERARCHY_FAILED', message: 'Não foi possível carregar a hierarquia salva.' },
    }, 500)
  }
})
