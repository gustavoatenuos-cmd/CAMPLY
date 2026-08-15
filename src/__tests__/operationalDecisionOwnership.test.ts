import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../hooks/useCamplyWorkspace.ts', import.meta.url), 'utf8');
const alerts = readFileSync(new URL('../components/AlertCenterView.tsx', import.meta.url), 'utf8');
const intelligence = readFileSync(new URL('../components/IntelligenceView.tsx', import.meta.url), 'utf8');
const evaluator = readFileSync(new URL('../lib/operational/evaluateOperationalSignals.ts', import.meta.url), 'utf8');

describe('operational decision ownership', () => {
  it('uses one evaluator for workspace operational signals', () => {
    expect(workspace).toContain('evaluateOperationalSignals');
    expect(workspace).toContain('syncOperationalSignals');
    expect(workspace).not.toContain('runAgentEngine');
    expect(app).not.toContain('buildInsights');
    expect(alerts).not.toContain('deriveCostAlerts');
    expect(intelligence).not.toContain('Insights Gerais (Legado)');
  });

  it('keeps Meta performance decisions outside the workspace evaluator', () => {
    expect(evaluator).toContain('Media performance is intentionally excluded');
    expect(evaluator).not.toContain('campaign.spent / campaign.budget');
    expect(evaluator).not.toContain('client?.benchmarks?.cpr');
    expect(evaluator).not.toContain('purchase_roas');
    expect(evaluator).not.toContain('cost_per_purchase');
  });
});
