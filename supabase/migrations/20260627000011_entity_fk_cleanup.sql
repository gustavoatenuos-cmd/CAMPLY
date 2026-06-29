-- Migration 000011: FK Cleanup and Delete Policy
-- Description: Sets run_scope on sync runs, makes last_sync_run_id NOT NULL on entities, and enforces immutable delete policy for snapshots.

BEGIN;

-- 1. Add run_scope to meta_sync_runs
ALTER TABLE public.meta_sync_runs ADD COLUMN IF NOT EXISTS run_scope TEXT DEFAULT 'full_account' NOT NULL;
ALTER TABLE public.meta_sync_runs ADD CONSTRAINT run_scope_check CHECK (run_scope IN ('full_account', 'selected_campaigns'));

-- 2. Clean up orphans and make last_sync_run_id NOT NULL on entities
DELETE FROM public.meta_campaign_entities WHERE last_sync_run_id IS NULL;
ALTER TABLE public.meta_campaign_entities ALTER COLUMN last_sync_run_id SET NOT NULL;
DELETE FROM public.meta_adset_entities WHERE last_sync_run_id IS NULL;
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
        -- Level 1 means it was called directly by the user statement.
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
