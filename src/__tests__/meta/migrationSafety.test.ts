// @ts-nocheck
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260627000003_mixed_attribution_support.sql', import.meta.url),
  'utf8'
);

const operationalReliabilityMigration = readFileSync(
  new URL('../../../supabase/migrations/20260701000022_operational_dashboard_reliability.sql', import.meta.url),
  'utf8'
);

const fullAccountDrilldownDashboardMigration = readFileSync(
  new URL('../../../supabase/migrations/20260701000024_dashboard_accepts_full_account_drilldown_runs.sql', import.meta.url),
  'utf8'
);

const hierarchyReliableActiveStructuresMigration = readFileSync(
  new URL('../../../supabase/migrations/20260701000025_hierarchy_uses_successful_active_structures.sql', import.meta.url),
  'utf8'
);

const analysisProfilesMigration = readFileSync(
  new URL('../../../supabase/migrations/20260702000026_analysis_profiles_weekly_targets.sql', import.meta.url),
  'utf8'
);

const campaignOperationalContractMigration = readFileSync(
  new URL('../../../supabase/migrations/20260713000000_meta_campaign_operational_contract.sql', import.meta.url),
  'utf8'
);

describe('mixed attribution migration safety', () => {
  it('is rerunnable and deduplicates before creating the idempotency index', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS');
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS');
    expect(migration).toContain('row_number() OVER');
    expect(migration.indexOf('ranked_duplicates')).toBeLessThan(migration.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS'));
    expect(migration).toContain('NULLS NOT DISTINCT');
  });

  it('keeps unknown analytics values nullable and constrains finite statuses', () => {
    expect(migration).not.toContain("SET adset_id = 'N/A'");
    expect(migration).not.toContain("SET date_start = '2000-01-01'");
    expect(migration).not.toContain("SET timezone = 'UTC'");
    expect(migration).toContain('meta_normalized_metrics_source_level_check');
    expect(migration).toContain('meta_normalized_metrics_completeness_check');
  });
});

