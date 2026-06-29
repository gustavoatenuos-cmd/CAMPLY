DO $$ BEGIN
  -- Add missing columns to current entities if they don't exist
  ALTER TABLE public.meta_campaign_entities ADD COLUMN IF NOT EXISTS sync_run_id UUID;
  ALTER TABLE public.meta_adset_entities ADD COLUMN IF NOT EXISTS sync_run_id UUID;
  -- meta_campaign_entities doesn't use entity_id as a pk, it's campaign_id, but the rpc uses entity_id. Let's make sure it exists or fix the RPC instead of renaming.
  -- Wait, the RPC uses entity_id. Let's add entity_id as well or just change the RPC. Let me check the RPC.
  
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_sync_runs_user_id_fkey') THEN
    ALTER TABLE public.meta_sync_runs
      ADD CONSTRAINT meta_sync_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_sync_runs_integration_id_fkey') THEN
    ALTER TABLE public.meta_sync_runs
      ADD CONSTRAINT meta_sync_runs_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES public.meta_integrations (id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_raw_snapshots_sync_run_id_fkey') THEN
    ALTER TABLE public.meta_raw_snapshots
      ADD CONSTRAINT meta_raw_snapshots_sync_run_id_fkey FOREIGN KEY (sync_run_id) REFERENCES public.meta_sync_runs (id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_campaign_entities_sync_run_id_fkey') THEN
    ALTER TABLE public.meta_campaign_entities
      ADD CONSTRAINT meta_campaign_entities_sync_run_id_fkey FOREIGN KEY (sync_run_id) REFERENCES public.meta_sync_runs (id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_adset_entities_sync_run_id_fkey') THEN
    ALTER TABLE public.meta_adset_entities
      ADD CONSTRAINT meta_adset_entities_sync_run_id_fkey FOREIGN KEY (sync_run_id) REFERENCES public.meta_sync_runs (id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_adset_entities_campaign_id_fkey') THEN
    ALTER TABLE public.meta_adset_entities
      ADD CONSTRAINT meta_adset_entities_campaign_id_fkey FOREIGN KEY (user_id, ad_account_id, campaign_id) REFERENCES public.meta_campaign_entities (user_id, ad_account_id, campaign_id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_normalized_metrics_sync_run_id_fkey') THEN
    ALTER TABLE public.meta_normalized_metrics
      ADD CONSTRAINT meta_normalized_metrics_sync_run_id_fkey FOREIGN KEY (sync_run_id) REFERENCES public.meta_sync_runs (id) ON DELETE CASCADE;
  END IF;
END $$;

-- 2. Hardening persist_meta_sync_run

DROP FUNCTION IF EXISTS public.persist_meta_sync_run(
    UUID, UUID, UUID, TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, JSONB, INTEGER, INTEGER
);

CREATE OR REPLACE FUNCTION public.persist_meta_sync_run(
  p_run_id UUID,
  p_user_id UUID,
  p_integration_id UUID,
  p_ad_account_id VARCHAR,
  p_final_status VARCHAR,
  p_metadata JSONB,
  p_raw_snapshots JSONB[],
  p_campaign_entities JSONB[],
  p_adset_entities JSONB[],
  p_normalized_metrics JSONB[],
  p_pages_fetched INT DEFAULT 0,
  p_records_fetched INT DEFAULT 0
) RETURNS void 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run_record RECORD;
BEGIN
  -- Strict validations
  IF p_final_status NOT IN ('success', 'partial', 'failed') THEN
    RAISE EXCEPTION 'Invalid final status: %', p_final_status;
  END IF;

  -- Validate run consistency and running status
  SELECT * INTO v_run_record FROM public.meta_sync_runs WHERE id = p_run_id FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sync run % not found', p_run_id;
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

  -- Update sync run
  UPDATE public.meta_sync_runs
  SET 
    status = p_final_status::meta_sync_status,
    metadata = COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('pages_fetched', p_pages_fetched, 'records_fetched', p_records_fetched),
    finished_at = NOW()
  WHERE id = p_run_id;

  -- Insert raw snapshots
  IF p_raw_snapshots IS NOT NULL AND array_length(p_raw_snapshots, 1) > 0 THEN
    INSERT INTO public.meta_raw_snapshots (sync_run_id, user_id, ad_account_id, entity_level, entity_id, endpoint, payload, page_number, date_start, date_stop)
    SELECT 
      p_run_id,
      p_user_id,
      p_ad_account_id,
      (s->>'entity_level')::varchar,
      (s->>'entity_id')::varchar,
      (s->>'endpoint')::varchar,
      s->'payload',
      (s->>'page_number')::int,
      (s->>'date_start')::date,
      (s->>'date_stop')::date
    FROM unnest(p_raw_snapshots) s;
  END IF;

  -- Upsert campaign entities
  IF p_campaign_entities IS NOT NULL AND array_length(p_campaign_entities, 1) > 0 THEN
    INSERT INTO public.meta_campaign_entities (sync_run_id, user_id, ad_account_id, campaign_id, campaign_name, raw_objective, classified_objective, meta_status, effective_status, last_synced_at, updated_at)
    SELECT 
      p_run_id,
      p_user_id,
      p_ad_account_id,
      (c->>'campaign_id')::varchar,
      (c->>'campaign_name')::varchar,
      (c->>'raw_objective')::varchar,
      (c->>'classified_objective')::meta_objective,
      (c->>'meta_status')::varchar,
      (c->>'effective_status')::varchar,
      NOW(),
      NOW()
    FROM unnest(p_campaign_entities) c
    ON CONFLICT (user_id, ad_account_id, campaign_id) DO UPDATE SET
      sync_run_id = EXCLUDED.sync_run_id,
      campaign_name = EXCLUDED.campaign_name,
      raw_objective = EXCLUDED.raw_objective,
      classified_objective = EXCLUDED.classified_objective,
      meta_status = EXCLUDED.meta_status,
      effective_status = EXCLUDED.effective_status,
      last_synced_at = EXCLUDED.last_synced_at,
      updated_at = EXCLUDED.updated_at;
  END IF;

  -- Upsert adset entities
  IF p_adset_entities IS NOT NULL AND array_length(p_adset_entities, 1) > 0 THEN
    INSERT INTO public.meta_adset_entities (sync_run_id, user_id, ad_account_id, campaign_id, adset_id, adset_name, optimization_goal, destination_type, promoted_object, attribution_setting, meta_status, effective_status, updated_at)
    SELECT 
      p_run_id,
      p_user_id,
      p_ad_account_id,
      (a->>'campaign_id')::varchar,
      (a->>'adset_id')::varchar,
      (a->>'adset_name')::varchar,
      (a->>'optimization_goal')::varchar,
      (a->>'destination_type')::varchar,
      COALESCE(a->'promoted_object', '{}'::jsonb),
      (a->>'attribution_setting')::varchar,
      (a->>'meta_status')::varchar,
      (a->>'effective_status')::varchar,
      NOW()
    FROM unnest(p_adset_entities) a
    ON CONFLICT (user_id, ad_account_id, adset_id) DO UPDATE SET
      sync_run_id = EXCLUDED.sync_run_id,
      adset_name = EXCLUDED.adset_name,
      optimization_goal = EXCLUDED.optimization_goal,
      destination_type = EXCLUDED.destination_type,
      promoted_object = EXCLUDED.promoted_object,
      attribution_setting = EXCLUDED.attribution_setting,
      meta_status = EXCLUDED.meta_status,
      effective_status = EXCLUDED.effective_status,
      updated_at = EXCLUDED.updated_at;
  END IF;

  -- Insert metrics
  IF p_normalized_metrics IS NOT NULL AND array_length(p_normalized_metrics, 1) > 0 THEN
    INSERT INTO public.meta_normalized_metrics (sync_run_id, user_id, ad_account_id, campaign_id, adset_id, metric_id, metric_value, action_type, source_field, date_start, date_stop, timezone, attribution_setting, source_level, completeness_status, calculation_metadata)
    SELECT 
      p_run_id,
      p_user_id,
      p_ad_account_id,
      (m->>'campaign_id')::varchar,
      (m->>'adset_id')::varchar,
      (m->>'metric_id')::varchar,
      (m->>'metric_value')::numeric,
      (m->>'action_type')::varchar,
      (m->>'source_field')::varchar,
      (m->>'date_start')::date,
      (m->>'date_stop')::date,
      (m->>'timezone')::varchar,
      (m->>'attribution_setting')::varchar,
      (m->>'source_level')::varchar,
      (m->>'completeness_status')::varchar,
      m->'calculation_metadata'
    FROM unnest(p_normalized_metrics) m;
  END IF;

END;
$$;

ALTER FUNCTION public.persist_meta_sync_run(UUID, UUID, UUID, VARCHAR, VARCHAR, JSONB, JSONB[], JSONB[], JSONB[], JSONB[], INT, INT) OWNER TO postgres;

-- Revoke execution from public, anon, and authenticated
REVOKE ALL ON FUNCTION public.persist_meta_sync_run(UUID, UUID, UUID, VARCHAR, VARCHAR, JSONB, JSONB[], JSONB[], JSONB[], JSONB[], INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.persist_meta_sync_run(UUID, UUID, UUID, VARCHAR, VARCHAR, JSONB, JSONB[], JSONB[], JSONB[], JSONB[], INT, INT) FROM anon;
REVOKE ALL ON FUNCTION public.persist_meta_sync_run(UUID, UUID, UUID, VARCHAR, VARCHAR, JSONB, JSONB[], JSONB[], JSONB[], JSONB[], INT, INT) FROM authenticated;

-- Grant execution to service_role only
GRANT EXECUTE ON FUNCTION public.persist_meta_sync_run(UUID, UUID, UUID, VARCHAR, VARCHAR, JSONB, JSONB[], JSONB[], JSONB[], JSONB[], INT, INT) TO service_role;

-- 3. Atomic OAuth Consumption RPC

CREATE OR REPLACE FUNCTION public.consume_meta_oauth_state(
  p_state_hash VARCHAR
) RETURNS TABLE(user_id UUID, redirect_uri TEXT, scopes TEXT[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.meta_oauth_states
  SET used_at = NOW()
  WHERE state_hash = p_state_hash AND used_at IS NULL AND expires_at > NOW()
  RETURNING public.meta_oauth_states.user_id, public.meta_oauth_states.redirect_uri, public.meta_oauth_states.scopes;
END;
$$;

ALTER FUNCTION public.consume_meta_oauth_state(VARCHAR) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.consume_meta_oauth_state(VARCHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_meta_oauth_state(VARCHAR) FROM anon;
REVOKE ALL ON FUNCTION public.consume_meta_oauth_state(VARCHAR) FROM authenticated;

-- Explicitly grant table permissions to service_role just in case they were missed
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_meta_oauth_state(VARCHAR) TO service_role;

NOTIFY pgrst, 'reload schema';
