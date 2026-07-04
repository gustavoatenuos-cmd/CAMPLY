-- Consolidates profiles, client-scoped targets, project links, idempotent client
-- creation and persisted alert lifecycle. This migration is additive: legacy
-- workspace/category/threshold fields remain available for rollback and backfill.
BEGIN;

CREATE TABLE IF NOT EXISTS public.project_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unlinked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT project_clients_identity_fk FOREIGN KEY (user_id, client_id)
    REFERENCES public.client_identity(user_id, client_id) ON DELETE RESTRICT,
  CONSTRAINT project_clients_project_not_blank CHECK (btrim(project_id) <> ''),
  CONSTRAINT project_clients_window_check CHECK (unlinked_at IS NULL OR unlinked_at >= linked_at)
);

ALTER TABLE public.project_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own project client links" ON public.project_clients;
CREATE POLICY "Users can view their own project client links" ON public.project_clients
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_project_clients_updated_at ON public.project_clients;
CREATE TRIGGER trg_project_clients_updated_at BEFORE UPDATE ON public.project_clients
  FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();
CREATE UNIQUE INDEX IF NOT EXISTS project_clients_one_active_project_per_client
  ON public.project_clients(user_id, client_id) WHERE unlinked_at IS NULL;
CREATE INDEX IF NOT EXISTS project_clients_active_project_idx
  ON public.project_clients(user_id, project_id, client_id) WHERE unlinked_at IS NULL;
REVOKE ALL ON public.project_clients FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.project_clients TO authenticated;

-- Safe legacy backfill. Missing projects/identities remain untouched and are
-- reported by the compatibility audit query in the handoff document.
WITH legacy_links AS (
  SELECT w.id::uuid AS user_id, btrim(c->>'id') AS client_id, btrim(c->>'projectId') AS project_id
  FROM public.camply_workspace w
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.data->'clients', '[]'::jsonb)) c
  WHERE w.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND NULLIF(btrim(c->>'id'), '') IS NOT NULL
    AND NULLIF(btrim(c->>'projectId'), '') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(w.data->'projects', '[]'::jsonb)) p
      WHERE btrim(p->>'id') = btrim(c->>'projectId')
    )
)
INSERT INTO public.project_clients(user_id, project_id, client_id)
SELECT l.user_id, l.project_id, l.client_id
FROM legacy_links l
JOIN public.client_identity ci ON ci.user_id = l.user_id AND ci.client_id = l.client_id
WHERE ci.archived_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.project_clients pc
    WHERE pc.user_id = l.user_id AND pc.client_id = l.client_id AND pc.unlinked_at IS NULL
  );

ALTER TABLE public.client_performance_targets
  ADD COLUMN IF NOT EXISTS client_id TEXT,
  ADD COLUMN IF NOT EXISTS expectation_type TEXT,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.client_performance_targets t
SET client_id = cma.client_id,
    expectation_type = COALESCE(t.expectation_type, CASE t.target_kind
      WHEN 'maximum_metric' THEN 'maximum'
      WHEN 'target_range' THEN 'range'
      WHEN 'minimum_results' THEN 'quantity_minimum'
      ELSE 'minimum'
    END)
FROM public.client_meta_assets cma
WHERE cma.user_id = t.user_id AND cma.id = t.client_meta_asset_id
  AND (t.client_id IS NULL OR t.expectation_type IS NULL);

