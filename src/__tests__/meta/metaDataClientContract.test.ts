import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const creativeLab = readFileSync(
  new URL('../../lib/meta/creativeLabService.ts', import.meta.url),
  'utf8'
);
const freshness = readFileSync(
  new URL('../../lib/meta/metaFreshnessService.ts', import.meta.url),
  'utf8'
);

describe('Meta data client contract', () => {
  it('routes Creative Lab database RPCs through supabaseData', () => {
    expect(creativeLab).toContain("import { supabaseData } from '../supabase'");
    expect(creativeLab).not.toContain("import { supabase } from '../supabase'");
    expect(creativeLab).not.toContain('supabase.rpc(');
  });

  it('routes freshness database RPCs through supabaseData', () => {
    expect(freshness).toContain("import { supabaseData } from '../supabase'");
    expect(freshness).not.toContain("import { supabase } from '../supabase'");
    expect(freshness).not.toContain('supabase.rpc(');
  });
});
