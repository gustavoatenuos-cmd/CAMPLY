-- supabase/migrations/20260708150000_guard_workspace_version_conflicts.sql

CREATE OR REPLACE FUNCTION public.try_save_camply_workspace_with_client_registry(
  p_data JSONB,
  p_expected_version BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_next_version BIGINT;
  v_current_version BIGINT;
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RAISE EXCEPTION 'Workspace payload must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF p_data ? 'clients' AND jsonb_typeof(p_data->'clients') <> 'array' THEN
    RAISE EXCEPTION 'Workspace clients must be an array' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_data->'clients', '[]'::jsonb)) AS c
    WHERE NULLIF(btrim(c->>'id'), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Every workspace client must contain a non-empty id' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT btrim(c->>'id') AS client_id, count(*) AS occurrences
      FROM jsonb_array_elements(COALESCE(p_data->'clients', '[]'::jsonb)) AS c
      GROUP BY btrim(c->>'id')
    ) duplicates
    WHERE duplicates.occurrences > 1
  ) THEN
    RAISE EXCEPTION 'Workspace contains duplicated client ids' USING ERRCODE = '23505';
  END IF;

  PERFORM 1
  FROM public.camply_workspace
  WHERE id = v_user_id::text
  FOR UPDATE;

  IF p_expected_version IS NULL THEN
    INSERT INTO public.camply_workspace (id, data, version, updated_at)
    VALUES (v_user_id::text, p_data, 1, now())
    ON CONFLICT (id) DO NOTHING
    RETURNING version INTO v_next_version;
  ELSE
    UPDATE public.camply_workspace
    SET data = p_data,
        version = version + 1,
        updated_at = now()
    WHERE id = v_user_id::text
      AND version = p_expected_version
    RETURNING version INTO v_next_version;
  END IF;

  IF v_next_version IS NULL THEN
    SELECT version INTO v_current_version FROM public.camply_workspace WHERE id = v_user_id::text;
    RETURN jsonb_build_object('status', 'conflict', 'current_version', v_current_version);
  END IF;

  WITH payload_clients AS (
    SELECT
      btrim(c->>'id') AS client_id,
      COALESCE(
        NULLIF(btrim(c->>'company'), ''),
        NULLIF(btrim(c->>'name'), ''),
        NULLIF(btrim(c->>'id'), '')
      ) AS display_name
    FROM jsonb_array_elements(COALESCE(p_data->'clients', '[]'::jsonb)) AS c
  )
  INSERT INTO public.client_identity (user_id, client_id, display_name, archived_at)
  SELECT v_user_id, client_id, display_name, NULL
  FROM payload_clients
  ON CONFLICT (user_id, client_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    archived_at = NULL,
    updated_at = now();

  WITH payload_clients AS (
    SELECT btrim(c->>'id') AS client_id
    FROM jsonb_array_elements(COALESCE(p_data->'clients', '[]'::jsonb)) AS c
  )
  UPDATE public.client_identity ci
  SET archived_at = COALESCE(ci.archived_at, now()),
      updated_at = now()
  WHERE ci.user_id = v_user_id
    AND ci.archived_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM payload_clients pc
      WHERE pc.client_id = ci.client_id
    );

  RETURN jsonb_build_object('status', 'saved', 'version', v_next_version);
END;
$$;

REVOKE ALL ON FUNCTION public.try_save_camply_workspace_with_client_registry(JSONB, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.try_save_camply_workspace_with_client_registry(JSONB, BIGINT) FROM anon;
GRANT EXECUTE ON FUNCTION public.try_save_camply_workspace_with_client_registry(JSONB, BIGINT) TO authenticated;
