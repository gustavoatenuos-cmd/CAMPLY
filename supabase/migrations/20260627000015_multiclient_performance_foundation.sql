-- Migration 000015: Multiclient performance foundation
-- Description: Adds transactional client registry, Meta asset links, versioned performance targets, and the first global dashboard RPC.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.client_identity (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_id),
  CONSTRAINT client_identity_client_id_not_blank CHECK (btrim(client_id) <> ''),
  CONSTRAINT client_identity_display_name_not_blank CHECK (btrim(display_name) <> '')
);

ALTER TABLE public.client_identity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own client identities" ON public.client_identity;
CREATE POLICY "Users can view their own client identities"
ON public.client_identity
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_client_identity_updated_at ON public.client_identity;
CREATE TRIGGER trg_client_identity_updated_at
BEFORE UPDATE ON public.client_identity
FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.camply_workspace w
    WHERE jsonb_array_length(COALESCE(w.data->'clients', '[]'::jsonb)) > 0
      AND w.id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) THEN
    RAISE EXCEPTION 'Cannot backfill client_identity: camply_workspace.id contains non-UUID values with clients.';
  END IF;
END $$;

INSERT INTO public.client_identity (user_id, client_id, display_name, archived_at)
SELECT
  w.id::uuid,
  client_record.client_id,
  client_record.display_name,
  NULL
FROM public.camply_workspace w
CROSS JOIN LATERAL (
  SELECT
    btrim(c->>'id') AS client_id,
    COALESCE(
      NULLIF(btrim(c->>'company'), ''),
      NULLIF(btrim(c->>'name'), ''),
      NULLIF(btrim(c->>'id'), '')
    ) AS display_name
  FROM jsonb_array_elements(COALESCE(w.data->'clients', '[]'::jsonb)) AS c
) AS client_record
WHERE client_record.client_id IS NOT NULL
  AND client_record.client_id <> ''
  AND client_record.display_name IS NOT NULL
  AND client_record.display_name <> ''
ON CONFLICT (user_id, client_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  archived_at = NULL,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.save_camply_workspace_with_client_registry(
  p_data JSONB,
  p_expected_version BIGINT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_next_version BIGINT;
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RAISE EXCEPTION 'Workspace payload must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF p_data ? 'clients' AND jsonb_typeof(p_data->'clients') <> 'array' THEN
    RAISE EXCEPTION 'Workspace clients must be an array' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_data->'clients', '[]'::jsonb)) AS c
    WHERE NULLIF(btrim(c->>'id'), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Every workspace client must contain a non-empty id' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT btrim(c->>'id') AS client_id, count(*) AS occurrences
      FROM jsonb_array_elements(COALESCE(p_data->'clients', '[]'::jsonb)) AS c
      GROUP BY btrim(c->>'id')
    ) duplicates
    WHERE duplicates.occurrences > 1
  ) THEN
    RAISE EXCEPTION 'Workspace contains duplicated client ids' USING ERRCODE = '23505';
  END IF;

  PERFORM 1
  FROM public.camply_workspace
  WHERE id = v_user_id::text
  FOR UPDATE;

  IF p_expected_version IS NULL THEN
    INSERT INTO public.camply_workspace (id, data, version, updated_at)
    VALUES (v_user_id::text, p_data, 1, now())
    ON CONFLICT (id) DO NOTHING
    RETURNING version INTO v_next_version;
  ELSE
    UPDATE public.camply_workspace
    SET data = p_data,
        version = version + 1,
        updated_at = now()
    WHERE id = v_user_id::text
      AND version = p_expected_version
    RETURNING version INTO v_next_version;
  END IF;

  IF v_next_version IS NULL THEN
    RAISE EXCEPTION 'Workspace changed in another session. Reload before saving.'
      USING ERRCODE = '40001';
  END IF;

  WITH payload_clients AS (
    SELECT
      btrim(c->>'id') AS client_id,
      COALESCE(
        NULLIF(btrim(c->>'company'), ''),
        NULLIF(btrim(c->>'name'), ''),
        NULLIF(btrim(c->>'id'), '')
      ) AS display_name
    FROM jsonb_array_elements(COALESCE(p_data->'clients', '[]'::jsonb)) AS c
  )
  INSERT INTO public.client_identity (user_id, client_id, display_name, archived_at)
  SELECT v_user_id, client_id, display_name, NULL
  FROM payload_clients
  ON CONFLICT (user_id, client_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    archived_at = NULL,
    updated_at = now();

  WITH payload_clients AS (
    SELECT btrim(c->>'id') AS client_id
    FROM jsonb_array_elements(COALESCE(p_data->'clients', '[]'::jsonb)) AS c
  )
  UPDATE public.client_identity ci
  SET archived_at = COALESCE(ci.archived_at, now()),
      updated_at = now()
  WHERE ci.user_id = v_user_id
    AND ci.archived_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM payload_clients pc
      WHERE pc.client_id = ci.client_id
    );

  RETURN v_next_version;
