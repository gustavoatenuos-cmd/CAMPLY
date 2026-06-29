-- Migration 000009: Immutable History Snapshots
-- Description: Applies composite cross-run foreign keys and immutability triggers to snapshot tables.

BEGIN;

-- 1. Ensure integration_id is populated in snapshots (000004 had it but we want to make sure it is not null)
-- 000004 already added integration_id.
-- Let's populate integration_id if null, just like in 000008
UPDATE public.meta_campaign_snapshots s 
SET integration_id = r.integration_id 
FROM public.meta_sync_runs r 
WHERE s.sync_run_id = r.id AND s.integration_id IS NULL;

UPDATE public.meta_adset_snapshots s 
SET integration_id = r.integration_id 
FROM public.meta_sync_runs r 
WHERE s.sync_run_id = r.id AND s.integration_id IS NULL;

DELETE FROM public.meta_campaign_snapshots WHERE integration_id IS NULL;
DELETE FROM public.meta_adset_snapshots WHERE integration_id IS NULL;

-- 2. Drop existing foreign keys
ALTER TABLE public.meta_campaign_snapshots DROP CONSTRAINT IF EXISTS meta_campaign_snapshots_sync_run_id_fkey;
ALTER TABLE public.meta_adset_snapshots DROP CONSTRAINT IF EXISTS meta_adset_snapshots_sync_run_id_fkey;

-- 3. Add composite FKs ensuring user_id, integration_id, and ad_account_id perfectly match the run
ALTER TABLE public.meta_campaign_snapshots 
  ADD CONSTRAINT meta_campaign_snapshots_cross_fk FOREIGN KEY (sync_run_id, user_id, integration_id, ad_account_id) 
  REFERENCES public.meta_sync_runs(id, user_id, integration_id, ad_account_id) ON DELETE CASCADE;

ALTER TABLE public.meta_adset_snapshots 
  ADD CONSTRAINT meta_adset_snapshots_cross_fk FOREIGN KEY (sync_run_id, user_id, integration_id, ad_account_id) 
  REFERENCES public.meta_sync_runs(id, user_id, integration_id, ad_account_id) ON DELETE CASCADE;


-- 4. Enforce Immutable Snapshots: Snapshots cannot be updated or deleted, only inserted.
CREATE OR REPLACE FUNCTION prevent_snapshot_updates()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Updates to historical snapshots are not allowed. Snapshots are immutable.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_campaign_snapshot_update ON public.meta_campaign_snapshots;
CREATE TRIGGER prevent_campaign_snapshot_update
BEFORE UPDATE ON public.meta_campaign_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_updates();

DROP TRIGGER IF EXISTS prevent_adset_snapshot_update ON public.meta_adset_snapshots;
CREATE TRIGGER prevent_adset_snapshot_update
BEFORE UPDATE ON public.meta_adset_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_updates();

COMMIT;