ALTER TABLE public.client_performance_targets
  ALTER COLUMN client_id SET NOT NULL,
  DROP CONSTRAINT IF EXISTS client_performance_targets_asset_user_fk,
  ALTER COLUMN client_meta_asset_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS client_performance_targets_expectation_check,
  ADD CONSTRAINT client_performance_targets_expectation_check CHECK (
    expectation_type IN ('maximum', 'minimum', 'range', 'quantity_minimum')
  ),
  DROP CONSTRAINT IF EXISTS client_performance_targets_client_fk,
  ADD CONSTRAINT client_performance_targets_client_fk FOREIGN KEY (user_id, client_id)
    REFERENCES public.client_identity(user_id, client_id) ON DELETE CASCADE,
  ADD CONSTRAINT client_performance_targets_asset_user_fk FOREIGN KEY (client_meta_asset_id, user_id)
    REFERENCES public.client_meta_assets(id, user_id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.fill_client_performance_target_identity()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.client_id IS NULL AND NEW.client_meta_asset_id IS NOT NULL THEN
    SELECT cma.client_id INTO NEW.client_id
    FROM public.client_meta_assets cma
    WHERE cma.id=NEW.client_meta_asset_id AND cma.user_id=NEW.user_id;
  END IF;
  NEW.expectation_type := COALESCE(NEW.expectation_type, CASE NEW.target_kind
    WHEN 'maximum_metric' THEN 'maximum'
    WHEN 'target_range' THEN 'range'
    WHEN 'minimum_results' THEN 'quantity_minimum'
    ELSE 'minimum'
  END);
  NEW.updated_at := now();
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_fill_client_performance_target_identity ON public.client_performance_targets;
CREATE TRIGGER trg_fill_client_performance_target_identity
BEFORE INSERT OR UPDATE ON public.client_performance_targets
FOR EACH ROW EXECUTE PROCEDURE public.fill_client_performance_target_identity();

DROP INDEX IF EXISTS public.client_performance_targets_active_unique;
CREATE UNIQUE INDEX IF NOT EXISTS client_targets_active_client_scope_unique
  ON public.client_performance_targets(user_id, client_id, metric_id, expectation_type)
  WHERE client_meta_asset_id IS NULL AND campaign_id IS NULL AND effective_to IS NULL AND archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS client_targets_active_account_scope_unique
  ON public.client_performance_targets(user_id, client_id, client_meta_asset_id, metric_id, expectation_type)
  WHERE client_meta_asset_id IS NOT NULL AND campaign_id IS NULL AND effective_to IS NULL AND archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS client_targets_active_campaign_scope_unique
  ON public.client_performance_targets(user_id, client_id, client_meta_asset_id, campaign_id, metric_id, expectation_type)
  WHERE campaign_id IS NOT NULL AND effective_to IS NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS client_targets_client_active_idx
  ON public.client_performance_targets(user_id, client_id, effective_from DESC)
  WHERE effective_to IS NULL AND archived_at IS NULL;

-- Profile JSON remains a compatibility copy. It is backfilled into normalized
-- targets only when a matching active target does not already exist.
INSERT INTO public.client_performance_targets (
  user_id, client_id, client_meta_asset_id, campaign_id, metric_id, target_kind,
  expectation_type, target_value, target_min, target_max, warning_tolerance_percent,
  critical_tolerance_percent, priority_weight, evaluation_period
)
SELECT p.user_id, p.client_id, NULL, NULL, g->>'metricId',
  CASE g->>'expectationType'
    WHEN 'maximum' THEN 'maximum_metric'
    WHEN 'range' THEN 'target_range'
    WHEN 'quantity_minimum' THEN 'minimum_results'
    ELSE 'minimum_metric'
  END,
  g->>'expectationType',
  COALESCE(NULLIF(g->>'value', '')::numeric, NULLIF(g->>'minValue', '')::numeric, 1),
  NULLIF(g->>'minValue', '')::numeric, NULLIF(g->>'maxValue', '')::numeric,
  COALESCE(NULLIF(g->>'warningTolerancePercent', '')::numeric, 10),
  COALESCE(NULLIF(g->>'criticalTolerancePercent', '')::numeric, 25),
  COALESCE(NULLIF(g->>'weight', '')::numeric, 1),
  COALESCE(NULLIF(g->>'evaluationPeriod', ''), p.budget_period)
FROM public.client_analysis_profiles p
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.performance_goals, '[]'::jsonb)) g
WHERE public.is_allowed_performance_metric(g->>'metricId')
  AND g->>'expectationType' IN ('maximum', 'minimum', 'range', 'quantity_minimum')
  AND NOT EXISTS (
    SELECT 1 FROM public.client_performance_targets t
    WHERE t.user_id = p.user_id AND t.client_id = p.client_id
      AND t.client_meta_asset_id IS NULL AND t.campaign_id IS NULL
      AND t.metric_id = g->>'metricId' AND t.expectation_type = g->>'expectationType'
      AND t.effective_to IS NULL AND t.archived_at IS NULL
  );

CREATE TABLE IF NOT EXISTS public.client_creation_idempotency (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key UUID NOT NULL,
  client_id TEXT NOT NULL,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, idempotency_key)
);
ALTER TABLE public.client_creation_idempotency ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own client creation requests" ON public.client_creation_idempotency;
CREATE POLICY "Users can view their own client creation requests" ON public.client_creation_idempotency
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
REVOKE ALL ON public.client_creation_idempotency FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.client_creation_idempotency TO authenticated;

