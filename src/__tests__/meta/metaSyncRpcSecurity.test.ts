import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260814221934_consolidate_meta_sync_rpc_security.sql', import.meta.url),
  'utf8'
);

describe('Meta sync RPC security contract', () => {
  it('executes with caller privileges and removes deprecated role inspection', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.resolve_meta_sync_client_asset');
    expect(migration).toContain("SECURITY INVOKER\nSET search_path = ''");
    expect(migration).not.toContain('SECURITY DEFINER');
    expect(migration).not.toContain('auth.role()');
    expect(migration).not.toContain('auth.jwt()');
  });

  it('uses a deny-by-default function privilege baseline', () => {
    const signature = 'public.resolve_meta_sync_client_asset(UUID, UUID)';
    expect(migration).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`);
    expect(migration).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM anon`);
    expect(migration).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM authenticated`);
    expect(migration).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM service_role`);
    expect(migration).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role`);
    expect(migration).not.toMatch(/GRANT EXECUTE[^;]+ TO (?:PUBLIC|anon|authenticated)/i);
  });

  it('keeps ownership and active-client validation inside the resolver', () => {
    expect(migration).toContain('JOIN public.client_identity ci');
    expect(migration).toContain('ci.archived_at IS NULL');
    expect(migration).toContain('cma.user_id = p_user_id');
    expect(migration).toContain('cma.unlinked_at IS NULL');
  });

  it('grants only the table reads required by the service role resolver', () => {
    for (const table of ['client_meta_assets', 'client_identity', 'meta_assets', 'meta_integrations']) {
      expect(migration).toContain(`GRANT SELECT ON TABLE public.${table} TO service_role`);
    }
    expect(migration).not.toMatch(/GRANT (?:INSERT|UPDATE|DELETE|ALL)[^;]+ TO service_role/i);
  });
});
