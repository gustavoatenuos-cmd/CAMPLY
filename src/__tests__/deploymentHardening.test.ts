import { describe, expect, it } from 'vitest';
import vercelConfig from '../../vercel.json';
import { readFileSync } from 'node:fs';

describe('deployment hardening', () => {
  it('ships the minimum browser security headers', () => {
    const headers = new Map(vercelConfig.headers[0].headers.map((header) => [header.key, header.value]));
    expect(headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(headers.get('Content-Security-Policy')).toContain('https://*.supabase.co');
    expect(headers.get('Permissions-Policy')).toContain('camera=()');
    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('declares JWT verification for every authenticated Edge Function added in the 2.0 foundation', () => {
    const config = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
    for (const functionName of ['meta-client-assets', 'meta-hierarchy', 'cost-alert-engine']) {
      expect(config).toContain(`[functions.${functionName}]\nverify_jwt = true`);
    }
  });
});
