-- Migration: cost_alerts_and_thresholds
-- Adds tables for cost-based alerting and configurable thresholds per client/campaign

-- 1. Budget Alerts — alertas de custo gerados automaticamente
CREATE TABLE IF NOT EXISTS public.budget_alerts (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  client_id     TEXT NOT NULL,
  campaign_id   TEXT,
  alert_type    TEXT NOT NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  metric_name   TEXT NOT NULL,
  current_value NUMERIC,
  threshold_value NUMERIC,
  message       TEXT NOT NULL,
  is_resolved   BOOLEAN DEFAULT false,
  triggered_at  TIMESTAMPTZ DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);

ALTER TABLE public.budget_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_owns_budget_alerts" ON public.budget_alerts;
CREATE POLICY "user_owns_budget_alerts" ON public.budget_alerts
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS budget_alerts_user_client
  ON public.budget_alerts(user_id, client_id, is_resolved, triggered_at DESC);

-- 2. Cost Thresholds — limites configuráveis por cliente/campanha
CREATE TABLE IF NOT EXISTS public.cost_thresholds (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  client_id       TEXT NOT NULL,
  campaign_id     TEXT,   -- NULL = aplica a todas as campanhas do cliente
  metric          TEXT NOT NULL CHECK (metric IN ('cpm','cpc','cpl','cpa','roas','budget_pct','frequency')),
  warning_level   NUMERIC NOT NULL,
  critical_level  NUMERIC NOT NULL,
  period          TEXT NOT NULL DEFAULT 'daily' CHECK (period IN ('daily','weekly','monthly')),
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, client_id, campaign_id, metric)
);

ALTER TABLE public.cost_thresholds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_owns_cost_thresholds" ON public.cost_thresholds;
CREATE POLICY "user_owns_cost_thresholds" ON public.cost_thresholds
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS cost_thresholds_user_client
  ON public.cost_thresholds(user_id, client_id, is_active);

-- 3. Client analytics profile — categoria e benchmarks
-- (extends camply_workspace JSONB, but also adds typed columns for future querying)
ALTER TABLE public.camply_workspace
  ADD COLUMN IF NOT EXISTS client_categories JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.camply_workspace.client_categories IS
  'Map of client_id -> {category, benchmarks, monthlyBudgetLimit, alertBudgetAt}';
