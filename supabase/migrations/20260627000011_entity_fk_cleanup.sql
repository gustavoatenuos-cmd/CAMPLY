-- Migration 000011: FK Cleanup and Delete Policy
-- Description: Sets run_scope on sync runs, safely backfills last_sync_run_id, makes it NOT NULL, and enforces immutable delete policy.

BEGIN;

-- 1. Add run_scope to meta_sync_runs
ALTER TABLE public.meta_sync_runs ADD COLUMN IF NOT EXISTS run_scope TEXT DEFAULT 'full_account' NOT NULL;
ALTER TABLE public.meta_sync_runs ADD CONSTRAINT run_scope_check CHECK (run_scope IN ('full_account', 'selected_campaigns'));

-- 2. Clean up orphans via backfill and make last_sync_run_id NOT NULL safely
DO $$
DECLARE
    orphan_campaigns INT;
    orphan_adsets INT;
BEGIN
    -- Backfill campaigns
    UPDATE public.meta_campaign_entities c
    SET last_sync_run_id = (
        SELECT id FROM public.meta_sync_runs r 
        WHERE r.integration_id = c.integration_id 
          AND r.ad_account_id = c.ad_account_id 
        ORDER BY created_at DESC LIMIT 1
    )
    WHERE c.last_sync_run_id IS NULL;

    -- Backfill adsets
    UPDATE public.meta_adset_entities a
    SET last_sync_run_id = (
        SELECT id FROM public.meta_sync_runs r 
        WHERE r.integration_id = a.integration_id 
          AND r.ad_account_id = a.ad_account_id 
        ORDER BY created_at DESC LIMIT 1
    )
    WHERE a.last_sync_run_id IS NULL;

    -- Check if any orphans remain
    SELECT count(*) INTO orphan_campaigns FROM public.meta_campaign_entities WHERE last_sync_run_id IS NULL;
    SELECT count(*) INTO orphan_adsets FROM public.meta_adset_entities WHERE last_sync_run_id IS NULL;
    
    IF orphan_campaigns > 0 OR orphan_adsets > 0 THEN
        RAISE EXCEPTION 'Cannot apply NOT NULL to last_sync_run_id. Found % orphan campaigns and % orphan adsets after backfill attempt.', orphan_campaigns, orphan_adsets;
    END IF;
END $$;

ALTER TABLE public.meta_campaign_entities ALTER COLUMN last_sync_run_id SET NOT NULL;
ALTER TABLE public.meta_adset_entities ALTER COLUMN last_sync_run_id SET NOT NULL;

-- 3. Composite Foreign Keys using last_sync_run_id
ALTER TABLE public.meta_campaign_entities DROP CONSTRAINT IF EXISTS meta_campaign_entities_cross_fk;
ALTER TABLE public.meta_campaign_entities 
  ADD CONSTRAINT meta_campaign_entities_cross_fk FOREIGN KEY (last_sync_run_id, user_id, integration_id, ad_account_id) 
  REFERENCES public.meta_sync_runs(id, user_id, integration_id, ad_account_id) ON DELETE CASCADE;

ALTER TABLE public.meta_adset_entities DROP CONSTRAINT IF EXISTS meta_adset_entities_cross_fk;
ALTER TABLE public.meta_adset_entities 
  ADD CONSTRAINT meta_adset_entities_cross_fk FOREIGN KEY (last_sync_run_id, user_id, integration_id, ad_account_id) 
  REFERENCES public.meta_sync_runs(id, user_id, integration_id, ad_account_id) ON DELETE CASCADE;

-- 4. Enforce Immutable Delete Policy for Snapshots (Updates already blocked in 000009)
CREATE OR REPLACE FUNCTION prevent_direct_snapshot_delete()
RETURNS TRIGGER AS $$
BEGIN
    IF pg_trigger_depth() = 1 THEN
        RAISE EXCEPTION 'Direct deletes to historical snapshots are not allowed. Snapshots are immutable.';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_campaign_snapshot_delete ON public.meta_campaign_snapshots;
CREATE TRIGGER prevent_campaign_snapshot_delete
BEFORE DELETE ON public.meta_campaign_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_direct_snapshot_delete();

DROP TRIGGER IF EXISTS prevent_adset_snapshot_delete ON public.meta_adset_snapshots;
CREATE TRIGGER prevent_adset_snapshot_delete
BEFORE DELETE ON public.meta_adset_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_direct_snapshot_delete();

COMMIT;
