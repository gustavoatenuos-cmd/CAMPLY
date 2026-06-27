-- Migration: Meta Analytics Storage
-- Description: Creates the structure for preserving Meta Ads historical snapshots, normalized metrics, and alerts.

CREATE TYPE meta_sync_status AS ENUM ('running', 'success', 'partial', 'failed');
CREATE TYPE meta_alert_severity AS ENUM ('info', 'warning', 'critical');
CREATE TYPE meta_alert_status AS ENUM ('active', 'resolved', 'ignored');
CREATE TYPE meta_objective AS ENUM ('WHATSAPP', 'MESSENGER', 'INSTAGRAM_DIRECT', 'MESSAGING_OTHER', 'SALES', 'LEADS', 'TRAFFIC', 'PROFILE_VISITS', 'ENGAGEMENT', 'AWARENESS', 'VIDEO', 'APP', 'OTHER', 'UNCLASSIFIED');

CREATE TABLE meta_sync_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    integration_id UUID,
    ad_account_id TEXT NOT NULL,
    graph_api_version TEXT NOT NULL,
    requested_period TEXT NOT NULL,
    date_start DATE,
    date_stop DATE,
    timezone TEXT,
    currency TEXT,
    attribution_config JSONB,
    status meta_sync_status NOT NULL DEFAULT 'running',
    pages_fetched INTEGER DEFAULT 0,
    records_fetched INTEGER DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    error_message TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE meta_raw_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sync_run_id UUID NOT NULL REFERENCES meta_sync_runs(id) ON DELETE CASCADE,
    ad_account_id TEXT NOT NULL,
    entity_level TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    payload JSONB NOT NULL,
    date_start DATE,
    date_stop DATE,
    page_number INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE meta_campaign_entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id TEXT,
    ad_account_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    campaign_name TEXT NOT NULL,
    raw_objective TEXT,
    classified_objective meta_objective DEFAULT 'UNCLASSIFIED',
    meta_status TEXT,
    effective_status TEXT,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, ad_account_id, campaign_id)
);

CREATE TABLE meta_adset_entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ad_account_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    adset_id TEXT NOT NULL,
    adset_name TEXT NOT NULL,
    optimization_goal TEXT,
    destination_type TEXT,
    promoted_object JSONB,
    attribution_setting TEXT,
    meta_status TEXT,
    effective_status TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, ad_account_id, adset_id)
);

CREATE TABLE meta_normalized_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sync_run_id UUID NOT NULL REFERENCES meta_sync_runs(id) ON DELETE CASCADE,
    ad_account_id TEXT NOT NULL,
    campaign_id TEXT,
    adset_id TEXT,
    metric_id TEXT NOT NULL,
    metric_value NUMERIC NOT NULL,
    action_type TEXT,
    source_field TEXT,
    date_start DATE,
    date_stop DATE,
    timezone TEXT,
    attribution_setting TEXT,
    calculation_metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE meta_analysis_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sync_run_id UUID NOT NULL REFERENCES meta_sync_runs(id) ON DELETE CASCADE,
    client_id TEXT,
    campaign_id TEXT,
    classified_objective meta_objective,
    status meta_alert_status NOT NULL DEFAULT 'active',
    severity meta_alert_severity NOT NULL,
    metric_id TEXT NOT NULL,
    current_value NUMERIC,
    reference_value NUMERIC,
    absolute_change NUMERIC,
    percentage_change NUMERIC,
    sample_size INTEGER,
    confidence NUMERIC,
    evidence TEXT,
    hypothesis TEXT,
    recommendation TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX idx_meta_snapshots_sync ON meta_raw_snapshots(sync_run_id);
CREATE INDEX idx_meta_snapshots_entity ON meta_raw_snapshots(entity_id);
CREATE INDEX idx_meta_normalized_metrics_campaign ON meta_normalized_metrics(campaign_id);
CREATE INDEX idx_meta_normalized_metrics_date ON meta_normalized_metrics(date_start, date_stop);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_meta_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_meta_campaign_entities_updated_at
BEFORE UPDATE ON meta_campaign_entities
FOR EACH ROW EXECUTE FUNCTION update_meta_updated_at();

CREATE TRIGGER update_meta_adset_entities_updated_at
BEFORE UPDATE ON meta_adset_entities
FOR EACH ROW EXECUTE FUNCTION update_meta_updated_at();

-- RLS Policies
ALTER TABLE meta_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_raw_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_campaign_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_adset_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_normalized_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_analysis_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own sync runs" ON meta_sync_runs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can view their own raw snapshots" ON meta_raw_snapshots FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can view their own campaign entities" ON meta_campaign_entities FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can view their own adset entities" ON meta_adset_entities FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can view their own normalized metrics" ON meta_normalized_metrics FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can view their own analysis alerts" ON meta_analysis_alerts FOR SELECT USING (auth.uid() = user_id);
