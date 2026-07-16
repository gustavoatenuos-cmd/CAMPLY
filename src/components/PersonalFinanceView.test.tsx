import '@testing-library/jest-dom/vitest';
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PersonalFinanceView } from './PersonalFinanceView';
import type { CamplyData, Client } from '../types';

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

describe('PersonalFinanceView finance readiness gaps', () => {
  afterEach(() => cleanup());

  it('flags an active client with no monthly fee configured as a finance gap', () => {
    const data = baseData({ clients: [makeClient({ monthlyFee: 0 })] });
    render(<PersonalFinanceView data={data} updateData={vi.fn()} />);

    expect(screen.getByText('Clientes ativos sem cobrança configurada')).toBeInTheDocument();
    expect(screen.getByTestId('finance-readiness-gap')).toHaveTextContent('Cliente Teste');
  });

  it('does not flag an active client that already has a recurring fee configured', () => {
    const data = baseData({ clients: [makeClient({ monthlyFee: 1000 })] });
    render(<PersonalFinanceView data={data} updateData={vi.fn()} />);

    expect(screen.queryByText('Clientes ativos sem cobrança configurada')).not.toBeInTheDocument();
  });

  it('does not flag an inactive (paused) client at all', () => {
    const data = baseData({ clients: [makeClient({ monthlyFee: 0, status: 'paused' })] });
    render(<PersonalFinanceView data={data} updateData={vi.fn()} />);

    expect(screen.queryByText('Clientes ativos sem cobrança configurada')).not.toBeInTheDocument();
  });
});
