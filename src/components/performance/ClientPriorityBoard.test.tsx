import '@testing-library/jest-dom/vitest';
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ClientPriorityBoard } from './ClientPriorityBoard';
import type { ClientPriorityEntry } from '../../lib/performance/clientPriorityGrouping';
import type { GlobalClientPerformance } from '../../lib/performance/globalPerformanceDashboard';

function client(id: string, name: string): GlobalClientPerformance {
  return {
    clientId: id,
    clientName: name,
    clientStatus: 'available',
    accounts: [],
    metrics: {},
    metricGroups: [],
    resolvedTargets: [],
    evaluations: [],
    budgetPacing: null,
    score: { value: 80, status: 'healthy' } as any,
    dataQuality: { status: 'complete', reason: null },
    lastSuccessfulRun: null,
    lastAttempt: null,
    hasNewerPartial: false,
    hasNewerFailure: false,
    analysisProfile: null,
  };
}

function entry(id: string, name: string, tier: ClientPriorityEntry['tier'], reasons: ClientPriorityEntry['reasons']): ClientPriorityEntry {
  return { client: client(id, name), workspaceClient: undefined, tier, reasons };
}

describe('ClientPriorityBoard', () => {
  afterEach(() => cleanup());

  it('renders the three tier columns with their counts', () => {
    const entries = [
      entry('a', 'Cliente A', 'action_now', ['sync_failed']),
      entry('b', 'Cliente B', 'attention', ['sync_partial']),
      entry('c', 'Cliente C', 'healthy', ['healthy']),
    ];
    render(<ClientPriorityBoard entries={entries} onSelectClient={() => {}} />);

    expect(screen.getByText('Exige ação agora')).toBeInTheDocument();
    expect(screen.getByText('Em atenção')).toBeInTheDocument();
    expect(screen.getByText('Saudáveis')).toBeInTheDocument();
    expect(screen.getByText('Cliente A')).toBeInTheDocument();
    expect(screen.getByText('Cliente B')).toBeInTheDocument();
    expect(screen.getByText('Cliente C')).toBeInTheDocument();
  });

  it('shows an empty-state message for a tier with no clients', () => {
    const entries = [entry('c', 'Cliente C', 'healthy', ['healthy'])];
    render(<ClientPriorityBoard entries={entries} onSelectClient={() => {}} />);
    expect(screen.getAllByText('Nenhum cliente neste grupo.')).toHaveLength(2);
  });

  it('calls onSelectClient with the clicked client id', () => {
    const onSelectClient = vi.fn();
    const entries = [entry('a', 'Cliente A', 'action_now', ['sync_failed'])];
    render(<ClientPriorityBoard entries={entries} onSelectClient={onSelectClient} />);
    fireEvent.click(screen.getByText('Cliente A'));
    expect(onSelectClient).toHaveBeenCalledWith('a');
  });

  it('caps the healthy column and allows expanding to see every client', () => {
    const entries = Array.from({ length: 8 }, (_, i) => entry(`h${i}`, `Saudável ${i}`, 'healthy', ['healthy']));
    render(<ClientPriorityBoard entries={entries} onSelectClient={() => {}} />);

    expect(screen.queryByText('Saudável 7')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Ver todos (8)'));
    expect(screen.getByText('Saudável 7')).toBeInTheDocument();
  });

  it('shows the technical reason under a partial client when the backend reported one', () => {
    const partialEntry: ClientPriorityEntry = {
      client: { ...client('p', 'Cliente Parcial'), dataQuality: { status: 'partial', reason: 'partial_page' } },
      workspaceClient: undefined,
      tier: 'attention',
      reasons: ['sync_partial'],
    };
    render(<ClientPriorityBoard entries={[partialEntry]} onSelectClient={() => {}} />);
    expect(screen.getByText(/Motivo técnico:/)).toBeInTheDocument();
    expect(screen.getByText(/número máximo de páginas/)).toBeInTheDocument();
  });

  it('does not show a technical reason line for a healthy client', () => {
    const entries = [entry('c', 'Cliente C', 'healthy', ['healthy'])];
    render(<ClientPriorityBoard entries={entries} onSelectClient={() => {}} />);
    expect(screen.queryByText(/Motivo técnico:/)).not.toBeInTheDocument();
  });

  it('never shows the project contractor/responsible name from the workspace record as the title', () => {
    // Reproduces the reported bug: a whole project's clients had `name`
    // holding the contractor's name ("Joao") while `company` (and the
    // backend-resolved clientName) had the real client name.
    const entryWithBadWorkspaceName: ClientPriorityEntry = {
      client: client('donatellus', 'Donatellus'),
      workspaceClient: { name: 'Joao', company: 'Donatellus', segment: 'alimentacao' } as any,
      tier: 'healthy',
      reasons: ['healthy'],
    };
    render(<ClientPriorityBoard entries={[entryWithBadWorkspaceName]} onSelectClient={() => {}} />);
    expect(screen.getByText('Donatellus')).toBeInTheDocument();
    expect(screen.queryByText('Joao')).not.toBeInTheDocument();
  });
});
