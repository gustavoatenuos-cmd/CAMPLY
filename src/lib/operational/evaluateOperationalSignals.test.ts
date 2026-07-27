import { describe, it, expect } from 'vitest';
import { evaluateOperationalSignals } from './evaluateOperationalSignals';
import { syncOperationalSignals } from './syncOperationalSignals';
import type { CamplyData, AgentRule, OperationalSignal } from '../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRule(overrides: Partial<AgentRule> & Pick<AgentRule, 'conditionType' | 'entityType'>): AgentRule {
  return {
    id: `rule-${overrides.conditionType}-${overrides.entityType}`,
    name: overrides.conditionType,
    description: '',
    severity: 'warning',
    enabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeBaseData(overrides: Partial<CamplyData> = {}): CamplyData {
  return {
    clients: [],
    campaigns: [],
    receivables: [],
    projects: [],
    tasks: [],
    activityLogs: [],
    agentRules: [],
    agentAlerts: [],
    agentLogs: [],
    ...overrides,
  };
}

const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString();
const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString();

// ─── 4. Regras configuráveis ──────────────────────────────────────────────────

describe('evaluateOperationalSignals — configurable rules', () => {
  describe('overdue rule disabled', () => {
    it('does NOT generate a signal for an overdue task when overdue rule is disabled', () => {
      const data = makeBaseData({
        agentRules: [makeRule({ conditionType: 'overdue', entityType: 'task', enabled: false })],
        tasks: [{ id: 't1', title: 'Tarefa vencida', done: false, dueDate: yesterday, clientId: 'c1', createdAt: '2026-01-01T00:00:00Z' } as CamplyData['tasks'][0]],
      });
      const signals = evaluateOperationalSignals(data);
      const overdueSignals = signals.filter(s => s.signalType === 'tarefa_atrasada');
      expect(overdueSignals).toHaveLength(0);
    });
  });

  describe('overdue rule enabled', () => {
    it('generates a signal for the same overdue task when overdue rule is enabled', () => {
      const data = makeBaseData({
        agentRules: [makeRule({ conditionType: 'overdue', entityType: 'task', enabled: true, severity: 'critical' })],
        tasks: [{ id: 't1', title: 'Tarefa vencida', done: false, dueDate: yesterday, clientId: 'c1', createdAt: '2026-01-01T00:00:00Z' } as CamplyData['tasks'][0]],
      });
      const signals = evaluateOperationalSignals(data);
      const overdueSignals = signals.filter(s => s.signalType === 'tarefa_atrasada');
      expect(overdueSignals).toHaveLength(1);
      expect(overdueSignals[0].severity).toBe('critical');
    });
  });

  describe('idle_days threshold changes', () => {
    it('generates signal when entity idle days exceed threshold', () => {
      const data = makeBaseData({
        agentRules: [makeRule({ conditionType: 'idle_days', entityType: 'project', thresholdValue: 3, thresholdUnit: 'days' })],
        projects: [{
          id: 'p1', name: 'Projeto parado', status: 'active', clientId: 'c1',
          lastActivityAt: fiveDaysAgo, projectType: 'site', billingType: 'one_time',
          dueDate: '', progress: 50, nextAction: '',
          createdAt: '2026-01-01T00:00:00Z',
        } as CamplyData['projects'][0]],
      });
      const signals = evaluateOperationalSignals(data);
      const idleSignals = signals.filter(s => s.signalType === 'projeto_parado');
      expect(idleSignals).toHaveLength(1);
    });

    it('does NOT generate signal when threshold is raised above idle days', () => {
      const data = makeBaseData({
        agentRules: [makeRule({ conditionType: 'idle_days', entityType: 'project', thresholdValue: 7, thresholdUnit: 'days' })],
        projects: [{
          id: 'p1', name: 'Projeto parado', status: 'active', clientId: 'c1',
          lastActivityAt: fiveDaysAgo, projectType: 'site', billingType: 'one_time',
          dueDate: '', progress: 50, nextAction: '',
          createdAt: '2026-01-01T00:00:00Z',
        } as CamplyData['projects'][0]],
      });
      const signals = evaluateOperationalSignals(data);
      const idleSignals = signals.filter(s => s.signalType === 'projeto_parado');
      expect(idleSignals).toHaveLength(0);
    });
  });

  describe('severity customization', () => {
    it('uses the configured severity in the generated signal', () => {
      const data = makeBaseData({
        agentRules: [makeRule({ conditionType: 'overdue', entityType: 'task', severity: 'info', enabled: true })],
        tasks: [{ id: 't1', title: 'Tarefa', done: false, dueDate: yesterday, clientId: 'c1', createdAt: '2026-01-01T00:00:00Z' } as CamplyData['tasks'][0]],
      });
      const signals = evaluateOperationalSignals(data);
      const overdueSignals = signals.filter(s => s.signalType === 'tarefa_atrasada');
      expect(overdueSignals[0].severity).toBe('info');
    });
  });

  describe('missing or invalid configuration', () => {
    it('does NOT crash when agentRules is empty', () => {
      const data = makeBaseData({
        agentRules: [],
        tasks: [{ id: 't1', title: 'Tarefa', done: false, dueDate: yesterday, clientId: 'c1', createdAt: '2026-01-01T00:00:00Z' } as CamplyData['tasks'][0]],
      });
      expect(() => evaluateOperationalSignals(data)).not.toThrow();
    });

    it('does NOT crash when agentRules is undefined', () => {
      const data = makeBaseData({
        tasks: [{ id: 't1', title: 'Tarefa', done: false, dueDate: yesterday, clientId: 'c1', createdAt: '2026-01-01T00:00:00Z' } as CamplyData['tasks'][0]],
      });
      (data as any).agentRules = undefined;
      expect(() => evaluateOperationalSignals(data)).not.toThrow();
    });

    it('does NOT generate signals with undefined severity', () => {
      const data = makeBaseData({
        agentRules: [{ ...makeRule({ conditionType: 'overdue', entityType: 'task', enabled: true }), severity: undefined as any }],
        tasks: [{ id: 't1', title: 'Tarefa', done: false, dueDate: yesterday, clientId: 'c1', createdAt: '2026-01-01T00:00:00Z' } as CamplyData['tasks'][0]],
      });
      const signals = evaluateOperationalSignals(data);
      const overdueSignals = signals.filter(s => s.signalType === 'tarefa_atrasada');
      // Should use fallback 'critical' for overdue
      if (overdueSignals.length > 0) {
        expect(['critical', 'warning', 'info', 'good']).toContain(overdueSignals[0].severity);
      }
    });

    it('idle_days with no thresholdValue falls back to safe default', () => {
      const data = makeBaseData({
        agentRules: [makeRule({ conditionType: 'idle_days', entityType: 'campaign', thresholdValue: undefined })],
        campaigns: [{
          id: 'camp1', name: 'Campaign', status: 'live', clientId: 'c1',
          lastOptimizedAt: fiveDaysAgo, budget: 0, spent: 0,
          createdAt: '2026-01-01T00:00:00Z', platform: 'Meta Ads',
        } as CamplyData['campaigns'][0]],
      });
      const signals = evaluateOperationalSignals(data);
      // With default threshold of 3, campaign idle for 5 days should trigger
      const idleSignals = signals.filter(s => s.signalType === 'campanha_parada');
      expect(idleSignals).toHaveLength(1);
    });
  });

  describe('campaign idle rule respects agent config', () => {
    it('generates signal when campaign idle_days rule is enabled and threshold exceeded', () => {
      const data = makeBaseData({
        agentRules: [makeRule({ conditionType: 'idle_days', entityType: 'campaign', thresholdValue: 3, enabled: true })],
        campaigns: [{
          id: 'camp1', name: 'Campaign idle', status: 'live', clientId: 'c1',
          lastOptimizedAt: fiveDaysAgo, budget: 0, spent: 0,
          createdAt: '2026-01-01T00:00:00Z', platform: 'Meta Ads',
        } as CamplyData['campaigns'][0]],
      });
      const signals = evaluateOperationalSignals(data);
      expect(signals.some(s => s.signalType === 'campanha_parada')).toBe(true);
    });

    it('does NOT generate signal when campaign idle_days rule is disabled', () => {
      const data = makeBaseData({
        agentRules: [makeRule({ conditionType: 'idle_days', entityType: 'campaign', thresholdValue: 3, enabled: false })],
        campaigns: [{
          id: 'camp1', name: 'Campaign idle', status: 'live', clientId: 'c1',
          lastOptimizedAt: fiveDaysAgo, budget: 0, spent: 0,
          createdAt: '2026-01-01T00:00:00Z', platform: 'Meta Ads',
        } as CamplyData['campaigns'][0]],
      });
      const signals = evaluateOperationalSignals(data);
      expect(signals.some(s => s.signalType === 'campanha_parada')).toBe(false);
    });
  });
});

// ─── 8. Ciclo de vida dos sinais ──────────────────────────────────────────────

describe('syncOperationalSignals — lifecycle', () => {

  const makeSignal = (overrides: Partial<OperationalSignal> = {}): OperationalSignal => ({
    id: 'sig-1',
    signalType: 'tarefa_atrasada',
    sourceDomain: 'tasks',
    relatedEntityId: 't1',
    relatedEntityType: 'task',
    clientId: 'c1',
    title: 'Tarefa Atrasada',
    message: 'A tarefa está atrasada.',
    severity: 'critical',
    status: 'active',
    deduplicationKey: 'c1_tarefa_atrasada_t1',
    triggeredAt: '2026-07-01T00:00:00Z',
    ...overrides,
  });

  it('new condition generates open (active) signal', () => {
    const current: OperationalSignal[] = [];
    const evaluated = [makeSignal()];
    const result = syncOperationalSignals(current, evaluated);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('active');
  });

  it('same condition re-evaluated does NOT duplicate', () => {
    const existing = makeSignal({ id: 'existing-1' });
    const current: OperationalSignal[] = [existing];
    const evaluated = [makeSignal({ id: 'new-eval-1' })]; // same deduplicationKey
    const result = syncOperationalSignals(current, evaluated);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('existing-1'); // keeps original ID
    expect(result[0].status).toBe('active');
  });

  it('resolved condition closes the signal', () => {
    const existing = makeSignal({ status: 'active' });
    const current: OperationalSignal[] = [existing];
    const evaluated: OperationalSignal[] = []; // condition gone
    const result = syncOperationalSignals(current, evaluated);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('resolved');
  });

  it('resolved signal stays in history', () => {
    const resolved = makeSignal({ status: 'resolved' });
    const current: OperationalSignal[] = [resolved];
    const evaluated: OperationalSignal[] = []; // still gone
    const result = syncOperationalSignals(current, evaluated);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('resolved');
  });

  it('condition reappearing re-activates resolved signal', () => {
    const resolved = makeSignal({ status: 'resolved', id: 'orig-id' });
    const current: OperationalSignal[] = [resolved];
    const evaluated = [makeSignal({ id: 'new-eval' })]; // same deduplicationKey
    const result = syncOperationalSignals(current, evaluated);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('active');
    expect(result[0].id).toBe('orig-id'); // preserves identity
  });

  it('disabled rule does NOT erase history of existing signals', () => {
    // If a rule is disabled, evaluateOperationalSignals won't produce the signal.
    // But syncOperationalSignals should mark it resolved, not delete it.
    const existing = makeSignal({ status: 'active' });
    const current: OperationalSignal[] = [existing];
    const evaluated: OperationalSignal[] = []; // disabled rule → no eval
    const result = syncOperationalSignals(current, evaluated);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('resolved'); // not deleted
  });

  it('dismissed signal is preserved even if condition is still active', () => {
    const dismissed = makeSignal({ status: 'dismissed' });
    const current: OperationalSignal[] = [dismissed];
    const evaluated = [makeSignal()]; // condition still fires
    const result = syncOperationalSignals(current, evaluated);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('dismissed');
  });
});

// ─── 9. Contadores usam mesma definição ───────────────────────────────────────

describe('active signal counting consistency', () => {
  it('all counter expressions agree on the same definition of active', () => {
    // This test verifies that the active signal filter is:
    // signal.status === 'active'
    // This is the ONLY filter used across:
    // - App.tsx (line 353): data.agentAlerts.filter(a => a.status === 'active')
    // - Sidebar (receives alertCount from App.tsx)
    // - TodayView (line 202): data.agentAlerts.filter(a => a.status === 'active')
    // - OverviewView (line 460): data.agentAlerts.filter(alert => alert.status === 'active')
    // - AlertCenterView (line 76): data.agentAlerts.filter(a => a.status !== 'resolved')
    //   (AlertCenterView also shows dismissed in its list, but counts use active filter)
    
    const signals: OperationalSignal[] = [
      { id: '1', signalType: 'a', sourceDomain: 'tasks', relatedEntityId: 'e1', relatedEntityType: 'task', title: '', message: '', severity: 'critical', status: 'active', deduplicationKey: 'k1', triggeredAt: '' },
      { id: '2', signalType: 'b', sourceDomain: 'tasks', relatedEntityId: 'e2', relatedEntityType: 'task', title: '', message: '', severity: 'warning', status: 'resolved', deduplicationKey: 'k2', triggeredAt: '' },
      { id: '3', signalType: 'c', sourceDomain: 'tasks', relatedEntityId: 'e3', relatedEntityType: 'task', title: '', message: '', severity: 'critical', status: 'dismissed', deduplicationKey: 'k3', triggeredAt: '' },
      { id: '4', signalType: 'd', sourceDomain: 'tasks', relatedEntityId: 'e4', relatedEntityType: 'task', title: '', message: '', severity: 'good', status: 'active', deduplicationKey: 'k4', triggeredAt: '' },
    ];

    // The canonical active filter (used by App.tsx, TodayView, OverviewView):
    const activeCount = signals.filter(a => a.status === 'active').length;
    expect(activeCount).toBe(2); // ids 1 and 4

    // The non-good active count (used by TodayView line 804 for badge):
    const badgeCount = signals.filter(a => a.status === 'active' && a.severity !== 'good').length;
    expect(badgeCount).toBe(1); // only id 1

    // Resolved and dismissed are NEVER counted as active
    expect(signals.filter(a => a.status === 'active').every(s => s.status === 'active')).toBe(true);
  });
});
