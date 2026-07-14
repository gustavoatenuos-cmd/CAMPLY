import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { errorResponse, HttpError, requireAuthenticatedUser } from '../_shared/auth.ts';
import { decryptToken } from '../_shared/crypto.ts';
import {
  fetchMetaGraph,
  fetchMetaGraphPaginated,
  META_GRAPH_VERSION,
  type PaginatedResult,
} from '../_shared/meta-api.ts';
import { classifyAdSetObjective, classifyCampaignObjective } from '../_shared/meta/classifier.ts';
import { normalizeMetaMetrics } from '../_shared/meta/normalizer.ts';
import { analyzeCampaignMix } from '../_shared/meta/mixedAttributionDetector.ts';
import {
  buildCampaignPeriodAnalytics,
  buildTrendAvailabilityByPeriod,
  mergeCompletenessStatuses,
  type MetaAdSetDefinition,
  type MetaInsightRow,
  type PeriodCompleteness,
  type PeriodCompletenessStatus,
  type TrendPeriodSignature,
} from '../_shared/meta/aggregation.ts';
import { insightHasDelivery } from '../_shared/meta/mixedAttributionDetector.ts';
import { withDirectPostgres } from '../_shared/direct-postgres.ts';

interface SyncRequestBody {
  clientMetaAssetId?: string;
  /** @deprecated legacy discovery-only identifiers; rejected for operational sync, see clientMetaAssetId */
  metaAssetId?: string;
  /** @deprecated legacy discovery-only identifiers; rejected for operational sync, see clientMetaAssetId */
  adAccountId?: string;
  periods?: string[];
  selectedCampaigns?: string[];
  selectedAdSets?: string[];
  selectedAds?: string[];
  selectedCreatives?: string[];
  selectedEntityIds?: {
    campaign_ids?: string[];
    campaignIds?: string[];
    adset_ids?: string[];
    adSetIds?: string[];
    adsetIds?: string[];
    ad_ids?: string[];
    adIds?: string[];
    creative_ids?: string[];
    creativeIds?: string[];
  };
  requestedLevel?: string;
  requested_level?: string;
}

interface MetaCampaign {
  id: string;
  name: string;
  status?: string;
  effective_status?: string;
  objective: string;
  daily_budget?: string | number;
  lifetime_budget?: string | number;
}

interface MetaAdSet extends MetaAdSetDefinition {
  campaign_id: string;
  name: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string | number;
  lifetime_budget?: string | number;
}

interface MetaAdCreative {
  id?: string;
  name?: string;
  title?: string;
  body?: string;
  thumbnail_url?: string;
  image_url?: string;
  object_story_spec?: Record<string, unknown> | null;
  updated_time?: string;
}

interface MetaAd {
  id: string;
  name: string;
  campaign_id: string;
  adset_id?: string;
  status?: string;
  effective_status?: string;
  creative?: MetaAdCreative;
}

interface OwnedClientMetaAsset {
  client_meta_asset_id: string;
  client_id: string;
  id: string;
  asset_id: string;
  integration_id: string;
  integration_user_id: string;
  integration_status: string;
  access_token_encrypted: string;
}

const METRIC_DEFINITION_VERSION = '2026-07-01.1';
const COLLECTION_CONTRACT_VERSION = '2026-07-01.1';
const VALID_REQUESTED_LEVELS = ['campaign', 'adset', 'ad', 'creative'] as const;

type RequestedLevel = typeof VALID_REQUESTED_LEVELS[number];

interface EntitySelection {
  campaign_ids: string[];
  adset_ids: string[];
  ad_ids: string[];
  creative_ids: string[];
}

const collectionStatus = <T>(result: PaginatedResult<T>): PeriodCompletenessStatus =>
  result.completionStatus;

const isIncomplete = (status: PeriodCompletenessStatus) =>
  status !== 'complete' && status !== 'zero_delivery';

const localIsoDate = (date: Date, timezone: string): string => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

const shiftIsoDate = (value: string, days: number): string => {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const weekMondayIsoDate = (value: string): string => {
  const date = new Date(`${value}T12:00:00Z`);
  const daysFromMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysFromMonday);
  return date.toISOString().slice(0, 10);
};

const insightPeriodParams = (period: string, timezone: string, now = new Date()): Record<string, string> => {
  if (period !== 'this_week') return { date_preset: period };
  if (timezone === 'UNKNOWN') return { date_preset: 'this_week_mon_today' };
  const until = localIsoDate(now, timezone);
  const since = weekMondayIsoDate(until);
  return { time_range: JSON.stringify({ since, until }) };
};

const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

const SAFE_META_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const assertSafeMetaId = (value: string, label: string, status = 400) => {
  if (!SAFE_META_ID_PATTERN.test(value)) {
    throw new HttpError(`Invalid ${label}`, status);
  }
};

export interface PeriodRangeValidation {
  status: PeriodCompletenessStatus;
  warnings: string[];
  errors: string[];
  metadata: Record<string, unknown>;
}

export const validateReturnedPeriodRange = (
  period: string,
  row: MetaInsightRow | undefined,
  timezone: string,
  now = new Date()
): PeriodRangeValidation => {
  const warnings: string[] = [];
  const errors: string[] = [];
  const dateStart = row?.date_start ?? null;
  const dateStop = row?.date_stop ?? null;
  const today = timezone !== 'UNKNOWN' ? localIsoDate(now, timezone) : null;
  const expectedThisMonthStart = today ? `${today.slice(0, 8)}01` : null;
  const expectedThisWeekStart = today ? weekMondayIsoDate(today) : null;

  const metadata: Record<string, unknown> = {
    period,
    timezone,
    returnedDateStart: dateStart,
    returnedDateStop: dateStop,
    expectedLocalToday: today,
    expectedThisMonthStart,
    expectedThisWeekStart,
  };

  if (timezone === 'UNKNOWN') {
    errors.push('Timezone unavailable for account period validation.');
  }
  if (!isIsoDate(dateStart)) {
    errors.push('Meta returned no valid date_start for the requested period.');
  }
  if (!isIsoDate(dateStop)) {
    errors.push('Meta returned no valid date_stop for the requested period.');
  }
  if (errors.length > 0) {
    return { status: 'validation_error', warnings, errors, metadata };
  }

  const validDateStart = dateStart as string;
  const validDateStop = dateStop as string;

  if (validDateStart > validDateStop) {
    errors.push('Meta returned date_start after date_stop.');
  }
  if (today && validDateStop > today) {
    errors.push('Meta returned a future date_stop for the account timezone.');
  }

  if (period === 'this_month') {
    metadata.expectedDateStart = expectedThisMonthStart;
    metadata.expectedDateStop = today;
    if (validDateStart !== expectedThisMonthStart) {
      errors.push('Meta this_month date_start does not match the account month start.');
    }
    if (today && validDateStop !== today) {
      warnings.push('Meta this_month date_stop differs from the local expectation; using returned range.');
    }
  } else if (period === 'today') {
    metadata.expectedDateStart = today;
    metadata.expectedDateStop = today;
    if (today && (validDateStart !== today || validDateStop !== today)) {
      errors.push('Meta today range does not match the account local date.');
    }
  } else if (period === 'this_week') {
    metadata.expectedDateStart = expectedThisWeekStart;
    metadata.expectedDateStop = today;
    if (expectedThisWeekStart && today && (validDateStart !== expectedThisWeekStart || validDateStop !== today)) {
      const validRelatedRange = validDateStart >= expectedThisWeekStart && validDateStart <= validDateStop && validDateStop <= today;
      if (validRelatedRange) {
        warnings.push('Meta this_week range differs from local expectation; using returned range.');
      } else {
        errors.push('Meta this_week range is not related to the requested calendar week.');
      }
    }
  } else if (period === 'last_7d') {
    const expectedStart = today ? shiftIsoDate(today, -6) : null;
    metadata.expectedDateStart = expectedStart;
    metadata.expectedDateStop = today;
    if (expectedStart && today && (validDateStart !== expectedStart || validDateStop !== today)) {
      const validRelatedRange = validDateStart >= expectedStart && validDateStart <= validDateStop && validDateStop <= today;
      if (validRelatedRange) {
        warnings.push('Meta last_7d range differs from local expectation; using returned range.');
      } else {
        errors.push('Meta last_7d range is not related to the requested period.');
      }
    }
  } else if (period === 'last_30d') {
    const expectedStart = today ? shiftIsoDate(today, -29) : null;
    metadata.expectedDateStart = expectedStart;
    metadata.expectedDateStop = today;
    if (expectedStart && today && (validDateStart !== expectedStart || validDateStop !== today)) {
      const validRelatedRange = validDateStart >= expectedStart && validDateStart <= validDateStop && validDateStop <= today;
      if (validRelatedRange) {
        warnings.push('Meta last_30d range differs from local expectation; using returned range.');
      } else {
        errors.push('Meta last_30d range is not related to the requested period.');
      }
    }
  }

  return {
    status: errors.length > 0 ? 'validation_error' : 'complete',
    warnings,
    errors,
    metadata,
  };
};

