-- Migration 000013: API Role Grants
-- Description: Ensures authenticated users have the necessary baseline grants to interact with tables exposed via PostgREST.

BEGIN;

GRANT SELECT ON public.meta_sync_runs TO authenticated;
GRANT SELECT ON public.meta_campaign_snapshots TO authenticated;
GRANT SELECT ON public.meta_adset_snapshots TO authenticated;
GRANT SELECT ON public.meta_normalized_metrics TO authenticated;

COMMIT;
