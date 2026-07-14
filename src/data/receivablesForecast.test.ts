import { describe, expect, it } from 'vitest';
import { buildOperationalView } from './receivablesForecast';
import { CamplyData, Client, Project, Receivable } from '../types';

const REFERENCE_DATE = new Date(2026, 6, 14); // 2026-07-14

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: 'client-1',
    projectId: '',
    name: 'Cliente Teste',
    company: '',
    segment: '',
    structure: '',
    hasProject: false,
    contact: '',
    monthlyFee: 1000,
    managementFeeType: 'recurring',
    dueDay: 20,
    adInvestmentPeriod: 'monthly',
    adInvestmentMeta: 0,
    adInvestmentGoogle: 0,
    adInvestmentYoutube: 0,
    adInvestmentTikTok: 0,
    status: 'active',
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    projectType: 'traffic',
    clientId: 'client-1',
    ownerName: '',
    company: '',
    billingType: 'recurring',
    name: 'Projeto Teste',
    role: '',
    status: 'active',
    progress: 0,
    dueDate: '2026-07-10',
    amountCharged: 0,
    amountReceived: 0,
    paymentStatus: 'pending',
    deliveredUrl: '',
    visibility: 'private',
    nextAction: '',
    ...overrides,
  };
}

function makeReceivable(overrides: Partial<Receivable> = {}): Receivable {
  return {
    id: 'recv-1',
    clientId: 'client-1',
    description: 'Mensalidade',
    amount: 1000,
    dueDate: '2026-07-10',
    status: 'pending',
    ...overrides,
  };
}

