-- Migration 000017: Meta Ad and Creative Storage
-- Description: Adds immutable Ad/Creative snapshots, latest entity tables, and
-- Ad-level metric keys so creative performance rankings can be built from
-- verified historical sync data.

BEGIN;

ALTER TABLE public.meta_sync_runs
  ALTER COLUMN selected_entity_ids SET DEFAULT jsonb_build_object(
    'campaign_ids', '[]'::jsonb,
    'adset_ids', '[]'::jsonb,
    'ad_ids', '[]'::jsonb,
    'creative_ids', '[]'::jsonb
  );

UPDATE public.meta_sync_runs
SET selected_entity_ids = jsonb_build_object(
  'campaign_ids', COALESCE(selected_entity_ids->'campaign_ids', '[]'::jsonb),
  'adset_ids', COALESCE(selected_entity_ids->'adset_ids', '[]'::jsonb),
  'ad_ids', COALESCE(selected_entity_ids->'ad_ids', '[]'::jsonb),
  'creative_ids', COALESCE(selected_entity_ids->'creative_ids', '[]'::jsonb)
);

ALTER TABLE public.meta_sync_runs
  DROP CONSTRAINT IF EXISTS meta_sync_runs_selected_entity_ids_check;
ALTER TABLE public.meta_sync_runs
  ADD CONSTRAINT meta_sync_runs_selected_entity_ids_check
  CHECK (
    jsonb_typeof(selected_entity_ids) = 'object'
    AND jsonb_typeof(COALESCE(selected_entity_ids->'campaign_ids', '[]'::jsonb)) = 'array'
    AND jsonb_typeof(COALESCE(selected_entity_ids->'adset_ids', '[]'::jsonb)) = 'array'
    AND jsonb_typeof(COALESCE(selected_entity_ids->'ad_ids', '[]'::jsonb)) = 'array'
    AND jsonb_typeof(COALESCE(selected_entity_ids->'creative_ids', '[]'::jsonb)) = 'array'
  );

ALTER TABLE public.meta_sync_runs
  DROP CONSTRAINT IF EXISTS run_scope_check;
ALTER TABLE public.meta_sync_runs
  ADD CONSTRAINT run_scope_check
  CHECK (run_scope IN (
    'full_account',
    'selected_campaigns',
    'selected_adsets',
    'selected_ads',
    'selected_creatives',
    'selected_entities'
  ));

CREATE TABLE IF NOT EXISTS public.meta_ad_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL,
  ad_account_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  adset_id TEXT,
  ad_id TEXT NOT NULL,
  ad_name TEXT NOT NULL,
  creative_id TEXT,
  meta_status TEXT,
  effective_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sync_run_id, ad_id),
  CONSTRAINT meta_ad_snapshots_cross_fk FOREIGN KEY (sync_run_id, user_id, integration_id, ad_account_id)
    REFERENCES public.meta_sync_runs(id, user_id, integration_id, ad_account_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.meta_creative_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL,
  ad_account_id TEXT NOT NULL,
  creative_id TEXT NOT NULL,
  creative_name TEXT,
  title TEXT,
  body TEXT,
  thumbnail_url TEXT,
  image_url TEXT,
  object_story_spec JSONB,
  asset_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sync_run_id, creative_id),
  CONSTRAINT meta_creative_snapshots_cross_fk FOREIGN KEY (sync_run_id, user_id, integration_id, ad_account_id)
    REFERENCES public.meta_sync_runs(id, user_id, integration_id, ad_account_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.meta_ad_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL,
  last_sync_run_id UUID NOT NULL,
  ad_account_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  adset_id TEXT,
  ad_id TEXT NOT NULL,
  ad_name TEXT NOT NULL,
  creative_id TEXT,
  meta_status TEXT,
  effective_status TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, integration_id, ad_account_id, ad_id),
  CONSTRAINT meta_ad_entities_cross_fk FOREIGN KEY (last_sync_run_id, user_id, integration_id, ad_account_id)
    REFERENCES public.meta_sync_runs(id, user_id, integration_id, ad_account_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.meta_creative_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL,
  last_sync_run_id UUID NOT NULL,
  ad_account_id TEXT NOT NULL,
  creative_id TEXT NOT NULL,
  creative_name TEXT,
  title TEXT,
  body TEXT,
  thumbnail_url TEXT,
  image_url TEXT,
  object_story_spec JSONB,
  asset_payload JSONB,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, integration_id, ad_account_id, creative_id),
  CONSTRAINT meta_creative_entities_cross_fk FOREIGN KEY (last_sync_run_id, user_id, integration_id, ad_account_id)
    REFERENCES public.meta_sync_runs(id, user_id, integration_id, ad_account_id) ON DELETE CASCADE
);

