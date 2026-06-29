-- Migration 000014: Complete read grants for authenticated Meta analytics users
-- Row Level Security policies continue to restrict rows by auth.uid().

BEGIN;

GRANT SELECT ON public.meta_raw_snapshots TO authenticated;
GRANT SELECT ON public.meta_campaign_entities TO authenticated;
GRANT SELECT ON public.meta_adset_entities TO authenticated;

COMMIT;
