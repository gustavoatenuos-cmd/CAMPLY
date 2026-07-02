-- Migration 000016: Meta Sync Collection Contract
-- Description: Records the exact collection contract for each Meta sync run so
-- campaign-level imports, selected-campaign imports, and Ad Set drill-downs are
-- distinguishable and cache-safe.

BEGIN;

ALTER TABLE public.meta_sync_runs
  ADD COLUMN IF NOT EXISTS requested_level TEXT DEFAULT 'campaign' NOT NULL,
  ADD COLUMN IF NOT EXISTS selected_entity_ids JSONB DEFAULT jsonb_build_object(
    'campaign_ids', '[]'::jsonb,
    'adset_ids', '[]'::jsonb
  ) NOT NULL,
  ADD COLUMN IF NOT EXISTS termination_reason TEXT,
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS collection_contract_version TEXT DEFAULT '2026-06-30.1' NOT NULL;

ALTER TABLE public.meta_sync_runs
  DROP CONSTRAINT IF EXISTS meta_sync_runs_requested_level_check;
ALTER TABLE public.meta_sync_runs
  ADD CONSTRAINT meta_sync_runs_requested_level_check
  CHECK (requested_level IN ('campaign', 'adset', 'ad', 'creative'));

ALTER TABLE public.meta_sync_runs
  DROP CONSTRAINT IF EXISTS meta_sync_runs_selected_entity_ids_check;
ALTER TABLE public.meta_sync_runs
  ADD CONSTRAINT meta_sync_runs_selected_entity_ids_check
  CHECK (
    jsonb_typeof(selected_entity_ids) = 'object'
    AND jsonb_typeof(COALESCE(selected_entity_ids->'campaign_ids', '[]'::jsonb)) = 'array'
    AND jsonb_typeof(COALESCE(selected_entity_ids->'adset_ids', '[]'::jsonb)) = 'array'
  );

ALTER TABLE public.meta_sync_runs
  DROP CONSTRAINT IF EXISTS meta_sync_runs_termination_reason_check;
ALTER TABLE public.meta_sync_runs
  ADD CONSTRAINT meta_sync_runs_termination_reason_check
  CHECK (
    termination_reason IS NULL
    OR termination_reason IN (
      'completed',
      'partial_collection',
      'validation_error',
      'meta_api_error',
      'persistence_error',
      'unexpected_error'
    )
  );

ALTER TABLE public.meta_sync_runs
  DROP CONSTRAINT IF EXISTS run_scope_check;
ALTER TABLE public.meta_sync_runs
  ADD CONSTRAINT run_scope_check
  CHECK (run_scope IN ('full_account', 'selected_campaigns', 'selected_adsets', 'selected_entities'));

UPDATE public.meta_sync_runs
SET
  requested_level = COALESCE(NULLIF(requested_level, ''), 'campaign'),
  selected_entity_ids = CASE
    WHEN jsonb_typeof(selected_entity_ids) = 'object' THEN selected_entity_ids
    ELSE jsonb_build_object('campaign_ids', '[]'::jsonb, 'adset_ids', '[]'::jsonb)
  END,
  collection_contract_version = COALESCE(NULLIF(collection_contract_version, ''), 'legacy'),
  request_fingerprint = COALESCE(request_fingerprint, 'legacy:' || id::text),
  termination_reason = CASE
    WHEN termination_reason IS NOT NULL THEN termination_reason
    WHEN status = 'success' THEN 'completed'
    WHEN status = 'partial' THEN 'partial_collection'
    WHEN status = 'failed' THEN 'unexpected_error'
    ELSE NULL
  END;

CREATE INDEX IF NOT EXISTS idx_meta_sync_runs_collection_contract
  ON public.meta_sync_runs (user_id, integration_id, ad_account_id, requested_level, collection_contract_version);

CREATE INDEX IF NOT EXISTS idx_meta_sync_runs_request_fingerprint
  ON public.meta_sync_runs (user_id, request_fingerprint)
  WHERE request_fingerprint IS NOT NULL;

