// @ts-nocheck
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../../supabase/functions/meta-validate-token/index.ts', import.meta.url), 'utf8');

describe('meta-validate-token persisted status', () => {
  it('uses the saved database connection without remote validation on page load', () => {
    expect(source).toContain('const { verifyRemote = false }');
    expect(source).toContain("status: 'active'");
    expect(source).toContain("source: 'database'");
    expect(source).toContain('remoteValidated: false');
  });

  it('preserves persisted state when explicit remote validation is unavailable', () => {
    expect(source).toContain('loadSavedConnection');
    expect(source).toContain('A conexão salva foi preservada');
    expect(source).not.toContain("status: 'disconnected'");
  });
});
