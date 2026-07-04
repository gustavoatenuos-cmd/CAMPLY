// @ts-nocheck
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../../supabase/functions/cost-alert-engine/index.ts', import.meta.url), 'utf8');

describe('cost alert engine persisted contract', () => {
  it('accepts only client identity and period, then reads qualified server data', () => {
    expect(source).toContain("body.client_id");
    expect(source).toContain("get_client_intelligence_dashboard_v1");
    expect(source).not.toContain('body.campaigns');
    expect(source).not.toContain('campaign.spent');
  });

  it('keeps evaluated and still-active keys separate before resolving', () => {
    expect(source).toContain('evaluatedRuleKeys');
    expect(source).toContain('evaluatedActiveKeys');
    expect(source).toContain('evaluatedRuleKeys.has(item.rule_key) && !evaluatedActiveKeys.has(item.rule_key)');
  });

  it('returns non-2xx on read, insert, update and readback failures', () => {
    expect(source).toContain('Alert insert failed');
    expect(source).toContain('Alert update failed');
    expect(source).toContain('Alert readback failed');
    expect(source).toContain('}, 500)');
  });
});
