-- Let a lightweight today/creative refresh become the current Creative Lab
-- structure while period metrics continue to roll up from daily facts.
-- Re-declarations are intentional: the public contracts stay unchanged.

-- Production compatibility: ensure the dedicated Creative Lab row RPC exists.
--
-- Some production environments reached the later verified-depth migration
-- without first receiving 20260924190000. Re-declaring only the row RPC is
-- idempotent and intentionally does not replace the newer account-summary RPC.

-- Creative Lab reads the same persisted Meta snapshots and date-sliced metrics
-- used by Analytics. It does not fetch performance directly from Graph/Claude.
-- One row represents one ad + creative relation; the frontend aggregates rows
-- by creative so reused creatives preserve all delivery without losing lineage.

CREATE OR REPLACE FUNCTION public.get_meta_creative_lab(
  p_client_meta_asset_id UUID,
  p_period TEXT DEFAULT 'last_30d',
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 100
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
  v_offset INTEGER;
  v_is_slice BOOLEAN := p_period IN ('today', 'yesterday', 'today_and_yesterday', 'last_7d', 'last_30d', 'last_90d');
  v_local_today DATE;
  v_date_start DATE;
  v_date_stop DATE;
  v_found BOOLEAN := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('state', 'unauthorized', 'items', '[]'::jsonb, 'total', 0);
  END IF;

  IF p_page < 1 OR p_page_size < 1 OR p_page_size > 200 THEN
    RAISE EXCEPTION 'Invalid creative lab pagination' USING ERRCODE = '22023';
  END IF;
  v_offset := (p_page - 1) * p_page_size;

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
    RETURN jsonb_build_object('state', 'unauthorized', 'items', '[]'::jsonb, 'total', 0);
  END IF;

  IF v_is_slice THEN
    v_local_today := (timezone(COALESCE(v_link.timezone_name, 'America/Sao_Paulo'), now()))::date;
    v_date_stop := CASE WHEN p_period = 'yesterday' THEN v_local_today - 1 ELSE v_local_today END;
    v_date_start := CASE p_period
      WHEN 'today' THEN v_local_today
      WHEN 'yesterday' THEN v_local_today - 1
      WHEN 'today_and_yesterday' THEN v_local_today - 1
      WHEN 'last_7d' THEN v_local_today - 6
      WHEN 'last_30d' THEN v_local_today - 29
      ELSE v_local_today - 89
    END;

    SELECT r.* INTO v_run
    FROM public.meta_sync_runs r
    WHERE r.user_id = v_user_id
      AND r.integration_id = v_link.integration_id
      AND r.ad_account_id = v_link.ad_account_id
      AND r.requested_period IN ('last_90d', 'today')
      AND r.run_scope = 'full_account'
      AND r.status IN ('success', 'partial')
      AND EXISTS (
        SELECT 1 FROM public.meta_ad_snapshots a
        WHERE a.sync_run_id = r.id AND a.user_id = v_user_id
      )
    ORDER BY r.finished_at DESC NULLS LAST, r.started_at DESC
    LIMIT 1;
    v_found := FOUND;
  END IF;

  IF NOT v_found THEN
    v_date_start := NULL;
    v_date_stop := NULL;
    SELECT r.* INTO v_run
    FROM public.meta_sync_runs r
    WHERE r.user_id = v_user_id
      AND r.integration_id = v_link.integration_id
      AND r.ad_account_id = v_link.ad_account_id
      AND r.requested_period = p_period
      AND r.run_scope = 'full_account'
      AND r.status IN ('success', 'partial')
      AND EXISTS (
        SELECT 1 FROM public.meta_ad_snapshots a
        WHERE a.sync_run_id = r.id AND a.user_id = v_user_id
      )
    ORDER BY r.finished_at DESC NULLS LAST, r.started_at DESC
    LIMIT 1;
    v_found := FOUND;
  END IF;

  IF NOT v_found THEN
    RETURN jsonb_build_object(
      'state', 'period_not_synced',
      'items', '[]'::jsonb,
      'total', 0,
      'page', p_page,
      'pageSize', p_page_size,
      'clientId', v_link.client_id,
      'clientMetaAssetId', v_link.id,
      'accountId', v_link.ad_account_id,
      'accountName', v_link.account_name
    );
  END IF;

  SELECT count(*) INTO v_total
  FROM public.meta_ad_snapshots a
  JOIN public.meta_creative_snapshots c
    ON c.sync_run_id = a.sync_run_id
   AND c.user_id = a.user_id
   AND c.creative_id = a.creative_id
  WHERE a.sync_run_id = v_run.id
    AND a.user_id = v_user_id
    AND a.creative_id IS NOT NULL;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'campaignId', row.campaign_id,
      'campaignName', row.campaign_name,
      'campaignStatus', row.campaign_status,
      'campaignEffectiveStatus', row.campaign_effective_status,
      'classifiedObjective', row.classified_objective,
      'adsetId', row.adset_id,
      'adsetName', row.adset_name,
      'adsetStatus', row.adset_status,
      'adsetEffectiveStatus', row.adset_effective_status,
      'adId', row.ad_id,
      'adName', row.ad_name,
      'adStatus', row.ad_status,
      'adEffectiveStatus', row.ad_effective_status,
      'creativeId', row.creative_id,
      'creativeName', row.creative_name,
      'title', row.title,
      'body', row.body,
      'thumbnailUrl', row.thumbnail_url,
      'imageUrl', row.image_url,
      'objectStorySpec', row.object_story_spec,
      'updatedAt', row.updated_at,
      'metrics', public.get_hierarchy_entity_metrics(
        v_date_start, v_date_stop,
        v_run.id, v_link.id, v_link.ad_account_id, v_link.account_name,
        COALESCE(v_run.currency, v_link.currency),
        COALESCE(v_run.timezone, v_link.timezone_name),
        'ad',
        row.campaign_id, row.adset_id, row.ad_id, row.creative_id,
        row.classified_objective::text, row.destination_type, row.attribution_setting
      )
    )
    ORDER BY row.structure_rank, row.creative_name NULLS LAST, row.ad_name
  ), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      a.campaign_id,
      COALESCE(cs.campaign_name, a.campaign_id) AS campaign_name,
      cs.meta_status AS campaign_status,
      cs.effective_status AS campaign_effective_status,
      cs.classified_objective,
      a.adset_id,
      COALESCE(s.adset_name, a.adset_id) AS adset_name,
      s.meta_status AS adset_status,
      s.effective_status AS adset_effective_status,
      s.destination_type,
      s.attribution_setting,
      a.ad_id,
      a.ad_name,
      a.meta_status AS ad_status,
      a.effective_status AS ad_effective_status,
      c.creative_id,
      COALESCE(c.creative_name, c.title, a.ad_name, c.creative_id) AS creative_name,
      c.title,
      c.body,
      c.thumbnail_url,
      c.image_url,
      c.object_story_spec,
      c.asset_payload->>'updated_time' AS updated_at,
      CASE
        WHEN upper(COALESCE(cs.effective_status, cs.meta_status, '')) = 'ACTIVE'
         AND upper(COALESCE(s.effective_status, s.meta_status, '')) = 'ACTIVE'
         AND upper(COALESCE(a.effective_status, a.meta_status, '')) = 'ACTIVE'
        THEN 0 ELSE 1
      END AS structure_rank
    FROM public.meta_ad_snapshots a
    JOIN public.meta_creative_snapshots c
      ON c.sync_run_id = a.sync_run_id
     AND c.user_id = a.user_id
     AND c.creative_id = a.creative_id
    LEFT JOIN public.meta_campaign_snapshots cs
      ON cs.sync_run_id = a.sync_run_id
     AND cs.user_id = a.user_id
     AND cs.campaign_id = a.campaign_id
    LEFT JOIN public.meta_adset_snapshots s
      ON s.sync_run_id = a.sync_run_id
     AND s.user_id = a.user_id
     AND s.adset_id = a.adset_id
    WHERE a.sync_run_id = v_run.id
      AND a.user_id = v_user_id
      AND a.creative_id IS NOT NULL
    ORDER BY structure_rank, creative_name NULLS LAST, a.ad_name
    OFFSET v_offset LIMIT p_page_size
  ) row;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_total = 0 THEN 'empty' ELSE 'ready' END,
    'items', v_items,
    'total', v_total,
    'page', p_page,
    'pageSize', p_page_size,
    'clientId', v_link.client_id,
    'clientMetaAssetId', v_link.id,
    'accountId', v_link.ad_account_id,
    'accountName', v_link.account_name,
    'currency', COALESCE(v_run.currency, v_link.currency),
    'timezone', COALESCE(v_run.timezone, v_link.timezone_name),
    'dateStart', COALESCE(v_date_start, v_run.date_start),
    'dateStop', COALESCE(v_date_stop, v_run.date_stop),
    'runId', v_run.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_meta_creative_lab(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_meta_creative_lab(UUID, TEXT, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_meta_creative_lab(UUID, TEXT, INTEGER, INTEGER) TO authenticated;


-- Move Creative Lab aggregation/classification out of the browser.
--
-- Snapshots + normalized metrics remain the source of truth.
-- This RPC builds a derived, reconstructable dashboard payload and caches it
-- privately by linked-account set + period + resolved sync-run signature.
-- A new Meta sync changes the run signature, so stale cache entries are never read.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.creative_lab_dashboard_cache (
  user_id UUID NOT NULL,
  asset_key TEXT NOT NULL,
  period TEXT NOT NULL,
  run_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  built_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, asset_key, period, run_key)
);

REVOKE ALL ON private.creative_lab_dashboard_cache FROM PUBLIC;
REVOKE ALL ON private.creative_lab_dashboard_cache FROM anon;
REVOKE ALL ON private.creative_lab_dashboard_cache FROM authenticated;

CREATE OR REPLACE FUNCTION public.get_meta_creative_lab_dashboard(
  p_client_meta_asset_ids UUID[],
  p_period TEXT DEFAULT 'last_30d',
  p_force_refresh BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_asset_ids UUID[];
  v_asset_id UUID;
  v_asset_key TEXT;
  v_run_tokens TEXT[] := ARRAY[]::TEXT[];
  v_run_key TEXT;
  v_link RECORD;
  v_run RECORD;
  v_local_today DATE;
  v_date_start DATE;
  v_date_stop DATE;
  v_response JSONB;
  v_page_items JSONB;
  v_all_items JSONB := '[]'::jsonb;
  v_page INTEGER;
  v_total INTEGER;
  v_any_period_not_synced BOOLEAN := false;
  v_payload JSONB;
  v_cache_hit JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('state', 'unauthorized', 'items', '[]'::jsonb);
  END IF;

  IF p_client_meta_asset_ids IS NULL OR cardinality(p_client_meta_asset_ids) = 0 THEN
    RETURN jsonb_build_object('state', 'empty', 'items', '[]'::jsonb, 'total', 0);
  END IF;

  IF p_period NOT IN ('last_7d', 'last_30d', 'last_90d') THEN
    RAISE EXCEPTION 'Invalid Creative Lab period' USING ERRCODE = '22023';
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT asset_id
    FROM unnest(p_client_meta_asset_ids) AS asset_id
    ORDER BY asset_id
  ) INTO v_asset_ids;

  IF (
    SELECT count(*)
    FROM public.client_meta_assets cma
    WHERE cma.id = ANY(v_asset_ids)
      AND cma.user_id = v_user_id
      AND cma.unlinked_at IS NULL
  ) <> cardinality(v_asset_ids) THEN
    RETURN jsonb_build_object('state', 'unauthorized', 'items', '[]'::jsonb);
  END IF;

  v_asset_key := array_to_string(v_asset_ids, ',');

  -- Resolve the same official run contract used by get_meta_creative_lab,
  -- but without calculating entity metrics. This gives the cache a cheap,
  -- deterministic invalidation key.
  FOREACH v_asset_id IN ARRAY v_asset_ids LOOP
    SELECT
      cma.id,
      ma.integration_id,
      ma.asset_id AS ad_account_id,
      ma.timezone_name
    INTO v_link
    FROM public.client_meta_assets cma
    JOIN public.meta_assets ma ON ma.id = cma.meta_asset_id
    WHERE cma.id = v_asset_id
      AND cma.user_id = v_user_id
      AND cma.unlinked_at IS NULL;

    v_local_today := (timezone(COALESCE(v_link.timezone_name, 'America/Sao_Paulo'), now()))::date;
    v_date_stop := v_local_today;
    v_date_start := CASE p_period
      WHEN 'last_7d' THEN v_local_today - 6
      WHEN 'last_30d' THEN v_local_today - 29
      ELSE v_local_today - 89
    END;

    v_run := NULL;
    SELECT r.*
    INTO v_run
    FROM public.meta_sync_runs r
    WHERE r.user_id = v_user_id
      AND r.integration_id = v_link.integration_id
      AND r.ad_account_id = v_link.ad_account_id
      AND r.requested_period IN ('last_90d', 'today')
      AND r.run_scope = 'full_account'
      AND r.status IN ('success', 'partial')
      AND EXISTS (
        SELECT 1
        FROM public.meta_ad_snapshots a
        WHERE a.sync_run_id = r.id
          AND a.user_id = v_user_id
      )
    ORDER BY r.finished_at DESC NULLS LAST, r.started_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      SELECT r.*
      INTO v_run
      FROM public.meta_sync_runs r
      WHERE r.user_id = v_user_id
        AND r.integration_id = v_link.integration_id
        AND r.ad_account_id = v_link.ad_account_id
        AND r.requested_period = p_period
        AND r.run_scope = 'full_account'
        AND r.status IN ('success', 'partial')
        AND EXISTS (
          SELECT 1
          FROM public.meta_ad_snapshots a
          WHERE a.sync_run_id = r.id
            AND a.user_id = v_user_id
        )
      ORDER BY r.finished_at DESC NULLS LAST, r.started_at DESC
      LIMIT 1;
    END IF;

    v_run_tokens := array_append(
      v_run_tokens,
      v_asset_id::text || ':' || COALESCE(v_run.id::text, 'none')
    );
  END LOOP;

  SELECT array_to_string(ARRAY(SELECT token FROM unnest(v_run_tokens) AS token ORDER BY token), ',')
  INTO v_run_key;

  IF NOT p_force_refresh THEN
    SELECT c.payload
    INTO v_cache_hit
    FROM private.creative_lab_dashboard_cache c
    WHERE c.user_id = v_user_id
      AND c.asset_key = v_asset_key
      AND c.period = p_period
      AND c.run_key = v_run_key;

    IF FOUND THEN
      RETURN v_cache_hit || jsonb_build_object('cache', 'hit');
    END IF;
  END IF;

  -- Reuse the existing official per-ad RPC inside Postgres. Pagination happens
  -- inside the database, so the browser no longer performs hierarchy N+1 calls
  -- or receives ad-level rows during normal Lab loading.
  FOREACH v_asset_id IN ARRAY v_asset_ids LOOP
    v_page := 1;
    LOOP
      v_response := public.get_meta_creative_lab(v_asset_id, p_period, v_page, 200);

      IF v_response->>'state' = 'unauthorized' THEN
        RETURN jsonb_build_object('state', 'unauthorized', 'items', '[]'::jsonb);
      END IF;

      IF v_response->>'state' = 'period_not_synced' THEN
        v_any_period_not_synced := true;
        EXIT;
      END IF;

      SELECT COALESCE(
        jsonb_agg(
          e.value || jsonb_build_object(
            'accountId', v_response->>'accountId',
            'accountName', v_response->>'accountName',
            'currency', v_response->'currency'
          )
        ),
        '[]'::jsonb
      )
      INTO v_page_items
      FROM jsonb_array_elements(COALESCE(v_response->'items', '[]'::jsonb)) AS e(value);

      v_all_items := v_all_items || v_page_items;
      v_total := COALESCE((v_response->>'total')::integer, 0);

      EXIT WHEN v_response->>'state' <> 'ready'
        OR jsonb_array_length(v_page_items) = 0
        OR v_page * 200 >= v_total;

      v_page := v_page + 1;
    END LOOP;
  END LOOP;

  IF jsonb_array_length(v_all_items) = 0 THEN
    v_payload := jsonb_build_object(
      'state', CASE WHEN v_any_period_not_synced THEN 'period_not_synced' ELSE 'empty' END,
      'items', '[]'::jsonb,
      'total', 0,
      'counts', jsonb_build_object(
        'all', 0, 'best', 0, 'average', 0, 'watch', 0,
        'no_result', 0, 'insufficient', 0, 'worst', 0
      ),
      'runKey', v_run_key,
      'cache', 'miss'
    );
  ELSE
    WITH raw AS (
      SELECT
        COALESCE(e.value->>'accountId', '') AS account_id,
        COALESCE(e.value->>'accountName', '') AS account_name,
        NULLIF(e.value->>'currency', '') AS currency,
        e.value->>'campaignId' AS campaign_id,
        e.value->>'campaignName' AS campaign_name,
        e.value->>'campaignStatus' AS campaign_status,
        e.value->>'campaignEffectiveStatus' AS campaign_effective_status,
        NULLIF(e.value->>'classifiedObjective', '') AS classified_objective,
        e.value->>'adsetId' AS adset_id,
        e.value->>'adsetName' AS adset_name,
        e.value->>'adsetStatus' AS adset_status,
        e.value->>'adsetEffectiveStatus' AS adset_effective_status,
        e.value->>'adId' AS ad_id,
        e.value->>'adName' AS ad_name,
        e.value->>'adStatus' AS ad_status,
        e.value->>'adEffectiveStatus' AS ad_effective_status,
        e.value->>'creativeId' AS creative_id,
        COALESCE(NULLIF(e.value->>'creativeName', ''), e.value->>'adName', e.value->>'creativeId') AS creative_name,
        e.value->>'title' AS title,
        e.value->>'body' AS body,
        e.value->>'thumbnailUrl' AS thumbnail_url,
        e.value->>'imageUrl' AS image_url,
        NULLIF(e.value->'objectStorySpec', 'null'::jsonb) AS object_story_spec,
        e.value->>'updatedAt' AS updated_at,
        COALESCE((e.value#>>'{metrics,spend,value}')::numeric, 0) AS spend,
        COALESCE((e.value#>>'{metrics,impressions,value}')::numeric, 0) AS impressions,
        COALESCE((e.value#>>'{metrics,reach,value}')::numeric, 0) AS reach,
        COALESCE((e.value#>>'{metrics,link_clicks,value}')::numeric, 0) AS link_clicks,
        COALESCE((e.value#>>'{metrics,landing_page_views,value}')::numeric, 0) AS landing_page_views,
        COALESCE((e.value#>>'{metrics,messaging_conversations_started_total,value}')::numeric, 0) AS conversations,
        COALESCE((e.value#>>'{metrics,leads,value}')::numeric, 0) AS leads,
        COALESCE((e.value#>>'{metrics,purchases,value}')::numeric, 0) AS purchases,
        COALESCE((e.value#>>'{metrics,purchase_value,value}')::numeric, 0) AS purchase_value,
        (
          upper(COALESCE(NULLIF(e.value->>'campaignEffectiveStatus', ''), e.value->>'campaignStatus', '')) = 'ACTIVE'
          AND upper(COALESCE(NULLIF(e.value->>'adsetEffectiveStatus', ''), e.value->>'adsetStatus', '')) = 'ACTIVE'
          AND upper(COALESCE(NULLIF(e.value->>'adEffectiveStatus', ''), e.value->>'adStatus', '')) = 'ACTIVE'
        ) AS active_structure,
        COALESCE(e.value->>'accountId', '') || ':' || COALESCE(e.value->>'creativeId', '') AS creative_key
      FROM jsonb_array_elements(v_all_items) AS e(value)
      WHERE COALESCE(e.value->>'creativeId', '') <> ''
    ),
    objective_sums AS (
      SELECT
        creative_key,
        upper(COALESCE(classified_objective, 'UNCLASSIFIED')) AS objective,
        SUM(spend) AS objective_spend
      FROM raw
      GROUP BY creative_key, upper(COALESCE(classified_objective, 'UNCLASSIFIED'))
    ),
    objective_choice AS (
      SELECT creative_key, objective
      FROM (
        SELECT
          creative_key,
          objective,
          row_number() OVER (
            PARTITION BY creative_key
            ORDER BY objective_spend DESC, objective
          ) AS rn
        FROM objective_sums
      ) ranked
      WHERE rn = 1
    ),
    base AS (
      SELECT
        r.creative_key,
        max(r.account_id) AS account_id,
        max(r.account_name) AS account_name,
        max(r.currency) AS currency,
        r.creative_id,
        max(r.creative_name) AS creative_name,
        max(r.title) AS title,
        max(r.body) AS body,
        max(r.thumbnail_url) AS thumbnail_url,
        max(r.image_url) AS image_url,
        (array_agg(r.object_story_spec) FILTER (WHERE r.object_story_spec IS NOT NULL))[1] AS object_story_spec,
        max(r.updated_at) AS updated_at,
        oc.objective,
        bool_or(r.active_structure) AS active,
        count(DISTINCT r.ad_id)::integer AS ads_count,
        count(DISTINCT r.ad_id) FILTER (WHERE r.active_structure)::integer AS active_ads,
        COALESCE(array_agg(DISTINCT r.campaign_name) FILTER (WHERE r.campaign_name IS NOT NULL), ARRAY[]::text[]) AS campaigns,
        COALESCE(array_agg(DISTINCT r.adset_name) FILTER (WHERE r.adset_name IS NOT NULL), ARRAY[]::text[]) AS adsets,
        SUM(r.spend) AS spend,
        SUM(r.impressions) AS impressions,
        SUM(r.reach) AS reach,
        SUM(r.link_clicks) AS link_clicks,
        SUM(r.landing_page_views) AS landing_page_views,
        SUM(r.conversations) AS conversations,
        SUM(r.leads) AS leads,
        SUM(r.purchases) AS purchases,
        SUM(r.purchase_value) AS purchase_value,
        jsonb_agg(
          jsonb_build_object(
            'adId', r.ad_id,
            'adName', r.ad_name,
            'campaignId', r.campaign_id,
            'campaignName', r.campaign_name,
            'adsetId', r.adset_id,
            'adsetName', r.adset_name,
            'accountName', r.account_name,
            'activeStructure', r.active_structure,
            'spend', r.spend,
            'result',
              CASE
                WHEN oc.objective = 'SALES' OR position('VENDA' in oc.objective) > 0 THEN r.purchases
                WHEN oc.objective = 'LEADS' OR position('CADASTRO' in oc.objective) > 0 THEN r.leads
                WHEN oc.objective IN ('WHATSAPP', 'MESSENGER', 'INSTAGRAM_DIRECT', 'MESSAGING_OTHER')
                  OR position('MESSAGE' in oc.objective) > 0 THEN r.conversations
                WHEN oc.objective = 'TRAFFIC'
                  OR position('TRÁFEGO' in oc.objective) > 0
                  OR position('TRAFEGO' in oc.objective) > 0
                  THEN CASE WHEN r.landing_page_views > 0 THEN r.landing_page_views ELSE r.link_clicks END
                ELSE r.link_clicks
              END
          )
          ORDER BY r.spend DESC, r.ad_name
        ) AS ads
      FROM raw r
      JOIN objective_choice oc USING (creative_key)
      GROUP BY r.creative_key, r.creative_id, oc.objective
    ),
    contracted AS (
      SELECT
        b.*,
        CASE WHEN b.impressions > 0 THEN (b.link_clicks / b.impressions) * 100 ELSE NULL END AS ctr,
        CASE WHEN b.impressions > 0 THEN (b.spend / b.impressions) * 1000 ELSE NULL END AS cpm,
        CASE WHEN b.link_clicks > 0 THEN b.spend / b.link_clicks ELSE NULL END AS cpc,
        CASE WHEN b.spend > 0 AND b.purchase_value > 0 THEN b.purchase_value / b.spend ELSE NULL END AS roas,
        CASE
          WHEN b.objective = 'SALES' OR position('VENDA' in b.objective) > 0 THEN 'Compras'
          WHEN b.objective = 'LEADS' OR position('CADASTRO' in b.objective) > 0 THEN 'Leads'
          WHEN b.objective IN ('WHATSAPP', 'MESSENGER', 'INSTAGRAM_DIRECT', 'MESSAGING_OTHER')
            OR position('MESSAGE' in b.objective) > 0 THEN 'Conversas'
          WHEN b.objective = 'TRAFFIC'
            OR position('TRÁFEGO' in b.objective) > 0
            OR position('TRAFEGO' in b.objective) > 0
            THEN CASE WHEN b.landing_page_views > 0 THEN 'Visitas' ELSE 'Cliques' END
          ELSE 'Cliques'
        END AS result_label,
        CASE
          WHEN b.objective = 'SALES' OR position('VENDA' in b.objective) > 0 THEN b.purchases
          WHEN b.objective = 'LEADS' OR position('CADASTRO' in b.objective) > 0 THEN b.leads
          WHEN b.objective IN ('WHATSAPP', 'MESSENGER', 'INSTAGRAM_DIRECT', 'MESSAGING_OTHER')
            OR position('MESSAGE' in b.objective) > 0 THEN b.conversations
          WHEN b.objective = 'TRAFFIC'
            OR position('TRÁFEGO' in b.objective) > 0
            OR position('TRAFEGO' in b.objective) > 0
            THEN CASE WHEN b.landing_page_views > 0 THEN b.landing_page_views ELSE b.link_clicks END
          ELSE b.link_clicks
        END AS result_value,
        CASE
          WHEN b.objective = 'SALES' OR position('VENDA' in b.objective) > 0 THEN 'CPA'
          WHEN b.objective = 'LEADS' OR position('CADASTRO' in b.objective) > 0 THEN 'CPL'
          WHEN b.objective IN ('WHATSAPP', 'MESSENGER', 'INSTAGRAM_DIRECT', 'MESSAGING_OTHER')
            OR position('MESSAGE' in b.objective) > 0 THEN 'Custo/conversa'
          WHEN b.objective = 'TRAFFIC'
            OR position('TRÁFEGO' in b.objective) > 0
            OR position('TRAFEGO' in b.objective) > 0
            THEN CASE WHEN b.landing_page_views > 0 THEN 'Custo/visita' ELSE 'CPC' END
          ELSE 'CPC'
        END AS cost_label
      FROM base b
    ),
    with_cost AS (
      SELECT
        c.*,
        CASE WHEN c.result_value > 0 THEN c.spend / c.result_value ELSE NULL END AS cost_per_result,
        CASE WHEN c.spend > 0
          THEN (CASE WHEN c.reach > 0 THEN c.reach ELSE c.impressions END) / c.spend
          ELSE NULL
        END AS delivery_efficiency,
        COALESCE(c.currency, 'BRL') || '|' || c.result_label || '|' || c.cost_label AS group_key
      FROM contracted c
    ),
    stats AS (
      SELECT
        group_key,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY cost_per_result)
          FILTER (WHERE result_value > 0 AND cost_per_result > 0) AS median_result_cost,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY spend)
          FILTER (WHERE spend > 0) AS median_spend
      FROM with_cost
      GROUP BY group_key
    ),
    result_rank AS (
      SELECT
        creative_key,
        CASE
          WHEN count(*) OVER (PARTITION BY group_key) = 1 THEN 50::numeric
          ELSE (1 - percent_rank() OVER (PARTITION BY group_key ORDER BY cost_per_result ASC)) * 100
        END AS score
      FROM with_cost
      WHERE result_value > 0 AND cost_per_result > 0
    ),
    cpm_rank AS (
      SELECT
        creative_key,
        CASE
          WHEN count(*) OVER (PARTITION BY group_key) = 1 THEN 50::numeric
          ELSE (1 - percent_rank() OVER (PARTITION BY group_key ORDER BY cpm ASC)) * 100
        END AS score
      FROM with_cost
      WHERE cpm > 0
    ),
    delivery_rank AS (
      SELECT
        creative_key,
        CASE
          WHEN count(*) OVER (PARTITION BY group_key) = 1 THEN 50::numeric
          ELSE percent_rank() OVER (PARTITION BY group_key ORDER BY delivery_efficiency ASC) * 100
        END AS score
      FROM with_cost
      WHERE delivery_efficiency > 0
    ),
    ctr_rank AS (
      SELECT
        creative_key,
        CASE
          WHEN count(*) OVER (PARTITION BY group_key) = 1 THEN 50::numeric
          ELSE percent_rank() OVER (PARTITION BY group_key ORDER BY ctr ASC) * 100
        END AS score
      FROM with_cost
      WHERE ctr IS NOT NULL AND ctr >= 0
    ),
    scored AS (
      SELECT
        w.*,
        GREATEST(COALESCE(s.median_result_cost, s.median_spend, 0), 0.01)::numeric AS evaluation_threshold_spend,
        s.median_result_cost,
        round(
          COALESCE(rr.score, 0) * 0.55
          + COALESCE(cr.score, 0) * 0.20
          + COALESCE(dr.score, 0) * 0.15
          + COALESCE(tr.score, 0) * 0.10
        )::integer AS score_value
      FROM with_cost w
      JOIN stats s USING (group_key)
      LEFT JOIN result_rank rr USING (creative_key)
      LEFT JOIN cpm_rank cr USING (creative_key)
      LEFT JOIN delivery_rank dr USING (creative_key)
      LEFT JOIN ctr_rank tr USING (creative_key)
    ),
    assessed AS (
      SELECT
        s.*,
        CASE
          WHEN s.spend <= 0 OR (s.result_value = 0 AND s.impressions < 100) THEN NULL
          WHEN s.result_value = 0 AND s.spend < s.evaluation_threshold_spend THEN NULL
          ELSE GREATEST(0, LEAST(100, s.score_value))
        END AS performance_score,
        CASE
          WHEN s.spend <= 0 OR (s.result_value = 0 AND s.impressions < 100) THEN 'insufficient'
          WHEN s.result_value = 0 AND s.spend < s.evaluation_threshold_spend THEN 'watch'
          WHEN s.result_value = 0 THEN 'no_result'
          WHEN s.score_value >= 70 THEN 'strong'
          WHEN s.score_value >= 45 THEN 'average'
          ELSE 'watch'
        END AS performance_band
      FROM scored s
    ),
    best_candidates AS (
      SELECT
        creative_key,
        row_number() OVER (
          ORDER BY performance_score DESC,
            cost_per_result ASC NULLS LAST,
            result_value DESC,
            spend DESC
        ) AS rn
      FROM assessed
      WHERE result_value > 0 AND performance_score IS NOT NULL
    ),
    no_result_candidates AS (
      SELECT
        creative_key,
        row_number() OVER (
          ORDER BY (spend / NULLIF(evaluation_threshold_spend, 0)) DESC, spend DESC
        ) AS rn
      FROM assessed
      WHERE performance_band = 'no_result' AND spend > 0
    ),
    result_worst_candidates AS (
      SELECT
        creative_key,
        row_number() OVER (
          ORDER BY performance_score ASC, cost_per_result DESC NULLS LAST, spend DESC
        ) AS rn
      FROM assessed
      WHERE result_value > 0 AND performance_score IS NOT NULL
    ),
    globals AS (
      SELECT
        count(*) FILTER (WHERE performance_band = 'no_result') AS no_result_count,
        count(*) FILTER (WHERE result_value > 0 AND performance_score IS NOT NULL) AS result_count
      FROM assessed
    ),
    flagged AS (
      SELECT
        a.*,
        CASE
          WHEN bc.rn = 1 THEN 'best'
          WHEN nrc.rn = 1 THEN 'worst'
          WHEN g.no_result_count = 0 AND g.result_count >= 2 AND rwc.rn = 1 THEN 'worst'
          ELSE NULL
        END AS performance_flag
      FROM assessed a
      LEFT JOIN best_candidates bc USING (creative_key)
      LEFT JOIN no_result_candidates nrc USING (creative_key)
      LEFT JOIN result_worst_candidates rwc USING (creative_key)
      CROSS JOIN globals g
    ),
    explained AS (
      SELECT
        f.*,
        CASE
          WHEN f.performance_flag = 'best'
            AND f.median_result_cost IS NOT NULL
            AND f.cost_per_result IS NOT NULL
            AND f.cost_per_result < f.median_result_cost
          THEN 'Melhor combinação do período: '
            || lower(f.cost_label) || ' '
            || round(((f.median_result_cost - f.cost_per_result) / f.median_result_cost) * 100)::text
            || '% menor que a mediana, com CPM e entrega considerados no score.'
          WHEN f.performance_flag = 'best'
          THEN 'Melhor combinação de custo por resultado, CPM, eficiência de alcance/entrega e CTR no período.'
          WHEN f.performance_flag = 'worst' AND f.result_value = 0
          THEN 'Sem ' || lower(f.result_label) || ' após investir '
            || round(f.spend / NULLIF(f.evaluation_threshold_spend, 0), 1)::text
            || 'x a faixa mínima de avaliação.'
          WHEN f.performance_flag = 'worst'
          THEN 'Menor score entre os criativos com resultado, considerando custo, CPM, eficiência de entrega e CTR.'
          WHEN f.performance_band = 'insufficient' AND f.spend <= 0
          THEN 'Sem investimento no período; o CAMPLY não classifica sem entrega.'
          WHEN f.performance_band = 'insufficient'
          THEN 'Volume de entrega ainda muito baixo para validar ou invalidar este criativo.'
          WHEN f.performance_band = 'watch' AND f.result_value = 0
          THEN 'Sem resultado até agora, mas ainda abaixo da faixa mínima de avaliação.'
          WHEN f.performance_band = 'no_result'
          THEN 'Atingiu a faixa mínima de avaliação sem gerar o resultado principal do objetivo.'
          WHEN f.performance_band = 'strong'
          THEN 'Custo por resultado e eficiência de entrega acima da faixa central dos criativos comparáveis.'
          WHEN f.performance_band = 'average'
          THEN 'Desempenho próximo da faixa central dos criativos comparáveis no período.'
          ELSE 'Tem resultado, mas custo e eficiência de entrega estão abaixo dos pares do período.'
        END AS performance_reason,
        CASE
          WHEN f.objective = 'SALES' OR position('VENDA' in f.objective) > 0
            THEN COALESCE(f.roas, CASE WHEN f.spend > 0 THEN f.purchases / GREATEST(f.spend, 1) ELSE 0 END)
          WHEN f.result_value > 0 THEN f.result_value / GREATEST(f.spend, 1)
          ELSE COALESCE(f.ctr, 0)
        END AS rank_score
      FROM flagged f
    ),
    counts AS (
      SELECT jsonb_build_object(
        'all', count(*),
        'best', count(*) FILTER (WHERE performance_flag = 'best' OR performance_band = 'strong'),
        'average', count(*) FILTER (WHERE performance_band = 'average'),
        'watch', count(*) FILTER (WHERE performance_band = 'watch'),
        'no_result', count(*) FILTER (WHERE performance_band = 'no_result'),
        'insufficient', count(*) FILTER (WHERE performance_band = 'insufficient'),
        'worst', count(*) FILTER (WHERE performance_flag = 'worst')
      ) AS value
      FROM explained
    )
    SELECT jsonb_build_object(
      'state', 'ready',
      'items', COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'key', x.creative_key,
            'creativeId', x.creative_id,
            'name', x.creative_name,
            'title', x.title,
            'body', x.body,
            'thumbnailUrl', x.thumbnail_url,
            'imageUrl', x.image_url,
            'objective', x.objective,
            'currency', x.currency,
            'active', x.active,
            'adsCount', x.ads_count,
            'activeAds', x.active_ads,
            'campaigns', to_jsonb(x.campaigns),
            'adsets', to_jsonb(x.adsets),
            'spend', x.spend,
            'impressions', x.impressions,
            'reach', x.reach,
            'linkClicks', x.link_clicks,
            'landingPageViews', x.landing_page_views,
            'conversations', x.conversations,
            'leads', x.leads,
            'purchases', x.purchases,
            'purchaseValue', x.purchase_value,
            'ctr', x.ctr,
            'cpm', x.cpm,
            'cpc', x.cpc,
            'roas', x.roas,
            'resultLabel', x.result_label,
            'resultValue', x.result_value,
            'costLabel', x.cost_label,
            'costPerResult', x.cost_per_result,
            'rankScore', x.rank_score,
            'performanceScore', x.performance_score,
            'performanceBand', x.performance_band,
            'performanceFlag', x.performance_flag,
            'performanceReason', x.performance_reason,
            'evaluationThresholdSpend', x.evaluation_threshold_spend,
            'ads', x.ads
          )
          ORDER BY
            CASE
              WHEN x.performance_flag = 'best' THEN 0
              WHEN x.performance_flag = 'worst' THEN 9
              WHEN x.performance_band = 'strong' THEN 1
              WHEN x.performance_band = 'average' THEN 2
              WHEN x.performance_band = 'watch' THEN 3
              WHEN x.performance_band = 'no_result' THEN 4
              ELSE 5
            END,
            x.performance_score DESC NULLS LAST,
            x.spend DESC
        ),
        '[]'::jsonb
      ),
      'total', count(*),
      'counts', (SELECT value FROM counts),
      'runKey', v_run_key,
      'cache', 'miss'
    )
    INTO v_payload
    FROM explained x;
  END IF;

  DELETE FROM private.creative_lab_dashboard_cache c
  WHERE c.user_id = v_user_id
    AND c.asset_key = v_asset_key
    AND c.period = p_period
    AND c.run_key <> v_run_key;

  INSERT INTO private.creative_lab_dashboard_cache (
    user_id, asset_key, period, run_key, payload, built_at
  ) VALUES (
    v_user_id, v_asset_key, p_period, v_run_key, v_payload, now()
  )
  ON CONFLICT (user_id, asset_key, period, run_key)
  DO UPDATE SET payload = EXCLUDED.payload, built_at = now();

  RETURN v_payload;
END;
$$;

REVOKE ALL ON FUNCTION public.get_meta_creative_lab_dashboard(UUID[], TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_meta_creative_lab_dashboard(UUID[], TEXT, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_meta_creative_lab_dashboard(UUID[], TEXT, BOOLEAN) TO authenticated;