ALTER TABLE public.meta_normalized_metrics
  ADD COLUMN IF NOT EXISTS ad_id TEXT,
  ADD COLUMN IF NOT EXISTS creative_id TEXT;

DROP INDEX IF EXISTS public.meta_normalized_metrics_idempotency_key;

CREATE UNIQUE INDEX IF NOT EXISTS meta_normalized_metrics_idempotency_key
ON public.meta_normalized_metrics (
  user_id,
  sync_run_id,
  ad_account_id,
  campaign_id,
  adset_id,
  ad_id,
  creative_id,
  metric_id,
  date_start,
  date_stop,
  attribution_setting,
  source_level
) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_meta_ad_snapshots_run ON public.meta_ad_snapshots(sync_run_id);
CREATE INDEX IF NOT EXISTS idx_meta_ad_snapshots_user ON public.meta_ad_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_meta_ad_snapshots_ad ON public.meta_ad_snapshots(user_id, integration_id, ad_account_id, ad_id);
CREATE INDEX IF NOT EXISTS idx_meta_creative_snapshots_run ON public.meta_creative_snapshots(sync_run_id);
CREATE INDEX IF NOT EXISTS idx_meta_creative_snapshots_user ON public.meta_creative_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_meta_creative_snapshots_creative ON public.meta_creative_snapshots(user_id, integration_id, ad_account_id, creative_id);
CREATE INDEX IF NOT EXISTS idx_meta_ad_entities_account ON public.meta_ad_entities(user_id, integration_id, ad_account_id);
CREATE INDEX IF NOT EXISTS idx_meta_creative_entities_account ON public.meta_creative_entities(user_id, integration_id, ad_account_id);
CREATE INDEX IF NOT EXISTS idx_meta_normalized_metrics_ad ON public.meta_normalized_metrics(user_id, sync_run_id, ad_id);
CREATE INDEX IF NOT EXISTS idx_meta_normalized_metrics_creative ON public.meta_normalized_metrics(user_id, sync_run_id, creative_id);

ALTER TABLE public.meta_ad_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_creative_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ad_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_creative_entities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own ad snapshots" ON public.meta_ad_snapshots;
CREATE POLICY "Users can view their own ad snapshots"
  ON public.meta_ad_snapshots FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own creative snapshots" ON public.meta_creative_snapshots;
CREATE POLICY "Users can view their own creative snapshots"
  ON public.meta_creative_snapshots FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own ad entities" ON public.meta_ad_entities;
CREATE POLICY "Users can view their own ad entities"
  ON public.meta_ad_entities FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own creative entities" ON public.meta_creative_entities;
CREATE POLICY "Users can view their own creative entities"
  ON public.meta_creative_entities FOR SELECT USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_meta_ad_entities_updated_at ON public.meta_ad_entities;
CREATE TRIGGER update_meta_ad_entities_updated_at
BEFORE UPDATE ON public.meta_ad_entities
FOR EACH ROW EXECUTE FUNCTION update_meta_updated_at();

DROP TRIGGER IF EXISTS update_meta_creative_entities_updated_at ON public.meta_creative_entities;
CREATE TRIGGER update_meta_creative_entities_updated_at
BEFORE UPDATE ON public.meta_creative_entities
FOR EACH ROW EXECUTE FUNCTION update_meta_updated_at();

