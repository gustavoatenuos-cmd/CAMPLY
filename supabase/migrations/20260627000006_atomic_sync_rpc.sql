-- Migration: Atomic Sync RPC
-- Description: Creates the transactional RPC function to persist all Meta Sync data in a single atomic transaction.

CREATE OR REPLACE FUNCTION persist_meta_sync_run(
    p_run_id UUID,
    p_user_id UUID,
    p_integration_id UUID,
    p_ad_account_id TEXT,
    p_status TEXT,
    p_raw_snapshots JSONB,
    p_historical_campaigns JSONB,
    p_historical_adsets JSONB,
    p_normalized_metrics JSONB,
    p_metadata JSONB,
    p_pages_fetched INTEGER,
    p_records_fetched INTEGER
)
RETURNS void AS $$
BEGIN
    -- 1. Verify Run
    UPDATE meta_sync_runs 
    SET status = p_status::meta_sync_status,
        metadata = p_metadata,
        pages_fetched = p_pages_fetched,
        records_fetched = p_records_fetched,
        finished_at = now()
    WHERE id = p_run_id AND user_id = p_user_id AND status = 'running';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SYNC_RUN_NOT_FOUND_OR_NOT_RUNNING';
    END IF;

    -- 2. Insert Raw Snapshots
    IF jsonb_array_length(p_raw_snapshots) > 0 THEN
        INSERT INTO meta_raw_snapshots (user_id, sync_run_id, ad_account_id, entity_level, entity_id, endpoint, payload, date_start, date_stop, page_number)
        SELECT 
            p_user_id, p_run_id, p_ad_account_id,
            s->>'entity_level', s->>'entity_id', s->>'endpoint', (s->>'payload')::jsonb,
            (s->>'date_start')::date, (s->>'date_stop')::date, (s->>'page_number')::int
        FROM jsonb_array_elements(p_raw_snapshots) AS s;
    END IF;

    -- 3. Insert Historical Campaigns and UPSERT Latest Entities
    IF jsonb_array_length(p_historical_campaigns) > 0 THEN
        -- Insert Snapshots
        INSERT INTO meta_campaign_snapshots (sync_run_id, user_id, integration_id, ad_account_id, campaign_id, campaign_name, raw_objective, classified_objective, meta_status, effective_status)
        SELECT 
            p_run_id, p_user_id, p_integration_id, p_ad_account_id,
            c->>'campaign_id', c->>'campaign_name', c->>'raw_objective', (c->>'classified_objective')::meta_objective,
            c->>'meta_status', c->>'effective_status'
        FROM jsonb_array_elements(p_historical_campaigns) AS c;

        -- Upsert Entities
        INSERT INTO meta_campaign_entities (user_id, ad_account_id, campaign_id, campaign_name, raw_objective, classified_objective, meta_status, effective_status, last_synced_at)
        SELECT 
            p_user_id, p_ad_account_id,
            c->>'campaign_id', c->>'campaign_name', c->>'raw_objective', (c->>'classified_objective')::meta_objective,
            c->>'meta_status', c->>'effective_status', now()
        FROM jsonb_array_elements(p_historical_campaigns) AS c
        ON CONFLICT (user_id, ad_account_id, campaign_id) DO UPDATE SET
            campaign_name = EXCLUDED.campaign_name,
            raw_objective = EXCLUDED.raw_objective,
            classified_objective = EXCLUDED.classified_objective,
            meta_status = EXCLUDED.meta_status,
            effective_status = EXCLUDED.effective_status,
            last_synced_at = EXCLUDED.last_synced_at;
    END IF;

    -- 4. Insert Historical AdSets and UPSERT Latest Entities
    IF jsonb_array_length(p_historical_adsets) > 0 THEN
        -- Insert Snapshots
        INSERT INTO meta_adset_snapshots (sync_run_id, user_id, integration_id, ad_account_id, campaign_id, adset_id, adset_name, optimization_goal, destination_type, promoted_object, attribution_setting, meta_status, effective_status)
        SELECT 
            p_run_id, p_user_id, p_integration_id, p_ad_account_id,
            a->>'campaign_id', a->>'adset_id', a->>'adset_name', a->>'optimization_goal',
            a->>'destination_type', (a->>'promoted_object')::jsonb, a->>'attribution_setting',
            a->>'meta_status', a->>'effective_status'
        FROM jsonb_array_elements(p_historical_adsets) AS a;

        -- Upsert Entities
        INSERT INTO meta_adset_entities (user_id, ad_account_id, campaign_id, adset_id, adset_name, optimization_goal, destination_type, promoted_object, attribution_setting, meta_status, effective_status)
        SELECT 
            p_user_id, p_ad_account_id,
            a->>'campaign_id', a->>'adset_id', a->>'adset_name', a->>'optimization_goal',
            a->>'destination_type', (a->>'promoted_object')::jsonb, a->>'attribution_setting',
            a->>'meta_status', a->>'effective_status'
        FROM jsonb_array_elements(p_historical_adsets) AS a
        ON CONFLICT (user_id, ad_account_id, adset_id) DO UPDATE SET
            campaign_id = EXCLUDED.campaign_id,
            adset_name = EXCLUDED.adset_name,
            optimization_goal = EXCLUDED.optimization_goal,
            destination_type = EXCLUDED.destination_type,
            promoted_object = EXCLUDED.promoted_object,
            attribution_setting = EXCLUDED.attribution_setting,
            meta_status = EXCLUDED.meta_status,
            effective_status = EXCLUDED.effective_status;
    END IF;

    -- 5. Insert Normalized Metrics
    IF jsonb_array_length(p_normalized_metrics) > 0 THEN
        INSERT INTO meta_normalized_metrics (user_id, sync_run_id, ad_account_id, campaign_id, adset_id, metric_id, metric_value, action_type, source_field, date_start, date_stop, timezone, attribution_setting, source_level, completeness_status, calculation_metadata)
        SELECT 
            p_user_id, p_run_id, p_ad_account_id,
            m->>'campaign_id', m->>'adset_id', m->>'metric_id', (m->>'metric_value')::numeric,
            m->>'action_type', m->>'source_field', (m->>'date_start')::date, (m->>'date_stop')::date,
            m->>'timezone', m->>'attribution_setting', m->>'source_level', m->>'completeness_status', (m->>'calculation_metadata')::jsonb
        FROM jsonb_array_elements(p_normalized_metrics) AS m;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