ALTER TABLE public.budget_alerts
  ADD COLUMN IF NOT EXISTS rule_key TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS period TEXT NOT NULL DEFAULT 'this_month',
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES public.meta_sync_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_meta_asset_id UUID,
  ADD COLUMN IF NOT EXISTS first_triggered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_triggered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE public.budget_alerts SET
  rule_key = COALESCE(rule_key, alert_type),
  status = CASE WHEN is_resolved THEN 'resolved' ELSE 'active' END,
  first_triggered_at = COALESCE(first_triggered_at, triggered_at),
  last_triggered_at = COALESCE(last_triggered_at, triggered_at);
ALTER TABLE public.budget_alerts
  ALTER COLUMN rule_key SET NOT NULL,
  ALTER COLUMN first_triggered_at SET NOT NULL,
  ALTER COLUMN last_triggered_at SET NOT NULL,
  DROP CONSTRAINT IF EXISTS budget_alerts_status_check,
  ADD CONSTRAINT budget_alerts_status_check CHECK (status IN ('active', 'acknowledged', 'resolved'));
CREATE UNIQUE INDEX IF NOT EXISTS budget_alerts_active_client_rule_unique
  ON public.budget_alerts(user_id, client_id, rule_key, metric_name, period)
  WHERE campaign_id IS NULL AND status IN ('active', 'acknowledged');
CREATE UNIQUE INDEX IF NOT EXISTS budget_alerts_active_campaign_rule_unique
  ON public.budget_alerts(user_id, client_id, campaign_id, rule_key, metric_name, period)
  WHERE campaign_id IS NOT NULL AND status IN ('active', 'acknowledged');