DROP TRIGGER IF EXISTS prevent_ad_snapshot_update ON public.meta_ad_snapshots;
CREATE TRIGGER prevent_ad_snapshot_update
BEFORE UPDATE ON public.meta_ad_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_updates();

DROP TRIGGER IF EXISTS prevent_creative_snapshot_update ON public.meta_creative_snapshots;
CREATE TRIGGER prevent_creative_snapshot_update
BEFORE UPDATE ON public.meta_creative_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_updates();

DROP TRIGGER IF EXISTS prevent_ad_snapshot_delete ON public.meta_ad_snapshots;
CREATE TRIGGER prevent_ad_snapshot_delete
BEFORE DELETE ON public.meta_ad_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_direct_snapshot_delete();

DROP TRIGGER IF EXISTS prevent_creative_snapshot_delete ON public.meta_creative_snapshots;
CREATE TRIGGER prevent_creative_snapshot_delete
BEFORE DELETE ON public.meta_creative_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_direct_snapshot_delete();

GRANT SELECT ON public.meta_ad_snapshots TO authenticated;
GRANT SELECT ON public.meta_creative_snapshots TO authenticated;
GRANT SELECT ON public.meta_ad_entities TO authenticated;
GRANT SELECT ON public.meta_creative_entities TO authenticated;

