DROP FUNCTION IF EXISTS public.resolve_meta_sync_client_asset(UUID, UUID);

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
SECURITY DEFINER
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
    ON ci.user_id::text = cma.user_id::text
   AND ci.client_id = cma.client_id
   AND ci.archived_at IS NULL
  JOIN public.meta_assets ma
    ON ma.id = cma.meta_asset_id
   AND ma.asset_type = 'adaccount'
  JOIN public.meta_integrations mi
    ON mi.id = ma.integration_id
   AND mi.user_id::text = cma.user_id::text
  WHERE cma.id = p_client_meta_asset_id
    AND cma.user_id::text = p_user_id::text
    AND cma.unlinked_at IS NULL
    AND (
      auth.role() = 'service_role'
      OR auth.uid() = p_user_id
    )
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_meta_sync_client_asset(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_meta_sync_client_asset(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_meta_sync_client_asset(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_meta_sync_client_asset(UUID, UUID) TO service_role;