DROP TRIGGER IF EXISTS trg_budget_alerts_updated_at ON public.budget_alerts;
CREATE TRIGGER trg_budget_alerts_updated_at BEFORE UPDATE ON public.budget_alerts
  FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.create_client_with_configuration_v1(
  p_client JSONB,
  p_project_id TEXT,
  p_profile JSONB,
  p_targets JSONB,
  p_idempotency_key UUID,
  p_workspace JSONB,
  p_expected_version BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user_id UUID := auth.uid(); v_client_id TEXT; v_version BIGINT; v_response JSONB;
  v_target JSONB; v_project_id TEXT := NULLIF(btrim(COALESCE(p_project_id, '')), '');
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt()->>'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR jsonb_typeof(COALESCE(p_client, 'null'::jsonb)) <> 'object'
    OR jsonb_typeof(COALESCE(p_profile, 'null'::jsonb)) <> 'object'
    OR jsonb_typeof(COALESCE(p_targets, 'null'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Invalid client configuration payload' USING ERRCODE = '22023';
  END IF;
  SELECT response INTO v_response FROM public.client_creation_idempotency
    WHERE user_id = v_user_id AND idempotency_key = p_idempotency_key;
  IF v_response IS NOT NULL THEN RETURN v_response; END IF;
  v_client_id := NULLIF(btrim(p_client->>'id'), '');
  IF v_client_id IS NULL OR NULLIF(btrim(COALESCE(p_client->>'name', p_client->>'company', '')), '') IS NULL THEN
    RAISE EXCEPTION 'Client id and name are required' USING ERRCODE = '22023';
  END IF;
  IF v_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_workspace->'projects', '[]'::jsonb)) p
    WHERE btrim(p->>'id') = v_project_id
  ) THEN RAISE EXCEPTION 'Project not found' USING ERRCODE = '42501'; END IF;

  v_version := public.save_camply_workspace_with_client_registry(p_workspace, p_expected_version);

  INSERT INTO public.client_analysis_profiles(
    user_id, client_id, vertical, subsegment, custom_vertical, custom_subsegment,
    business_model, primary_objective, primary_conversion_metric, secondary_metrics,
    performance_goals, primary_channel, budget_period, planned_budget, budget_platform, analysis_enabled
  ) VALUES (
    v_user_id, v_client_id, COALESCE(NULLIF(btrim(p_profile->>'vertical'), ''), 'Outros'),
    COALESCE(NULLIF(btrim(p_profile->>'subsegment'), ''), 'Outros'),
    NULLIF(btrim(COALESCE(p_profile->>'customVertical', '')), ''),
    NULLIF(btrim(COALESCE(p_profile->>'customSubsegment', '')), ''),
    COALESCE(NULLIF(btrim(COALESCE(p_profile->>'businessModel', '')), ''), 'configuração pendente'),
    NULLIF(p_profile->>'primaryObjective', ''),
    COALESCE(NULLIF(p_profile->>'primaryConversionMetric', ''), 'messaging_conversations_started_total'),
    COALESCE(p_profile->'secondaryMetrics', '[]'::jsonb), COALESCE(p_targets, '[]'::jsonb),
    COALESCE(NULLIF(p_profile->>'primaryChannel', ''), 'Misto'),
    COALESCE(NULLIF(p_profile->>'budgetPeriod', ''), 'monthly'),
    NULLIF(p_profile->>'plannedBudget', '')::numeric,
    COALESCE(NULLIF(p_profile->>'budgetPlatform', ''), 'meta'),
    COALESCE((p_profile->>'analysisEnabled')::boolean, true)
  ) ON CONFLICT(user_id, client_id) DO UPDATE SET
    vertical=EXCLUDED.vertical, subsegment=EXCLUDED.subsegment,
    custom_vertical=EXCLUDED.custom_vertical, custom_subsegment=EXCLUDED.custom_subsegment,
    primary_objective=EXCLUDED.primary_objective,
    primary_conversion_metric=EXCLUDED.primary_conversion_metric,
    secondary_metrics=EXCLUDED.secondary_metrics, performance_goals=EXCLUDED.performance_goals,
    primary_channel=EXCLUDED.primary_channel, budget_period=EXCLUDED.budget_period,
    planned_budget=EXCLUDED.planned_budget, budget_platform=EXCLUDED.budget_platform,
    analysis_enabled=EXCLUDED.analysis_enabled, updated_at=now();

  UPDATE public.client_performance_targets SET effective_to=now(), updated_at=now()
  WHERE user_id=v_user_id AND client_id=v_client_id AND client_meta_asset_id IS NULL
    AND campaign_id IS NULL AND effective_to IS NULL AND archived_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_targets) g
      WHERE g->>'metricId'=client_performance_targets.metric_id
        AND g->>'expectationType'=client_performance_targets.expectation_type);

  FOR v_target IN SELECT value FROM jsonb_array_elements(p_targets) LOOP
    IF NOT public.is_allowed_performance_metric(v_target->>'metricId')
      OR v_target->>'expectationType' NOT IN ('maximum','minimum','range','quantity_minimum') THEN
      RAISE EXCEPTION 'Invalid performance target' USING ERRCODE='22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.client_performance_targets t
      WHERE t.user_id=v_user_id AND t.client_id=v_client_id AND t.client_meta_asset_id IS NULL
        AND t.campaign_id IS NULL AND t.metric_id=v_target->>'metricId'
        AND t.expectation_type=v_target->>'expectationType' AND t.effective_to IS NULL
        AND t.archived_at IS NULL AND t.target_value=COALESCE(NULLIF(v_target->>'value','')::numeric, NULLIF(v_target->>'minValue','')::numeric, 1)
        AND t.target_min IS NOT DISTINCT FROM NULLIF(v_target->>'minValue','')::numeric
        AND t.target_max IS NOT DISTINCT FROM NULLIF(v_target->>'maxValue','')::numeric
    ) THEN
      UPDATE public.client_performance_targets SET effective_to=now(), updated_at=now()
      WHERE user_id=v_user_id AND client_id=v_client_id AND client_meta_asset_id IS NULL
        AND campaign_id IS NULL AND metric_id=v_target->>'metricId'
        AND expectation_type=v_target->>'expectationType' AND effective_to IS NULL AND archived_at IS NULL;
      INSERT INTO public.client_performance_targets(
        user_id,client_id,metric_id,target_kind,expectation_type,target_value,target_min,target_max,
        warning_tolerance_percent,critical_tolerance_percent,priority_weight,evaluation_period
      ) VALUES (
        v_user_id,v_client_id,v_target->>'metricId',CASE v_target->>'expectationType'
          WHEN 'maximum' THEN 'maximum_metric' WHEN 'range' THEN 'target_range'
          WHEN 'quantity_minimum' THEN 'minimum_results' ELSE 'minimum_metric' END,
        v_target->>'expectationType',COALESCE(NULLIF(v_target->>'value','')::numeric,NULLIF(v_target->>'minValue','')::numeric,1),
        NULLIF(v_target->>'minValue','')::numeric,NULLIF(v_target->>'maxValue','')::numeric,
        COALESCE(NULLIF(v_target->>'warningTolerancePercent','')::numeric,10),
        COALESCE(NULLIF(v_target->>'criticalTolerancePercent','')::numeric,25),
        COALESCE(NULLIF(v_target->>'weight','')::numeric,1),
        COALESCE(NULLIF(v_target->>'evaluationPeriod',''),p_profile->>'budgetPeriod','monthly')
      );
    END IF;
  END LOOP;

  UPDATE public.project_clients SET unlinked_at=now(),updated_at=now()
    WHERE user_id=v_user_id AND client_id=v_client_id AND unlinked_at IS NULL
      AND (v_project_id IS NULL OR project_id<>v_project_id);
  IF v_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.project_clients WHERE user_id=v_user_id AND client_id=v_client_id
      AND project_id=v_project_id AND unlinked_at IS NULL
  ) THEN INSERT INTO public.project_clients(user_id,project_id,client_id)
    VALUES(v_user_id,v_project_id,v_client_id); END IF;

  v_response := jsonb_build_object('clientId',v_client_id,'workspaceVersion',v_version,
    'projectId',v_project_id,'saved',true);
  INSERT INTO public.client_creation_idempotency(user_id,idempotency_key,client_id,response)
    VALUES(v_user_id,p_idempotency_key,v_client_id,v_response);
  RETURN v_response;
