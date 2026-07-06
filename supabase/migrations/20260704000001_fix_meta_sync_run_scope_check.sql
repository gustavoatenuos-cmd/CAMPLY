BEGIN;

ALTER TABLE public.meta_sync_runs
DROP CONSTRAINT IF EXISTS run_scope_check;

ALTER TABLE public.meta_sync_runs
ADD CONSTRAINT run_scope_check
CHECK (
  run_scope IN (
    'full_account',
    'selected_campaigns',
    'selected_adsets',
    'selected_ads',
    'selected_creatives',
    'selected_entities'
  )
);

COMMIT;
