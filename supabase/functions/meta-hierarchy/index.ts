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
  dateStart?: unknown
  dateStop?: unknown
  includeHistorical?: unknown
}

const VALID_PERIODS = new Set(['this_month', 'this_week', 'today', 'yesterday', 'today_and_yesterday', 'last_7d', 'last_30d', 'last_90d'])
const VALID_LEVELS = new Set(['campaign', 'adset', 'ad', 'creative'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

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

function shiftIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function defaultRange(period: string): { dateStart: string; dateStop: string } {
  const today = new Date().toISOString().slice(0, 10)
  if (period === 'this_month') return { dateStart: `${today.slice(0, 7)}-01`, dateStop: today }
  if (period === 'this_week') {
    const current = new Date(`${today}T12:00:00.000Z`)
    return { dateStart: shiftIsoDate(today, -((current.getUTCDay() + 6) % 7)), dateStop: today }
  }
  if (period === 'yesterday') {
    const yesterday = shiftIsoDate(today, -1)
    return { dateStart: yesterday, dateStop: yesterday }
  }
  if (period === 'today_and_yesterday') return { dateStart: shiftIsoDate(today, -1), dateStop: today }
  if (period === 'last_7d') return { dateStart: shiftIsoDate(today, -6), dateStop: today }
  if (period === 'last_30d') return { dateStart: shiftIsoDate(today, -29), dateStop: today }
  if (period === 'last_90d') return { dateStart: shiftIsoDate(today, -89), dateStop: today }
  return { dateStart: today, dateStop: today }
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
    const fallbackRange = defaultRange(period)
    const dateStart = typeof body.dateStart === 'string' && ISO_DATE.test(body.dateStart) ? body.dateStart : fallbackRange.dateStart
    const dateStop = typeof body.dateStop === 'string' && ISO_DATE.test(body.dateStop) ? body.dateStop : fallbackRange.dateStop
    const includeHistorical = body.includeHistorical === true

    if (!clientMetaAssetId) throw new HttpError('clientMetaAssetId é obrigatório.', 400)
    if (!VALID_PERIODS.has(period)) throw new HttpError('Período de hierarquia inválido.', 400)
    if (!VALID_LEVELS.has(level)) throw new HttpError('Nível de hierarquia inválido.', 400)
    if (level !== 'campaign' && !parentId) throw new HttpError('parentId é obrigatório para este nível.', 400)
    if (dateStart > dateStop) throw new HttpError('Data inicial não pode ser posterior à data final.', 400)
    if (dateStop > new Date().toISOString().slice(0, 10)) throw new HttpError('Período futuro não pode ser consultado.', 400)

    const result = await withDirectPostgres(async (sql) => sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({
        sub: user.id,
        is_anonymous: false,
      })}, true)`

      const rows = await tx<{ hierarchy: unknown }[]>`
        select public.get_meta_performance_hierarchy_v2(
          ${clientMetaAssetId}::uuid,
          ${period},
          ${dateStart}::date,
          ${dateStop}::date,
          ${level},
          ${parentId},
          ${page},
          ${pageSize},
          ${includeHistorical}
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
