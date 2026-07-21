import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { corsHeaders } from '../_shared/cors.ts'
import { HttpError, requireAuthenticatedUser } from '../_shared/auth.ts'
import { withDirectPostgres } from '../_shared/direct-postgres.ts'

type AnalyticsDashboardBody = {
  action?: unknown
  period?: unknown
  clientIds?: unknown
  assetIds?: unknown
}

const VALID_PERIODS = new Set(['today', 'yesterday', 'today_and_yesterday', 'last_7d', 'last_30d', 'last_90d'])

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const values = Array.from(new Set(value.filter((item): item is string => (
    typeof item === 'string' && item.trim().length > 0
  )).map((item) => item.trim())))
  return values.length ? values : null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let user: { id: string } | undefined;
  let body: AnalyticsDashboardBody | undefined;

  try {
    const authResult = await requireAuthenticatedUser(req);
    user = authResult.user;
    body = await req.json().catch(() => ({})) as AnalyticsDashboardBody
    const action = body.action === 'dashboard' ? 'dashboard' : body.action === 'capabilities' ? 'capabilities' : ''

    if (!action) throw new HttpError('Ação analítica inválida.', 400)

    const result = await withDirectPostgres(async (sql) => sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({
        sub: user.id,
        is_anonymous: false,
      })}, true)`

      if (action === 'capabilities') {
        const rows = await tx<{ capabilities: unknown }[]>`
          select public.get_analytics_capabilities() as capabilities
        `
        return { capabilities: rows[0]?.capabilities ?? null }
      }

      const period = typeof body.period === 'string' ? body.period : ''
      if (!VALID_PERIODS.has(period)) throw new HttpError('Período analítico inválido.', 400)

      const clientIds = stringArray(body.clientIds)
      const assetIds = stringArray(body.assetIds)
      const rows = await tx<{ dashboard: unknown }[]>`
        select public.get_global_performance_dashboard_v2(
          ${period},
          ${clientIds}::text[],
          ${assetIds}::uuid[]
        ) as dashboard
      `
      return { dashboard: rows[0]?.dashboard ?? [] }
    }))

    return jsonResponse({ success: true, ...result })
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse({
        success: false,
        error: { code: 'ANALYTICS_DASHBOARD_FAILED', message: error.message },
      }, error.status)
    }

    const pgError = error as Record<string, unknown>;
    console.error(`[analytics-dashboard] Direct analytics read failed.`, {
      action: body?.action || 'unknown',
      period: body?.period || 'unknown',
      userId: user?.id || 'unknown',
      rpc: (body?.action) === 'capabilities' ? 'get_analytics_capabilities' : 'get_global_performance_dashboard_v2',
      errorCode: pgError?.code || 'unknown',
      errorMessage: error instanceof Error ? error.message : String(error),
      stage: 'rpc_execution'
    })
    return jsonResponse({
      success: false,
      error: {
        code: 'ANALYTICS_DASHBOARD_FAILED',
        message: 'Não foi possível carregar o contrato analítico salvo.',
      },
    }, 500)
  }
})
