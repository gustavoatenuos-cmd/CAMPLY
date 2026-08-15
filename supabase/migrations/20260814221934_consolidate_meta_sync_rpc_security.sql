-- The resolver returns the encrypted Meta access token and is consumed only
-- by the meta-sync-performance Edge Function through its service-role client.
-- Keep it out of authenticated/anonymous Data API access and execute with the
-- caller privileges instead of bypassing row-level access controls.

CREATE OR REPLACE FUNCTION public.resolve_meta_sync_client_asset(
  p_user_id UUID,
  p_client_meta_asset_id UUID
)
RETURNS TABLE (
  client_meta_asset_id UUID,
  client_id TEXT,
  id UUID,
  asset_id TEXT,
  integration_id UUID,
  integration_user_id TEXT,
  integration_status TEXT,
  access_token_encrypted TEXT
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    cma.id AS client_meta_asset_id,
    cma.client_id,
    ma.id,
    ma.asset_id,
    mi.id AS integration_id,
    mi.user_id::text AS integration_user_id,
    mi.status AS integration_status,
    mi.access_token_encrypted
  FROM public.client_meta_assets cma
  JOIN public.client_identity ci
    ON ci.user_id = cma.user_id
   AND ci.client_id = cma.client_id
   AND ci.archived_at IS NULL
  JOIN public.meta_assets ma
    ON ma.id = cma.meta_asset_id
   AND ma.asset_type = 'adaccount'
  JOIN public.meta_integrations mi
    ON mi.id = ma.integration_id
   AND mi.user_id = cma.user_id
  WHERE cma.id = p_client_meta_asset_id
    AND cma.user_id = p_user_id
    AND cma.unlinked_at IS NULL
  LIMIT 1;
$$;

ALTER FUNCTION public.resolve_meta_sync_client_asset(UUID, UUID) OWNER TO postgres;

GRANT SELECT ON TABLE public.client_meta_assets TO service_role;
GRANT SELECT ON TABLE public.client_identity TO service_role;
GRANT SELECT ON TABLE public.meta_assets TO service_role;
GRANT SELECT ON TABLE public.meta_integrations TO service_role;

REVOKE ALL ON FUNCTION public.resolve_meta_sync_client_asset(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_meta_sync_client_asset(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_meta_sync_client_asset(UUID, UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.resolve_meta_sync_client_asset(UUID, UUID) FROM service_role;
GRANT EXECUTE ON FUNCTION public.resolve_meta_sync_client_asset(UUID, UUID) TO service_role;