const normalizeIdArray = (...values: unknown[]): string[] => {
  const ids = values.flatMap((value) => Array.isArray(value) ? value : [])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const id of ids) {
    assertSafeMetaId(id, 'selected Meta entity id');
  }
  return Array.from(new Set(ids)).sort();
};

const parseRequestedLevel = (value: unknown, selection: EntitySelection): RequestedLevel => {
  const level = typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : 'campaign';

  if (!VALID_REQUESTED_LEVELS.includes(level as RequestedLevel)) {
    throw new HttpError(`Invalid requestedLevel: ${String(value)}`, 400);
  }

  if ((selection.ad_ids.length > 0 || selection.creative_ids.length > 0) && (level === 'campaign' || level === 'adset')) {
    return 'ad';
  }

  if (selection.adset_ids.length > 0 && level === 'campaign') {
    return 'adset';
  }

  return level as RequestedLevel;
};

const resolveRunScope = (selection: EntitySelection): string => {
  const hasCampaigns = selection.campaign_ids.length > 0;
  const hasAdSets = selection.adset_ids.length > 0;
  const hasAds = selection.ad_ids.length > 0;
  const hasCreatives = selection.creative_ids.length > 0;
  const selectedScopes = [hasCampaigns, hasAdSets, hasAds, hasCreatives].filter(Boolean).length;
  if (selectedScopes > 1) return 'selected_entities';
  if (hasCreatives) return 'selected_creatives';
  if (hasAds) return 'selected_ads';
  if (hasAdSets) return 'selected_adsets';
  if (hasCampaigns) return 'selected_campaigns';
  return 'full_account';
};

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`
    ).join(',')}}`;
  }
  return JSON.stringify(value);
};

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const buildRequestFingerprint = async (contract: Record<string, unknown>): Promise<string> =>
  sha256Hex(stableJson(contract));

const normalizeSelection = (body: SyncRequestBody): EntitySelection => ({
  campaign_ids: normalizeIdArray(
    body.selectedCampaigns,
    body.selectedEntityIds?.campaign_ids,
    body.selectedEntityIds?.campaignIds
  ),
  adset_ids: normalizeIdArray(
    body.selectedAdSets,
    body.selectedEntityIds?.adset_ids,
    body.selectedEntityIds?.adsetIds,
    body.selectedEntityIds?.adSetIds
  ),
  ad_ids: normalizeIdArray(
    body.selectedAds,
    body.selectedEntityIds?.ad_ids,
    body.selectedEntityIds?.adIds
  ),
  creative_ids: normalizeIdArray(
    body.selectedCreatives,
    body.selectedEntityIds?.creative_ids,
    body.selectedEntityIds?.creativeIds
  ),
});

const terminationReasonForError = (error: unknown): string => {
  if (error instanceof HttpError) {
    if (error.status === 400 || error.status === 403) return 'validation_error';
    if (error.status === 502) return 'meta_api_error';
    if (error.status === 500 && error.message.includes('Database persistence failed')) {
      return 'persistence_error';
    }
  }
  return 'unexpected_error';
};

type SupabaseAdminClient = Awaited<ReturnType<typeof requireAuthenticatedUser>>['adminClient'];

interface PersistedSyncVerification {
  runId: string;
  status: string | null;
  finishedAt: string | null;
  dateStart: string | null;
  dateStop: string | null;
  timezone: string | null;
  currency: string | null;
  accountMetricsCount: number;
  campaignMetricsCount: number;
  dashboardQualified: boolean;
}

const DASHBOARD_QUALIFIED_REQUESTED_LEVELS = new Set(['campaign', 'adset', 'ad', 'creative']);

const countPersistedMetrics = async (
  supabaseClient: SupabaseAdminClient,
  runId: string,
  userId: string,
  sourceLevel: 'account' | 'campaign'
): Promise<number> => {
  const { count, error } = await supabaseClient
    .from('meta_normalized_metrics')
    .select('id', { count: 'exact', head: true })
    .eq('sync_run_id', runId)
    .eq('user_id', userId)
    .eq('source_level', sourceLevel);

  if (error) {
    throw new HttpError(`Failed to verify persisted ${sourceLevel} metrics: ${error.message}`, 500);
  }

  return count ?? 0;
};

const verifyPersistedSyncRun = async (
  supabaseClient: SupabaseAdminClient,
  runId: string,
  userId: string,
  requestedPeriod: string
): Promise<PersistedSyncVerification> => {
  const { data: run, error: runError } = await supabaseClient
    .from('meta_sync_runs')
    .select('id,status,finished_at,date_start,date_stop,timezone,currency,run_scope,requested_level,requested_period')
    .eq('id', runId)
    .eq('user_id', userId)
    .single();

  if (runError || !run) {
    throw new HttpError(`Failed to verify persisted sync run: ${runError?.message || 'run not found'}`, 500);
  }

  const accountMetricsCount = await countPersistedMetrics(supabaseClient, runId, userId, 'account');
  const campaignMetricsCount = await countPersistedMetrics(supabaseClient, runId, userId, 'campaign');

  return {
    runId,
    status: run.status ?? null,
    finishedAt: run.finished_at ?? null,
    dateStart: run.date_start ?? null,
    dateStop: run.date_stop ?? null,
    timezone: run.timezone ?? null,
    currency: run.currency ?? null,
    accountMetricsCount,
    campaignMetricsCount,
    dashboardQualified: run.status === 'success'
      && run.run_scope === 'full_account'
      && DASHBOARD_QUALIFIED_REQUESTED_LEVELS.has(run.requested_level || '')
      && run.requested_period === requestedPeriod
      && accountMetricsCount > 0,
  };
};