END; $$;
REVOKE ALL ON FUNCTION public.create_client_with_configuration_v1(JSONB,TEXT,JSONB,JSONB,UUID,JSONB,BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_client_with_configuration_v1(JSONB,TEXT,JSONB,JSONB,UUID,JSONB,BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_client_intelligence_dashboard_v1(
  p_client_id TEXT, p_period TEXT DEFAULT 'this_month'
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user_id UUID:=auth.uid(); v_rows JSONB; v_base JSONB; v_profile JSONB; v_targets JSONB; v_alerts JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.client_identity WHERE user_id=v_user_id AND client_id=p_client_id AND archived_at IS NULL)
    THEN RAISE EXCEPTION 'Client not found' USING ERRCODE='42501'; END IF;
  v_rows:=public.get_global_performance_dashboard_v2(p_period,ARRAY[p_client_id],NULL);
  v_base:=COALESCE(v_rows->0,'{}'::jsonb);
  SELECT to_jsonb(p) INTO v_profile FROM public.client_analysis_profiles p
    WHERE p.user_id=v_user_id AND p.client_id=p_client_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',t.id,'metricId',t.metric_id,
    'expectationType',t.expectation_type,'targetValue',t.target_value,'targetMin',t.target_min,
    'targetMax',t.target_max,'warningTolerancePercent',t.warning_tolerance_percent,
    'criticalTolerancePercent',t.critical_tolerance_percent,'weight',t.priority_weight,
    'evaluationPeriod',t.evaluation_period)),'[]'::jsonb) INTO v_targets
  FROM public.client_performance_targets t WHERE t.user_id=v_user_id AND t.client_id=p_client_id
    AND t.effective_to IS NULL AND t.archived_at IS NULL;
  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.last_triggered_at DESC),'[]'::jsonb) INTO v_alerts
  FROM public.budget_alerts a WHERE a.user_id=v_user_id AND a.client_id=p_client_id
    AND a.status IN ('active','acknowledged');
  RETURN jsonb_build_object(
    'client',jsonb_build_object('id',p_client_id,'name',v_base->>'clientName',
      'vertical',v_profile->>'vertical','subsegment',v_profile->>'subsegment',
      'primaryObjective',v_profile->>'primary_objective','primaryChannel',v_profile->>'primary_channel'),
    'profile',v_profile,'accounts',COALESCE(v_base->'accounts','[]'::jsonb),
    'dataQuality',v_base->'dataQuality','reliableRun',v_base->'lastSuccessfulRun',
    'latestAttempt',v_base->'lastAttempt','metrics',COALESCE(v_base->'metrics','{}'::jsonb),
    'campaigns',COALESCE(v_base->'metricGroups','[]'::jsonb),'targets',v_targets,'alerts',v_alerts,
    'budgetPacing',NULL,'score',jsonb_build_object('value',NULL,'status','insufficient_data',
      'confidence',0,'explanation','Avaliação calculada somente com evidência qualificada.','factors','[]'::jsonb),
    'priorities','[]'::jsonb,'period',p_period,'contractVersion',1
  );
END; $$;
REVOKE ALL ON FUNCTION public.get_client_intelligence_dashboard_v1(TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_client_intelligence_dashboard_v1(TEXT,TEXT) TO authenticated;

COMMIT;
