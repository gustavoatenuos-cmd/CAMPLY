-- Migration 000008: Cross Run Integrity
-- Description: Adds integration_id to entity and snapshot tables, populates it from meta_sync_runs, and enforces composite foreign keys.

BEGIN;

-- 1. Add integration_id and last_sync_run_id to all relevant tables (NULLable initially)
ALTER TABLE public.meta_raw_snapshots ADD COLUMN IF NOT EXISTS integration_id UUID;
ALTER TABLE public.meta_campaign_entities ADD COLUMN IF NOT EXISTS integration_id UUID;
ALTER TABLE public.meta_campaign_entities ADD COLUMN IF NOT EXISTS last_sync_run_id UUID REFERENCES public.meta_sync_runs(id) ON DELETE SET NULL;
ALTER TABLE public.meta_adset_entities ADD COLUMN IF NOT EXISTS integration_id UUID;
ALTER TABLE public.meta_adset_entities ADD COLUMN IF NOT EXISTS last_sync_run_id UUID REFERENCES public.meta_sync_runs(id) ON DELETE SET NULL;
ALTER TABLE public.meta_normalized_metrics ADD COLUMN IF NOT EXISTS integration_id UUID;
ALTER TABLE public.meta_sync_runs ADD COLUMN IF NOT EXISTS integration_id UUID;

-- 2. Populate integration_id via sync_run_id (Backfill)
UPDATE public.meta_raw_snapshots s 
SET integration_id = r.integration_id 
FROM public.meta_sync_runs r 
WHERE s.sync_run_id = r.id AND s.integration_id IS NULL;

UPDATE public.meta_campaign_entities e 
SET integration_id = s.integration_id, last_sync_run_id = s.sync_run_id
FROM public.meta_campaign_snapshots s 
WHERE e.user_id = s.user_id AND e.campaign_id = s.campaign_id AND e.integration_id IS NULL;

UPDATE public.meta_adset_entities e 
SET integration_id = s.integration_id, last_sync_run_id = s.sync_run_id
FROM public.meta_adset_snapshots s 
WHERE e.user_id = s.user_id AND e.adset_id = s.adset_id AND e.integration_id IS NULL;

UPDATE public.meta_normalized_metrics s 
SET integration_id = r.integration_id 
FROM public.meta_sync_runs r 
WHERE s.sync_run_id = r.id AND s.integration_id IS NULL;

-- 3. Make them NOT NULL
ALTER TABLE public.meta_sync_runs ALTER COLUMN integration_id SET NOT NULL;
ALTER TABLE public.meta_raw_snapshots ALTER COLUMN integration_id SET NOT NULL;
ALTER TABLE public.meta_campaign_entities ALTER COLUMN integration_id SET NOT NULL;
ALTER TABLE public.meta_adset_entities ALTER COLUMN integration_id SET NOT NULL;
ALTER TABLE public.meta_normalized_metrics ALTER COLUMN integration_id SET NOT NULL;

-- 4. Create composite UNIQUE on meta_sync_runs
ALTER TABLE public.meta_sync_runs DROP CONSTRAINT IF EXISTS meta_sync_runs_cross_fk_unique;
ALTER TABLE public.meta_sync_runs ADD CONSTRAINT meta_sync_runs_cross_fk_unique UNIQUE (id, user_id, integration_id, ad_account_id);

-- 5. Drop existing FKs to recreate them as composite
ALTER TABLE public.meta_raw_snapshots DROP CONSTRAINT IF EXISTS meta_raw_snapshots_sync_run_id_fkey;
ALTER TABLE public.meta_campaign_entities DROP CONSTRAINT IF EXISTS meta_campaign_entities_sync_run_id_fkey;
ALTER TABLE public.meta_adset_entities DROP CONSTRAINT IF EXISTS meta_adset_entities_sync_run_id_fkey;
ALTER TABLE public.meta_normalized_metrics DROP CONSTRAINT IF EXISTS meta_normalized_metrics_sync_run_id_fkey;

-- 6. Add composite FKs ensuring user_id, integration_id, and ad_account_id perfectly match the run
ALTER TABLE public.meta_raw_snapshots 
  ADD CONSTRAINT meta_raw_snapshots_cross_fk FOREIGN KEY (sync_run_id, user_id, integration_id, ad_account_id) 
  REFERENCES public.meta_sync_runs(id, user_id, integration_id, ad_account_id) ON DELETE CASCADE;

ALTER TABLE public.meta_campaign_entities 
  ADD CONSTRAINT meta_campaign_entities_cross_fk FOREIGN KEY (sync_run_id, user_id, integration_id, ad_account_id) 
  REFERENCES public.meta_sync_runs(id, user_id, integration_id, ad_account_id) ON DELETE CASCADE;

ALTER TABLE public.meta_adset_entities 
  ADD CONSTRAINT meta_adset_entities_cross_fk FOREIGN KEY (sync_run_id, user_id, integration_id, ad_account_id) 
  REFERENCES public.meta_sync_runs(id, user_id, integration_id, ad_account_id) ON DELETE CASCADE;

ALTER TABLE public.meta_normalized_metrics 
  ADD CONSTRAINT meta_normalized_metrics_cross_fk FOREIGN KEY (sync_run_id, user_id, integration_id, ad_account_id) 
  REFERENCES public.meta_sync_runs(id, user_id, integration_id, ad_account_id) ON DELETE CASCADE;

-- 7. Update UNIQUE indexes on entities to include integration_id
-- Drop the dependent FK first
ALTER TABLE public.meta_adset_entities DROP CONSTRAINT IF EXISTS meta_adset_entities_campaign_id_fkey;

ALTER TABLE public.meta_campaign_entities DROP CONSTRAINT IF EXISTS meta_campaign_entities_user_id_ad_account_id_campaign_id_key;
ALTER TABLE public.meta_campaign_entities ADD CONSTRAINT meta_campaign_entities_unique_key UNIQUE (user_id, integration_id, ad_account_id, campaign_id);

ALTER TABLE public.meta_adset_entities DROP CONSTRAINT IF EXISTS meta_adset_entities_user_id_ad_account_id_adset_id_key;
ALTER TABLE public.meta_adset_entities ADD CONSTRAINT meta_adset_entities_unique_key UNIQUE (user_id, integration_id, ad_account_id, adset_id);

-- Ensure adset to campaign FK includes integration_id
ALTER TABLE public.meta_adset_entities ADD CONSTRAINT meta_adset_entities_campaign_id_fkey 
  FOREIGN KEY (user_id, integration_id, ad_account_id, campaign_id) 
  REFERENCES public.meta_campaign_entities(user_id, integration_id, ad_account_id, campaign_id) ON DELETE CASCADE;

COMMIT;
