import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'supabase/functions/meta-validate-token/index.ts'), 'utf8');

describe('meta-validate-token persisted status contract', () => {
  it('loads the saved connection as the default source without remote validation', () => {
    expect(source).toContain('const { verifyRemote = false }');
    expect(source).toContain("source: 'database'");
    expect(source).toContain('remoteValidated: false');
    expect(source).toContain('loadSavedConnection(userId)');
  });

  it('preserves the saved connection when explicit Facebook validation is unavailable', () => {
    expect(source).toContain('Explicit Meta token validation unavailable');
    expect(source).toContain('A conexão salva foi preservada.');
    expect(source).toContain("status = 'expired'");
    expect(source).toContain("source: 'remote'");
  });

  it('uses direct Postgres for read and update operations to avoid frontend token leakage', () => {
    expect(source).toContain('withDirectPostgres');
    expect(source).not.toContain('access_token_encrypted:');
    expect(source).not.toContain('jsonResponse({ access_token');
  });
});