DROP FUNCTION IF EXISTS public.persist_meta_sync_run(UUID, UUID, UUID, TEXT, TEXT, JSON[], JSON[], JSON[], JSON[], JSONB, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.persist_meta_sync_run(UUID, UUID, UUID, TEXT, TEXT, JSON[], JSON[], JSON[], JSON[], JSON[], JSON[], JSONB, TEXT, INTEGER, INTEGER);

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
  p_ad_entities JSON[] DEFAULT NULL,
  p_creative_entities JSON[] DEFAULT NULL,
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

    IF p_creative_entities IS NOT NULL AND array_length(p_creative_entities, 1) > 0 THEN
        INSERT INTO public.meta_creative_snapshots (sync_run_id, user_id, integration_id, ad_account_id, creative_id, creative_name, title, body, thumbnail_url, image_url, object_story_spec, asset_payload)
        SELECT
            p_run_id, p_user_id, p_integration_id, p_ad_account_id,
            (cr->>'creative_id')::varchar, (cr->>'creative_name')::varchar, (cr->>'title')::text, (cr->>'body')::text,
            (cr->>'thumbnail_url')::text, (cr->>'image_url')::text, (cr->'object_story_spec')::jsonb, (cr->'asset_payload')::jsonb
        FROM unnest(p_creative_entities) AS cr;

        INSERT INTO public.meta_creative_entities (user_id, integration_id, last_sync_run_id, ad_account_id, creative_id, creative_name, title, body, thumbnail_url, image_url, object_story_spec, asset_payload, last_synced_at)
        SELECT
            p_user_id, p_integration_id, p_run_id, p_ad_account_id,
            (cr->>'creative_id')::varchar, (cr->>'creative_name')::varchar, (cr->>'title')::text, (cr->>'body')::text,
            (cr->>'thumbnail_url')::text, (cr->>'image_url')::text, (cr->'object_story_spec')::jsonb, (cr->'asset_payload')::jsonb, now()
        FROM unnest(p_creative_entities) AS cr
        ON CONFLICT (user_id, integration_id, ad_account_id, creative_id) DO UPDATE SET
            creative_name = EXCLUDED.creative_name,
            title = EXCLUDED.title,
            body = EXCLUDED.body,
            thumbnail_url = EXCLUDED.thumbnail_url,
            image_url = EXCLUDED.image_url,
            object_story_spec = EXCLUDED.object_story_spec,
            asset_payload = EXCLUDED.asset_payload,
            last_sync_run_id = EXCLUDED.last_sync_run_id,
            last_synced_at = EXCLUDED.last_synced_at;
    END IF;

    IF p_ad_entities IS NOT NULL AND array_length(p_ad_entities, 1) > 0 THEN
        INSERT INTO public.meta_ad_snapshots (sync_run_id, user_id, integration_id, ad_account_id, campaign_id, adset_id, ad_id, ad_name, creative_id, meta_status, effective_status)
        SELECT
            p_run_id, p_user_id, p_integration_id, p_ad_account_id,
            (ad->>'campaign_id')::varchar, (ad->>'adset_id')::varchar, (ad->>'ad_id')::varchar, (ad->>'ad_name')::varchar,
            (ad->>'creative_id')::varchar, (ad->>'meta_status')::varchar, (ad->>'effective_status')::varchar
        FROM unnest(p_ad_entities) AS ad;

        INSERT INTO public.meta_ad_entities (user_id, integration_id, last_sync_run_id, ad_account_id, campaign_id, adset_id, ad_id, ad_name, creative_id, meta_status, effective_status, last_synced_at)
        SELECT
            p_user_id, p_integration_id, p_run_id, p_ad_account_id,
            (ad->>'campaign_id')::varchar, (ad->>'adset_id')::varchar, (ad->>'ad_id')::varchar, (ad->>'ad_name')::varchar,
            (ad->>'creative_id')::varchar, (ad->>'meta_status')::varchar, (ad->>'effective_status')::varchar, now()
        FROM unnest(p_ad_entities) AS ad
        ON CONFLICT (user_id, integration_id, ad_account_id, ad_id) DO UPDATE SET
            campaign_id = EXCLUDED.campaign_id,
            adset_id = EXCLUDED.adset_id,
            ad_name = EXCLUDED.ad_name,
            creative_id = EXCLUDED.creative_id,
            meta_status = EXCLUDED.meta_status,
            effective_status = EXCLUDED.effective_status,
            last_sync_run_id = EXCLUDED.last_sync_run_id,
            last_synced_at = EXCLUDED.last_synced_at;
    END IF;

    IF p_normalized_metrics IS NOT NULL AND array_length(p_normalized_metrics, 1) > 0 THEN
        INSERT INTO public.meta_normalized_metrics (user_id, sync_run_id, integration_id, ad_account_id, campaign_id, adset_id, ad_id, creative_id, metric_id, metric_value, action_type, source_field, date_start, date_stop, timezone, attribution_setting, source_level, completeness_status, calculation_metadata)
        SELECT
            p_user_id, p_run_id, p_integration_id, p_ad_account_id,
            (m->>'campaign_id')::varchar, (m->>'adset_id')::varchar, (m->>'ad_id')::varchar, (m->>'creative_id')::varchar,
            (m->>'metric_id')::varchar, (m->>'metric_value')::numeric,
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

REVOKE ALL ON FUNCTION public.persist_meta_sync_run(UUID, UUID, UUID, TEXT, TEXT, JSON[], JSON[], JSON[], JSON[], JSON[], JSON[], JSONB, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.persist_meta_sync_run(UUID, UUID, UUID, TEXT, TEXT, JSON[], JSON[], JSON[], JSON[], JSON[], JSON[], JSONB, TEXT, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.persist_meta_sync_run(UUID, UUID, UUID, TEXT, TEXT, JSON[], JSON[], JSON[], JSON[], JSON[], JSON[], JSONB, TEXT, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.persist_meta_sync_run(UUID, UUID, UUID, TEXT, TEXT, JSON[], JSON[], JSON[], JSON[], JSON[], JSON[], JSONB, TEXT, INTEGER, INTEGER) TO service_role;

ALTER FUNCTION public.persist_meta_sync_run(UUID, UUID, UUID, TEXT, TEXT, JSON[], JSON[], JSON[], JSON[], JSON[], JSON[], JSONB, TEXT, INTEGER, INTEGER) OWNER TO postgres;

COMMIT;