describe('operational dashboard reliability migration safety', () => {
  it('uses direct function definitions instead of editing previous SQL text', () => {
    expect(operationalReliabilityMigration).not.toMatch(/pg_get_functiondef/i);
    expect(operationalReliabilityMigration).not.toMatch(/regexp_replace/i);
    expect(operationalReliabilityMigration).not.toMatch(/\breplace\s*\(/i);
    expect(operationalReliabilityMigration).toContain('CREATE OR REPLACE FUNCTION public.get_analytics_capabilities()');
    expect(operationalReliabilityMigration).toContain('CREATE OR REPLACE FUNCTION public.get_global_performance_dashboard_v2');
  });

  it('starts from full successful account-level campaign syncs before later drill-down support', () => {
    expect(operationalReliabilityMigration).toContain("r.status = 'success'");
    expect(operationalReliabilityMigration).toContain("r.run_scope = 'full_account'");
    expect(operationalReliabilityMigration).toContain("r.requested_level = 'campaign'");
    expect(operationalReliabilityMigration).toContain("r.requested_period = p_period");
    expect(operationalReliabilityMigration).toContain("m.source_level = 'account'");
    expect(operationalReliabilityMigration).toContain("m.source_level = 'campaign'");
  });

  it('keeps complete account syncs visible when deeper drill-down levels were requested', () => {
    expect(fullAccountDrilldownDashboardMigration).toContain("requested_level IN (''campaign'', ''adset'', ''ad'', ''creative'')");
    expect(fullAccountDrilldownDashboardMigration).toContain('source_level');
    expect(fullAccountDrilldownDashboardMigration).toContain('get_global_performance_dashboard_v2');
  });

  it('keeps operational hierarchy from showing partial or inactive child structures as active campaigns', () => {
    expect(hierarchyReliableActiveStructuresMigration).toContain('get_meta_performance_hierarchy');
    expect(hierarchyReliableActiveStructuresMigration).toContain("AND r.status = 'success'");
    expect(hierarchyReliableActiveStructuresMigration).toContain('meta_adset_snapshots active_adset');
    expect(hierarchyReliableActiveStructuresMigration).toContain('NOT EXISTS');
    expect(hierarchyReliableActiveStructuresMigration).not.toMatch(/pg_get_functiondef/i);
    expect(hierarchyReliableActiveStructuresMigration).not.toMatch(/\breplace\s*\(/i);
  });

  it('repairs client_identity from camply_workspace without archiving or deleting clients', () => {
    expect(operationalReliabilityMigration).toContain('INSERT INTO public.client_identity');
    expect(operationalReliabilityMigration).toContain('FROM public.camply_workspace w');
    expect(operationalReliabilityMigration).toContain('ON CONFLICT (user_id, client_id) DO UPDATE');
    expect(operationalReliabilityMigration).not.toMatch(/\bDELETE\s+FROM\s+public\.client_identity/i);
    expect(operationalReliabilityMigration).not.toMatch(/\bUPDATE\s+public\.client_identity\s+SET\s+archived_at/i);
  });

  it('does not aggregate uuid columns with min or max directly', () => {
    expect(operationalReliabilityMigration).not.toMatch(/\bmin\s*\(\s*(ls\.id|a\.client_meta_asset_id)\s*\)/i);
    expect(operationalReliabilityMigration).toContain('min(ls.id::text)');
    expect(operationalReliabilityMigration).toContain('min(a.client_meta_asset_id::text)::uuid');
  });

  it('adds analysis profiles, weekly period and advanced targets additively', () => {
    expect(analysisProfilesMigration).toContain('CREATE TABLE IF NOT EXISTS public.client_analysis_profiles');
    expect(analysisProfilesMigration).toContain('REFERENCES public.client_identity(user_id, client_id)');
    expect(analysisProfilesMigration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(analysisProfilesMigration).toContain('upsert_client_analysis_profile');
    expect(analysisProfilesMigration).toContain('weekly_budget');
    expect(analysisProfilesMigration).toContain('maximum_metric');
    expect(analysisProfilesMigration).toContain('minimum_metric');
    expect(analysisProfilesMigration).toContain('target_range');
    expect(analysisProfilesMigration).toContain("jsonb_build_array('this_month', 'this_week', 'today', 'last_7d', 'last_30d')");
    expect(analysisProfilesMigration).toContain('custom_vertical TEXT');
    expect(analysisProfilesMigration).toContain('minimum_evaluation_spend NUMERIC');
    expect(analysisProfilesMigration).toContain('attribution_delay_hours INTEGER');
    expect(analysisProfilesMigration).toContain('CREATE OR REPLACE FUNCTION public.get_global_performance_dashboard_v2');
    expect(analysisProfilesMigration).toContain('CREATE OR REPLACE FUNCTION public.get_meta_performance_hierarchy');
    expect(analysisProfilesMigration).toContain('CREATE OR REPLACE FUNCTION public.get_client_meta_asset_catalog');
    expect(analysisProfilesMigration).not.toMatch(/pg_get_functiondef/i);
    expect(analysisProfilesMigration).not.toMatch(/regexp_replace/i);
    expect(analysisProfilesMigration).not.toMatch(/v_definition\s*:=\s*replace/i);
  });
});

describe('meta campaign operational contract migration safety', () => {
  it('creates client_meta_campaign_scope with RLS and a validated scope_status', () => {
    expect(campaignOperationalContractMigration).toContain(
      'CREATE TABLE IF NOT EXISTS public.client_meta_campaign_scope'
    );
    expect(campaignOperationalContractMigration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(campaignOperationalContractMigration).toContain(
      "CHECK (scope_status IN ('included', 'excluded', 'archived'))"
    );
    expect(campaignOperationalContractMigration).toContain(
      'REFERENCES public.client_meta_assets(id, user_id)'
    );
    expect(campaignOperationalContractMigration).toContain('set_client_meta_campaign_scope');
  });

  it('replaces the old get_meta_performance_hierarchy overload instead of shadowing it', () => {
    expect(campaignOperationalContractMigration).toContain(
      'DROP FUNCTION IF EXISTS public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER)'
    );
    expect(campaignOperationalContractMigration).toContain("p_scope_filter TEXT DEFAULT 'operational'");
    expect(campaignOperationalContractMigration).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_meta_performance_hierarchy(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT) TO authenticated'
    );
  });

  it('surfaces every non-analyzable verdict in its own named bucket instead of dropping campaigns', () => {
    expect(campaignOperationalContractMigration).toContain('activeNoDeliveryItems');
    expect(campaignOperationalContractMigration).toContain('activeWithoutActiveStructureItems');
    expect(campaignOperationalContractMigration).toContain('pausedWithSpendItems');
    expect(campaignOperationalContractMigration).toContain('unclassifiedDestinationItems');
    expect(campaignOperationalContractMigration).toContain("'NOT_OPERATIONAL'");
    expect(campaignOperationalContractMigration).toContain("'ANALYZABLE'");
  });

  it('is written as direct function definitions, not string-surgery on prior bodies', () => {
    expect(campaignOperationalContractMigration).not.toMatch(/pg_get_functiondef/i);
    expect(campaignOperationalContractMigration).not.toMatch(/regexp_replace/i);
    expect(campaignOperationalContractMigration).not.toMatch(/\breplace\s*\(/i);
  });
});
