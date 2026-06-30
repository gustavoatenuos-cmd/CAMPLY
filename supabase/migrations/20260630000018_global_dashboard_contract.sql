-- Migration 000018: Global performance dashboard contract hardening
-- Keeps account currencies isolated, preserves metric availability/completeness,
-- and exposes account/campaign dimensions required by the UI evaluation layer.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_global_performance_dashboard(
  p_period TEXT DEFAULT 'last_7d',
  p_client_ids TEXT[] DEFAULT NULL,
  p_asset_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_result JSONB;
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_period NOT IN ('today', 'last_7d', 'last_30d') THEN
    RAISE EXCEPTION 'Invalid dashboard period: %', p_period USING ERRCODE = '22023';
  END IF;

  WITH active_clients AS (
    SELECT ci.user_id, ci.client_id, ci.display_name
    FROM public.client_identity ci
    WHERE ci.user_id = v_user_id
      AND ci.archived_at IS NULL
      AND (p_client_ids IS NULL OR ci.client_id = ANY(p_client_ids))
  ),
  active_links AS (
    SELECT cma.id, cma.user_id, cma.client_id, cma.meta_asset_id
    FROM public.client_meta_assets cma
    JOIN active_clients ac
      ON ac.user_id = cma.user_id
     AND ac.client_id = cma.client_id
    WHERE cma.user_id = v_user_id
      AND cma.unlinked_at IS NULL
      AND (p_asset_ids IS NULL OR cma.meta_asset_id = ANY(p_asset_ids))
  ),
  account_rows AS (
    SELECT
      al.id AS client_meta_asset_id,
      al.client_id,
      ma.id AS meta_asset_id,
      ma.integration_id,
      ma.asset_id AS ad_account_id,
      ma.asset_name AS account_name,
      ma.currency,
      ma.timezone_name AS timezone
    FROM active_links al
    JOIN public.meta_assets ma ON ma.id = al.meta_asset_id
    JOIN public.meta_integrations mi
      ON mi.id = ma.integration_id
     AND mi.user_id = v_user_id
  ),
  latest_attempt AS (
    SELECT DISTINCT ON (ar.client_id, ar.meta_asset_id)
      ar.client_id,
      ar.client_meta_asset_id,
      ar.meta_asset_id,
      ar.integration_id,
      ar.ad_account_id,
      r.id,
      r.status,
      r.started_at,
      r.finished_at,
      r.termination_reason,
      r.date_start,
      r.date_stop,
      COALESCE(r.timezone, ar.timezone) AS timezone,
      COALESCE(r.currency, ar.currency) AS currency
    FROM account_rows ar
    JOIN public.meta_sync_runs r
      ON r.user_id = v_user_id
     AND r.integration_id = ar.integration_id
     AND r.ad_account_id = ar.ad_account_id
     AND r.requested_period = p_period
     AND r.run_scope = 'full_account'
     AND r.requested_level = 'campaign'
    ORDER BY ar.client_id, ar.meta_asset_id, r.started_at DESC, r.created_at DESC
  ),
  latest_success AS (
    SELECT DISTINCT ON (ar.client_id, ar.meta_asset_id)
      ar.client_id,
      ar.client_meta_asset_id,
      ar.meta_asset_id,
      ar.integration_id,
      ar.ad_account_id,
      r.id,
      r.status,
      r.started_at,
      r.finished_at,
      r.termination_reason,
      r.date_start,
      r.date_stop,
      COALESCE(r.timezone, ar.timezone) AS timezone,
      COALESCE(r.currency, ar.currency) AS currency
    FROM account_rows ar
    JOIN public.meta_sync_runs r
      ON r.user_id = v_user_id
     AND r.integration_id = ar.integration_id
     AND r.ad_account_id = ar.ad_account_id
     AND r.requested_period = p_period
     AND r.run_scope = 'full_account'
     AND r.requested_level = 'campaign'
     AND r.status = 'success'
    ORDER BY ar.client_id, ar.meta_asset_id, r.finished_at DESC NULLS LAST, r.started_at DESC, r.created_at DESC
  ),
  account_metric_rollup AS (
    SELECT
      ls.client_id,
      ls.client_meta_asset_id,
      ls.meta_asset_id,
      ls.integration_id,
      ls.ad_account_id,
      ls.currency,
      m.metric_id,
      SUM(m.metric_value)::numeric AS metric_value,
      CASE
        WHEN bool_or(COALESCE(m.completeness_status, 'complete') NOT IN ('complete', 'zero_delivery'))
          THEN max(m.completeness_status) FILTER (
            WHERE m.completeness_status IS NOT NULL
              AND m.completeness_status NOT IN ('complete', 'zero_delivery')
          )
        WHEN bool_and(COALESCE(m.completeness_status, 'complete') = 'zero_delivery')
          THEN 'zero_delivery'
        ELSE 'complete'
      END AS completeness_status
    FROM latest_success ls
    JOIN public.meta_normalized_metrics m
      ON m.sync_run_id = ls.id
     AND m.user_id = v_user_id
     AND m.integration_id = ls.integration_id
     AND m.ad_account_id = ls.ad_account_id
     AND (m.source_level = 'campaign' OR (m.source_level IS NULL AND m.adset_id IS NULL AND m.ad_id IS NULL))
    WHERE m.metric_id IN (
      'spend',
      'impressions',
      'link_clicks',
      'whatsapp_conversations_started',
      'messenger_conversations_started',
      'instagram_direct_conversations_started',
      'messaging_conversations_started_generic',
      'messaging_conversations_started_total',
      'leads',
      'purchases',
      'purchase_value'
    )
    GROUP BY
      ls.client_id,
      ls.client_meta_asset_id,
      ls.meta_asset_id,
      ls.integration_id,
      ls.ad_account_id,
      ls.currency,
      m.metric_id
  ),
  account_metric_json AS (
    SELECT
      amr.client_id,
      amr.client_meta_asset_id,
      jsonb_object_agg(
        amr.metric_id,
        jsonb_build_object(
          'value', amr.metric_value,
          'available', true,
          'completenessStatus', amr.completeness_status
        )
        ORDER BY amr.metric_id
      ) AS metrics
    FROM account_metric_rollup amr
    GROUP BY amr.client_id, amr.client_meta_asset_id
  ),
  account_metric_pivot AS (
    SELECT
      amr.client_id,
      amr.client_meta_asset_id,
      max(amr.currency) AS currency,
      SUM(amr.metric_value) FILTER (WHERE amr.metric_id = 'spend') AS spend,
      bool_or(amr.metric_id = 'spend') AS has_spend,
      SUM(amr.metric_value) FILTER (WHERE amr.metric_id = 'impressions') AS impressions,
      bool_or(amr.metric_id = 'impressions') AS has_impressions,
      SUM(amr.metric_value) FILTER (WHERE amr.metric_id = 'link_clicks') AS link_clicks,
      bool_or(amr.metric_id = 'link_clicks') AS has_link_clicks,
      SUM(amr.metric_value) FILTER (WHERE amr.metric_id = 'messaging_conversations_started_total') AS conversations_total,
      bool_or(amr.metric_id = 'messaging_conversations_started_total') AS has_conversations_total,
      SUM(amr.metric_value) FILTER (
        WHERE amr.metric_id IN (
          'whatsapp_conversations_started',
          'messenger_conversations_started',
          'instagram_direct_conversations_started',
          'messaging_conversations_started_generic'
        )
      ) AS conversation_components,
      bool_or(amr.metric_id IN (
        'whatsapp_conversations_started',
        'messenger_conversations_started',
        'instagram_direct_conversations_started',
        'messaging_conversations_started_generic'
      )) AS has_conversation_components,
      SUM(amr.metric_value) FILTER (WHERE amr.metric_id = 'leads') AS leads,
      bool_or(amr.metric_id = 'leads') AS has_leads,
      SUM(amr.metric_value) FILTER (WHERE amr.metric_id = 'purchases') AS purchases,
      bool_or(amr.metric_id = 'purchases') AS has_purchases,
      SUM(amr.metric_value) FILTER (WHERE amr.metric_id = 'purchase_value') AS purchase_value,
      bool_or(amr.metric_id = 'purchase_value') AS has_purchase_value,
      bool_or(amr.completeness_status NOT IN ('complete', 'zero_delivery')) AS has_partial,
      max(amr.completeness_status) FILTER (
        WHERE amr.completeness_status NOT IN ('complete', 'zero_delivery')
      ) AS non_complete_status
    FROM account_metric_rollup amr
    GROUP BY amr.client_id, amr.client_meta_asset_id
  ),
  account_summary AS (
    SELECT
      ls.*,
      COALESCE(amj.metrics, '{}'::jsonb) AS metrics,
      amp.spend,
      COALESCE(amp.has_spend, false) AS has_spend,
      amp.impressions,
      COALESCE(amp.has_impressions, false) AS has_impressions,
      amp.link_clicks,
      COALESCE(amp.has_link_clicks, false) AS has_link_clicks,
      CASE
        WHEN amp.has_conversations_total THEN amp.conversations_total
        WHEN amp.has_conversation_components THEN amp.conversation_components
        ELSE NULL
      END AS conversations,
      COALESCE(amp.has_conversations_total OR amp.has_conversation_components, false) AS has_conversations,
      amp.leads,
      COALESCE(amp.has_leads, false) AS has_leads,
      amp.purchases,
      COALESCE(amp.has_purchases, false) AS has_purchases,
      amp.purchase_value,
      COALESCE(amp.has_purchase_value, false) AS has_purchase_value,
      COALESCE(amp.has_partial, false) AS has_partial,
      amp.non_complete_status
    FROM latest_success ls
    LEFT JOIN account_metric_json amj
      ON amj.client_id = ls.client_id
     AND amj.client_meta_asset_id = ls.client_meta_asset_id
    LEFT JOIN account_metric_pivot amp
      ON amp.client_id = ls.client_id
     AND amp.client_meta_asset_id = ls.client_meta_asset_id
  ),
  group_metric_rollup AS (
    SELECT
      ls.client_id,
      ls.client_meta_asset_id,
      ls.meta_asset_id,
      ls.currency,
      m.campaign_id,
      COALESCE(cs.campaign_name, m.campaign_id, 'Campanha sem nome') AS campaign_name,
      cs.classified_objective::text AS classified_objective,
      COALESCE(m.calculation_metadata->>'destination_type', ads.destination_type) AS destination_type,
      COALESCE(m.attribution_setting, ads.attribution_setting) AS attribution_setting,
      m.metric_id,
      SUM(m.metric_value)::numeric AS metric_value,
      CASE
        WHEN bool_or(COALESCE(m.completeness_status, 'complete') NOT IN ('complete', 'zero_delivery'))
          THEN max(m.completeness_status) FILTER (
            WHERE m.completeness_status IS NOT NULL
              AND m.completeness_status NOT IN ('complete', 'zero_delivery')
          )
        WHEN bool_and(COALESCE(m.completeness_status, 'complete') = 'zero_delivery')
          THEN 'zero_delivery'
        ELSE 'complete'
      END AS completeness_status
    FROM latest_success ls
    JOIN public.meta_normalized_metrics m
      ON m.sync_run_id = ls.id
     AND m.user_id = v_user_id
     AND m.integration_id = ls.integration_id
     AND m.ad_account_id = ls.ad_account_id
     AND (m.source_level = 'campaign' OR (m.source_level IS NULL AND m.adset_id IS NULL AND m.ad_id IS NULL))
     AND m.campaign_id IS NOT NULL
    LEFT JOIN public.meta_campaign_snapshots cs
      ON cs.sync_run_id = m.sync_run_id
     AND cs.campaign_id = m.campaign_id
    LEFT JOIN public.meta_adset_snapshots ads
      ON ads.sync_run_id = m.sync_run_id
     AND ads.campaign_id = m.campaign_id
     AND ads.adset_id = m.adset_id
    GROUP BY
      ls.client_id,
      ls.client_meta_asset_id,
      ls.meta_asset_id,
      ls.currency,
      m.campaign_id,
      COALESCE(cs.campaign_name, m.campaign_id, 'Campanha sem nome'),
      cs.classified_objective::text,
      COALESCE(m.calculation_metadata->>'destination_type', ads.destination_type),
      COALESCE(m.attribution_setting, ads.attribution_setting),
      m.metric_id
  ),
  campaign_groups AS (
    SELECT
      gmr.client_id,
      gmr.client_meta_asset_id,
      gmr.meta_asset_id,
      gmr.currency,
      gmr.campaign_id,
      gmr.campaign_name,
      gmr.classified_objective,
      gmr.destination_type,
      gmr.attribution_setting,
      SUM(gmr.metric_value) FILTER (WHERE gmr.metric_id = 'spend') AS spend,
      CASE
        WHEN bool_or(gmr.completeness_status NOT IN ('complete', 'zero_delivery'))
          THEN max(gmr.completeness_status) FILTER (
            WHERE gmr.completeness_status NOT IN ('complete', 'zero_delivery')
          )
        WHEN bool_and(gmr.completeness_status = 'zero_delivery') THEN 'zero_delivery'
        ELSE 'complete'
      END AS completeness_status,
      jsonb_object_agg(
        gmr.metric_id,
        jsonb_build_object(
          'value', gmr.metric_value,
          'available', true,
          'completenessStatus', gmr.completeness_status
        )
        ORDER BY gmr.metric_id
      ) AS metrics
    FROM group_metric_rollup gmr
    GROUP BY
      gmr.client_id,
      gmr.client_meta_asset_id,
      gmr.meta_asset_id,
      gmr.currency,
      gmr.campaign_id,
      gmr.campaign_name,
      gmr.classified_objective,
      gmr.destination_type,
      gmr.attribution_setting
  ),
  active_targets AS (
    SELECT
      al.client_id,
      t.id,
      t.client_meta_asset_id,
      t.campaign_id,
      t.metric_id,
      t.target_kind,
      t.target_value,
      t.effective_from,
      t.effective_to
    FROM active_links al
    JOIN public.client_performance_targets t
      ON t.user_id = v_user_id
     AND t.client_meta_asset_id = al.id
     AND t.effective_from <= now()
     AND (t.effective_to IS NULL OR t.effective_to > now())
  ),
  client_rollup AS (
    SELECT
      ac.client_id,
      count(DISTINCT ar.meta_asset_id) AS account_count,
      count(DISTINCT asu.currency) FILTER (WHERE asu.has_spend) AS spend_currency_count,
      SUM(asu.spend) FILTER (WHERE asu.has_spend) AS spend,
      COALESCE(bool_or(asu.has_spend), false) AS has_spend,
      SUM(asu.impressions) FILTER (WHERE asu.has_impressions) AS impressions,
      COALESCE(bool_or(asu.has_impressions), false) AS has_impressions,
      SUM(asu.link_clicks) FILTER (WHERE asu.has_link_clicks) AS link_clicks,
      COALESCE(bool_or(asu.has_link_clicks), false) AS has_link_clicks,
      SUM(asu.conversations) FILTER (WHERE asu.has_conversations) AS conversations,
      COALESCE(bool_or(asu.has_conversations), false) AS has_conversations,
      SUM(asu.leads) FILTER (WHERE asu.has_leads) AS leads,
      COALESCE(bool_or(asu.has_leads), false) AS has_leads,
      SUM(asu.purchases) FILTER (WHERE asu.has_purchases) AS purchases,
      COALESCE(bool_or(asu.has_purchases), false) AS has_purchases,
      SUM(asu.purchase_value) FILTER (WHERE asu.has_purchase_value) AS purchase_value,
      COALESCE(bool_or(asu.has_purchase_value), false) AS has_purchase_value,
      COALESCE(bool_or(asu.has_partial), false) AS has_partial,
      max(asu.non_complete_status) AS non_complete_status,
      max(asu.finished_at) AS latest_success_finished_at
    FROM active_clients ac
    LEFT JOIN account_rows ar ON ar.client_id = ac.client_id
    LEFT JOIN account_summary asu ON asu.client_id = ac.client_id
    GROUP BY ac.client_id
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'clientId', ac.client_id,
        'clientName', ac.display_name,
        'clientStatus',
          CASE
            WHEN cr.account_count = 0 THEN 'not_connected'
            WHEN EXISTS (SELECT 1 FROM latest_attempt la WHERE la.client_id = ac.client_id AND la.status = 'running') THEN 'syncing'
            WHEN NOT EXISTS (SELECT 1 FROM latest_attempt la WHERE la.client_id = ac.client_id) THEN 'never_synced'
            WHEN NOT EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id)
              AND EXISTS (SELECT 1 FROM latest_attempt la WHERE la.client_id = ac.client_id AND la.status = 'failed') THEN 'failed'
            WHEN NOT EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id)
              AND EXISTS (SELECT 1 FROM latest_attempt la WHERE la.client_id = ac.client_id AND la.status = 'partial') THEN 'partial'
            WHEN EXISTS (
              SELECT 1
              FROM latest_attempt la
              JOIN latest_success ls ON ls.client_meta_asset_id = la.client_meta_asset_id
              WHERE la.client_id = ac.client_id
                AND la.status = 'failed'
                AND la.started_at > ls.started_at
            ) THEN 'failed'
            WHEN EXISTS (
              SELECT 1
              FROM latest_attempt la
              JOIN latest_success ls ON ls.client_meta_asset_id = la.client_meta_asset_id
              WHERE la.client_id = ac.client_id
                AND la.status = 'partial'
                AND la.started_at > ls.started_at
            ) THEN 'partial'
            WHEN (cr.has_spend OR cr.has_impressions)
              AND COALESCE(cr.spend, 0) = 0
              AND COALESCE(cr.impressions, 0) = 0 THEN 'no_delivery'
            WHEN cr.latest_success_finished_at < now() - interval '36 hours' THEN 'stale'
            ELSE 'available'
          END,
        'accounts', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'clientMetaAssetId', ar.client_meta_asset_id,
              'metaAssetId', ar.meta_asset_id,
              'integrationId', ar.integration_id,
              'adAccountId', ar.ad_account_id,
              'accountName', ar.account_name,
              'currency', COALESCE(asu.currency, ar.currency),
              'timezone', COALESCE(asu.timezone, ar.timezone),
              'dateStart', asu.date_start,
              'dateStop', asu.date_stop,
              'metrics', COALESCE(asu.metrics, '{}'::jsonb),
              'budgetPacing', NULL,
              'dataQuality', jsonb_build_object(
                'status', CASE
                  WHEN asu.id IS NULL THEN 'unavailable'
                  WHEN asu.has_partial THEN 'partial'
                  ELSE 'complete'
                END,
                'reason', CASE
                  WHEN asu.id IS NULL THEN 'no_successful_run'
                  WHEN asu.has_partial THEN asu.non_complete_status
                  ELSE NULL
                END
              ),
              'lastSuccessfulRun', CASE WHEN asu.id IS NULL THEN NULL ELSE jsonb_build_object(
                'id', asu.id,
                'status', asu.status,
                'startedAt', asu.started_at,
                'finishedAt', asu.finished_at,
                'terminationReason', asu.termination_reason
              ) END,
              'lastAttempt', CASE WHEN la.id IS NULL THEN NULL ELSE jsonb_build_object(
                'id', la.id,
                'status', la.status,
                'startedAt', la.started_at,
                'finishedAt', la.finished_at,
                'terminationReason', la.termination_reason
              ) END
            )
            ORDER BY ar.account_name, ar.meta_asset_id
          )
          FROM account_rows ar
          LEFT JOIN account_summary asu ON asu.client_meta_asset_id = ar.client_meta_asset_id
          LEFT JOIN latest_attempt la ON la.client_meta_asset_id = ar.client_meta_asset_id
          WHERE ar.client_id = ac.client_id
        ), '[]'::jsonb),
        'metrics', jsonb_build_object(
          'spend', jsonb_build_object(
            'value', CASE WHEN cr.has_spend AND cr.spend_currency_count <= 1 THEN cr.spend ELSE NULL END,
            'available', cr.has_spend AND cr.spend_currency_count <= 1,
            'completenessStatus', CASE WHEN cr.spend_currency_count > 1 THEN 'mixed_currency' WHEN cr.has_spend THEN COALESCE(cr.non_complete_status, 'complete') ELSE NULL END
          ),
          'impressions', jsonb_build_object('value', CASE WHEN cr.has_impressions THEN cr.impressions ELSE NULL END, 'available', cr.has_impressions, 'completenessStatus', CASE WHEN cr.has_impressions THEN COALESCE(cr.non_complete_status, 'complete') ELSE NULL END),
          'link_clicks', jsonb_build_object('value', CASE WHEN cr.has_link_clicks THEN cr.link_clicks ELSE NULL END, 'available', cr.has_link_clicks, 'completenessStatus', CASE WHEN cr.has_link_clicks THEN COALESCE(cr.non_complete_status, 'complete') ELSE NULL END),
          'messaging_conversations_started_total', jsonb_build_object('value', CASE WHEN cr.has_conversations THEN cr.conversations ELSE NULL END, 'available', cr.has_conversations, 'completenessStatus', CASE WHEN cr.has_conversations THEN COALESCE(cr.non_complete_status, 'complete') ELSE NULL END),
          'cost_per_messaging_conversation', jsonb_build_object(
            'value', CASE WHEN cr.has_spend AND cr.spend_currency_count <= 1 AND cr.has_conversations AND cr.conversations > 0 THEN cr.spend / cr.conversations ELSE NULL END,
            'available', cr.has_spend AND cr.spend_currency_count <= 1 AND cr.has_conversations AND cr.conversations > 0,
            'completenessStatus', CASE WHEN cr.spend_currency_count > 1 THEN 'mixed_currency' WHEN cr.has_conversations THEN COALESCE(cr.non_complete_status, 'complete') ELSE NULL END
          ),
          'leads', jsonb_build_object('value', CASE WHEN cr.has_leads THEN cr.leads ELSE NULL END, 'available', cr.has_leads, 'completenessStatus', CASE WHEN cr.has_leads THEN COALESCE(cr.non_complete_status, 'complete') ELSE NULL END),
          'cost_per_lead', jsonb_build_object(
            'value', CASE WHEN cr.has_spend AND cr.spend_currency_count <= 1 AND cr.has_leads AND cr.leads > 0 THEN cr.spend / cr.leads ELSE NULL END,
            'available', cr.has_spend AND cr.spend_currency_count <= 1 AND cr.has_leads AND cr.leads > 0,
            'completenessStatus', CASE WHEN cr.spend_currency_count > 1 THEN 'mixed_currency' WHEN cr.has_leads THEN COALESCE(cr.non_complete_status, 'complete') ELSE NULL END
          ),
          'purchases', jsonb_build_object('value', CASE WHEN cr.has_purchases THEN cr.purchases ELSE NULL END, 'available', cr.has_purchases, 'completenessStatus', CASE WHEN cr.has_purchases THEN COALESCE(cr.non_complete_status, 'complete') ELSE NULL END),
          'cost_per_purchase', jsonb_build_object(
            'value', CASE WHEN cr.has_spend AND cr.spend_currency_count <= 1 AND cr.has_purchases AND cr.purchases > 0 THEN cr.spend / cr.purchases ELSE NULL END,
            'available', cr.has_spend AND cr.spend_currency_count <= 1 AND cr.has_purchases AND cr.purchases > 0,
            'completenessStatus', CASE WHEN cr.spend_currency_count > 1 THEN 'mixed_currency' WHEN cr.has_purchases THEN COALESCE(cr.non_complete_status, 'complete') ELSE NULL END
          ),
          'purchase_value', jsonb_build_object(
            'value', CASE WHEN cr.has_purchase_value AND cr.spend_currency_count <= 1 THEN cr.purchase_value ELSE NULL END,
            'available', cr.has_purchase_value AND cr.spend_currency_count <= 1,
            'completenessStatus', CASE WHEN cr.spend_currency_count > 1 THEN 'mixed_currency' WHEN cr.has_purchase_value THEN COALESCE(cr.non_complete_status, 'complete') ELSE NULL END
          )
        ),
        'metricGroups', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'clientMetaAssetId', cg.client_meta_asset_id,
              'metaAssetId', cg.meta_asset_id,
              'currency', cg.currency,
              'campaignId', cg.campaign_id,
              'campaignName', cg.campaign_name,
              'classifiedObjective', cg.classified_objective,
              'destinationType', cg.destination_type,
              'attributionSetting', cg.attribution_setting,
              'spend', cg.spend,
              'completenessStatus', cg.completeness_status,
              'metrics', cg.metrics
            )
            ORDER BY cg.campaign_name, cg.campaign_id, cg.classified_objective, cg.destination_type, cg.attribution_setting
          )
          FROM campaign_groups cg
          WHERE cg.client_id = ac.client_id
        ), '[]'::jsonb),
        'resolvedTargets', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', at.id,
              'clientMetaAssetId', at.client_meta_asset_id,
              'campaignId', at.campaign_id,
              'metricId', at.metric_id,
              'targetKind', at.target_kind,
              'targetValue', at.target_value,
              'effectiveFrom', at.effective_from,
              'effectiveTo', at.effective_to
            )
            ORDER BY at.client_meta_asset_id, at.metric_id, at.target_kind, at.campaign_id NULLS FIRST
          )
          FROM active_targets at
          WHERE at.client_id = ac.client_id
        ), '[]'::jsonb),
        'evaluations', '[]'::jsonb,
        'budgetPacing', NULL,
        'dataQuality', jsonb_build_object(
          'status', CASE
            WHEN NOT EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id) THEN 'unavailable'
            WHEN cr.has_partial THEN 'partial'
            WHEN EXISTS (
              SELECT 1
              FROM latest_attempt la
              JOIN latest_success ls ON ls.client_meta_asset_id = la.client_meta_asset_id
              WHERE la.client_id = ac.client_id
                AND la.status IN ('partial', 'failed')
                AND la.started_at > ls.started_at
            ) THEN 'partial'
            ELSE 'complete'
          END,
          'reason', CASE
            WHEN NOT EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id) THEN 'no_successful_run'
            WHEN cr.has_partial THEN cr.non_complete_status
            WHEN EXISTS (
              SELECT 1
              FROM latest_attempt la
              JOIN latest_success ls ON ls.client_meta_asset_id = la.client_meta_asset_id
              WHERE la.client_id = ac.client_id
                AND la.status IN ('partial', 'failed')
                AND la.started_at > ls.started_at
            ) THEN 'newer_incomplete_attempt'
            ELSE NULL
          END
        ),
        'lastSuccessfulRun', (
          SELECT jsonb_build_object(
            'id', ls.id,
            'status', ls.status,
            'startedAt', ls.started_at,
            'finishedAt', ls.finished_at,
            'terminationReason', ls.termination_reason
          )
          FROM latest_success ls
          WHERE ls.client_id = ac.client_id
          ORDER BY ls.finished_at DESC NULLS LAST, ls.started_at DESC
          LIMIT 1
        ),
        'lastAttempt', (
          SELECT jsonb_build_object(
            'id', la.id,
            'status', la.status,
            'startedAt', la.started_at,
            'finishedAt', la.finished_at,
            'terminationReason', la.termination_reason
          )
          FROM latest_attempt la
          WHERE la.client_id = ac.client_id
          ORDER BY la.started_at DESC
          LIMIT 1
        ),
        'hasNewerPartial', EXISTS (
          SELECT 1
          FROM latest_attempt la
          JOIN latest_success ls ON ls.client_meta_asset_id = la.client_meta_asset_id
          WHERE la.client_id = ac.client_id
            AND la.status = 'partial'
            AND la.started_at > ls.started_at
        ),
        'hasNewerFailure', EXISTS (
          SELECT 1
          FROM latest_attempt la
          JOIN latest_success ls ON ls.client_meta_asset_id = la.client_meta_asset_id
          WHERE la.client_id = ac.client_id
            AND la.status = 'failed'
            AND la.started_at > ls.started_at
        )
      )
      ORDER BY ac.display_name, ac.client_id
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM active_clients ac
  LEFT JOIN client_rollup cr ON cr.client_id = ac.client_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_global_performance_dashboard(TEXT, TEXT[], UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_global_performance_dashboard(TEXT, TEXT[], UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_global_performance_dashboard(TEXT, TEXT[], UUID[]) TO authenticated;

COMMIT;
