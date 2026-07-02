import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { corsHeaders } from '../_shared/cors.ts'
import { errorResponse, requireAuthenticatedUser } from '../_shared/auth.ts'
import { withDirectPostgres } from '../_shared/direct-postgres.ts'

type ClientRow = { client_id: string; display_name: string | null }
type IntegrationRow = { id: string }
type AssetRow = {
  id: string
  integration_id: string
  asset_id: string
  asset_name: string | null
  currency: string | null
  timezone_name: string | null
  asset_status: string | null
}
type LinkRow = {
  id: string
  client_id: string
  meta_asset_id: string
  linked_at: string
}
type RunRow = {
  id: string
  status?: 'running' | 'success' | 'partial' | 'failed'
  requested_period: string
  requested_level: string
  run_scope: string
  started_at: string
  finished_at: string | null
  termination_reason?: string | null
  pages_fetched?: number | null
  records_fetched?: number | null
  integration_id: string
  ad_account_id: string
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

async function optionalBody(req: Request): Promise<{ clientId?: string; p_client_id?: string }> {
  try {
    return await req.json()
  } catch {
    return {}
  }
}

function newestRun(current: RunRow | undefined, candidate: RunRow): RunRow {
  if (!current) return candidate
  const currentTime = new Date(current.finished_at || current.started_at).getTime()
  const candidateTime = new Date(candidate.finished_at || candidate.started_at).getTime()
  return candidateTime > currentTime ? candidate : current
}

function runSummary(run?: RunRow) {
  if (!run) return null
  return {
    id: run.id,
    status: run.status,
    period: run.requested_period,
    level: run.requested_level,
    scope: run.run_scope,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    terminationReason: run.termination_reason ?? null,
    pagesFetched: run.pages_fetched ?? undefined,
    recordsFetched: run.records_fetched ?? undefined,
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { user } = await requireAuthenticatedUser(req)
    const { clientId, p_client_id } = await optionalBody(req)
    const requestedClientId = clientId || p_client_id || null

    const catalog = await withDirectPostgres(async (sql) => {
      const clients = requestedClientId
        ? await sql<ClientRow[]>`
          select client_id, display_name
          from public.client_identity
          where user_id = ${user.id}::uuid
            and client_id = ${requestedClientId}
            and archived_at is null
          order by display_name asc
        `
        : await sql<ClientRow[]>`
          select client_id, display_name
          from public.client_identity
          where user_id = ${user.id}::uuid
            and archived_at is null
          order by display_name asc
        `

      const integrationsData = await sql<IntegrationRow[]>`
        select id
        from public.meta_integrations
        where user_id::text = ${user.id}
          and status = 'active'
      `

      const integrationIds = integrationsData.map((item) => item.id)

      if (integrationIds.length === 0) {
        return {
          clients: clients.map((client) => ({
            clientId: client.client_id,
            clientName: client.display_name || client.client_id,
            accounts: [],
          })),
          availableAssets: [],
          source: 'edge',
        }
      }

      const assets = await sql<AssetRow[]>`
        select id, integration_id, asset_id, asset_name, currency, timezone_name, asset_status
        from public.meta_assets
        where integration_id = any(${integrationIds}::uuid[])
          and asset_type = 'adaccount'
        order by asset_name asc
      `

      const assetIds = assets.map((asset) => asset.id)
      const adAccountIds = assets.map((asset) => asset.asset_id)

      const links = assetIds.length === 0
        ? []
        : await sql<LinkRow[]>`
          select id, client_id, meta_asset_id, linked_at
          from public.client_meta_assets
          where user_id = ${user.id}::uuid
            and meta_asset_id = any(${assetIds}::uuid[])
            and unlinked_at is null
        `

      const runs = adAccountIds.length === 0
        ? []
        : await sql<RunRow[]>`
          select id, status, requested_period, requested_level, run_scope, started_at, finished_at,
                 termination_reason, pages_fetched, records_fetched, integration_id, ad_account_id
          from public.meta_sync_runs
          where user_id = ${user.id}::uuid
            and integration_id = any(${integrationIds}::uuid[])
            and ad_account_id = any(${adAccountIds}::text[])
          order by started_at desc
          limit 500
        `

      const assetById = new Map(assets.map((asset) => [asset.id, asset]))
      const linkByAssetId = new Map(links.map((link) => [link.meta_asset_id, link]))
      const lastAttemptByAccount = new Map<string, RunRow>()
      const lastSuccessByAccount = new Map<string, RunRow>()
      const periodsByAccount = new Map<string, Set<string>>()

      for (const run of runs) {
        const key = `${run.integration_id}:${run.ad_account_id}`
        lastAttemptByAccount.set(key, newestRun(lastAttemptByAccount.get(key), run))
        if (run.status === 'success') {
          lastSuccessByAccount.set(key, newestRun(lastSuccessByAccount.get(key), run))
          if (run.run_scope === 'full_account' && ['this_month', 'this_week', 'today', 'last_7d', 'last_30d'].includes(run.requested_period)) {
            const periods = periodsByAccount.get(key) || new Set<string>()
            periods.add(run.requested_period)
            periodsByAccount.set(key, periods)
          }
        }
      }

      return {
        clients: clients.map((client) => ({
          clientId: client.client_id,
          clientName: client.display_name || client.client_id,
          accounts: links
            .filter((link) => link.client_id === client.client_id)
            .map((link) => {
              const asset = assetById.get(link.meta_asset_id)
              if (!asset) return null
              const key = `${asset.integration_id}:${asset.asset_id}`
              return {
                clientMetaAssetId: link.id,
                metaAssetId: asset.id,
                integrationId: asset.integration_id,
                adAccountId: asset.asset_id,
                accountName: asset.asset_name || asset.asset_id,
                currency: asset.currency,
                timezone: asset.timezone_name,
                assetStatus: asset.asset_status,
                linkedAt: link.linked_at,
                availablePeriods: Array.from(periodsByAccount.get(key) || []).sort(),
                lastAttempt: runSummary(lastAttemptByAccount.get(key)),
                lastSuccess: runSummary(lastSuccessByAccount.get(key)),
              }
            })
            .filter(Boolean),
        })),
        availableAssets: assets.map((asset) => {
          const link = linkByAssetId.get(asset.id) || null
          return {
            metaAssetId: asset.id,
            integrationId: asset.integration_id,
            adAccountId: asset.asset_id,
            accountName: asset.asset_name || asset.asset_id,
            currency: asset.currency,
            timezone: asset.timezone_name,
            assetStatus: asset.asset_status,
            linkedClientId: link?.client_id || null,
            clientMetaAssetId: link?.id || null,
          }
        }),
        source: 'edge',
      }
    })
    return jsonResponse(catalog)
  } catch (error) {
    return errorResponse(error, corsHeaders, null, 'META_CLIENT_CATALOG_FAILED')
  }
})
