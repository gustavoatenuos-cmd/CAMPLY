-- Meta campaign operational contract.
--
-- Root cause: public.get_meta_performance_hierarchy (20260710000000) decides a
-- campaign is "active" purely from COALESCE(effective_status, meta_status) = 'ACTIVE'
-- on the latest campaign snapshot row. That's the entire check: no delivery/spend
-- check, no check that any adset/ad under the campaign is actually active, and no
-- way to permanently exclude a campaign from the operational view. Paused campaigns
-- with real spend are silently dropped (a prior attempt at this, 20260708140000,
-- joined a public.meta_campaign_groups table that was never created and was reverted
-- in 20260710000000); campaigns with zero delivery or all-paused structure render as
-- if healthy.
--
-- This migration:
--   1. Adds public.client_meta_campaign_scope so an operator can permanently
--      include/exclude/archive a campaign from the operational view without
--      deleting its historical snapshots.
--   2. Rewrites get_meta_performance_hierarchy's campaign branch to compute a
--      real eligibility verdict per campaign (mirrors the precedence documented in
--      src/lib/performance/campaignDecisionEligibility.ts) and to surface campaigns
--      that fail each part of the contract in named side buckets instead of
--      dropping them silently.
--
-- The 7th parameter (p_scope_filter) cannot be added via a bare CREATE OR REPLACE:
-- Postgres resolves functions by declared arity, so a 7-arg declaration is a
-- distinct overload from the existing 6-arg one, not a replacement -- calling with
-- 6 args would become ambiguous the moment both exist (the exact bug class already
-- fixed once in this repo for upsert_client_analysis_profile). The old signature is
-- dropped explicitly below, and the ACL for the new signature is re-issued -- it does
-- not carry over from the dropped one.

BEGIN;

-- 1. Campaign operational scope -------------------------------------------------