export async function handleRequest(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const generatedRunId = crypto.randomUUID();
  let usedRunId: string = generatedRunId;
  let supabaseClient: Awaited<ReturnType<typeof requireAuthenticatedUser>>['adminClient'] | null = null;
  let userId: string | null = null;

  try {
    const auth = await requireAuthenticatedUser(req);
    userId = auth.user.id;
    supabaseClient = auth.adminClient;

    const body = await req.json() as SyncRequestBody & { syncRunId?: string };
    const clientMetaAssetId = typeof body.clientMetaAssetId === 'string' ? body.clientMetaAssetId.trim() : undefined;
    const legacyMetaAssetId = typeof body.metaAssetId === 'string' ? body.metaAssetId.trim() : undefined;
    const legacyAdAccountId = typeof body.adAccountId === 'string' ? body.adAccountId.trim() : undefined;
    if (body.clientMetaAssetId !== undefined && typeof body.clientMetaAssetId !== 'string') {
      throw new HttpError('Invalid clientMetaAssetId', 400);
    }
    if (body.metaAssetId !== undefined && typeof body.metaAssetId !== 'string') {
      throw new HttpError('Invalid metaAssetId', 400);
    }
    if (body.adAccountId !== undefined && typeof body.adAccountId !== 'string') {
      throw new HttpError('Invalid adAccountId', 400);
    }
    if (clientMetaAssetId) assertSafeMetaId(clientMetaAssetId, 'clientMetaAssetId');
    if (legacyMetaAssetId) assertSafeMetaId(legacyMetaAssetId, 'metaAssetId');
    if (legacyAdAccountId) assertSafeMetaId(legacyAdAccountId, 'adAccountId');

    // Operational sync only ever runs against a Meta account linked to an active
    // client (public.client_meta_assets). A Facebook-authorized ad account that
    // was merely discovered (meta_assets) and never linked to a client is not an
    // operational account and must never be synced or analyzed.
    if (!clientMetaAssetId) {
      throw new HttpError(
        'A sincronização operacional exige uma conta Meta vinculada a um cliente (clientMetaAssetId).',
        400
      );
    }

    const periods = Array.isArray(body.periods) && body.periods.length > 0
      ? Array.from(new Set(body.periods.filter((period): period is string => typeof period === 'string' && period.length > 0)))
      : ['last_7d'];
      
    const validPeriods = ['today', 'yesterday', 'this_week', 'this_month', 'last_month', 'this_quarter', 'maximum', 'last_3d', 'last_7d', 'last_14d', 'last_28d', 'last_30d', 'last_90d', 'this_year', 'last_year'];
    for (const p of periods) {
      if (!validPeriods.includes(p)) {
        throw new HttpError(`Invalid period: ${p}`, 400);
      }
    }
    if (periods.length !== 1) {
      throw new HttpError('Exactly one requested period is required per synchronization run', 400);
    }

    const selectedEntityIds = normalizeSelection(body);
    const requestedLevel = parseRequestedLevel(
      body.requestedLevel ?? body.requested_level,
      selectedEntityIds
    );
    const selectedCampaignSet = new Set(selectedEntityIds.campaign_ids);
    const selectedAdSetSet = new Set(selectedEntityIds.adset_ids);
    const selectedAdIdsSet = new Set(selectedEntityIds.ad_ids);
    const selectedCreativeSet = new Set(selectedEntityIds.creative_ids);
    const shouldCollectAds = requestedLevel === 'ad' || requestedLevel === 'creative';
    const runScope = resolveRunScope(selectedEntityIds);
      
    if (body.syncRunId) {
      throw new HttpError('O parâmetro syncRunId não é permitido. O sistema o gera exclusivamente.', 400);
    }
    usedRunId = generatedRunId;

    // Resolve the account exclusively through the client link: client_meta_assets
    // (unlinked_at IS NULL) -> client_identity (archived_at IS NULL) -> meta_assets
    // -> meta_integrations. A discovered-but-unlinked meta_assets row, or a link
    // whose client was archived, must never resolve here.
    const asset = await withDirectPostgres(async (sql) => {
      const rows = await sql<OwnedClientMetaAsset[]>`
        select cma.id::text as client_meta_asset_id,
               cma.client_id,
               ma.id::text as id,
               ma.asset_id,
               mi.id::text as integration_id,
               mi.user_id::text as integration_user_id,
               mi.status as integration_status,
               mi.access_token_encrypted
        from public.client_meta_assets cma
        join public.client_identity ci
          on ci.user_id = cma.user_id
         and ci.client_id = cma.client_id
         and ci.archived_at is null
        join public.meta_assets ma
          on ma.id = cma.meta_asset_id
        join public.meta_integrations mi
          on mi.id = ma.integration_id
         and mi.user_id::text = cma.user_id::text
        where cma.id::text = ${clientMetaAssetId}
          and cma.user_id::text = ${userId}
          and cma.unlinked_at is null
          and ma.asset_type = 'adaccount'
        limit 1
      `;
      return rows[0] || null;
    });

    if (!asset) {
      console.error('Client Meta asset link was not found or is not active', {
        userId,
        clientMetaAssetId,
      });
      throw new HttpError('Conta Meta não vinculada a um cliente ativo.', 403);
    }

    if (asset.integration_user_id !== userId) {
      throw new HttpError('Integração não pertence ao usuário', 403);
    }

    if (asset.integration_status !== 'active') {
      throw new HttpError('A integração não está ativa', 403);
    }

    const integration = {
      id: asset.integration_id,
      user_id: asset.integration_user_id,
      status: asset.integration_status,
      access_token_encrypted: asset.access_token_encrypted,
    };
    const adAccountId = asset.asset_id;
    const resolvedMetaAssetId = asset.id;
    const resolvedClientId = asset.client_id;
    assertSafeMetaId(adAccountId, 'stored Meta ad account id', 500);

    const accessToken = await decryptToken(integration.access_token_encrypted);
    const appSecret = Deno.env.get('META_APP_SECRET');
    if (!appSecret) throw new Error('META_APP_SECRET is not configured');

    const collectionContract = {
      collectionContractVersion: COLLECTION_CONTRACT_VERSION,
      metricDefinitionVersion: METRIC_DEFINITION_VERSION,
      graphApiVersion: META_GRAPH_VERSION,
      endpoint: 'meta-sync-ads',
      clientMetaAssetId,
      clientId: resolvedClientId,
      metaAssetId: resolvedMetaAssetId,
      adAccountId,
      requestedLevel,
      periods,
      runScope,
      selectedEntityIds,
      fields: {
        campaigns: 'id,name,status,objective,daily_budget,lifetime_budget,effective_status',
        adsets: 'id,campaign_id,name,status,effective_status,optimization_goal,destination_type,promoted_object,attribution_setting,daily_budget,lifetime_budget',
        ads: 'id,name,campaign_id,adset_id,status,effective_status,creative{id,name,title,body,object_story_spec,thumbnail_url,image_url,updated_time}',
        campaignInsights: 'campaign_id,date_start,date_stop,impressions,reach,clicks,inline_link_clicks,spend,actions,action_values',
        adsetInsights: 'adset_id,campaign_id,date_start,date_stop,impressions,reach,clicks,inline_link_clicks,spend,actions,action_values',
        adInsights: 'ad_id,adset_id,campaign_id,date_start,date_stop,impressions,reach,clicks,inline_link_clicks,spend,actions,action_values',
        accountInsights: 'date_start,date_stop,impressions,reach,clicks,inline_link_clicks,spend,actions,action_values',
      },
    };
    const requestFingerprint = await buildRequestFingerprint(collectionContract);

    let timezone = 'UNKNOWN';
    let currency = 'UNKNOWN';
    const collectionMessages: string[] = [];
    const collectionWarnings: string[] = [];
    const collectionErrors: string[] = [];
    const rangeDiagnosticsByPeriod: Record<string, PeriodRangeValidation['metadata']> = {};
    let accountContextStatus: PeriodCompletenessStatus = 'complete';

    // Reserve the run before any Graph API request. Database uniqueness and
    // rate limits therefore protect the upstream API as well as persistence.
    const { error: runError } = await supabaseClient.from('meta_sync_runs').insert({
      id: usedRunId,
      user_id: userId,
      integration_id: integration.id,
      ad_account_id: adAccountId,
      graph_api_version: META_GRAPH_VERSION,
      requested_period: periods.join(','),
      timezone: timezone === 'UNKNOWN' ? null : timezone,
      currency: currency === 'UNKNOWN' ? null : currency,
      status: 'running',
      run_scope: runScope,
      requested_level: requestedLevel,
      selected_entity_ids: selectedEntityIds,
      request_fingerprint: requestFingerprint,
      collection_contract_version: COLLECTION_CONTRACT_VERSION,
      metadata: {
        collection_contract: collectionContract,
        collection_contract_version: COLLECTION_CONTRACT_VERSION,
        request_fingerprint: requestFingerprint,
        requested_level: requestedLevel,
        selected_entity_ids: selectedEntityIds,
      },
    });
    if (runError) {
      if (runError.code === '23505') {
        return new Response(JSON.stringify({
          success: false,
          status: 'running',
          runId: null,
          error: {
            code: 'META_SYNC_ALREADY_RUNNING',
            message: 'Uma sincronização idêntica já está em andamento.',
          },
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 409,
        });
      }
      if (runError.message?.includes('rate limit')) {
        throw new HttpError('Muitas sincronizações foram iniciadas. Aguarde um minuto e tente novamente.', 429);
      }
      throw new HttpError(`Failed to create sync run: ${runError.message}`, 500);
    }

    try {
      const account = await fetchMetaGraph({
        endpoint: `/${adAccountId}`,
        accessToken,
        appSecret,
        timeoutMs: 40000,
        maxRetries: 0,
        params: { fields: 'timezone_name,currency' },
      });
      timezone = typeof account?.timezone_name === 'string' && account.timezone_name
        ? account.timezone_name
        : 'UNKNOWN';
      currency = typeof account?.currency === 'string' && account.currency
        ? account.currency
        : 'UNKNOWN';
      if (timezone === 'UNKNOWN' || currency === 'UNKNOWN') {
        accountContextStatus = 'validation_error';
        collectionErrors.push('Meta account timezone or currency is unavailable.');
        collectionMessages.push('Meta account timezone or currency is unavailable.');
      }
    } catch (error) {
      accountContextStatus = 'validation_error';
      const message = `Meta account context unavailable: ${error instanceof Error ? error.message : 'unknown error'}`;
      collectionErrors.push(message);
      collectionMessages.push(message);
    }

    const { error: contextUpdateError } = await supabaseClient
      .from('meta_sync_runs')
      .update({
        timezone: timezone === 'UNKNOWN' ? null : timezone,
        currency: currency === 'UNKNOWN' ? null : currency,
      })
      .match({ id: usedRunId, user_id: userId, status: 'running' });
    if (contextUpdateError) {
      throw new HttpError(`Failed to persist Meta account context: ${contextUpdateError.message}`, 500);
    }

    const fetchCampaigns = fetchMetaGraphPaginated<MetaCampaign>({
      endpoint: `/${adAccountId}/campaigns`,
      accessToken,
      appSecret,
        timeoutMs: 40000,
        maxRetries: 0,
      params: {
        fields: 'id,name,status,objective,daily_budget,lifetime_budget,effective_status',
        limit: '100',
      },
    }, 1, 100);

    const fetchAdsets = fetchMetaGraphPaginated<MetaAdSet>({
      endpoint: `/${adAccountId}/adsets`,
      accessToken,
      appSecret,
        timeoutMs: 40000,
        maxRetries: 0,
      params: {
        fields: 'id,campaign_id,name,status,effective_status,optimization_goal,destination_type,promoted_object,attribution_setting,daily_budget,lifetime_budget',
        limit: '100',
      },
    }, 1, 100);

    const fetchAds = shouldCollectAds
      ? fetchMetaGraphPaginated<MetaAd>({
          endpoint: `/${adAccountId}/ads`,
          accessToken,
          appSecret,
        timeoutMs: 40000,
        maxRetries: 0,
          params: {
            fields: 'id,name,campaign_id,adset_id,status,effective_status,creative{id,name,title,body,object_story_spec,thumbnail_url,image_url,updated_time}',
            filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] }]),
            limit: '100',
          },
        }, 1, 100)
      : Promise.resolve({
          data: [],
          pagesFetched: 0,
          recordsFetched: 0,
          isPartial: false,
          completionStatus: 'complete' as const,
          errorMessage: undefined,
        });

    const [campaignsResult, adsetsResult, adsResult] = await Promise.all([
      fetchCampaigns,
      fetchAdsets,
      fetchAds
    ]);

    if (campaignsResult.errorMessage) collectionMessages.push(`Campaign collection: ${campaignsResult.errorMessage}`);
    if (adsetsResult.errorMessage) collectionMessages.push(`Ad Set collection: ${adsetsResult.errorMessage}`);
    if (adsResult.errorMessage) collectionMessages.push(`Ad collection: ${adsResult.errorMessage}`);
    if (campaignsResult.data.length === 0 && campaignsResult.completionStatus !== 'complete') {
      throw new HttpError('Meta campaign collection failed', 502);
    }

    const allCampaigns = campaignsResult.data;
    let activeCampaigns = allCampaigns;
    let activeAdSets = adsetsResult.data.map((adset) => ({
      ...adset,
      classified_objective: classifyAdSetObjective({
        campaignObjective: allCampaigns.find((campaign) => campaign.id === adset.campaign_id)?.objective || '',
        adsetOptimizationGoal: adset.optimization_goal || undefined,
        adsetDestinationType: adset.destination_type || undefined,
        adsetPromotedObject: adset.promoted_object,
      }),
    }));

    if (selectedCampaignSet.size > 0) {
      activeCampaigns = activeCampaigns.filter((campaign) => selectedCampaignSet.has(campaign.id));
      activeAdSets = activeAdSets.filter((adset) => selectedCampaignSet.has(adset.campaign_id));
    }

    if (selectedAdSetSet.size > 0) {
      activeAdSets = activeAdSets.filter((adset) => selectedAdSetSet.has(adset.id));
      const campaignIdsFromSelectedAdSets = new Set(activeAdSets.map((adset) => adset.campaign_id));
      activeCampaigns = activeCampaigns.filter((campaign) => campaignIdsFromSelectedAdSets.has(campaign.id));
    }

    let activeAds = adsResult.data.filter((ad) => Boolean(ad.id) && Boolean(ad.campaign_id));
    if (shouldCollectAds) {
      if (selectedCampaignSet.size > 0) {
        activeAds = activeAds.filter((ad) => selectedCampaignSet.has(ad.campaign_id));
      }
      if (selectedAdSetSet.size > 0) {
        activeAds = activeAds.filter((ad) => typeof ad.adset_id === 'string' && selectedAdSetSet.has(ad.adset_id));
      }
      if (selectedAdIdsSet.size > 0) {
        activeAds = activeAds.filter((ad) => selectedAdIdsSet.has(ad.id));
      }
      if (selectedCreativeSet.size > 0) {
        activeAds = activeAds.filter((ad) => typeof ad.creative?.id === 'string' && selectedCreativeSet.has(ad.creative.id));
      }

      if (selectedAdIdsSet.size > 0 || selectedCreativeSet.size > 0) {
        const campaignIdsFromSelectedAds = new Set(activeAds.map((ad) => ad.campaign_id));
        const adsetIdsFromSelectedAds = new Set(activeAds
          .map((ad) => ad.adset_id)
          .filter((adsetId): adsetId is string => typeof adsetId === 'string' && adsetId.length > 0)
        );
        activeCampaigns = activeCampaigns.filter((campaign) => campaignIdsFromSelectedAds.has(campaign.id));
        activeAdSets = activeAdSets.filter((adset) => adsetIdsFromSelectedAds.has(adset.id));
      }
    } else {
      activeAds = [];
    }

    const activeCampaignIds = new Set(activeCampaigns.map((campaign) => campaign.id));
    const activeAdSetIds = new Set(activeAdSets.map((adset) => adset.id));
    if (shouldCollectAds) {
      activeAds = activeAds.filter((ad) =>
        activeCampaignIds.has(ad.campaign_id)
        && (!ad.adset_id || activeAdSetIds.has(ad.adset_id))
      );
    }

    const classifiedObjectives = new Map<string, ReturnType<typeof classifyCampaignObjective>>();
    const requiresAdsetInsights = new Set<string>();
    
    // Arrays for bulk RPC insert
    const p_historical_campaigns: any[] = [];
    const p_historical_adsets: any[] = [];
    const p_historical_ads: any[] = [];
    const p_historical_creatives: any[] = [];
    const p_raw_snapshots: any[] = [];
    const p_normalized_metrics: any[] = [];

    for (const adset of activeAdSets) {
      p_historical_adsets.push({
        campaign_id: adset.campaign_id,
        adset_id: adset.id,
        adset_name: adset.name,
        optimization_goal: adset.optimization_goal || null,
        destination_type: adset.destination_type || null,
        promoted_object: {
          ...(adset.promoted_object || {}),
          _camply_daily_budget: adset.daily_budget ?? null,
          _camply_lifetime_budget: adset.lifetime_budget ?? null,
        },
        attribution_setting: adset.attribution_setting || null,
        meta_status: adset.status || null,
        effective_status: adset.effective_status || null,
      });
    }

    const creativeIdsSeen = new Set<string>();
    for (const ad of activeAds) {
      const creativeId = ad.creative?.id || null;
      p_historical_ads.push({
        campaign_id: ad.campaign_id,
        adset_id: ad.adset_id || null,
        ad_id: ad.id,
        ad_name: ad.name,
        creative_id: creativeId,
        meta_status: ad.status || null,
        effective_status: ad.effective_status || null,
      });

      if (creativeId && !creativeIdsSeen.has(creativeId)) {
        creativeIdsSeen.add(creativeId);
        p_historical_creatives.push({
          creative_id: creativeId,
          creative_name: ad.creative?.name || null,
          title: ad.creative?.title || null,
          body: ad.creative?.body || null,
          thumbnail_url: ad.creative?.thumbnail_url || null,
          image_url: ad.creative?.image_url || null,
          object_story_spec: ad.creative?.object_story_spec || null,
          asset_payload: ad.creative || null,
        });
      }
    }

    for (const campaign of activeCampaigns) {
      const campaignAdsets = activeAdSets.filter((adset) => adset.campaign_id === campaign.id);
      const classifiedObjective = classifyCampaignObjective(campaignAdsets.map((adset) => ({
        campaignObjective: campaign.objective,
        adsetOptimizationGoal: adset.optimization_goal || undefined,
        adsetDestinationType: adset.destination_type || undefined,
        adsetPromotedObject: adset.promoted_object,
      })));
      classifiedObjectives.set(campaign.id, classifiedObjective);
      const mix = analyzeCampaignMix(campaignAdsets, campaign.objective);
      if (
        requestedLevel !== 'campaign'
        || mix.structuralMixedAttribution
        || mix.mixedObjective
        || mix.mixedDestination
      ) {
        requiresAdsetInsights.add(campaign.id);
      }

      p_historical_campaigns.push({
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        raw_objective: campaign.objective,
        classified_objective: classifiedObjective,
        meta_status: campaign.status || null,
        effective_status: campaign.effective_status || null,
      });
    }

    const campaignInsightsByPeriod: Record<string, MetaInsightRow[]> = {};
    const accountInsightsByPeriod: Record<string, MetaInsightRow[]> = {};
    const adsetInsightsByPeriod: Record<string, MetaInsightRow[]> = {};
    const adInsightsByPeriod: Record<string, MetaInsightRow[]> = {};
    const collectionStatusByPeriod: Record<string, {
      account: PeriodCompletenessStatus;
      campaign: PeriodCompletenessStatus;
      adset: PeriodCompletenessStatus;
      ad: PeriodCompletenessStatus;
    }> = {};
    
    let totalPagesFetched = campaignsResult.pagesFetched + adsetsResult.pagesFetched + adsResult.pagesFetched;
    let totalRecordsFetched = campaignsResult.recordsFetched + adsetsResult.recordsFetched + adsResult.recordsFetched;

    // --- PARALLEL INSIGHT COLLECTION WITH SERVER-SIDE FILTERING ---
    // Build a filtering rule for the Graph API so that
    // Facebook only computes insights for ACTIVE/PAUSED campaigns,
    // drastically reducing response size and latency.
    const activeStatusFilter = JSON.stringify([
      { field: 'campaign.effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] },
    ]);
    const adsetStatusFilter = JSON.stringify([
      { field: 'adset.effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] },
    ]);

    // Process each period concurrently using Promise.all
    const periodResults = await Promise.all(periods.map(async (period) => {
      const periodParams = insightPeriodParams(period, timezone);

      // Within each period, fetch all levels concurrently
      const [accountInsightsResult, campaignInsightsResult, adsetInsightsResult, adInsightsResult] =
        await Promise.all([
          // Account level (no filtering needed — always a single row)
          fetchMetaGraphPaginated<MetaInsightRow>({
            endpoint: `/${adAccountId}/insights`,
            accessToken,
            appSecret,
        timeoutMs: 40000,
        maxRetries: 0,
            params: {
              level: 'account',
              fields: 'date_start,date_stop,impressions,reach,clicks,inline_link_clicks,spend,actions,action_values',
              ...periodParams,
              limit: '100',
            },
          }, 1, 100),

          // Campaign level — filtered server-side
          fetchMetaGraphPaginated<MetaInsightRow>({
            endpoint: `/${adAccountId}/insights`,
            accessToken,
            appSecret,
        timeoutMs: 40000,
        maxRetries: 0,
            params: {
              level: 'campaign',
              fields: 'campaign_id,date_start,date_stop,impressions,reach,clicks,inline_link_clicks,spend,actions,action_values',
              filtering: activeStatusFilter,
              ...periodParams,
              limit: '100',
            },
          }, 1, 100),

          // Ad set level — only if needed, filtered server-side
          requiresAdsetInsights.size > 0
            ? fetchMetaGraphPaginated<MetaInsightRow>({
                endpoint: `/${adAccountId}/insights`,
                accessToken,
                appSecret,
        timeoutMs: 40000,
        maxRetries: 0,
                params: {
                  level: 'adset',
                  fields: 'adset_id,campaign_id,date_start,date_stop,impressions,reach,clicks,inline_link_clicks,spend,actions,action_values',
                  filtering: adsetStatusFilter,
                  ...periodParams,
                  limit: '100',
                },
              }, 1, 100)
            : Promise.resolve<PaginatedResult<MetaInsightRow>>({
                data: [],
                pagesFetched: 0,
                recordsFetched: 0,
                isPartial: false,
                completionStatus: 'complete',
              }),

          // Ad level — only if needed, filtered server-side
          shouldCollectAds && activeAds.length > 0
            ? fetchMetaGraphPaginated<MetaInsightRow>({
                endpoint: `/${adAccountId}/insights`,
                accessToken,
                appSecret,
        timeoutMs: 40000,
        maxRetries: 0,
                params: {
                  level: 'ad',
                  fields: 'ad_id,adset_id,campaign_id,date_start,date_stop,impressions,reach,clicks,inline_link_clicks,spend,actions,action_values',
                  filtering: activeStatusFilter,
                  ...periodParams,
                  limit: '100',
                },
              }, 1, 100)
            : Promise.resolve<PaginatedResult<MetaInsightRow>>({
                data: [],
                pagesFetched: 0,
                recordsFetched: 0,
                isPartial: false,
                completionStatus: 'complete',
              }),
        ]);

      return { period, accountInsightsResult, campaignInsightsResult, adsetInsightsResult, adInsightsResult };
    }));

    // Reassemble results from the parallel execution into the existing data structures
    for (const { period, accountInsightsResult, campaignInsightsResult, adsetInsightsResult, adInsightsResult } of periodResults) {
      totalPagesFetched += accountInsightsResult.pagesFetched
        + campaignInsightsResult.pagesFetched
        + adsetInsightsResult.pagesFetched
        + adInsightsResult.pagesFetched;
      totalRecordsFetched += accountInsightsResult.recordsFetched
        + campaignInsightsResult.recordsFetched
        + adsetInsightsResult.recordsFetched
        + adInsightsResult.recordsFetched;

      if (accountInsightsResult.errorMessage) {
        collectionMessages.push(`Account insights ${period}: ${accountInsightsResult.errorMessage}`);
      }
      if (campaignInsightsResult.errorMessage) {
        collectionMessages.push(`Campaign insights ${period}: ${campaignInsightsResult.errorMessage}`);
      }
      if (adsetInsightsResult.errorMessage) {
        collectionMessages.push(`Ad Set insights ${period}: ${adsetInsightsResult.errorMessage}`);
      }
      if (adInsightsResult.errorMessage) {
        collectionMessages.push(`Ad insights ${period}: ${adInsightsResult.errorMessage}`);
      }

      accountInsightsByPeriod[period] = accountInsightsResult.data;
      const accountRangeValidation = validateReturnedPeriodRange(
        period,
        accountInsightsResult.data[0],
        timezone
      );
      rangeDiagnosticsByPeriod[period] = accountRangeValidation.metadata;
      for (const warning of accountRangeValidation.warnings) {
        const message = `Account insights ${period}: ${warning}`;
        collectionWarnings.push(message);
        collectionMessages.push(message);
        console.warn(message, accountRangeValidation.metadata);
      }
      for (const validationError of accountRangeValidation.errors) {
        const message = `Account insights ${period}: ${validationError}`;
        collectionErrors.push(message);
        collectionMessages.push(message);
        console.warn(message, accountRangeValidation.metadata);
      }

      const filteredCampaignInsights = campaignInsightsResult.data.filter((row) =>
        Boolean(row.campaign_id) && activeCampaignIds.has(row.campaign_id as string)
      );
      campaignInsightsByPeriod[period] = filteredCampaignInsights;
      
      adsetInsightsByPeriod[period] = adsetInsightsResult.data.filter((row) =>
        row.campaign_id
        && activeCampaignIds.has(row.campaign_id)
        && requiresAdsetInsights.has(row.campaign_id)
        && (!selectedAdSetSet.size || (typeof row.adset_id === 'string' && selectedAdSetSet.has(row.adset_id)))
      );
      const activeAdIds = new Set(activeAds.map((ad) => ad.id));
      adInsightsByPeriod[period] = adInsightsResult.data.filter((row) =>
        typeof row.ad_id === 'string'
        && activeAdIds.has(row.ad_id)
        && (!row.campaign_id || activeCampaignIds.has(row.campaign_id))
        && (!row.adset_id || activeAdSetIds.has(row.adset_id))
      );
      const accountInsight = accountInsightsResult.data[0];
      const accountCollectionStatus = mergeCompletenessStatuses([
        collectionStatus(accountInsightsResult),
        accountContextStatus,
        accountRangeValidation.status,
      ]);

      collectionStatusByPeriod[period] = {
        account: accountCollectionStatus === 'complete' && accountInsight && !insightHasDelivery(accountInsight)
          ? 'zero_delivery'
          : accountCollectionStatus,
        campaign: mergeCompletenessStatuses([
          collectionStatus(campaignInsightsResult),
          accountContextStatus,
        ]),
        adset: mergeCompletenessStatuses([
          collectionStatus(adsetInsightsResult),
          accountContextStatus,
        ]),
        ad: mergeCompletenessStatuses([
          collectionStatus(adInsightsResult),
          accountContextStatus,
        ]),
      };

      p_raw_snapshots.push({
        entity_level: 'account',
        entity_id: period,
        endpoint: `/${adAccountId}/insights?level=account&date_preset=${period}`,
        payload: accountInsightsResult.data,
        date_start: accountInsightsResult.data[0]?.date_start || null,
        date_stop: accountInsightsResult.data[0]?.date_stop || null,
        page_number: 1,
      });

      p_raw_snapshots.push({
        entity_level: 'campaign',
        entity_id: period,
        endpoint: `/${adAccountId}/insights?level=campaign&date_preset=${period}`,
        payload: filteredCampaignInsights,
        date_start: filteredCampaignInsights[0]?.date_start || null,
        date_stop: filteredCampaignInsights[0]?.date_stop || null,
        page_number: 1,
      });

      if (requiresAdsetInsights.size > 0) {
        p_raw_snapshots.push({
          entity_level: 'adset',
          entity_id: period,
          endpoint: `/${adAccountId}/insights?level=adset&date_preset=${period}`,
          payload: adsetInsightsByPeriod[period],
          date_start: adsetInsightsByPeriod[period][0]?.date_start || null,
          date_stop: adsetInsightsByPeriod[period][0]?.date_stop || null,
          page_number: 1,
        });
      }

      if (shouldCollectAds && activeAds.length > 0) {
        p_raw_snapshots.push({
          entity_level: 'ad',
          entity_id: period,
          endpoint: `/${adAccountId}/insights?level=ad&date_preset=${period}`,
          payload: adInsightsByPeriod[period],
          date_start: adInsightsByPeriod[period][0]?.date_start || null,
          date_stop: adInsightsByPeriod[period][0]?.date_stop || null,
          page_number: 1,
        });
      }
    }

    const campaignsWithInsights = [];
    const overallCompletenessByPeriod: Record<string, PeriodCompletenessStatus> = {};

    for (const period of periods) {
      const accountInsight = accountInsightsByPeriod[period][0];
      if (!accountInsight) continue;
      const accountNormalized = [
        'UNCLASSIFIED',
        'WHATSAPP',
        'SALES',
        'LEADS',
        'TRAFFIC',
      ].reduce<Record<string, ReturnType<typeof normalizeMetaMetrics>[string]>>((metrics, objective) => ({
        ...metrics,
        ...normalizeMetaMetrics([accountInsight], objective as Parameters<typeof normalizeMetaMetrics>[1], 'account'),
      }), {});

      Object.entries(accountNormalized).forEach(([metricId, result]) => {
        p_normalized_metrics.push({
          campaign_id: null,
          adset_id: null,
          metric_id: metricId,
          metric_value: result.value,
          action_type: result.metadata.action_types?.join(',') || null,
          source_field: result.metadata.source_field || null,
          date_start: accountInsight.date_start || null,
          date_stop: accountInsight.date_stop || null,
          timezone: timezone === 'UNKNOWN' ? null : timezone,
          attribution_setting: null,
          source_level: 'account',
          completeness_status: collectionStatusByPeriod[period].account,
          calculation_metadata: result.metadata,
        });
      });
      overallCompletenessByPeriod[period] = collectionStatusByPeriod[period].account;
    }

    for (const campaign of activeCampaigns) {
      const campaignAdsets = activeAdSets.filter((adset) => adset.campaign_id === campaign.id);
      const campaignAds = activeAds.filter((ad) => ad.campaign_id === campaign.id);
      const globalMetricsByPeriod: Record<string, unknown> = {};
      const attributionGroupsByPeriod: Record<string, unknown[]> = {};
      const completenessByPeriod: Record<string, PeriodCompleteness> = {};
      const mixedAttributionByPeriod: Record<string, boolean> = {};
      const trendSignatures: TrendPeriodSignature[] = [];
      let structuralMix = analyzeCampaignMix(campaignAdsets, campaign.objective);

      for (const period of periods) {
        const campaignInsight = campaignInsightsByPeriod[period]
          .find((row) => row.campaign_id === campaign.id);
        const adsetInsights = adsetInsightsByPeriod[period]
          .filter((row) => row.campaign_id === campaign.id);
        const adInsights = adInsightsByPeriod[period]
          .filter((row) => row.campaign_id === campaign.id);
        
        // Pass adset insights properly to analytics aggregation
        const analytics = buildCampaignPeriodAnalytics(
          campaign,
          campaignAdsets,
          campaignInsight,
          adsetInsights,
          {
            campaignCollectionStatus: collectionStatusByPeriod[period].campaign,
            adsetCollectionStatus: collectionStatusByPeriod[period].adset,
            timezone,
            currency,
            failedAdsetIds: [],
          }
        );
        structuralMix = analytics.mix;
        if (analytics.globalMetrics) globalMetricsByPeriod[period] = analytics.globalMetrics;
        attributionGroupsByPeriod[period] = analytics.attributionGroups;
        completenessByPeriod[period] = analytics.completeness;
        mixedAttributionByPeriod[period] = analytics.mix.effectiveMixedAttribution;
        overallCompletenessByPeriod[period] = mergeCompletenessStatuses([
          overallCompletenessByPeriod[period] || 'complete',
          analytics.completeness.status,
        ]);

        const persistAtAdsetLevel = requiresAdsetInsights.has(campaign.id);
        
        // ALWAYS persist global campaign metrics
        if (campaignInsight) {
          const globalNormalized = normalizeMetaMetrics(
            [campaignInsight],
            classifiedObjectives.get(campaign.id) || 'UNCLASSIFIED',
            campaign.id
          );
          Object.entries(globalNormalized).forEach(([metricId, result]) => {
            p_normalized_metrics.push({
              campaign_id: campaign.id,
              adset_id: null,
              metric_id: metricId,
              metric_value: result.value,
              action_type: result.metadata.action_types?.join(',') || null,
              source_field: result.metadata.source_field || null,
              date_start: campaignInsight.date_start || null,
              date_stop: campaignInsight.date_stop || null,
              timezone: timezone === 'UNKNOWN' ? null : timezone,
              attribution_setting: campaignAdsets[0]?.attribution_setting || null,
              source_level: 'campaign', // explicitly global
              completeness_status: analytics.completeness.status,
              calculation_metadata: result.metadata,
            });
          });
        }

        // ALSO persist adset metrics if it's mixed destination/objective/attribution
        if (persistAtAdsetLevel) {
          for (const insight of adsetInsights) {
            const adset = campaignAdsets.find((candidate) => candidate.id === insight.adset_id);
            if (!adset) continue;
            
            // IMPORTANT: Overwrite insight.attribution_setting with the DB value if the API didn't return it!
            // Wait, the API returns it if we ask for it (which we don't in the mock graph insights right now, but we do for adsets).
            // Normalizer expects the insight object.
            const normalized = normalizeMetaMetrics(
              [insight],
              adset.classified_objective || 'UNCLASSIFIED',
              campaign.id,
              adset.id
            );
            Object.entries(normalized).forEach(([metricId, result]) => {
              p_normalized_metrics.push({
                campaign_id: campaign.id,
                adset_id: adset.id,
                metric_id: metricId,
                metric_value: result.value,
                action_type: result.metadata.action_types?.join(',') || null,
                source_field: result.metadata.source_field || null,
                date_start: insight.date_start || null,
                date_stop: insight.date_stop || null,
                timezone: timezone === 'UNKNOWN' ? null : timezone,
                attribution_setting: adset.attribution_setting || null,
                source_level: 'adset', // explicitly adset
                completeness_status: collectionStatusByPeriod[period].adset, // strictly the adset completion status
                calculation_metadata: result.metadata,
              });
            });
          }
        }

        if (shouldCollectAds) {
          for (const insight of adInsights) {
            const adId = typeof insight.ad_id === 'string' ? insight.ad_id : null;
            if (!adId) continue;
            const ad = campaignAds.find((candidate) => candidate.id === adId);
            if (!ad) continue;

            const adset = campaignAdsets.find((candidate) => candidate.id === ad.adset_id);
            const normalized = normalizeMetaMetrics(
              [insight],
              adset?.classified_objective || classifiedObjectives.get(campaign.id) || 'UNCLASSIFIED',
              campaign.id,
              ad.adset_id
            );
            Object.entries(normalized).forEach(([metricId, result]) => {
              p_normalized_metrics.push({
                campaign_id: campaign.id,
                adset_id: ad.adset_id || null,
                ad_id: ad.id,
                creative_id: ad.creative?.id || null,
                metric_id: metricId,
                metric_value: result.value,
                action_type: result.metadata.action_types?.join(',') || null,
                source_field: result.metadata.source_field || null,
                date_start: insight.date_start || null,
                date_stop: insight.date_stop || null,
                timezone: timezone === 'UNKNOWN' ? null : timezone,
                attribution_setting: adset?.attribution_setting || null,
                source_level: 'ad',
                completeness_status: collectionStatusByPeriod[period].ad,
                calculation_metadata: result.metadata,
              });
            });
          }
        }

        trendSignatures.push({
          period,
          attributionSettings: analytics.mix.effectiveAttributionSettings,
          sourceLevel: analytics.completeness.sourceLevel,
          timezone: analytics.completeness.timezone,
          objectiveGroups: analytics.attributionGroups
            .filter((group) => group.completeness === 'complete')
            .map((group) => group.classifiedObjective),
          completenessStatus: completenessByPeriod[period].status,
          dateStart: analytics.completeness.dateStart,
          dateStop: analytics.completeness.dateStop,
          metricDefinitionVersion: METRIC_DEFINITION_VERSION,
        });
      }

      const trendAvailabilityByPeriod = buildTrendAvailabilityByPeriod(trendSignatures);
      const lastPeriodTrend = trendAvailabilityByPeriod[periods[periods.length - 1]];
      const classifiedAdsetsWithAds = campaignAdsets.map((adset) => ({
        ...adset,
        ads: campaignAds
          .filter((ad) => ad.adset_id === adset.id)
          .map((ad) => ({
            id: ad.id,
            name: ad.name,
            status: ad.status || ad.effective_status || 'UNKNOWN',
            effective_status: ad.effective_status,
            creative_id: ad.creative?.id || null,
            creative: ad.creative || null,
            metricsByPeriod: Object.fromEntries(periods.map((period) => {
              const insight = adInsightsByPeriod[period]?.find((row) => row.ad_id === ad.id);
              if (!insight) return [period, {}];
              const normalized = normalizeMetaMetrics(
                [insight],
                adset.classified_objective || classifiedObjectives.get(campaign.id) || 'UNCLASSIFIED',
                campaign.id,
                ad.adset_id
              );
              return [period, {
                ...Object.fromEntries(Object.entries(normalized).map(([metricId, result]) => [metricId, result.value])),
                sourceLevel: 'ad',
                dateStart: insight.date_start || null,
                dateStop: insight.date_stop || null,
                timezone,
                currency,
              }];
            })),
          })),
      }));
      campaignsWithInsights.push({
        ...campaign,
        classifiedAdsets: classifiedAdsetsWithAds,
        classifiedObjective: classifiedObjectives.get(campaign.id) || 'UNCLASSIFIED',
        structuralMixedAttribution: structuralMix.structuralMixedAttribution,
        mixedAttribution: Object.values(mixedAttributionByPeriod).some(Boolean),
        mixedAttributionByPeriod,
        mixedObjective: structuralMix.mixedObjective,
        mixedDestination: structuralMix.mixedDestination,
        globalMetricsByPeriod,
        attributionGroupsByPeriod,
        completenessByPeriod,
        trendAvailabilityByPeriod,
        trendAvailable: lastPeriodTrend?.available || false,
        trendUnavailableReason: lastPeriodTrend?.reason || null,
      });
    }

    const adCollectionIncomplete = shouldCollectAds
      && (
        adsResult.completionStatus !== 'complete'
        || Object.values(collectionStatusByPeriod).some((status) => isIncomplete(status.ad))
      );
    const accountMetricRows = p_normalized_metrics.filter((metric) => metric.source_level === 'account');
    const accountDeliveryDetected = accountInsightsByPeriod[periods[0]]?.some((row) => insightHasDelivery(row)) ?? false;
    if (accountDeliveryDetected && accountMetricRows.length === 0) {
      const message = 'Account delivery was detected but no account-level metrics were prepared for persistence.';
      collectionErrors.push(message);
      collectionMessages.push(message);
    }
    if (accountMetricRows.some((metric) => !metric.date_start || !metric.date_stop)) {
      const message = 'Account-level metrics contain missing date_start or date_stop.';
      collectionErrors.push(message);
      collectionMessages.push(message);
    }
    if (timezone === 'UNKNOWN' || currency === 'UNKNOWN') {
      const message = 'Meta account context is incomplete after collection.';
      if (!collectionErrors.includes(message)) collectionErrors.push(message);
    }
    const collectionIncomplete = Object.values(overallCompletenessByPeriod).some(isIncomplete)
      || campaignsResult.completionStatus !== 'complete'
      || adsetsResult.completionStatus !== 'complete'
      || adCollectionIncomplete
      || accountContextStatus !== 'complete'
      || collectionErrors.length > 0;
    
    // Using partial if collection is incomplete.
    const syncStatus = collectionIncomplete ? 'partial' : 'success';
    const errorMessage = collectionMessages.join(' ').trim();
    
    const p_metadata = {
      error_message: errorMessage || null,
      completeness_by_period: overallCompletenessByPeriod,
      collection_contract: collectionContract,
      collection_contract_version: COLLECTION_CONTRACT_VERSION,
      request_fingerprint: requestFingerprint,
      requested_level: requestedLevel,
      selected_entity_ids: selectedEntityIds,
      collection_warnings: collectionWarnings,
      collection_errors: collectionErrors,
      range_diagnostics_by_period: rangeDiagnosticsByPeriod,
      // Traceability fields to compare this run against the Ads Manager, per the
      // linked-client sync contract: which client/account this run actually
      // covered, and exactly how each period was requested from the Graph API.
      sync_reconciliation: {
        clientMetaAssetId,
        clientId: resolvedClientId,
        metaAssetId: resolvedMetaAssetId,
        adAccountId,
        periods,
        timezone: timezone === 'UNKNOWN' ? null : timezone,
        currency: currency === 'UNKNOWN' ? null : currency,
        requestedLevel,
        runScope,
        graphApiVersion: META_GRAPH_VERSION,
        periodParamsByPeriod: Object.fromEntries(periods.map((period) => [period, insightPeriodParams(period, timezone)])),
      },
    };
    const terminationReason = syncStatus === 'success' ? 'completed' : 'partial_collection';

    const collectedRanges = p_normalized_metrics
      .filter((metric) => metric.source_level === 'account' && metric.date_start && metric.date_stop);
    const dateStart = collectedRanges[0]?.date_start || null;
    const dateStop = collectedRanges[0]?.date_stop || null;
    const { error: contextError } = await supabaseClient.from('meta_sync_runs').update({
      date_start: dateStart,
      date_stop: dateStop,
      timezone: timezone === 'UNKNOWN' ? null : timezone,
      currency: currency === 'UNKNOWN' ? null : currency,
    }).match({ id: usedRunId, status: 'running' });
    if (contextError) {
      throw new HttpError(`Failed to persist run context: ${contextError.message}`, 500);
    }

    // CALL THE ATOMIC RPC!
    const { error: rpcError } = await supabaseClient.rpc('persist_meta_sync_run', {
        p_run_id: usedRunId,
        p_user_id: userId,
        p_integration_id: integration.id,
        p_ad_account_id: adAccountId,
        p_final_status: syncStatus,
        p_raw_snapshots: p_raw_snapshots,
        p_campaign_entities: p_historical_campaigns,
        p_adset_entities: p_historical_adsets,
        p_normalized_metrics: p_normalized_metrics,
        p_ad_entities: p_historical_ads,
        p_creative_entities: p_historical_creatives,
        p_metadata: p_metadata,
        p_termination_reason: terminationReason,
        p_pages_fetched: totalPagesFetched,
        p_records_fetched: totalRecordsFetched
    });

    if (rpcError) {
       console.error("RPC Error:", rpcError);
       throw new HttpError(`Database persistence failed: ${rpcError.message}`, 500);
    }

    const dashboardQualificationRequired = runScope === 'full_account'
      && DASHBOARD_QUALIFIED_REQUESTED_LEVELS.has(requestedLevel)
      && accountMetricRows.length > 0;

    const persisted = syncStatus === 'success'
      ? await verifyPersistedSyncRun(supabaseClient, usedRunId, userId, periods[0])
      : null;
    const successVerificationErrors: string[] = [];
    if (syncStatus === 'success' && persisted) {
      if (persisted.status !== 'success') successVerificationErrors.push(`run status is ${persisted.status || 'missing'}`);
      if (!persisted.finishedAt) successVerificationErrors.push('finished_at was not persisted');
      if (!persisted.dateStart) successVerificationErrors.push('date_start was not persisted');
      if (!persisted.dateStop) successVerificationErrors.push('date_stop was not persisted');
      if (!persisted.timezone) successVerificationErrors.push('timezone was not persisted');
      if (!persisted.currency) successVerificationErrors.push('currency was not persisted');
      if (accountDeliveryDetected && persisted.accountMetricsCount === 0) {
        successVerificationErrors.push('account delivery exists but no account metrics were persisted');
      }
      if (accountMetricRows.length > 0 && persisted.accountMetricsCount === 0) {
        successVerificationErrors.push('prepared account metrics were not readable after persistence');
      }
      if (dashboardQualificationRequired && !persisted.dashboardQualified) {
        successVerificationErrors.push('dashboard cannot qualify this run as the latest reliable account source');
      }
    }

    if (successVerificationErrors.length > 0) {
      throw new HttpError(`Database persistence verification failed: ${successVerificationErrors.join('; ')}`, 500);
    }

    return new Response(JSON.stringify({
      success: syncStatus === 'success' || syncStatus === 'partial',
      status: syncStatus,
      runId: usedRunId,
      campaigns: campaignsWithInsights,
      message: errorMessage || undefined,
      completenessByPeriod: overallCompletenessByPeriod,
      failedAdsetIds: [],
      requestedLevel,
      selectedEntityIds,
      requestFingerprint,
      collectionContractVersion: COLLECTION_CONTRACT_VERSION,
      timezone,
      currency,
      dashboardQualificationRequired,
      persisted,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: syncStatus === 'partial' ? 206 : 200,
    });
  } catch (error) {
    console.error('Meta Sync Error:', error);
    const terminationReason = terminationReasonForError(error);
    if (supabaseClient && userId) {
      try {
        await supabaseClient.from('meta_sync_runs').update({
           status: 'failed',
           error_message: error instanceof Error ? error.message : 'Unexpected Meta sync error',
           termination_reason: terminationReason,
           metadata: {
             error_message: error instanceof Error ? error.message : 'Unexpected Meta sync error',
             termination_reason: terminationReason,
           },
           finished_at: new Date().toISOString()
        }).match({ id: usedRunId, user_id: userId });
      } catch (persistenceError) {
        console.error('Failed to persist Meta sync failure:', persistenceError);
      }
    }
    const errorCode = error instanceof HttpError
      ? error.status === 429
        ? 'META_RATE_LIMITED'
        : error.status === 502
          ? 'META_API_ERROR'
          : error.status === 400 || error.status === 403
            ? 'META_VALIDATION_ERROR'
            : 'META_PERSISTENCE_FAILED'
      : 'META_PERSISTENCE_FAILED';
    return errorResponse(error, corsHeaders, usedRunId, errorCode);
  }
}
serve(handleRequest);
