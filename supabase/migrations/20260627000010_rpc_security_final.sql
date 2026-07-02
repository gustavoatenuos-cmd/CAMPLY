-- Migration 000010: RPC Security Final
-- Description: Hardens persist_meta_sync_run RPC with proper security controls.

BEGIN;

-- Drop old signatures to avoid overloading ambiguity
DROP FUNCTION IF EXISTS public.persist_meta_sync_run(UUID, UUID, UUID, TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, JSONB, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.persist_meta_sync_run(UUID, UUID, UUID, TEXT, TEXT, JSON[], JSON[], JSON[], JSON[], JSONB, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.persist_meta_sync_run(UUID, UUID, UUID, VARCHAR, VARCHAR, JSONB, JSONB[], JSONB[], JSONB[], JSONB[], INTEGER, INTEGER);

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
  p_pages_fetched INT DEFAULT 0,
  p_records_fetched INT DEFAULT 0
)
RETURNS void AS $$
DECLARE
    v_run_record RECORD;
BEGIN
    -- 1. Lock and Verify Run
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

    -- 2. Insert Raw Snapshots
    IF p_raw_snapshots IS NOT NULL AND array_length(p_raw_snapshots, 1) > 0 THEN
        INSERT INTO public.meta_raw_snapshots (user_id, sync_run_id, integration_id, ad_account_id, entity_level, entity_id, endpoint, payload, date_start, date_stop, page_number)
        SELECT 
            p_user_id, p_run_id, p_integration_id, p_ad_account_id,
            (s->>'entity_level')::varchar, (s->>'entity_id')::varchar, (s->>'endpoint')::varchar, (s->'payload')::jsonb,
            (s->>'date_start')::date, (s->>'date_stop')::date, (s->>'page_number')::int
        FROM unnest(p_raw_snapshots) AS s;
    END IF;

    -- 3. Insert Historical Campaigns and UPSERT Latest Entities
    IF p_campaign_entities IS NOT NULL AND array_length(p_campaign_entities, 1) > 0 THEN
        -- Insert Snapshots (Structural)
        INSERT INTO public.meta_campaign_snapshots (sync_run_id, user_id, integration_id, ad_account_id, campaign_id, campaign_name, raw_objective, classified_objective, meta_status, effective_status)
        SELECT 
            p_run_id, p_user_id, p_integration_id, p_ad_account_id,
            (c->>'campaign_id')::varchar, (c->>'campaign_name')::varchar, (c->>'raw_objective')::varchar, (c->>'classified_objective')::public.meta_objective,
            (c->>'meta_status')::varchar, (c->>'effective_status')::varchar
        FROM unnest(p_campaign_entities) AS c;

        -- Upsert Entities
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

    -- 4. Insert Historical AdSets and UPSERT Latest Entities
    IF p_adset_entities IS NOT NULL AND array_length(p_adset_entities, 1) > 0 THEN
        -- Insert Snapshots (Structural)
        INSERT INTO public.meta_adset_snapshots (sync_run_id, user_id, integration_id, ad_account_id, campaign_id, adset_id, adset_name, optimization_goal, destination_type, promoted_object, attribution_setting, meta_status, effective_status)
        SELECT 
            p_run_id, p_user_id, p_integration_id, p_ad_account_id,
            (a->>'campaign_id')::varchar, (a->>'adset_id')::varchar, (a->>'adset_name')::varchar, (a->>'optimization_goal')::varchar,
            (a->>'destination_type')::varchar, (a->'promoted_object')::jsonb, (a->>'attribution_setting')::varchar,
            (a->>'meta_status')::varchar, (a->>'effective_status')::varchar
        FROM unnest(p_adset_entities) AS a;

        -- Upsert Entities
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

    -- 5. Insert Normalized Metrics
    IF p_normalized_metrics IS NOT NULL AND array_length(p_normalized_metrics, 1) > 0 THEN
        INSERT INTO public.meta_normalized_metrics (user_id, sync_run_id, integration_id, ad_account_id, campaign_id, adset_id, metric_id, metric_value, action_type, source_field, date_start, date_stop, timezone, attribution_setting, source_level, completeness_status, calculation_metadata)
        SELECT 
            p_user_id, p_run_id, p_integration_id, p_ad_account_id,
            (m->>'campaign_id')::varchar, (m->>'adset_id')::varchar, (m->>'metric_id')::varchar, (m->>'metric_value')::numeric,
            (m->>'action_type')::varchar, (m->>'source_field')::varchar, (m->>'date_start')::date, (m->>'date_stop')::date,
            (m->>'timezone')::varchar, (m->>'attribution_setting')::varchar, (m->>'source_level')::varchar, (m->>'completeness_status')::varchar, (m->'calculation_metadata')::jsonb
        FROM unnest(p_normalized_metrics) AS m;
    END IF;

    -- 6. Update Run Status
    UPDATE public.meta_sync_runs 
    SET status = p_final_status::public.meta_sync_status,
        metadata = COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('pages_fetched', p_pages_fetched, 'records_fetched', p_records_fetched),
        finished_at = now()
    WHERE id = p_run_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Apply required privileges
REVOKE ALL ON FUNCTION public.persist_meta_sync_run(UUID, UUID, UUID, TEXT, TEXT, JSON[], JSON[], JSON[], JSON[], JSONB, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.persist_meta_sync_run(UUID, UUID, UUID, TEXT, TEXT, JSON[], JSON[], JSON[], JSON[], JSONB, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.persist_meta_sync_run(UUID, UUID, UUID, TEXT, TEXT, JSON[], JSON[], JSON[], JSON[], JSONB, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.persist_meta_sync_run(UUID, UUID, UUID, TEXT, TEXT, JSON[], JSON[], JSON[], JSON[], JSONB, INTEGER, INTEGER) TO service_role;

ALTER FUNCTION public.persist_meta_sync_run(UUID, UUID, UUID, TEXT, TEXT, JSON[], JSON[], JSON[], JSON[], JSONB, INTEGER, INTEGER) OWNER TO postgres;

COMMIT;
