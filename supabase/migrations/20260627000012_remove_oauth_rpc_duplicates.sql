-- Migration: Remove OAuth RPC Duplicates
-- Description: Drops the duplicate consume_meta_oauth_state(TEXT) and ensures only the correct atomic version remains.

-- Drop the old one created in 000005 to avoid PostgREST overloading resolution errors
DROP FUNCTION IF EXISTS public.consume_meta_oauth_state(TEXT);

-- Make sure PostgREST schema cache is reloaded
NOTIFY pgrst, 'reload schema';
