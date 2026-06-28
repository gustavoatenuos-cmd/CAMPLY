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

interface SyncRequestBody {
  adAccountId?: string;
  syncRunId?: string;
  periods?: string[];
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
}

const METRIC_DEFINITION_VERSION = '2026-06-27.1';

const collectionStatus = <T>(result: PaginatedResult<T>): PeriodCompletenessStatus =>
  result.completionStatus;

const isIncomplete = (status: PeriodCompletenessStatus) =>
  status !== 'complete' && status !== 'zero_delivery';

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

    const body = await req.json() as SyncRequestBody;
    const adAccountId = body.adAccountId?.trim();
    const periods = Array.isArray(body.periods) && body.periods.length > 0
      ? Array.from(new Set(body.periods.filter((period): period is string => typeof period === 'string' && period.length > 0)))
      : ['last_7d'];
    usedRunId = body.syncRunId || generatedRunId;

    if (!adAccountId) throw new HttpError('adAccountId is required', 400);
    if (!/^[0-9a-f-]{36}$/i.test(usedRunId)) throw new HttpError('syncRunId must be a UUID', 400);

    const { data: integration, error: integrationError } = await supabaseClient
      .from('meta_integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (integrationError || !integration) {
      throw new HttpError('No active Meta integration found', 409);
    }

    const accessToken = await decryptToken(integration.access_token_encrypted);
    const appSecret = Deno.env.get('META_APP_SECRET');
    if (!appSecret) throw new Error('META_APP_SECRET is not configured');

    let timezone = 'UNKNOWN';
    let currency = 'UNKNOWN';
    const collectionMessages: string[] = [];
    let accountContextStatus: PeriodCompletenessStatus = 'complete';
    try {
      const account = await fetchMetaGraph({
        endpoint: `/${adAccountId}`,
        accessToken,
        appSecret,
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
        collectionMessages.push('Meta account timezone or currency is unavailable.');
      }
    } catch (error) {
      accountContextStatus = 'validation_error';
      collectionMessages.push(`Meta account context unavailable: ${error instanceof Error ? error.message : 'unknown error'}`);
    }

    // 1. Create run as running
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
    });
    if (runError) throw new HttpError(`Failed to create sync run: ${runError.message}`, 500);

    const campaignsResult = await fetchMetaGraphPaginated<MetaCampaign>({
      endpoint: `/${adAccountId}/campaigns`,
      accessToken,
      appSecret,
      params: {
        fields: 'id,name,status,objective,daily_budget,lifetime_budget,effective_status',
        filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]),
        limit: '100',
      },
    });
    const adsetsResult = await fetchMetaGraphPaginated<MetaAdSet>({
      endpoint: `/${adAccountId}/adsets`,
      accessToken,
      appSecret,
      params: {
        fields: 'id,campaign_id,name,status,effective_status,optimization_goal,destination_type,promoted_object,attribution_setting',
        filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]),
        limit: '100',
      },
    });

    if (campaignsResult.errorMessage) collectionMessages.push(`Campaign collection: ${campaignsResult.errorMessage}`);
    if (adsetsResult.errorMessage) collectionMessages.push(`Ad Set collection: ${adsetsResult.errorMessage}`);
    if (campaignsResult.data.length === 0 && campaignsResult.completionStatus !== 'complete') {
      throw new HttpError('Meta campaign collection failed', 502);
    }

    const activeCampaigns = campaignsResult.data;
    const activeAdSets = adsetsResult.data.map((adset) => ({
      ...adset,
      classified_objective: classifyAdSetObjective({
        campaignObjective: activeCampaigns.find((campaign) => campaign.id === adset.campaign_id)?.objective || '',
        adsetOptimizationGoal: adset.optimization_goal || undefined,
        adsetDestinationType: adset.destination_type || undefined,
        adsetPromotedObject: adset.promoted_object,
      }),
    }));

    const classifiedObjectives = new Map<string, ReturnType<typeof classifyCampaignObjective>>();
    const requiresAdsetInsights = new Set<string>();
    
    // Arrays for bulk RPC insert
    const p_historical_campaigns: any[] = [];
    const p_historical_adsets: any[] = [];
    const p_raw_snapshots: any[] = [];
    const p_normalized_metrics: any[] = [];

    for (const adset of activeAdSets) {
      p_historical_adsets.push({
        campaign_id: adset.campaign_id,
        adset_id: adset.id,
        adset_name: adset.name,
        optimization_goal: adset.optimization_goal || null,
        destination_type: adset.destination_type || null,
        promoted_object: adset.promoted_object || null,
        attribution_setting: adset.attribution_setting || null,
        meta_status: adset.status || null,
        effective_status: adset.effective_status || null,
      });
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
      if (mix.structuralMixedAttribution || mix.mixedObjective || mix.mixedDestination) {
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
    const adsetInsightsByPeriod: Record<string, MetaInsightRow[]> = {};
    const collectionStatusByPeriod: Record<string, {
      campaign: PeriodCompletenessStatus;
      adset: PeriodCompletenessStatus;
    }> = {};
    
    let totalPagesFetched = campaignsResult.pagesFetched + adsetsResult.pagesFetched;
    let totalRecordsFetched = campaignsResult.recordsFetched + adsetsResult.recordsFetched;

    for (const period of periods) {
      const campaignInsightsResult = await fetchMetaGraphPaginated<MetaInsightRow>({
        endpoint: `/${adAccountId}/insights`,
        accessToken,
        appSecret,
        params: {
          level: 'campaign',
          fields: 'campaign_id,date_start,date_stop,impressions,reach,inline_link_clicks,spend,actions,action_values',
          date_preset: period,
          limit: '100',
        },
      });
      totalPagesFetched += campaignInsightsResult.pagesFetched;
      totalRecordsFetched += campaignInsightsResult.recordsFetched;
      if (campaignInsightsResult.errorMessage) {
        collectionMessages.push(`Campaign insights ${period}: ${campaignInsightsResult.errorMessage}`);
      }

      let adsetInsightsResult: PaginatedResult<MetaInsightRow> = {
        data: [],
        pagesFetched: 0,
        recordsFetched: 0,
        isPartial: false,
        completionStatus: 'complete',
      };
      if (requiresAdsetInsights.size > 0) {
        adsetInsightsResult = await fetchMetaGraphPaginated<MetaInsightRow>({
          endpoint: `/${adAccountId}/insights`,
          accessToken,
          appSecret,
          params: {
            level: 'adset',
            fields: 'adset_id,campaign_id,date_start,date_stop,impressions,inline_link_clicks,spend,actions,action_values',
            date_preset: period,
            limit: '100',
          },
        });
        totalPagesFetched += adsetInsightsResult.pagesFetched;
        totalRecordsFetched += adsetInsightsResult.recordsFetched;
        if (adsetInsightsResult.errorMessage) {
          collectionMessages.push(`Ad Set insights ${period}: ${adsetInsightsResult.errorMessage}`);
        }
      }

      campaignInsightsByPeriod[period] = campaignInsightsResult.data;
      adsetInsightsByPeriod[period] = adsetInsightsResult.data.filter((row) =>
        row.campaign_id && requiresAdsetInsights.has(row.campaign_id)
      );
      collectionStatusByPeriod[period] = {
        campaign: mergeCompletenessStatuses([
          collectionStatus(campaignInsightsResult),
          accountContextStatus,
        ]),
        adset: mergeCompletenessStatuses([
          collectionStatus(adsetInsightsResult),
          accountContextStatus,
        ]),
      };

      p_raw_snapshots.push({
        entity_level: 'campaign',
        entity_id: period,
        endpoint: `/${adAccountId}/insights?level=campaign&date_preset=${period}`,
        payload: campaignInsightsResult.data,
        date_start: campaignInsightsResult.data[0]?.date_start || null,
        date_stop: campaignInsightsResult.data[0]?.date_stop || null,
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
    }

    const campaignsWithInsights = [];
    const overallCompletenessByPeriod: Record<string, PeriodCompletenessStatus> = {};

    for (const campaign of activeCampaigns) {
      const campaignAdsets = activeAdSets.filter((adset) => adset.campaign_id === campaign.id);
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
                source_level: analytics.completeness.sourceLevel,
                completeness_status: analytics.completeness.status,
                calculation_metadata: result.metadata,
              });
            });
          }
        } else if (campaignInsight) {
          const normalized = normalizeMetaMetrics(
            [campaignInsight],
            classifiedObjectives.get(campaign.id) || 'UNCLASSIFIED',
            campaign.id
          );
          Object.entries(normalized).forEach(([metricId, result]) => {
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
              source_level: analytics.completeness.sourceLevel,
              completeness_status: analytics.completeness.status,
              calculation_metadata: result.metadata,
            });
          });
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
      campaignsWithInsights.push({
        ...campaign,
        classifiedAdsets: campaignAdsets,
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

    const collectionIncomplete = Object.values(overallCompletenessByPeriod).some(isIncomplete)
      || campaignsResult.completionStatus !== 'complete'
      || adsetsResult.completionStatus !== 'complete'
      || accountContextStatus !== 'complete';
    
    // Using partial if collection is incomplete.
    const syncStatus = collectionIncomplete ? 'partial' : 'success';
    const errorMessage = collectionMessages.join(' ').trim();
    
    const p_metadata = {
      error_message: errorMessage || null,
      completeness_by_period: overallCompletenessByPeriod,
    };

    // CALL THE ATOMIC RPC!
    const { error: rpcError } = await supabaseClient.rpc('persist_meta_sync_run', {
        p_run_id: usedRunId,
        p_user_id: userId,
        p_integration_id: integration.id,
        p_ad_account_id: adAccountId,
        p_status: syncStatus,
        p_raw_snapshots: p_raw_snapshots,
        p_historical_campaigns: p_historical_campaigns,
        p_historical_adsets: p_historical_adsets,
        p_normalized_metrics: p_normalized_metrics,
        p_metadata: p_metadata,
        p_pages_fetched: totalPagesFetched,
        p_records_fetched: totalRecordsFetched
    });

    if (rpcError) {
       console.error("RPC Error:", rpcError);
       throw new HttpError(`Database persistence failed: ${rpcError.message}`, 500);
    }

    return new Response(JSON.stringify({
      success: syncStatus === 'success',
      status: syncStatus,
      runId: usedRunId,
      campaigns: campaignsWithInsights,
      message: errorMessage || undefined,
      completenessByPeriod: overallCompletenessByPeriod,
      failedAdsetIds: [],
      timezone,
      currency,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Meta Sync Error:', error);
    if (supabaseClient && userId) {
      try {
        await supabaseClient.from('meta_sync_runs').update({
           status: 'failed',
           error_message: error instanceof Error ? error.message : 'Unexpected Meta sync error',
           finished_at: new Date().toISOString()
        }).match({ id: usedRunId, user_id: userId });
      } catch (persistenceError) {
        console.error('Failed to persist Meta sync failure:', persistenceError);
      }
    }
    return errorResponse(error, corsHeaders);
  }
}
serve(handleRequest);
