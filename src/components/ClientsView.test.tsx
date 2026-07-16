import '@testing-library/jest-dom/vitest';
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

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
    // Cliente pausado é operacionalmente inativo — não aparece sob o filtro
    // padrão "Ativos" (ver ClientLifecycleFilter), só sob "Todos"/"Inativos".
    fireEvent.click(screen.getByTestId('client-lifecycle-filter-all'));
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

describe('ClientsView lifecycle filter and deactivate/reactivate', () => {
  afterEach(() => cleanup());

  it('defaults to the "Ativos" filter, hiding a paused client until "Todos"/"Inativos" is selected', () => {
    const data = baseData({ clients: [makeClient({ id: 'active-1', name: 'Cliente Ativo' }), makeClient({ id: 'paused-1', name: 'Cliente Pausado', status: 'paused' })] });
    render(<ClientsView data={data} updateData={vi.fn()} />);

    expect(screen.getByText('Cliente Ativo')).toBeInTheDocument();
    expect(screen.queryByText('Cliente Pausado')).not.toBeInTheDocument();
    expect(screen.getByTestId('client-lifecycle-filter-active')).toHaveTextContent('Ativos · 1');
    expect(screen.getByTestId('client-lifecycle-filter-inactive')).toHaveTextContent('Inativos · 1');
    expect(screen.getByTestId('client-lifecycle-filter-all')).toHaveTextContent('Todos · 2');

    fireEvent.click(screen.getByTestId('client-lifecycle-filter-inactive'));
    expect(screen.queryByText('Cliente Ativo')).not.toBeInTheDocument();
    expect(screen.getByText('Cliente Pausado')).toBeInTheDocument();
  });

  it('a project being archived excludes an otherwise-active client from the "Ativos" filter', () => {
    const data = baseData({
      clients: [makeClient({ id: 'client-1', name: 'Cliente Com Projeto Arquivado', projectId: 'project-1' })],
      projects: [{
        id: 'project-1', projectType: 'traffic', clientId: 'client-1', ownerName: '', company: '',
        billingType: 'recurring', name: 'Projeto', role: '', status: 'archived', progress: 0, dueDate: '',
        amountCharged: 0, amountReceived: 0, paymentStatus: 'pending', deliveredUrl: '', visibility: 'private', nextAction: '',
      }],
    });
    render(<ClientsView data={data} updateData={vi.fn()} />);
    expect(screen.queryByText('Cliente Com Projeto Arquivado')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('client-lifecycle-filter-all'));
    expect(screen.getByText('Cliente Com Projeto Arquivado')).toBeInTheDocument();
  });

  it('deactivating an active client requires confirmation and sets status to paused', () => {
    const updateData = vi.fn();
    const data = baseData({ clients: [makeClient()] });
    render(<ClientsView data={data} updateData={updateData} />);

    fireEvent.click(screen.getByTestId('client-deactivate-button'));
    expect(screen.getByText('Desativar cliente?')).toBeInTheDocument();
    expect(updateData).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Desativar cliente', { selector: 'button.bg-rose-400' }));
    expect(updateData).toHaveBeenCalledTimes(1);
    const updater = updateData.mock.calls[0][0];
    const result = updater(data);
    expect(result.clients[0].status).toBe('paused');
  });

  it('reactivating a paused client sets status to active without a confirmation dialog', () => {
    const updateData = vi.fn();
    const data = baseData({ clients: [makeClient({ status: 'paused' })] });
    render(<ClientsView data={data} updateData={updateData} />);
    fireEvent.click(screen.getByTestId('client-lifecycle-filter-all'));

    fireEvent.click(screen.getByTestId('client-reactivate-button'));
    expect(screen.queryByText('Desativar cliente?')).not.toBeInTheDocument();
    expect(updateData).toHaveBeenCalledTimes(1);
    const updater = updateData.mock.calls[0][0];
    const result = updater(data);
    expect(result.clients[0].status).toBe('active');
  });
});
