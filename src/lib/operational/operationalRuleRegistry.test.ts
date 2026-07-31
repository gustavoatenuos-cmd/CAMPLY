import { describe, it, expect } from 'vitest';
import { resolveRuleConfiguration } from './operationalRuleRegistry';

describe('resolveRuleConfiguration', () => {
  it('returns invalid_fallback for unknown rules', () => {
    const res = resolveRuleConfiguration('unknown_rule');
    expect(res.configurationSource).toBe('invalid_fallback');
  });

  it('returns system_default for non-configurable rules even with persisted data', () => {
    const res = resolveRuleConfiguration('project_due_soon', [{ conditionType: 'project_due_soon', isActive: false, severity: 'critical', thresholdValue: 1 } as any]);
    expect(res.configurationSource).toBe('system_default');
    expect(res.enabled).toBe(true);
  });

  it('returns system_default when configurable rule has no persisted config', () => {
    const res = resolveRuleConfiguration('campaign_budget_warning', []);
    expect(res.configurationSource).toBe('system_default');
    expect(res.thresholdValue).toBe(70);
  });

  it('returns user config when valid', () => {
    const res = resolveRuleConfiguration('campaign_budget_warning', [{ conditionType: 'campaign_budget_warning', isActive: true, severity: 'warning', thresholdValue: 75 } as any]);
    expect(res.configurationSource).toBe('user');
    expect(res.thresholdValue).toBe(75);
  });

  it('returns user config disabled', () => {
    const res = resolveRuleConfiguration('campaign_budget_warning', [{ conditionType: 'campaign_budget_warning', isActive: false } as any]);
    expect(res.configurationSource).toBe('user');
    expect(res.enabled).toBe(false);
  });

  it('rejects negative thresholds', () => {
    const res = resolveRuleConfiguration('campaign_budget_warning', [{ conditionType: 'campaign_budget_warning', isActive: true, thresholdValue: -5 } as any]);
    expect(res.configurationSource).toBe('invalid_fallback');
    expect(res.thresholdValue).toBe(70);
  });

  it('rejects thresholds below min', () => {
    const res = resolveRuleConfiguration('campaign_budget_warning', [{ conditionType: 'campaign_budget_warning', isActive: true, thresholdValue: 10 } as any]);
    expect(res.configurationSource).toBe('invalid_fallback');
    expect(res.thresholdValue).toBe(70);
  });

  it('rejects thresholds above max', () => {
    const res = resolveRuleConfiguration('campaign_budget_critical', [{ conditionType: 'campaign_budget_critical', isActive: true, thresholdValue: 300 } as any]);
    expect(res.configurationSource).toBe('invalid_fallback');
    expect(res.thresholdValue).toBe(90);
  });

  it('accepts threshold exactly at min', () => {
    const res = resolveRuleConfiguration('campaign_budget_warning', [{ conditionType: 'campaign_budget_warning', isActive: true, thresholdValue: 50 } as any]);
    expect(res.configurationSource).toBe('user');
    expect(res.thresholdValue).toBe(50);
  });

  it('accepts threshold exactly at max', () => {
    const res = resolveRuleConfiguration('campaign_budget_warning', [{ conditionType: 'campaign_budget_warning', isActive: true, thresholdValue: 89.99 } as any]);
    expect(res.configurationSource).toBe('user');
    expect(res.thresholdValue).toBe(89.99);
  });

  it('rejects NaN thresholds', () => {
    const res = resolveRuleConfiguration('campaign_budget_warning', [{ conditionType: 'campaign_budget_warning', isActive: true, thresholdValue: NaN } as any]);
    expect(res.configurationSource).toBe('invalid_fallback');
  });

  it('rejects invalid severities', () => {
    const res = resolveRuleConfiguration('campaign_budget_warning', [{ conditionType: 'campaign_budget_warning', isActive: true, severity: 'fatal' as any } as any]);
    expect(res.configurationSource).toBe('invalid_fallback');
  });
});