END;
$$;

REVOKE ALL ON FUNCTION public.save_camply_workspace_with_client_registry(JSONB, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_camply_workspace_with_client_registry(JSONB, BIGINT) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_camply_workspace_with_client_registry(JSONB, BIGINT) TO authenticated;

CREATE TABLE IF NOT EXISTS public.client_meta_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  meta_asset_id UUID NOT NULL REFERENCES public.meta_assets(id) ON DELETE RESTRICT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unlinked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT client_meta_assets_identity_fk
    FOREIGN KEY (user_id, client_id)
    REFERENCES public.client_identity(user_id, client_id)
    ON DELETE RESTRICT,
  CONSTRAINT client_meta_assets_unlink_after_link CHECK (unlinked_at IS NULL OR unlinked_at >= linked_at)
);

ALTER TABLE public.client_meta_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own client meta assets" ON public.client_meta_assets;
CREATE POLICY "Users can view their own client meta assets"
ON public.client_meta_assets
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS client_meta_assets_id_user_unique
ON public.client_meta_assets(id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS client_meta_assets_active_asset_unique
ON public.client_meta_assets(user_id, meta_asset_id)
WHERE unlinked_at IS NULL;

CREATE INDEX IF NOT EXISTS client_meta_assets_client_idx
ON public.client_meta_assets(user_id, client_id)
WHERE unlinked_at IS NULL;

DROP TRIGGER IF EXISTS trg_client_meta_assets_updated_at ON public.client_meta_assets;
CREATE TRIGGER trg_client_meta_assets_updated_at
BEFORE UPDATE ON public.client_meta_assets
FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.client_performance_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_meta_asset_id UUID NOT NULL,
  campaign_id TEXT,
  metric_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_value NUMERIC NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT client_performance_targets_asset_user_fk
    FOREIGN KEY (client_meta_asset_id, user_id)
    REFERENCES public.client_meta_assets(id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT client_performance_targets_kind_check
    CHECK (target_kind IN ('cost_per_result', 'daily_budget', 'monthly_budget', 'minimum_results')),
  CONSTRAINT client_performance_targets_value_check CHECK (target_value > 0),
  CONSTRAINT client_performance_targets_metric_kind_check CHECK (
    (
      target_kind IN ('daily_budget', 'monthly_budget')
      AND metric_id = 'spend'
    )
    OR (
      target_kind IN ('cost_per_result', 'minimum_results')
      AND metric_id <> 'spend'
    )
  ),
  CONSTRAINT client_performance_targets_window_check CHECK (effective_to IS NULL OR effective_to > effective_from)
);

ALTER TABLE public.client_performance_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own performance targets" ON public.client_performance_targets;
CREATE POLICY "Users can view their own performance targets"
ON public.client_performance_targets
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS client_performance_targets_active_unique
ON public.client_performance_targets(
  user_id,
  client_meta_asset_id,
  COALESCE(campaign_id, ''),
  metric_id,
  target_kind
)
WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS client_performance_targets_asset_idx
ON public.client_performance_targets(user_id, client_meta_asset_id, effective_from DESC);

CREATE OR REPLACE FUNCTION public.is_allowed_performance_metric(p_metric_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_metric_id = ANY (ARRAY[
    'spend',
    'impressions',
    'cpm',
    'link_clicks',
    'link_ctr',
    'link_cpc',
    'cpa',
    'whatsapp_conversations_started',
    'messenger_conversations_started',
    'instagram_direct_conversations_started',
    'messaging_conversations_started_generic',
    'messaging_conversations_started_total',
    'cost_per_messaging_conversation',
    'purchases',
    'purchase_value',
    'purchase_roas',
    'leads',
    'landing_page_views',
    'page_load_rate',
    'profile_visits',
    'video_views',
    'thru_plays'
  ]);
$$;

REVOKE ALL ON FUNCTION public.is_allowed_performance_metric(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_allowed_performance_metric(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.link_client_meta_asset(
  p_client_id TEXT,
  p_meta_asset_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_existing RECORD;
  v_link_id UUID;
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(btrim(p_client_id), '') IS NULL THEN
    RAISE EXCEPTION 'client_id is required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.client_identity ci
    WHERE ci.user_id = v_user_id
      AND ci.client_id = p_client_id
      AND ci.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Client not found or archived' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.meta_assets ma
    JOIN public.meta_integrations mi ON mi.id = ma.integration_id
    WHERE ma.id = p_meta_asset_id
      AND mi.user_id = v_user_id
      AND ma.asset_type = 'adaccount'
  ) THEN
    RAISE EXCEPTION 'Meta asset not found for authenticated user' USING ERRCODE = '42501';
  END IF;

  SELECT id, client_id
  INTO v_existing
  FROM public.client_meta_assets
  WHERE user_id = v_user_id
    AND meta_asset_id = p_meta_asset_id
    AND unlinked_at IS NULL
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.client_id = p_client_id THEN
      RETURN v_existing.id;
    END IF;
    RAISE EXCEPTION 'Meta asset is already linked to another active client' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.client_meta_assets (user_id, client_id, meta_asset_id)
  VALUES (v_user_id, p_client_id, p_meta_asset_id)
  RETURNING id INTO v_link_id;

  RETURN v_link_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unlink_client_meta_asset(
  p_client_meta_asset_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_unlinked_at TIMESTAMPTZ := now();
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.client_meta_assets
  SET unlinked_at = COALESCE(unlinked_at, v_unlinked_at),
      updated_at = now()
  WHERE id = p_client_meta_asset_id
    AND user_id = v_user_id
    AND unlinked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active client Meta asset link not found' USING ERRCODE = '42501';
  END IF;

  UPDATE public.client_performance_targets
  SET effective_to = v_unlinked_at
  WHERE user_id = v_user_id
    AND client_meta_asset_id = p_client_meta_asset_id
    AND effective_to IS NULL
    AND effective_from < v_unlinked_at;
END;
$$;

REVOKE ALL ON FUNCTION public.link_client_meta_asset(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_client_meta_asset(TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.link_client_meta_asset(TEXT, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.unlink_client_meta_asset(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unlink_client_meta_asset(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.unlink_client_meta_asset(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_client_performance_target(
  p_client_meta_asset_id UUID,
  p_metric_id TEXT,
  p_target_kind TEXT,
  p_target_value NUMERIC,
  p_campaign_id TEXT DEFAULT NULL,
  p_effective_from TIMESTAMPTZ DEFAULT now()
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_effective_from TIMESTAMPTZ := COALESCE(p_effective_from, now());
  v_target_id UUID;
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_allowed_performance_metric(p_metric_id) THEN
    RAISE EXCEPTION 'Metric id is not allowed for performance targets: %', p_metric_id USING ERRCODE = '22023';
  END IF;

  IF p_target_kind NOT IN ('cost_per_result', 'daily_budget', 'monthly_budget', 'minimum_results') THEN
    RAISE EXCEPTION 'Invalid target kind: %', p_target_kind USING ERRCODE = '22023';
  END IF;

  IF p_target_value IS NULL OR p_target_value <= 0 THEN
    RAISE EXCEPTION 'Target value must be greater than zero' USING ERRCODE = '22023';
  END IF;

  IF (
    (p_target_kind IN ('daily_budget', 'monthly_budget') AND p_metric_id <> 'spend')
    OR (p_target_kind IN ('cost_per_result', 'minimum_results') AND p_metric_id = 'spend')
  ) THEN
    RAISE EXCEPTION 'Metric and target kind are incompatible' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.client_meta_assets cma
    JOIN public.client_identity ci
      ON ci.user_id = cma.user_id
     AND ci.client_id = cma.client_id
    JOIN public.meta_assets ma
      ON ma.id = cma.meta_asset_id
    JOIN public.meta_integrations mi
      ON mi.id = ma.integration_id
    WHERE cma.id = p_client_meta_asset_id
      AND cma.user_id = v_user_id
      AND cma.unlinked_at IS NULL
      AND ci.archived_at IS NULL
      AND mi.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Client Meta asset link not found for authenticated user' USING ERRCODE = '42501';
  END IF;

  UPDATE public.client_performance_targets
  SET effective_to = v_effective_from
  WHERE user_id = v_user_id
    AND client_meta_asset_id = p_client_meta_asset_id
    AND COALESCE(campaign_id, '') = COALESCE(p_campaign_id, '')
    AND metric_id = p_metric_id
    AND target_kind = p_target_kind
    AND effective_to IS NULL
    AND effective_from < v_effective_from;

  IF EXISTS (
    SELECT 1
    FROM public.client_performance_targets t
    WHERE t.user_id = v_user_id
      AND t.client_meta_asset_id = p_client_meta_asset_id
      AND COALESCE(t.campaign_id, '') = COALESCE(p_campaign_id, '')
      AND t.metric_id = p_metric_id
      AND t.target_kind = p_target_kind
      AND tstzrange(t.effective_from, COALESCE(t.effective_to, 'infinity'::timestamptz), '[)')
          && tstzrange(v_effective_from, 'infinity'::timestamptz, '[)')
  ) THEN
    RAISE EXCEPTION 'Performance target temporal overlap detected' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.client_performance_targets (
    user_id,
    client_meta_asset_id,
    campaign_id,
    metric_id,
    target_kind,
    target_value,
    effective_from
  )
  VALUES (
    v_user_id,
    p_client_meta_asset_id,
    NULLIF(btrim(COALESCE(p_campaign_id, '')), ''),
    p_metric_id,
    p_target_kind,
    p_target_value,
    v_effective_from
  )
  RETURNING id INTO v_target_id;

  RETURN v_target_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_client_performance_target(
  p_target_id UUID,
  p_effective_to TIMESTAMPTZ DEFAULT now()
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_effective_to TIMESTAMPTZ := COALESCE(p_effective_to, now());
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.client_performance_targets
    WHERE id = p_target_id
      AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Performance target not found' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.client_performance_targets
    WHERE id = p_target_id
      AND user_id = v_user_id
      AND effective_from >= v_effective_to
  ) THEN
    RAISE EXCEPTION 'effective_to must be greater than effective_from' USING ERRCODE = '22023';
  END IF;

  UPDATE public.client_performance_targets
  SET effective_to = v_effective_to
  WHERE id = p_target_id
    AND user_id = v_user_id
    AND effective_to IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.set_client_performance_target(UUID, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_client_performance_target(UUID, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_client_performance_target(UUID, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) TO authenticated;

REVOKE ALL ON FUNCTION public.close_client_performance_target(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_client_performance_target(UUID, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.close_client_performance_target(UUID, TIMESTAMPTZ) TO authenticated;

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
    WHERE cma.user_id = v_user_id
      AND cma.unlinked_at IS NULL
      AND (p_asset_ids IS NULL OR cma.meta_asset_id = ANY(p_asset_ids))
  ),
  account_rows AS (
    SELECT
      al.client_id,
      ma.id AS meta_asset_id,
      ma.integration_id,
      ma.asset_id AS ad_account_id,
      ma.asset_name AS account_name,
      ma.currency,
      ma.timezone_name AS timezone
    FROM active_links al
    JOIN public.meta_assets ma ON ma.id = al.meta_asset_id
    JOIN public.meta_integrations mi ON mi.id = ma.integration_id AND mi.user_id = v_user_id
  ),
  latest_attempt AS (
    SELECT DISTINCT ON (ar.client_id, ar.meta_asset_id)
      ar.client_id,
      ar.meta_asset_id,
      r.id,
      r.status,
      r.started_at,
      r.finished_at,
      r.error_message,
      r.metadata
    FROM account_rows ar
    JOIN public.meta_sync_runs r
      ON r.user_id = v_user_id
     AND r.integration_id = ar.integration_id
     AND r.ad_account_id = ar.ad_account_id
     AND r.requested_period = p_period
     AND r.run_scope = 'full_account'
     AND COALESCE(r.metadata->>'requested_level', 'campaign') = 'campaign'
    ORDER BY ar.client_id, ar.meta_asset_id, r.started_at DESC, r.created_at DESC
  ),
  latest_success AS (
    SELECT DISTINCT ON (ar.client_id, ar.meta_asset_id)
      ar.client_id,
      ar.meta_asset_id,
      r.id,
      r.status,
      r.started_at,
      r.finished_at,
      r.error_message,
      r.metadata
    FROM account_rows ar
    JOIN public.meta_sync_runs r
      ON r.user_id = v_user_id
     AND r.integration_id = ar.integration_id
     AND r.ad_account_id = ar.ad_account_id
     AND r.requested_period = p_period
     AND r.run_scope = 'full_account'
     AND COALESCE(r.metadata->>'requested_level', 'campaign') = 'campaign'
     AND r.status = 'success'
    ORDER BY ar.client_id, ar.meta_asset_id, r.finished_at DESC NULLS LAST, r.started_at DESC, r.created_at DESC
  ),
  additive_metrics AS (
    SELECT
      ls.client_id,
      m.metric_id,
      SUM(m.metric_value) AS value,
      bool_or(COALESCE(m.completeness_status, 'complete') <> 'complete') AS has_partial,
      max(m.completeness_status) FILTER (WHERE m.completeness_status IS NOT NULL AND m.completeness_status <> 'complete') AS non_complete_status
    FROM latest_success ls
    JOIN public.meta_normalized_metrics m
      ON m.sync_run_id = ls.id
     AND m.user_id = v_user_id
     AND (m.source_level = 'campaign' OR (m.source_level IS NULL AND m.adset_id IS NULL))
     AND m.metric_id IN (
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
    GROUP BY ls.client_id, m.metric_id
  ),
  metric_totals AS (
    SELECT
      ac.client_id,
      COALESCE(SUM(value) FILTER (WHERE metric_id = 'spend'), 0) AS spend,
      COALESCE(SUM(value) FILTER (WHERE metric_id = 'impressions'), 0) AS impressions,
      COALESCE(SUM(value) FILTER (WHERE metric_id = 'link_clicks'), 0) AS link_clicks,
      COALESCE(
        SUM(value) FILTER (WHERE metric_id = 'messaging_conversations_started_total'),
        SUM(value) FILTER (WHERE metric_id IN (
          'whatsapp_conversations_started',
          'messenger_conversations_started',
          'instagram_direct_conversations_started',
          'messaging_conversations_started_generic'
        )),
        0
      ) AS conversations,
      COALESCE(SUM(value) FILTER (WHERE metric_id = 'leads'), 0) AS leads,
      COALESCE(SUM(value) FILTER (WHERE metric_id = 'purchases'), 0) AS purchases,
      COALESCE(SUM(value) FILTER (WHERE metric_id = 'purchase_value'), 0) AS purchase_value,
      COALESCE(bool_or(has_partial), false) AS has_partial,
      max(non_complete_status) AS non_complete_status
    FROM active_clients ac
    LEFT JOIN additive_metrics am ON am.client_id = ac.client_id
    GROUP BY ac.client_id
  ),
  campaign_groups AS (
    SELECT
      ls.client_id,
      m.campaign_id,
      COALESCE(cs.campaign_name, m.campaign_id, 'Campanha sem nome') AS campaign_name,
      cs.classified_objective::text AS classified_objective,
      ads.destination_type,
      COALESCE(m.attribution_setting, ads.attribution_setting) AS attribution_setting,
      SUM(m.metric_value) FILTER (WHERE m.metric_id = 'spend') AS spend,
      jsonb_object_agg(m.metric_id, m.metric_value ORDER BY m.metric_id) AS metrics
    FROM latest_success ls
    JOIN public.meta_normalized_metrics m
      ON m.sync_run_id = ls.id
     AND m.user_id = v_user_id
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
      m.campaign_id,
      COALESCE(cs.campaign_name, m.campaign_id, 'Campanha sem nome'),
      cs.classified_objective::text,
      ads.destination_type,
      COALESCE(m.attribution_setting, ads.attribution_setting)
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
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'clientId', ac.client_id,
      'clientName', ac.display_name,
      'clientStatus',
        CASE
          WHEN NOT EXISTS (SELECT 1 FROM active_links al WHERE al.client_id = ac.client_id) THEN 'not_connected'
          WHEN EXISTS (SELECT 1 FROM latest_attempt la WHERE la.client_id = ac.client_id AND la.status = 'running') THEN 'syncing'
          WHEN NOT EXISTS (SELECT 1 FROM latest_attempt la WHERE la.client_id = ac.client_id) THEN 'never_synced'
          WHEN EXISTS (
            SELECT 1 FROM latest_attempt la
            WHERE la.client_id = ac.client_id
              AND la.status = 'failed'
              AND NOT EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id)
          ) THEN 'failed'
          WHEN EXISTS (
            SELECT 1 FROM latest_attempt la
            WHERE la.client_id = ac.client_id
              AND la.status = 'partial'
              AND NOT EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id)
          ) THEN 'partial'
          WHEN EXISTS (
            SELECT 1 FROM latest_attempt la
            WHERE la.client_id = ac.client_id
              AND la.status = 'partial'
              AND EXISTS (
                SELECT 1 FROM latest_success ls
                WHERE ls.client_id = ac.client_id
                  AND la.started_at > ls.started_at
              )
          ) THEN 'partial'
          WHEN EXISTS (
            SELECT 1 FROM latest_attempt la
            WHERE la.client_id = ac.client_id
              AND la.status = 'failed'
              AND EXISTS (
                SELECT 1 FROM latest_success ls
                WHERE ls.client_id = ac.client_id
                  AND la.started_at > ls.started_at
              )
          ) THEN 'failed'
          WHEN COALESCE(mt.spend, 0) = 0 AND COALESCE(mt.impressions, 0) = 0 THEN 'no_delivery'
          WHEN EXISTS (
            SELECT 1 FROM latest_success ls
            WHERE ls.client_id = ac.client_id
              AND ls.finished_at < now() - interval '36 hours'
          ) THEN 'stale'
          ELSE 'available'
        END,
      'accounts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'metaAssetId', ar.meta_asset_id,
          'integrationId', ar.integration_id,
          'adAccountId', ar.ad_account_id,
          'accountName', ar.account_name,
          'currency', ar.currency,
          'timezone', ar.timezone
        ) ORDER BY ar.account_name)
        FROM account_rows ar
        WHERE ar.client_id = ac.client_id
      ), '[]'::jsonb),
      'metrics', jsonb_build_object(
        'spend', jsonb_build_object('value', CASE WHEN EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id) THEN mt.spend ELSE NULL END, 'available', EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id), 'completenessStatus', COALESCE(mt.non_complete_status, CASE WHEN EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id) THEN 'complete' ELSE NULL END)),
        'impressions', jsonb_build_object('value', CASE WHEN EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id) THEN mt.impressions ELSE NULL END, 'available', EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id), 'completenessStatus', COALESCE(mt.non_complete_status, CASE WHEN EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id) THEN 'complete' ELSE NULL END)),
        'messaging_conversations_started_total', jsonb_build_object('value', CASE WHEN EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id) THEN mt.conversations ELSE NULL END, 'available', EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id), 'completenessStatus', COALESCE(mt.non_complete_status, CASE WHEN EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id) THEN 'complete' ELSE NULL END)),
        'cost_per_messaging_conversation', jsonb_build_object('value', CASE WHEN mt.conversations > 0 THEN mt.spend / mt.conversations ELSE NULL END, 'available', mt.conversations > 0, 'completenessStatus', COALESCE(mt.non_complete_status, CASE WHEN EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id) THEN 'complete' ELSE NULL END)),
        'leads', jsonb_build_object('value', CASE WHEN EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id) THEN mt.leads ELSE NULL END, 'available', EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id), 'completenessStatus', COALESCE(mt.non_complete_status, CASE WHEN EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id) THEN 'complete' ELSE NULL END)),
        'purchases', jsonb_build_object('value', CASE WHEN EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id) THEN mt.purchases ELSE NULL END, 'available', EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id), 'completenessStatus', COALESCE(mt.non_complete_status, CASE WHEN EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id) THEN 'complete' ELSE NULL END))
      ),
      'metricGroups', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'campaignId', cg.campaign_id,
          'campaignName', cg.campaign_name,
          'classifiedObjective', cg.classified_objective,
          'destinationType', cg.destination_type,
          'attributionSetting', cg.attribution_setting,
          'spend', cg.spend,
          'metrics', cg.metrics
        ) ORDER BY cg.campaign_name, cg.campaign_id, cg.classified_objective, cg.destination_type, cg.attribution_setting)
        FROM campaign_groups cg
        WHERE cg.client_id = ac.client_id
      ), '[]'::jsonb),
      'resolvedTargets', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', at.id,
          'clientMetaAssetId', at.client_meta_asset_id,
          'campaignId', at.campaign_id,
          'metricId', at.metric_id,
          'targetKind', at.target_kind,
          'targetValue', at.target_value,
          'effectiveFrom', at.effective_from,
          'effectiveTo', at.effective_to
        ) ORDER BY at.metric_id, at.target_kind, at.campaign_id NULLS FIRST)
        FROM active_targets at
        WHERE at.client_id = ac.client_id
      ), '[]'::jsonb),
      'evaluations', '[]'::jsonb,
      'budgetPacing', NULL,
      'dataQuality', jsonb_build_object(
        'status',
          CASE
            WHEN NOT EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id) THEN 'unavailable'
            WHEN mt.has_partial THEN 'partial'
            WHEN EXISTS (
              SELECT 1 FROM latest_attempt la
              WHERE la.client_id = ac.client_id
                AND la.status IN ('partial', 'failed')
                AND EXISTS (
                  SELECT 1 FROM latest_success ls
                  WHERE ls.client_id = ac.client_id
                    AND la.started_at > ls.started_at
                )
            ) THEN 'partial'
            ELSE 'complete'
          END,
        'reason',
          CASE
            WHEN NOT EXISTS (SELECT 1 FROM latest_success ls WHERE ls.client_id = ac.client_id) THEN 'no_successful_run'
            WHEN mt.has_partial THEN mt.non_complete_status
            WHEN EXISTS (
              SELECT 1 FROM latest_attempt la
              WHERE la.client_id = ac.client_id
                AND la.status IN ('partial', 'failed')
                AND EXISTS (
                  SELECT 1 FROM latest_success ls
                  WHERE ls.client_id = ac.client_id
                    AND la.started_at > ls.started_at
                )
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
          'terminationReason', ls.metadata->>'termination_reason'
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
          'terminationReason', la.metadata->>'termination_reason'
        )
        FROM latest_attempt la
        WHERE la.client_id = ac.client_id
        ORDER BY la.started_at DESC
        LIMIT 1
      ),
      'hasNewerPartial', EXISTS (
        SELECT 1 FROM latest_attempt la
        WHERE la.client_id = ac.client_id
          AND la.status = 'partial'
          AND EXISTS (
            SELECT 1 FROM latest_success ls
            WHERE ls.client_id = ac.client_id
              AND la.started_at > ls.started_at
          )
      ),
      'hasNewerFailure', EXISTS (
        SELECT 1 FROM latest_attempt la
        WHERE la.client_id = ac.client_id
          AND la.status = 'failed'
          AND EXISTS (
            SELECT 1 FROM latest_success ls
            WHERE ls.client_id = ac.client_id
              AND la.started_at > ls.started_at
          )
      )
    )
    ORDER BY ac.display_name, ac.client_id
  ), '[]'::jsonb)
  INTO v_result
  FROM active_clients ac
  LEFT JOIN metric_totals mt ON mt.client_id = ac.client_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_global_performance_dashboard(TEXT, TEXT[], UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_global_performance_dashboard(TEXT, TEXT[], UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_global_performance_dashboard(TEXT, TEXT[], UUID[]) TO authenticated;

REVOKE ALL ON public.client_identity FROM PUBLIC;
REVOKE ALL ON public.client_identity FROM anon;
REVOKE ALL ON public.client_identity FROM authenticated;
GRANT SELECT ON public.client_identity TO authenticated;

REVOKE ALL ON public.client_meta_assets FROM PUBLIC;
REVOKE ALL ON public.client_meta_assets FROM anon;
REVOKE ALL ON public.client_meta_assets FROM authenticated;
GRANT SELECT ON public.client_meta_assets TO authenticated;

REVOKE ALL ON public.client_performance_targets FROM PUBLIC;
REVOKE ALL ON public.client_performance_targets FROM anon;
REVOKE ALL ON public.client_performance_targets FROM authenticated;
GRANT SELECT ON public.client_performance_targets TO authenticated;

COMMIT;