function makeData(overrides: Partial<CamplyData> = {}): CamplyData {
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

describe('buildOperationalView', () => {
  it('generates at most 2 forecast rows (current + next month) for a recurring active client', () => {
    const data = makeData({ clients: [makeClient()] });
    const view = buildOperationalView(data, REFERENCE_DATE);

    const rowsForClient = [...view.currentMonthEntries, ...view.nextMonthEntries].filter(
      (entry) => entry.clientId === 'client-1',
    );

    expect(rowsForClient).toHaveLength(2);
    expect(view.currentMonthEntries[0].monthKey).toBe('2026-07');
    expect(view.nextMonthEntries[0].monthKey).toBe('2026-08');
  });

  it('excludes inactive clients from the operational view', () => {
    const data = makeData({ clients: [makeClient({ status: 'paused' })] });
    const view = buildOperationalView(data, REFERENCE_DATE);

    expect(view.currentMonthEntries).toHaveLength(0);
    expect(view.nextMonthEntries).toHaveLength(0);
  });

  it('excludes clients linked to a done (archived) project', () => {
    const data = makeData({
      clients: [makeClient({ projectId: 'project-1' })],
      projects: [makeProject({ status: 'done' })],
    });
    const view = buildOperationalView(data, REFERENCE_DATE);

    expect(view.currentMonthEntries).toHaveLength(0);
    expect(view.nextMonthEntries).toHaveLength(0);
  });

  it('does not duplicate a recurring forecast when a real receivable already exists for the competência', () => {
    const data = makeData({
      clients: [makeClient()],
      receivables: [makeReceivable({ dueDate: '2026-07-10', amount: 1234 })],
    });
    const view = buildOperationalView(data, REFERENCE_DATE);

    expect(view.currentMonthEntries).toHaveLength(1);
    expect(view.currentMonthEntries[0].amount).toBe(1234);
    expect(view.currentMonthEntries[0].receivableId).toBe('recv-1');
  });

  it('shows a standalone ad-hoc receivable for an active client with no recurring fee configured', () => {
    const data = makeData({
      clients: [makeClient({ monthlyFee: 0 })],
      receivables: [makeReceivable({ id: 'recv-extra', description: 'Setup pontual', amount: 500, dueDate: '2026-08-05' })],
    });
    const view = buildOperationalView(data, REFERENCE_DATE);

    expect(view.currentMonthEntries).toHaveLength(0);
    expect(view.nextMonthEntries.map((entry) => entry.receivableId)).toEqual(['recv-extra']);
  });

  it('separates overdue-this-month from overdue-all-time, keeping old overdue out of the default month view', () => {
    const data = makeData({
      clients: [makeClient({ id: 'client-2', monthlyFee: 0 })],
      receivables: [
        makeReceivable({ id: 'recv-current-overdue', clientId: 'client-2', dueDate: '2026-07-01', status: 'overdue', amount: 300 }),
        makeReceivable({ id: 'recv-old-overdue', clientId: 'client-2', dueDate: '2026-04-01', status: 'overdue', amount: 800 }),
      ],
    });
    const view = buildOperationalView(data, REFERENCE_DATE);

    expect(view.overdueCurrentMonthEntries.map((e) => e.receivableId)).toEqual(['recv-current-overdue']);
    expect(view.overdueAllEntries.map((e) => e.receivableId).sort()).toEqual(['recv-current-overdue', 'recv-old-overdue'].sort());
    expect(view.currentMonthEntries.some((e) => e.receivableId === 'recv-old-overdue')).toBe(false);
  });

  it('computes the four top cards scoped to current and next month only', () => {
    const data = makeData({
      clients: [makeClient({ monthlyFee: 1000 })],
      receivables: [
        makeReceivable({ id: 'recv-paid', dueDate: '2026-07-05', status: 'paid', amount: 1000 }),
      ],
    });
    const view = buildOperationalView(data, REFERENCE_DATE);

    expect(view.cards.currentMonthReceived).toBe(1000);
    expect(view.cards.nextMonthForecast).toBe(1000);
  });

  it('includes every receivable regardless of client status in the history entries (used by the "Todos" filter)', () => {
    const data = makeData({
      clients: [makeClient({ status: 'paused' })],
      receivables: [makeReceivable({ dueDate: '2025-01-01', status: 'paid', amount: 100 })],
    });
    const view = buildOperationalView(data, REFERENCE_DATE);

    expect(view.historyEntries).toHaveLength(1);
    expect(view.currentMonthEntries).toHaveLength(0);
  });

  it('one-time management fee clients generate only a current month row, never a next-month row', () => {
    const data = makeData({ clients: [makeClient({ managementFeeType: 'one_time' })] });
    const view = buildOperationalView(data, REFERENCE_DATE);

    expect(view.currentMonthEntries).toHaveLength(1);
    expect(view.nextMonthEntries).toHaveLength(0);
  });

  it('does not regenerate a phantom monthly row for a one-time fee already billed in a previous month', () => {
    const data = makeData({
      clients: [makeClient({ managementFeeType: 'one_time', monthlyFee: 900 })],
      receivables: [makeReceivable({ description: 'Setup inicial', amount: 900, dueDate: '2026-05-20', status: 'paid', paidAt: '2026-05-20' })],
    });
    const view = buildOperationalView(data, REFERENCE_DATE);

    expect(view.currentMonthEntries).toHaveLength(0);
    expect(view.nextMonthEntries).toHaveLength(0);
  });

  it('matches the recurring mensalidade to the receivable closest to monthlyFee when two receivables share the same month', () => {
    const data = makeData({
      clients: [makeClient({ monthlyFee: 1000 })],
      receivables: [
        makeReceivable({ id: 'recv-adhoc', description: 'Cobrança avulsa', amount: 300, dueDate: '2026-07-05' }),
        makeReceivable({ id: 'recv-mensalidade', description: 'Mensalidade', amount: 1000, dueDate: '2026-07-20' }),
      ],
    });
    const view = buildOperationalView(data, REFERENCE_DATE);

    const mensalidadeRow = view.currentMonthEntries.find((entry) => entry.receivableId === 'recv-mensalidade');
    expect(mensalidadeRow).toBeDefined();
    expect(mensalidadeRow?.amount).toBe(1000);
    // A cobrança avulsa não é consumida pela previsão recorrente: continua aparecendo como linha própria.
    expect(view.currentMonthEntries.some((entry) => entry.receivableId === 'recv-adhoc')).toBe(true);
  });
});
