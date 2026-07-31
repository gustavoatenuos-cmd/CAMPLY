import fs from 'fs';

// 1. signalFilters.test.ts
const filterTest = `import { describe, it, expect } from 'vitest';
import { isActionableSignal, selectActiveActionableSignals, countActiveActionableSignals } from './signalFilters';
import { OperationalSignal } from '../../types';

describe('signalFilters', () => {
  const s1 = { status: 'active', severity: 'critical', signalType: 'budget' } as OperationalSignal;
  const s2 = { status: 'active', severity: 'warning', signalType: 'budget' } as OperationalSignal;
  const s3 = { status: 'active', severity: 'good', signalType: 'budget' } as OperationalSignal;
  const s4 = { status: 'resolved', severity: 'critical', signalType: 'budget' } as OperationalSignal;
  const s5 = { status: 'dismissed', severity: 'critical', signalType: 'budget' } as OperationalSignal;
  const s6 = { status: 'active', severity: 'info', signalType: 'all_clear' } as OperationalSignal;

  it('identifies actionable signals correctly', () => {
    expect(isActionableSignal(s1)).toBe(true);
    expect(isActionableSignal(s2)).toBe(true);
    expect(isActionableSignal(s3)).toBe(false); // good
    expect(isActionableSignal(s4)).toBe(false); // resolved
    expect(isActionableSignal(s5)).toBe(false); // dismissed
    expect(isActionableSignal(s6)).toBe(false); // all_clear
  });

  it('selects and counts actionable signals', () => {
    const list = [s1, s2, s3, s4, s5, s6];
    const filtered = selectActiveActionableSignals(list);
    expect(filtered.length).toBe(2);
    expect(countActiveActionableSignals(list)).toBe(2);
    expect(countActiveActionableSignals(undefined)).toBe(0);
  });
});
`;
fs.writeFileSync('src/lib/operational/signalFilters.test.ts', filterTest);

// 2. ClientCampaignDrawer.tsx update coverage warning
let drawerStr = fs.readFileSync('src/components/analytics/ClientCampaignDrawer.tsx', 'utf-8');
drawerStr = drawerStr.replace(
  /<div className="rounded-md bg-amber-50 p-4 mb-6">[\s\S]*?<\/div>/,
  `<div className="rounded-md bg-amber-50 p-4 mb-6">
      <div className="flex">
        <div className="flex-shrink-0">
          <AlertTriangle className="h-5 w-5 text-amber-400" />
        </div>
        <div className="ml-3">
          <h3 className="text-sm font-medium text-amber-800">Cobertura Parcial</h3>
          <div className="mt-2 text-sm text-amber-700">
            <p>As campanhas podem ser consultadas, mas as métricas não cobrem todo o período selecionado.</p>
            <ul className="list-disc pl-5 mt-2 space-y-1 text-xs">
              <li><strong>Período solicitado:</strong> {period.start} a {period.end}</li>
              <li><strong>Período coberto:</strong> {diagnostics.periodCovered?.start || 'N/A'} a {diagnostics.periodCovered?.end || 'N/A'}</li>
              <li><strong>Última sincronização bem-sucedida:</strong> {diagnostics.lastSync ? new Date(diagnostics.lastSync).toLocaleString() : 'N/A'}</li>
              <li><strong>Qualidade:</strong> {diagnostics.qualityStatus}</li>
              <li><strong>Motivo da limitação:</strong> {diagnostics.reason || 'Desconhecido'}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>`
);
fs.writeFileSync('src/components/analytics/ClientCampaignDrawer.tsx', drawerStr);

// 3. Update syncOperationalSignals.test.ts
const syncTestStr = `import { describe, it, expect } from 'vitest';
import { syncOperationalSignals } from './syncOperationalSignals';
import { OperationalSignal } from '../../types';

describe('syncOperationalSignals', () => {
  const now = '2026-07-29T20:00:00.000Z';

  it('handles new signal correctly', () => {
    const evaluated = [{ deduplicationKey: 'k1', id: '1' } as OperationalSignal];
    const { signals, transitions } = syncOperationalSignals([], evaluated, { now });
    expect(signals[0].status).toBe('active');
    expect(signals[0].triggeredAt).toBe(now);
    expect(signals[0].lastDetectedAt).toBe(now);
    expect(signals[0].occurrenceCount).toBe(1);
    expect(signals[0].resolvedAt).toBeUndefined();
    expect(signals[0].dismissedAt).toBeUndefined();
  });

  it('handles existing active signal', () => {
    const current = [{ deduplicationKey: 'k1', id: '1', status: 'active', triggeredAt: 'old', lastDetectedAt: 'old', occurrenceCount: 1 } as OperationalSignal];
    const evaluated = [{ deduplicationKey: 'k1', id: '1' } as OperationalSignal];
    const { signals } = syncOperationalSignals(current, evaluated, { now });
    expect(signals[0].status).toBe('active');
    expect(signals[0].triggeredAt).toBe('old');
    expect(signals[0].lastDetectedAt).toBe(now);
    expect(signals[0].occurrenceCount).toBe(1);
  });

  it('resolves absent signals', () => {
    const current = [{ deduplicationKey: 'k1', id: '1', status: 'active', triggeredAt: 'old', occurrenceCount: 1 } as OperationalSignal];
    const { signals, transitions } = syncOperationalSignals(current, [], { now });
    expect(signals[0].status).toBe('resolved');
    expect(signals[0].resolvedAt).toBe(now);
    expect(transitions[0].newStatus).toBe('resolved');
  });

  it('reactivates resolved signals', () => {
    const current = [{ deduplicationKey: 'k1', id: '1', status: 'resolved', resolvedAt: 'old_res', triggeredAt: 'old', occurrenceCount: 1 } as OperationalSignal];
    const evaluated = [{ deduplicationKey: 'k1', id: '1' } as OperationalSignal];
    const { signals, transitions } = syncOperationalSignals(current, evaluated, { now });
    expect(signals[0].status).toBe('active');
    expect(signals[0].resolvedAt).toBeUndefined();
    expect(signals[0].occurrenceCount).toBe(2);
    expect(transitions[0].newStatus).toBe('active');
  });

  it('preserves dismissed status when still detected', () => {
    const current = [{ deduplicationKey: 'k1', id: '1', status: 'dismissed', dismissedAt: 'old_dis', triggeredAt: 'old', occurrenceCount: 1 } as OperationalSignal];
    const evaluated = [{ deduplicationKey: 'k1', id: '1' } as OperationalSignal];
    const { signals } = syncOperationalSignals(current, evaluated, { now });
    expect(signals[0].status).toBe('dismissed');
    expect(signals[0].dismissedAt).toBe('old_dis');
    expect(signals[0].lastDetectedAt).toBe(now);
  });
});
`;
fs.writeFileSync('src/lib/operational/syncOperationalSignals.test.ts', syncTestStr);