CREATE TABLE IF NOT EXISTS public.client_meta_campaign_scope (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_meta_asset_id UUID NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT,
  scope_status TEXT NOT NULL DEFAULT 'included',
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT client_meta_campaign_scope_asset_user_fk
    FOREIGN KEY (client_meta_asset_id, user_id)
    REFERENCES public.client_meta_assets(id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT client_meta_campaign_scope_status_check
    CHECK (scope_status IN ('included', 'excluded', 'archived'))
);

ALTER TABLE public.client_meta_campaign_scope ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own campaign scope" ON public.client_meta_campaign_scope;
CREATE POLICY "Users can view their own campaign scope"
ON public.client_meta_campaign_scope
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS client_meta_campaign_scope_unique
ON public.client_meta_campaign_scope(user_id, client_meta_asset_id, campaign_id);

CREATE INDEX IF NOT EXISTS client_meta_campaign_scope_out_of_scope_idx
ON public.client_meta_campaign_scope(user_id, client_meta_asset_id)
WHERE scope_status <> 'included';

DROP TRIGGER IF EXISTS trg_client_meta_campaign_scope_updated_at ON public.client_meta_campaign_scope;
CREATE TRIGGER trg_client_meta_campaign_scope_updated_at
BEFORE UPDATE ON public.client_meta_campaign_scope
FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

REVOKE ALL ON public.client_meta_campaign_scope FROM PUBLIC;
REVOKE ALL ON public.client_meta_campaign_scope FROM anon;
REVOKE ALL ON public.client_meta_campaign_scope FROM authenticated;
GRANT SELECT ON public.client_meta_campaign_scope TO authenticated;

CREATE OR REPLACE FUNCTION public.set_client_meta_campaign_scope(
  p_client_meta_asset_id UUID,
  p_campaign_id TEXT,
  p_campaign_name TEXT,
  p_scope_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.client_meta_campaign_scope
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_row public.client_meta_campaign_scope;
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_scope_status NOT IN ('included', 'excluded', 'archived') THEN
    RAISE EXCEPTION 'Invalid scope_status: %', p_scope_status USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.client_meta_assets
    WHERE id = p_client_meta_asset_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Client meta asset not found' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.client_meta_campaign_scope (
    user_id, client_meta_asset_id, campaign_id, campaign_name, scope_status, reason
  ) VALUES (
    v_user_id, p_client_meta_asset_id, p_campaign_id, p_campaign_name, p_scope_status, p_reason
  )
  ON CONFLICT (user_id, client_meta_asset_id, campaign_id) DO UPDATE SET
    campaign_name = EXCLUDED.campaign_name,
    scope_status = EXCLUDED.scope_status,
    reason = EXCLUDED.reason,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.set_client_meta_campaign_scope(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_client_meta_campaign_scope(UUID, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_client_meta_campaign_scope(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- 2. get_meta_performance_hierarchy: real eligibility contract ------------------

DROP FUNCTION IF EXISTS public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER);

CREATE FUNCTION public.get_meta_performance_hierarchy(
  p_client_meta_asset_id UUID,
  p_period TEXT,
  p_level TEXT,
  p_parent_id TEXT DEFAULT NULL,
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 50,
  p_scope_filter TEXT DEFAULT 'operational'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_link RECORD;
  v_run RECORD;
  v_items JSONB := '[]'::jsonb;
  v_total INTEGER := 0;
  v_offset INTEGER := (p_page - 1) * p_page_size;
  v_active_no_delivery_items JSONB := '[]'::jsonb;
  v_active_no_delivery_total INTEGER := 0;
  v_active_without_structure_items JSONB := '[]'::jsonb;
  v_active_without_structure_total INTEGER := 0;
  v_paused_with_spend_items JSONB := '[]'::jsonb;
  v_paused_with_spend_total INTEGER := 0;
  v_unclassified_items JSONB := '[]'::jsonb;
  v_unclassified_total INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated', 'state', 'unauthorized');
  END IF;

  IF p_scope_filter NOT IN ('operational', 'out_of_scope') THEN
    RAISE EXCEPTION 'Invalid scope filter: %', p_scope_filter USING ERRCODE = '22023';
  END IF;

  SELECT cma.id, cma.client_id, ma.id AS meta_asset_id, ma.integration_id,
         ma.asset_id AS ad_account_id, ma.asset_name AS account_name,
         ma.currency, ma.timezone_name
  INTO v_link
  FROM public.client_meta_assets cma
  JOIN public.meta_assets ma ON ma.id = cma.meta_asset_id
  WHERE cma.id = p_client_meta_asset_id
    AND cma.user_id = v_user_id
    AND cma.unlinked_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'asset_not_found', 'state', 'unauthorized');
  END IF;

  SELECT * INTO v_run
  FROM public.meta_sync_runs
  WHERE user_id = v_user_id
    AND integration_id = v_link.integration_id
    AND ad_account_id = v_link.ad_account_id
    AND requested_period = p_period
    AND run_scope = 'full_account'
    AND status = 'success'
  ORDER BY finished_at DESC NULLS LAST, started_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'state', 'period_not_synced',
      'level', p_level, 'period', p_period, 'page', p_page, 'pageSize', p_page_size,
      'total', 0, 'items', '[]'::jsonb,
      'clientId', v_link.client_id, 'clientMetaAssetId', v_link.id,
      'metaAssetId', v_link.meta_asset_id, 'integrationId', v_link.integration_id,
      'adAccountId', v_link.ad_account_id
    );
  END IF;

  IF p_level = 'campaign' AND p_scope_filter = 'out_of_scope' THEN
    -- "Fora da operação": campaigns the operator explicitly excluded/archived via
    -- set_client_meta_campaign_scope. Kept queryable (never deleted), just out of
    -- every operational bucket below.
    SELECT count(*) INTO v_total
    FROM public.meta_campaign_snapshots s
    JOIN public.client_meta_campaign_scope sc
      ON sc.user_id = v_user_id AND sc.client_meta_asset_id = v_link.id AND sc.campaign_id = s.campaign_id
    WHERE s.sync_run_id = v_run.id AND s.user_id = v_user_id
      AND sc.scope_status IN ('excluded', 'archived');

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.campaign_id, 'name', s.campaign_name, 'status', s.meta_status,
      'effectiveStatus', s.effective_status, 'objective', s.raw_objective,
      'classifiedObjective', s.classified_objective, 'destinationType', NULL,
      'attributionSetting', NULL, 'creativeId', NULL,
      'verdict', 'NOT_OPERATIONAL', 'scopeStatus', s.scope_status,
      'hasActiveAdset', NULL, 'adLevelCollected', NULL, 'hasActiveAd', NULL,
      'metrics', public.get_traceable_entity_metrics(
        v_run.id, v_link.id, v_link.ad_account_id, v_link.account_name,
        COALESCE(v_run.currency, v_link.currency), COALESCE(v_run.timezone, v_link.timezone_name),
        'campaign', s.campaign_id, NULL, NULL, NULL, s.classified_objective::text, NULL, NULL
      )
    ) ORDER BY s.campaign_name), '[]'::jsonb) INTO v_items
    FROM (
      SELECT s.*, sc.scope_status
      FROM public.meta_campaign_snapshots s
      JOIN public.client_meta_campaign_scope sc
        ON sc.user_id = v_user_id AND sc.client_meta_asset_id = v_link.id AND sc.campaign_id = s.campaign_id
      WHERE s.sync_run_id = v_run.id AND s.user_id = v_user_id
        AND sc.scope_status IN ('excluded', 'archived')
      ORDER BY s.campaign_name OFFSET v_offset LIMIT p_page_size
    ) s;
  ELSIF p_level = 'campaign' THEN
    -- Eligibility contract (must mirror src/lib/performance/campaignDecisionEligibility.ts):
    --   NOT_OPERATIONAL                 -> excluded/archived via client_meta_campaign_scope
    --   ACTIVE_WITHOUT_ACTIVE_STRUCTURE -> ACTIVE campaign, no ACTIVE adset, or ad-level
    --                                      was collected and none of its ads are ACTIVE
    --   ACTIVE_NO_DELIVERY              -> ACTIVE campaign, active structure, zero real metric
    --   PAUSED_WITH_SPEND               -> not ACTIVE, but spend > 0 in the period
    --   UNCLASSIFIED_DESTINATION        -> ACTIVE, active structure, has delivery, but
    --                                      classified_objective is NULL/UNCLASSIFIED
    --   ANALYZABLE                      -> passes every check above
    --   (no verdict)                    -> not ACTIVE and zero spend; stays invisible,
    --                                      matching this RPC's historical behavior
    WITH campaign_facts AS (
      SELECT
        s.campaign_id, s.campaign_name, s.meta_status, s.effective_status,
        s.raw_objective, s.classified_objective,
        COALESCE(NULLIF(upper(s.effective_status), ''), NULLIF(upper(s.meta_status), ''), '') = 'ACTIVE' AS is_active,
        COALESCE(sc.scope_status, 'included') AS scope_status,
        EXISTS (
          SELECT 1 FROM public.meta_adset_snapshots aset
          WHERE aset.sync_run_id = v_run.id AND aset.user_id = v_user_id AND aset.campaign_id = s.campaign_id
            AND COALESCE(NULLIF(upper(aset.effective_status), ''), NULLIF(upper(aset.meta_status), ''), '') = 'ACTIVE'
        ) AS has_active_adset,
        EXISTS (
          SELECT 1 FROM public.meta_ad_snapshots ad
          WHERE ad.sync_run_id = v_run.id AND ad.user_id = v_user_id AND ad.campaign_id = s.campaign_id
        ) AS ad_level_collected,
        EXISTS (
          SELECT 1 FROM public.meta_ad_snapshots ad
          WHERE ad.sync_run_id = v_run.id AND ad.user_id = v_user_id AND ad.campaign_id = s.campaign_id
            AND COALESCE(NULLIF(upper(ad.effective_status), ''), NULLIF(upper(ad.meta_status), ''), '') = 'ACTIVE'
        ) AS has_active_ad,
        EXISTS (
          SELECT 1 FROM public.meta_normalized_metrics m
          WHERE m.sync_run_id = v_run.id AND m.user_id = v_user_id AND m.campaign_id = s.campaign_id
            AND m.source_level = 'campaign' AND m.adset_id IS NULL AND m.ad_id IS NULL
            AND m.metric_id IN (
              'spend', 'impressions', 'reach', 'clicks', 'link_clicks',
              'messaging_conversations_started_total', 'leads', 'purchases', 'purchase_value'
            )
            AND m.metric_value > 0
        ) AS has_real_metric,
        (s.classified_objective IS NOT NULL AND s.classified_objective::text <> 'UNCLASSIFIED') AS is_classifiable,
        COALESCE((
          SELECT m.metric_value FROM public.meta_normalized_metrics m
          WHERE m.sync_run_id = v_run.id AND m.user_id = v_user_id AND m.campaign_id = s.campaign_id
            AND m.source_level = 'campaign' AND m.adset_id IS NULL AND m.ad_id IS NULL AND m.metric_id = 'spend'
          ORDER BY m.created_at DESC LIMIT 1
        ), 0) AS spend
      FROM public.meta_campaign_snapshots s
      LEFT JOIN public.client_meta_campaign_scope sc
        ON sc.user_id = v_user_id AND sc.client_meta_asset_id = v_link.id AND sc.campaign_id = s.campaign_id
      WHERE s.sync_run_id = v_run.id AND s.user_id = v_user_id
    ),
    verdicts AS (
      SELECT *,
        CASE
          WHEN scope_status IN ('excluded', 'archived') THEN 'NOT_OPERATIONAL'
          WHEN is_active AND (NOT has_active_adset OR (ad_level_collected AND NOT has_active_ad))
            THEN 'ACTIVE_WITHOUT_ACTIVE_STRUCTURE'
          WHEN is_active AND NOT has_real_metric THEN 'ACTIVE_NO_DELIVERY'
          WHEN NOT is_active AND spend > 0 THEN 'PAUSED_WITH_SPEND'
          WHEN is_active AND NOT is_classifiable THEN 'UNCLASSIFIED_DESTINATION'
          WHEN is_active THEN 'ANALYZABLE'
          ELSE NULL
        END AS verdict
      FROM campaign_facts
    ),
    shaped AS (
      SELECT v.*,
        jsonb_build_object(
          'id', v.campaign_id, 'name', v.campaign_name, 'status', v.meta_status,
          'effectiveStatus', v.effective_status, 'objective', v.raw_objective,
          'classifiedObjective', v.classified_objective, 'destinationType', NULL,
          'attributionSetting', NULL, 'creativeId', NULL,
          'verdict', v.verdict, 'scopeStatus', v.scope_status,
          'hasActiveAdset', v.has_active_adset, 'adLevelCollected', v.ad_level_collected,
          'hasActiveAd', v.has_active_ad,
          'metrics', public.get_traceable_entity_metrics(
            v_run.id, v_link.id, v_link.ad_account_id, v_link.account_name,
            COALESCE(v_run.currency, v_link.currency), COALESCE(v_run.timezone, v_link.timezone_name),
            'campaign', v.campaign_id, NULL, NULL, NULL, v.classified_objective::text, NULL, NULL
          )
        ) AS row_json
      FROM verdicts v
    )
    SELECT
      (SELECT count(*) FROM shaped WHERE verdict = 'ANALYZABLE'),
      (SELECT COALESCE(jsonb_agg(x.row_json ORDER BY x.campaign_name), '[]'::jsonb)
         FROM (SELECT * FROM shaped WHERE verdict = 'ANALYZABLE' ORDER BY campaign_name OFFSET v_offset LIMIT p_page_size) x),
      (SELECT count(*) FROM shaped WHERE verdict = 'ACTIVE_NO_DELIVERY'),
      (SELECT COALESCE(jsonb_agg(x.row_json ORDER BY x.campaign_name), '[]'::jsonb)
         FROM (SELECT * FROM shaped WHERE verdict = 'ACTIVE_NO_DELIVERY' ORDER BY campaign_name LIMIT 200) x),
      (SELECT count(*) FROM shaped WHERE verdict = 'ACTIVE_WITHOUT_ACTIVE_STRUCTURE'),
      (SELECT COALESCE(jsonb_agg(x.row_json ORDER BY x.campaign_name), '[]'::jsonb)
         FROM (SELECT * FROM shaped WHERE verdict = 'ACTIVE_WITHOUT_ACTIVE_STRUCTURE' ORDER BY campaign_name LIMIT 200) x),
      (SELECT count(*) FROM shaped WHERE verdict = 'PAUSED_WITH_SPEND'),
      (SELECT COALESCE(jsonb_agg(x.row_json ORDER BY x.campaign_name), '[]'::jsonb)
         FROM (SELECT * FROM shaped WHERE verdict = 'PAUSED_WITH_SPEND' ORDER BY campaign_name LIMIT 200) x),
      (SELECT count(*) FROM shaped WHERE verdict = 'UNCLASSIFIED_DESTINATION'),
      (SELECT COALESCE(jsonb_agg(x.row_json ORDER BY x.campaign_name), '[]'::jsonb)
         FROM (SELECT * FROM shaped WHERE verdict = 'UNCLASSIFIED_DESTINATION' ORDER BY campaign_name LIMIT 200) x)
    INTO
      v_total, v_items,
      v_active_no_delivery_total, v_active_no_delivery_items,
      v_active_without_structure_total, v_active_without_structure_items,
      v_paused_with_spend_total, v_paused_with_spend_items,
      v_unclassified_total, v_unclassified_items;
  ELSIF p_level = 'adset' THEN
    SELECT count(*) INTO v_total
    FROM public.meta_adset_snapshots s
    WHERE s.sync_run_id = v_run.id AND s.user_id = v_user_id AND s.campaign_id = p_parent_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.adset_id, 'name', s.adset_name, 'parentId', s.campaign_id,
      'status', s.meta_status, 'effectiveStatus', s.effective_status,
      'objective', s.optimization_goal, 'classifiedObjective', NULL,
      'destinationType', s.destination_type, 'attributionSetting', s.attribution_setting,
      'dailyBudget', public.safe_cast_numeric(s.promoted_object->>'_camply_daily_budget') / 100,
      'lifetimeBudget', public.safe_cast_numeric(s.promoted_object->>'_camply_lifetime_budget') / 100,
      'creativeId', NULL,
      'metrics', public.get_traceable_entity_metrics(
        v_run.id, v_link.id, v_link.ad_account_id, v_link.account_name,
        COALESCE(v_run.currency, v_link.currency), COALESCE(v_run.timezone, v_link.timezone_name),
        'adset', s.campaign_id, s.adset_id, NULL, NULL, NULL, s.destination_type, s.attribution_setting
      )
    ) ORDER BY s.adset_name), '[]'::jsonb) INTO v_items
    FROM (
      SELECT * FROM public.meta_adset_snapshots
      WHERE sync_run_id = v_run.id AND user_id = v_user_id AND campaign_id = p_parent_id
      ORDER BY adset_name OFFSET v_offset LIMIT p_page_size
    ) s;
  ELSIF p_level = 'ad' THEN
    SELECT count(*) INTO v_total
    FROM public.meta_ad_snapshots s
    WHERE s.sync_run_id = v_run.id AND s.user_id = v_user_id AND s.adset_id = p_parent_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.ad_id, 'name', s.ad_name, 'parentId', s.adset_id,
      'campaignId', s.campaign_id, 'status', s.meta_status,
      'effectiveStatus', s.effective_status, 'creativeId', s.creative_id,
      'metrics', public.get_traceable_entity_metrics(
        v_run.id, v_link.id, v_link.ad_account_id, v_link.account_name,
        COALESCE(v_run.currency, v_link.currency), COALESCE(v_run.timezone, v_link.timezone_name),
        'ad', s.campaign_id, s.adset_id, s.ad_id, NULL, NULL, NULL, NULL
      )
    ) ORDER BY s.ad_name), '[]'::jsonb) INTO v_items
    FROM (
      SELECT * FROM public.meta_ad_snapshots
      WHERE sync_run_id = v_run.id AND user_id = v_user_id AND adset_id = p_parent_id
      ORDER BY ad_name OFFSET v_offset LIMIT p_page_size
    ) s;
  ELSE
    SELECT count(*) INTO v_total
    FROM public.meta_ad_snapshots a
    JOIN public.meta_creative_snapshots c
      ON c.sync_run_id = a.sync_run_id AND c.creative_id = a.creative_id
    WHERE a.sync_run_id = v_run.id AND a.user_id = v_user_id AND a.ad_id = p_parent_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', creative.creative_id, 'name', creative.creative_name, 'parentId', creative.ad_id,
      'creativeId', creative.creative_id, 'title', creative.title, 'body', creative.body,
      'thumbnailUrl', creative.thumbnail_url, 'imageUrl', creative.image_url,
      'objectStorySpec', creative.object_story_spec, 'updatedAt', creative.updated_at,
      'metrics', public.get_traceable_entity_metrics(
        v_run.id, v_link.id, v_link.ad_account_id, v_link.account_name,
        COALESCE(v_run.currency, v_link.currency), COALESCE(v_run.timezone, v_link.timezone_name),
        'ad', creative.campaign_id, creative.adset_id, creative.ad_id, creative.creative_id, NULL, NULL, NULL
      )
    ) ORDER BY creative.creative_name), '[]'::jsonb) INTO v_items
    FROM (
      SELECT a.ad_id, a.campaign_id, a.adset_id,
             c.creative_id, c.creative_name, c.title, c.body,
             c.thumbnail_url, c.image_url, c.object_story_spec,
             c.asset_payload->>'updated_time' AS updated_at
      FROM public.meta_ad_snapshots a
      JOIN public.meta_creative_snapshots c
        ON c.sync_run_id = a.sync_run_id AND c.creative_id = a.creative_id
      WHERE a.sync_run_id = v_run.id AND a.user_id = v_user_id AND a.ad_id = p_parent_id
      ORDER BY c.creative_name
      OFFSET v_offset LIMIT p_page_size
    ) creative;
  END IF;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_total = 0 THEN 'empty' ELSE 'ready' END,
    'level', p_level, 'period', p_period, 'page', p_page, 'pageSize', p_page_size,
    'total', v_total, 'items', v_items,
    'activeNoDeliveryItems', v_active_no_delivery_items, 'activeNoDeliveryTotal', v_active_no_delivery_total,
    'activeWithoutActiveStructureItems', v_active_without_structure_items,
    'activeWithoutActiveStructureTotal', v_active_without_structure_total,
    'pausedWithSpendItems', v_paused_with_spend_items, 'pausedWithSpendTotal', v_paused_with_spend_total,
    'unclassifiedDestinationItems', v_unclassified_items, 'unclassifiedDestinationTotal', v_unclassified_total,
    'clientId', v_link.client_id, 'clientMetaAssetId', v_link.id,
    'metaAssetId', v_link.meta_asset_id, 'integrationId', v_link.integration_id,
    'adAccountId', v_link.ad_account_id,
    'currency', COALESCE(v_run.currency, v_link.currency),
    'timezone', COALESCE(v_run.timezone, v_link.timezone_name),
    'dateStart', v_run.date_start,
    'dateStop', v_run.date_stop,
    'run', jsonb_build_object(
      'id', v_run.id,
      'status', v_run.status,
      'startedAt', v_run.started_at,
      'finishedAt', v_run.finished_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT) TO authenticated;

COMMIT;
