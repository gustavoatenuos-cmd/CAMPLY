import '@testing-library/jest-dom/vitest';
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('./meta/MetaOperationalWorkspace', () => ({
  MetaOperationalWorkspace: () => <div data-testid="mock-meta-operational-workspace" />,
}));

import { ClientsView } from './ClientsView';
import type { CamplyData, Client, Receivable } from '../types';

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
  } as Client;
}

function baseData(overrides: Partial<CamplyData> = {}): CamplyData {
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
  } as CamplyData;
}

describe('ClientsView finance readiness badge', () => {
  afterEach(() => cleanup());

  it('shows "Financeiro OK" for an active client with a recurring fee configured', () => {
    const data = baseData({ clients: [makeClient({ monthlyFee: 1000 })] });
    render(<ClientsView data={data} updateData={vi.fn()} />);
    expect(screen.getByTestId('client-finance-readiness-badge')).toHaveTextContent('Financeiro OK');
  });

  it('shows "Cobrança pendente" for an active client with no fee configured', () => {
    const data = baseData({ clients: [makeClient({ monthlyFee: 0 })] });
    render(<ClientsView data={data} updateData={vi.fn()} />);
    expect(screen.getByTestId('client-finance-readiness-badge')).toHaveTextContent('Cobrança pendente');
  });

  it('shows "Fora da operação" for a paused client', () => {
    const data = baseData({ clients: [makeClient({ status: 'paused' })] });
    render(<ClientsView data={data} updateData={vi.fn()} />);
    expect(screen.getByTestId('client-finance-readiness-badge')).toHaveTextContent('Fora da operação');
  });

  it('surfaces an overdue current-month charge instead of silently dropping it (regression: overdue entries live in a separate bucket)', () => {
    const today = new Date();
    const overdueDueDate = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
    const receivable: Receivable = {
      id: 'recv-1',
      clientId: 'client-1',
      description: 'Mensalidade',
      amount: 1000,
      dueDate: overdueDueDate,
      status: 'overdue',
    };
    const data = baseData({ clients: [makeClient({ monthlyFee: 1000 })], receivables: [receivable] });
    render(<ClientsView data={data} updateData={vi.fn()} />);

    const badge = screen.getByTestId('client-finance-readiness-badge');
    // O cliente ainda tem o lançamento do próximo mês, então continua "OK" no
    // status, mas o atraso do mês atual precisa aparecer - não pode desaparecer.
    expect(badge).toHaveAttribute('title', expect.stringContaining('Cobrança em atraso'));
  });
});
