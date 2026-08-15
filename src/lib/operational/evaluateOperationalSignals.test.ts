import { describe, expect, it } from 'vitest';
import { initialData } from '../../data/camplyStore';
import type { CamplyData } from '../../types';
import { evaluateOperationalSignals } from './evaluateOperationalSignals';

const NOW = new Date('2026-08-15T12:00:00-03:00');

function workspace(overrides: Partial<CamplyData>): CamplyData {
  return { ...initialData, ...overrides } as CamplyData;
}

describe('evaluateOperationalSignals', () => {
  it('detects overdue workspace obligations deterministically', () => {
    const data = workspace({
      tasks: [{
        id: 'task-1',
        title: 'Entregar landing page',
        dueDate: '2026-08-12',
        area: 'site',
        taskType: 'outro',
        clientId: 'client-1',
        done: false,
      }],
    });

    const signals = evaluateOperationalSignals(data, NOW);

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      id: 'signal:client-1:task_overdue:task-1',
      severity: 'critical',
      status: 'active',
      relatedEntityType: 'task',
    });
  });

  it('keeps campaign maintenance cadence as an operational signal', () => {
    const data = workspace({
      campaigns: [{
        id: 'campaign-1',
        clientId: 'client-1',
        name: 'WhatsApp Agosto',
        platform: 'Meta Ads',
        status: 'live',
        objective: 'Engajamento',
        budget: 1000,
        spent: 990,
        cpr: 999,
        lastOptimizedAt: '2026-08-10T12:00:00-03:00',
        nextAction: 'Revisar criativos',
        priority: 'high',
      }],
    });

    const signals = evaluateOperationalSignals(data, NOW);

    expect(signals.map((signal) => signal.id)).toContain(
      'signal:client-1:campaign_optimization_idle:campaign-1'
    );
  });

  it('never turns manual spend, budget or CPR into media-performance signals', () => {
    const data = workspace({
      clients: [{
        id: 'client-1',
        projectId: '',
        name: 'Cliente',
        company: 'Cliente',
        segment: 'Serviços',
        structure: '',
        hasProject: false,
        contact: '',
        monthlyFee: 0,
        managementFeeType: 'recurring',
        dueDay: 10,
        adInvestmentPeriod: 'monthly',
        adInvestmentMeta: 1000,
        adInvestmentGoogle: 0,
        adInvestmentYoutube: 0,
        adInvestmentTikTok: 0,
        status: 'active',
        benchmarks: { cpr: 20 },
      }],
      campaigns: [{
        id: 'campaign-1',
        clientId: 'client-1',
        name: 'Campanha',
        platform: 'Meta Ads',
        status: 'live',
        objective: 'Engajamento',
        budget: 1000,
        spent: 999,
        cpr: 500,
        lastOptimizedAt: '2026-08-15T10:00:00-03:00',
        nextAction: '',
        priority: 'high',
      }],
    });

    const signals = evaluateOperationalSignals(data, NOW);
    const serialized = JSON.stringify(signals).toLowerCase();

    expect(signals).toHaveLength(0);
    expect(serialized).not.toContain('budget');
    expect(serialized).not.toContain('cpr');
    expect(serialized).not.toContain('roas');
    expect(serialized).not.toContain('cpa');
  });

  it('respects configured idle-day thresholds', () => {
    const data = workspace({
      agentRules: [{
        id: 'rule-1',
        name: 'Campanha parada',
        description: '',
        entityType: 'campaign',
        conditionType: 'idle_days',
        thresholdValue: 10,
        thresholdUnit: 'days',
        severity: 'critical',
        enabled: true,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      }],
      campaigns: [{
        id: 'campaign-1',
        clientId: 'client-1',
        name: 'Campanha',
        platform: 'Meta Ads',
        status: 'live',
        objective: 'Engajamento',
        budget: 0,
        spent: 0,
        lastOptimizedAt: '2026-08-10T12:00:00-03:00',
        nextAction: '',
        priority: 'medium',
      }],
    });

    expect(evaluateOperationalSignals(data, NOW)).toHaveLength(0);
  });
});