-- Replace the single atomic persistence RPC signature with a version that also
-- finalizes termination_reason. The rest of the mutation remains atomic.
DROP FUNCTION IF EXISTS public.persist_meta_sync_run(UUID, UUID, UUID, TEXT, TEXT, JSON[], JSON[], JSON[], JSON[], JSONB, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.persist_meta_sync_run(UUID, UUID, UUID, TEXT, TEXT, JSON[], JSON[], JSON[], JSON[], JSONB, TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.persist_meta_sync_run(
  p_run_id UUID,
  p_user_id UUID,
  p_integration_id UUID,
  p_ad_account_id TEXT,
  p_final_status TEXT,
  p_raw_snapshots JSON[],
  p_campaign_entities JSON[],
  p_adset_entities JSON[],
  p_normalized_metrics JSON[],
  p_metadata JSONB DEFAULT NULL,
  p_termination_reason TEXT DEFAULT NULL,
  p_pages_fetched INT DEFAULT 0,
  p_records_fetched INT DEFAULT 0
)
RETURNS void AS $$
DECLARE
    v_run_record RECORD;
    v_termination_reason TEXT;
BEGIN
    SELECT * INTO v_run_record FROM public.meta_sync_runs
    WHERE id = p_run_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SYNC_RUN_NOT_FOUND_OR_NOT_RUNNING';
    END IF;

    IF v_run_record.status != 'running' THEN
        RAISE EXCEPTION 'Sync run % is not in running state', p_run_id;
    END IF;

    IF v_run_record.user_id != p_user_id THEN
        RAISE EXCEPTION 'Sync run % user_id mismatch', p_run_id;
    END IF;

    IF v_run_record.integration_id != p_integration_id THEN
        RAISE EXCEPTION 'Sync run % integration_id mismatch', p_run_id;
    END IF;

    IF v_run_record.ad_account_id != p_ad_account_id THEN
        RAISE EXCEPTION 'Sync run % ad_account_id mismatch', p_run_id;
    END IF;

    v_termination_reason := COALESCE(
      p_termination_reason,
      CASE
        WHEN p_final_status = 'success' THEN 'completed'
        WHEN p_final_status = 'partial' THEN 'partial_collection'
        ELSE 'unexpected_error'
      END
    );

    IF v_termination_reason NOT IN (
      'completed',
      'partial_collection',
      'validation_error',
      'meta_api_error',
      'persistence_error',
      'unexpected_error'
    ) THEN
      RAISE EXCEPTION 'Invalid termination_reason: %', v_termination_reason;
    END IF;

    IF p_raw_snapshots IS NOT NULL AND array_length(p_raw_snapshots, 1) > 0 THEN
        INSERT INTO public.meta_raw_snapshots (user_id, sync_run_id, integration_id, ad_account_id, entity_level, entity_id, endpoint, payload, date_start, date_stop, page_number)
        SELECT
            p_user_id, p_run_id, p_integration_id, p_ad_account_id,
            (s->>'entity_level')::varchar, (s->>'entity_id')::varchar, (s->>'endpoint')::varchar, (s->'payload')::jsonb,
            (s->>'date_start')::date, (s->>'date_stop')::date, (s->>'page_number')::int
        FROM unnest(p_raw_snapshots) AS s;
    END IF;

    IF p_campaign_entities IS NOT NULL AND array_length(p_campaign_entities, 1) > 0 THEN
        INSERT INTO public.meta_campaign_snapshots (sync_run_id, user_id, integration_id, ad_account_id, campaign_id, campaign_name, raw_objective, classified_objective, meta_status, effective_status)
        SELECT
            p_run_id, p_user_id, p_integration_id, p_ad_account_id,
            (c->>'campaign_id')::varchar, (c->>'campaign_name')::varchar, (c->>'raw_objective')::varchar, (c->>'classified_objective')::public.meta_objective,
            (c->>'meta_status')::varchar, (c->>'effective_status')::varchar
        FROM unnest(p_campaign_entities) AS c;

        INSERT INTO public.meta_campaign_entities (user_id, integration_id, ad_account_id, campaign_id, campaign_name, raw_objective, classified_objective, meta_status, effective_status, last_synced_at, last_sync_run_id)
        SELECT
            p_user_id, p_integration_id, p_ad_account_id,
            (c->>'campaign_id')::varchar, (c->>'campaign_name')::varchar, (c->>'raw_objective')::varchar, (c->>'classified_objective')::public.meta_objective,
            (c->>'meta_status')::varchar, (c->>'effective_status')::varchar, now(), p_run_id
        FROM unnest(p_campaign_entities) AS c
        ON CONFLICT (user_id, integration_id, ad_account_id, campaign_id) DO UPDATE SET
            campaign_name = EXCLUDED.campaign_name,
            raw_objective = EXCLUDED.raw_objective,
            classified_objective = EXCLUDED.classified_objective,
            meta_status = EXCLUDED.meta_status,
            effective_status = EXCLUDED.effective_status,
            last_synced_at = EXCLUDED.last_synced_at,
            last_sync_run_id = EXCLUDED.last_sync_run_id;
    END IF;

    IF p_adset_entities IS NOT NULL AND array_length(p_adset_entities, 1) > 0 THEN
        INSERT INTO public.meta_adset_snapshots (sync_run_id, user_id, integration_id, ad_account_id, campaign_id, adset_id, adset_name, optimization_goal, destination_type, promoted_object, attribution_setting, meta_status, effective_status)
        SELECT
            p_run_id, p_user_id, p_integration_id, p_ad_account_id,
            (a->>'campaign_id')::varchar, (a->>'adset_id')::varchar, (a->>'adset_name')::varchar, (a->>'optimization_goal')::varchar,
            (a->>'destination_type')::varchar, (a->'promoted_object')::jsonb, (a->>'attribution_setting')::varchar,
            (a->>'meta_status')::varchar, (a->>'effective_status')::varchar
        FROM unnest(p_adset_entities) AS a;

        INSERT INTO public.meta_adset_entities (user_id, integration_id, ad_account_id, campaign_id, adset_id, adset_name, optimization_goal, destination_type, promoted_object, attribution_setting, meta_status, effective_status, last_sync_run_id)
        SELECT
            p_user_id, p_integration_id, p_ad_account_id,
            (a->>'campaign_id')::varchar, (a->>'adset_id')::varchar, (a->>'adset_name')::varchar, (a->>'optimization_goal')::varchar,
            (a->>'destination_type')::varchar, (a->'promoted_object')::jsonb, (a->>'attribution_setting')::varchar,
            (a->>'meta_status')::varchar, (a->>'effective_status')::varchar, p_run_id
        FROM unnest(p_adset_entities) AS a
        ON CONFLICT (user_id, integration_id, ad_account_id, adset_id) DO UPDATE SET
            campaign_id = EXCLUDED.campaign_id,
            adset_name = EXCLUDED.adset_name,
            optimization_goal = EXCLUDED.optimization_goal,
            destination_type = EXCLUDED.destination_type,
            promoted_object = EXCLUDED.promoted_object,
            attribution_setting = EXCLUDED.attribution_setting,
            meta_status = EXCLUDED.meta_status,
            effective_status = EXCLUDED.effective_status,
            last_sync_run_id = EXCLUDED.last_sync_run_id;
    END IF;

    IF p_normalized_metrics IS NOT NULL AND array_length(p_normalized_metrics, 1) > 0 THEN
        INSERT INTO public.meta_normalized_metrics (user_id, sync_run_id, integration_id, ad_account_id, campaign_id, adset_id, metric_id, metric_value, action_type, source_field, date_start, date_stop, timezone, attribution_setting, source_level, completeness_status, calculation_metadata)
        SELECT
            p_user_id, p_run_id, p_integration_id, p_ad_account_id,
            (m->>'campaign_id')::varchar, (m->>'adset_id')::varchar, (m->>'metric_id')::varchar, (m->>'metric_value')::numeric,
            (m->>'action_type')::varchar, (m->>'source_field')::varchar, (m->>'date_start')::date, (m->>'date_stop')::date,
            (m->>'timezone')::varchar, (m->>'attribution_setting')::varchar, (m->>'source_level')::varchar, (m->>'completeness_status')::varchar, (m->'calculation_metadata')::jsonb
        FROM unnest(p_normalized_metrics) AS m;
    END IF;

    UPDATE public.meta_sync_runs
    SET status = p_final_status::public.meta_sync_status,
        termination_reason = v_termination_reason,
        metadata = COALESCE(p_metadata, '{}'::jsonb)
          || jsonb_build_object(
            'pages_fetched', p_pages_fetched,
            'records_fetched', p_records_fetched,
            'termination_reason', v_termination_reason
          ),
        finished_at = now()
    WHERE id = p_run_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.persist_meta_sync_run(UUID, UUID, UUID, TEXT, TEXT, JSON[], JSON[], JSON[], JSON[], JSONB, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.persist_meta_sync_run(UUID, UUID, UUID, TEXT, TEXT, JSON[], JSON[], JSON[], JSON[], JSONB, TEXT, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.persist_meta_sync_run(UUID, UUID, UUID, TEXT, TEXT, JSON[], JSON[], JSON[], JSON[], JSONB, TEXT, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.persist_meta_sync_run(UUID, UUID, UUID, TEXT, TEXT, JSON[], JSON[], JSON[], JSON[], JSONB, TEXT, INTEGER, INTEGER) TO service_role;

ALTER FUNCTION public.persist_meta_sync_run(UUID, UUID, UUID, TEXT, TEXT, JSON[], JSON[], JSON[], JSON[], JSONB, TEXT, INTEGER, INTEGER) OWNER TO postgres;

COMMIT;
