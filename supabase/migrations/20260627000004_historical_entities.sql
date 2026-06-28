-- Migration: Historical Meta Entities
-- Description: Creates the immutable historical snapshot tables for Campaigns and AdSets linked to a sync run.

CREATE TABLE meta_campaign_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_run_id UUID NOT NULL REFERENCES meta_sync_runs(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    integration_id UUID NOT NULL, -- References meta_integrations but avoiding direct FK here if not strictly needed, or we can add it.
    ad_account_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    campaign_name TEXT NOT NULL,
    raw_objective TEXT,
    classified_objective meta_objective DEFAULT 'UNCLASSIFIED',
    meta_status TEXT,
    effective_status TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(sync_run_id, campaign_id)
);

CREATE TABLE meta_adset_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_run_id UUID NOT NULL REFERENCES meta_sync_runs(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    integration_id UUID NOT NULL,
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
    UNIQUE(sync_run_id, adset_id)
);

-- Indexes
CREATE INDEX idx_meta_campaign_snapshots_run ON meta_campaign_snapshots(sync_run_id);
CREATE INDEX idx_meta_adset_snapshots_run ON meta_adset_snapshots(sync_run_id);
CREATE INDEX idx_meta_campaign_snapshots_user ON meta_campaign_snapshots(user_id);
CREATE INDEX idx_meta_adset_snapshots_user ON meta_adset_snapshots(user_id);

-- RLS
ALTER TABLE meta_campaign_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_adset_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own campaign snapshots" ON meta_campaign_snapshots FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can view their own adset snapshots" ON meta_adset_snapshots FOR SELECT USING (auth.uid() = user_id);
