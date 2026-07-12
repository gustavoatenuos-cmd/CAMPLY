-- Adds 'rate_limit_exhausted' as a valid completeness_status /
-- termination_reason value.
--
-- Before this migration, meta-sync-performance collapsed a Meta rate limit
-- (code 4/17/32/613/8000x) that survived all retries into the same generic
-- 'api_error' / 'partial_collection' as any other failure — indistinguishable
-- from a broken auth token, a malformed request, or a genuine Meta outage.
-- The frontend TraceableMetric type (src/lib/performance/traceableMetrics.ts)
-- already declared 'rate_limit_exhausted' as a valid completeness value; the
-- backend never emitted it. This migration lets the backend keep that
-- promise so operators can tell "Meta throttled us" apart from "something
-- else is broken" without reading Edge Function logs.

ALTER TABLE public.meta_normalized_metrics
  DROP CONSTRAINT IF EXISTS meta_normalized_metrics_completeness_check;
ALTER TABLE public.meta_normalized_metrics
  ADD CONSTRAINT meta_normalized_metrics_completeness_check
  CHECK (
    completeness_status IS NULL OR completeness_status IN (
      'zero_delivery',
      'missing_insight_row',
      'partial_page',
      'timeout',
      'api_error',
      'rate_limit_exhausted',
      'validation_error',
      'complete'
    )
  );

ALTER TABLE public.meta_sync_runs
  DROP CONSTRAINT IF EXISTS meta_sync_runs_termination_reason_check;
ALTER TABLE public.meta_sync_runs
  ADD CONSTRAINT meta_sync_runs_termination_reason_check
  CHECK (
    termination_reason IS NULL
    OR termination_reason IN (
      'completed',
      'partial_collection',
      'rate_limit_exhausted',
      'validation_error',
      'meta_api_error',
      'persistence_error',
      'unexpected_error'
    )
  );
