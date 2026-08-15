-- Persist multi-account Meta synchronization progress so a page reload never
-- loses the operational state and an interrupted batch can be resumed safely.

BEGIN;

CREATE TABLE IF NOT EXISTS public.meta_sync_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_period TEXT NOT NULL DEFAULT 'last_90d',
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'partial', 'failed')),
  total_items INTEGER NOT NULL DEFAULT 0 CHECK (total_items >= 0),
  completed_items INTEGER NOT NULL DEFAULT 0 CHECK (completed_items >= 0),
  success_items INTEGER NOT NULL DEFAULT 0 CHECK (success_items >= 0),
  partial_items INTEGER NOT NULL DEFAULT 0 CHECK (partial_items >= 0),
  failed_items INTEGER NOT NULL DEFAULT 0 CHECK (failed_items >= 0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT meta_sync_batches_counter_check CHECK (
    success_items + partial_items + failed_items <= completed_items
    AND completed_items <= total_items
  )
);

CREATE TABLE IF NOT EXISTS public.meta_sync_batch_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.meta_sync_batches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_meta_asset_id UUID NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  account_name TEXT NOT NULL,
  ad_account_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'success', 'partial', 'failed', 'already_running')),
  sync_run_id UUID,
  message TEXT,
  error_message TEXT,
  error_code TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT meta_sync_batch_items_asset_user_fk
    FOREIGN KEY (client_meta_asset_id, user_id)
    REFERENCES public.client_meta_assets(id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT meta_sync_batch_items_batch_asset_unique UNIQUE (batch_id, client_meta_asset_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS meta_sync_batches_one_running_per_user
ON public.meta_sync_batches(user_id)
WHERE status = 'running';

CREATE INDEX IF NOT EXISTS meta_sync_batches_user_created_idx
ON public.meta_sync_batches(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS meta_sync_batch_items_batch_idx
ON public.meta_sync_batch_items(batch_id, created_at);

ALTER TABLE public.meta_sync_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_sync_batch_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own Meta sync batches" ON public.meta_sync_batches;
CREATE POLICY "Users can view their own Meta sync batches"
ON public.meta_sync_batches
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own Meta sync batch items" ON public.meta_sync_batch_items;
CREATE POLICY "Users can view their own Meta sync batch items"
ON public.meta_sync_batch_items
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_meta_sync_batches_updated_at ON public.meta_sync_batches;
CREATE TRIGGER trg_meta_sync_batches_updated_at
BEFORE UPDATE ON public.meta_sync_batches
FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_meta_sync_batch_items_updated_at ON public.meta_sync_batch_items;
CREATE TRIGGER trg_meta_sync_batch_items_updated_at
BEFORE UPDATE ON public.meta_sync_batch_items
FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.meta_sync_batch_payload(
  p_batch_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', b.id,
    'status', b.status,
    'period', b.requested_period,
    'total', b.total_items,
    'completed', b.completed_items,
    'success', b.success_items,
    'partial', b.partial_items,
    'failed', b.failed_items,
    'startedAt', b.started_at,
    'finishedAt', b.finished_at,
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'clientId', i.client_id,
          'clientName', i.client_name,
          'clientMetaAssetId', i.client_meta_asset_id,
          'accountName', i.account_name,
          'adAccountId', i.ad_account_id,
          'status', i.status,
          'runId', i.sync_run_id,
          'message', i.message,
          'error', i.error_message,
          'errorCode', i.error_code
        )
        ORDER BY i.created_at, i.id
      )
      FROM public.meta_sync_batch_items i
      WHERE i.batch_id = b.id
        AND i.user_id = p_user_id
    ), '[]'::jsonb)
  )
  FROM public.meta_sync_batches b
  WHERE b.id = p_batch_id
    AND b.user_id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.meta_sync_batch_payload(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meta_sync_batch_payload(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.meta_sync_batch_payload(UUID, UUID) FROM authenticated;

CREATE OR REPLACE FUNCTION public.get_latest_meta_sync_batch()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_batch_id UUID;
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT b.id
  INTO v_batch_id
  FROM public.meta_sync_batches b
  WHERE b.user_id = v_user_id
  ORDER BY (b.status = 'running') DESC, b.created_at DESC
  LIMIT 1;

  IF v_batch_id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN public.meta_sync_batch_payload(v_batch_id, v_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_latest_meta_sync_batch() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_latest_meta_sync_batch() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_latest_meta_sync_batch() TO authenticated;

CREATE OR REPLACE FUNCTION public.start_meta_sync_batch(
  p_client_meta_asset_ids UUID[],
  p_period TEXT DEFAULT 'last_90d'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_batch_id UUID;
  v_inserted_count INTEGER;
  v_total INTEGER;
  v_completed INTEGER;
  v_success INTEGER;
  v_partial INTEGER;
  v_failed INTEGER;
  v_batch_status TEXT;
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_period <> 'last_90d' THEN
    RAISE EXCEPTION 'Only the official last_90d period can be synchronized'
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(array_length(p_client_meta_asset_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'At least one linked Meta account is required'
      USING ERRCODE = '22023';
  END IF;

  -- Serializes starts per user and makes the partial unique index race-proof.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  SELECT b.id
  INTO v_batch_id
  FROM public.meta_sync_batches b
  WHERE b.user_id = v_user_id
    AND b.status = 'running'
  ORDER BY b.created_at DESC
  LIMIT 1;

  IF v_batch_id IS NOT NULL THEN
    -- Reconcile a restored batch with today's active client links. Accounts
    -- removed from the operation must not leave a batch permanently stuck,
    -- and newly linked accounts can join the same resumable batch.
    UPDATE public.meta_sync_batch_items i
    SET status = 'failed',
        error_message = 'Conta removida da operação antes da conclusão do lote.',
        error_code = 'CLIENT_META_ASSET_NO_LONGER_ACTIVE',
        finished_at = now()
    WHERE i.batch_id = v_batch_id
      AND i.user_id = v_user_id
      AND i.status IN ('pending', 'running')
      AND NOT (i.client_meta_asset_id = ANY(p_client_meta_asset_ids));

    INSERT INTO public.meta_sync_batch_items (
      batch_id,
      user_id,
      client_meta_asset_id,
      client_id,
      client_name,
      account_name,
      ad_account_id
    )
    SELECT DISTINCT ON (cma.id)
      v_batch_id,
      v_user_id,
      cma.id,
      cma.client_id,
      ci.display_name,
      ma.asset_name,
      ma.asset_id
    FROM unnest(p_client_meta_asset_ids) requested(client_meta_asset_id)
    JOIN public.client_meta_assets cma
      ON cma.id = requested.client_meta_asset_id
     AND cma.user_id = v_user_id
     AND cma.unlinked_at IS NULL
    JOIN public.client_identity ci
      ON ci.user_id = cma.user_id
     AND ci.client_id = cma.client_id
     AND ci.archived_at IS NULL
    JOIN public.meta_assets ma
      ON ma.id = cma.meta_asset_id
     AND ma.asset_type = 'adaccount'
    JOIN public.meta_integrations mi
      ON mi.id = ma.integration_id
     AND mi.user_id = v_user_id
     AND mi.status = 'active'
    ORDER BY cma.id
    ON CONFLICT (batch_id, client_meta_asset_id) DO NOTHING;

    SELECT
      count(*)::integer,
      count(*) FILTER (WHERE status IN ('success', 'partial', 'failed', 'already_running'))::integer,
      count(*) FILTER (WHERE status = 'success')::integer,
      count(*) FILTER (WHERE status IN ('partial', 'already_running'))::integer,
      count(*) FILTER (WHERE status = 'failed')::integer
    INTO v_total, v_completed, v_success, v_partial, v_failed
    FROM public.meta_sync_batch_items
    WHERE batch_id = v_batch_id
      AND user_id = v_user_id;

    v_batch_status := CASE
      WHEN v_completed < v_total THEN 'running'
      WHEN v_success = v_total THEN 'success'
      WHEN v_failed = v_total THEN 'failed'
      ELSE 'partial'
    END;

    UPDATE public.meta_sync_batches
    SET total_items = v_total,
        completed_items = v_completed,
        success_items = v_success,
        partial_items = v_partial,
        failed_items = v_failed,
        status = v_batch_status,
        finished_at = CASE WHEN v_batch_status = 'running' THEN NULL ELSE now() END
    WHERE id = v_batch_id
      AND user_id = v_user_id;

    IF v_batch_status = 'running' THEN
      RETURN public.meta_sync_batch_payload(v_batch_id, v_user_id);
    END IF;

    -- Reconciliation may finish a stale batch. In that case start a fresh
    -- batch for the currently requested active accounts below.
    v_batch_id := NULL;
  END IF;

  INSERT INTO public.meta_sync_batches (user_id, requested_period)
  VALUES (v_user_id, p_period)
  RETURNING id INTO v_batch_id;

  INSERT INTO public.meta_sync_batch_items (
    batch_id,
    user_id,
    client_meta_asset_id,
    client_id,
    client_name,
    account_name,
    ad_account_id
  )
  SELECT DISTINCT ON (cma.id)
    v_batch_id,
    v_user_id,
    cma.id,
    cma.client_id,
    ci.display_name,
    ma.asset_name,
    ma.asset_id
  FROM unnest(p_client_meta_asset_ids) requested(client_meta_asset_id)
  JOIN public.client_meta_assets cma
    ON cma.id = requested.client_meta_asset_id
   AND cma.user_id = v_user_id
   AND cma.unlinked_at IS NULL
  JOIN public.client_identity ci
    ON ci.user_id = cma.user_id
   AND ci.client_id = cma.client_id
   AND ci.archived_at IS NULL
  JOIN public.meta_assets ma
    ON ma.id = cma.meta_asset_id
   AND ma.asset_type = 'adaccount'
  JOIN public.meta_integrations mi
    ON mi.id = ma.integration_id
   AND mi.user_id = v_user_id
   AND mi.status = 'active'
  ORDER BY cma.id;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  IF v_inserted_count = 0 THEN
    RAISE EXCEPTION 'No active linked Meta account was authorized for this batch'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.meta_sync_batches
  SET total_items = v_inserted_count
  WHERE id = v_batch_id
    AND user_id = v_user_id;

  RETURN public.meta_sync_batch_payload(v_batch_id, v_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.start_meta_sync_batch(UUID[], TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_meta_sync_batch(UUID[], TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.start_meta_sync_batch(UUID[], TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_meta_sync_batch_item_running(
  p_batch_id UUID,
  p_item_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.meta_sync_batch_items i
  SET status = 'running',
      started_at = COALESCE(i.started_at, now()),
      finished_at = NULL,
      message = NULL,
      error_message = NULL,
      error_code = NULL
  FROM public.meta_sync_batches b
  WHERE i.id = p_item_id
    AND i.batch_id = p_batch_id
    AND i.user_id = v_user_id
    AND b.id = i.batch_id
    AND b.user_id = v_user_id
    AND b.status = 'running'
    AND i.status IN ('pending', 'running');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meta sync batch item is not available to run'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN public.meta_sync_batch_payload(p_batch_id, v_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_meta_sync_batch_item_running(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_meta_sync_batch_item_running(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_meta_sync_batch_item_running(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.finish_meta_sync_batch_item(
  p_batch_id UUID,
  p_item_id UUID,
  p_status TEXT,
  p_run_id UUID DEFAULT NULL,
  p_message TEXT DEFAULT NULL,
  p_error TEXT DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_total INTEGER;
  v_completed INTEGER;
  v_success INTEGER;
  v_partial INTEGER;
  v_failed INTEGER;
  v_batch_status TEXT;
BEGIN
  IF v_user_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('success', 'partial', 'failed', 'already_running') THEN
    RAISE EXCEPTION 'Invalid Meta sync batch item status'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.meta_sync_batch_items i
  SET status = p_status,
      sync_run_id = p_run_id,
      message = p_message,
      error_message = p_error,
      error_code = p_error_code,
      finished_at = now()
  FROM public.meta_sync_batches b
  WHERE i.id = p_item_id
    AND i.batch_id = p_batch_id
    AND i.user_id = v_user_id
    AND b.id = i.batch_id
    AND b.user_id = v_user_id
    AND b.status = 'running'
    AND i.status IN ('pending', 'running');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meta sync batch item is not available to finish'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE status IN ('success', 'partial', 'failed', 'already_running'))::integer,
    count(*) FILTER (WHERE status = 'success')::integer,
    count(*) FILTER (WHERE status IN ('partial', 'already_running'))::integer,
    count(*) FILTER (WHERE status = 'failed')::integer
  INTO v_total, v_completed, v_success, v_partial, v_failed
  FROM public.meta_sync_batch_items
  WHERE batch_id = p_batch_id
    AND user_id = v_user_id;

  v_batch_status := CASE
    WHEN v_completed < v_total THEN 'running'
    WHEN v_success = v_total THEN 'success'
    WHEN v_failed = v_total THEN 'failed'
    ELSE 'partial'
  END;

  UPDATE public.meta_sync_batches
  SET total_items = v_total,
      completed_items = v_completed,
      success_items = v_success,
      partial_items = v_partial,
      failed_items = v_failed,
      status = v_batch_status,
      finished_at = CASE WHEN v_batch_status = 'running' THEN NULL ELSE now() END
  WHERE id = p_batch_id
    AND user_id = v_user_id;

  RETURN public.meta_sync_batch_payload(p_batch_id, v_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.finish_meta_sync_batch_item(UUID, UUID, TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finish_meta_sync_batch_item(UUID, UUID, TEXT, UUID, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.finish_meta_sync_batch_item(UUID, UUID, TEXT, UUID, TEXT, TEXT, TEXT) TO authenticated;

COMMIT;
