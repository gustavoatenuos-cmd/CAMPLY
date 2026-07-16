import '@testing-library/jest-dom/vitest';
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ClientOperationalChecklist } from './ClientOperationalChecklist';
import type { ClientOperationalReadiness, ReadinessArea } from '../../lib/operational/clientOperationalReadiness';

function readyArea<T extends string>(status: T): ReadinessArea<T> {
  return { status, missing: [], warnings: [], action: '' };
}

function baseReadiness(overrides: Partial<ClientOperationalReadiness> = {}): ClientOperationalReadiness {
  return {
    clientId: 'client-1',
    globalStatus: 'ready',
    analytics: readyArea('ready'),
    meta: readyArea('ready'),
    campaigns: readyArea('ready'),
    finance: readyArea('ready'),
    ...overrides,
  };
}

describe('ClientOperationalChecklist', () => {
  afterEach(() => cleanup());

  it('renders one card per area plus the banner', () => {
    render(<ClientOperationalChecklist readiness={baseReadiness()} />);
    expect(screen.getByTestId('client-readiness-banner')).toBeInTheDocument();
    expect(screen.getByTestId('client-readiness-area-analytics')).toBeInTheDocument();
    expect(screen.getByTestId('client-readiness-area-meta')).toBeInTheDocument();
    expect(screen.getByTestId('client-readiness-area-campaigns')).toBeInTheDocument();
    expect(screen.getByTestId('client-readiness-area-finance')).toBeInTheDocument();
  });

  it('shows the missing prerequisite and required action for a blocked area', () => {
    const readiness = baseReadiness({
      globalStatus: 'blocked',
      meta: { status: 'blocked', missing: ['Conta Meta não vinculada'], warnings: [], action: 'Vincular conta Meta' },
    });
    render(<ClientOperationalChecklist readiness={readiness} />);
    const metaCard = screen.getByTestId('client-readiness-area-meta');
    expect(metaCard).toHaveTextContent('Falta: Conta Meta não vinculada');
    expect(metaCard).toHaveTextContent('Ação: Vincular conta Meta');
  });

  it('shows warnings without an action for a ready-but-warned area', () => {
    const readiness = baseReadiness({
      globalStatus: 'attention',
      finance: { status: 'ready', missing: [], warnings: ['Cobrança em atraso'], action: '' },
    });
    render(<ClientOperationalChecklist readiness={readiness} />);
    const financeCard = screen.getByTestId('client-readiness-area-finance');
    expect(financeCard).toHaveTextContent('Cobrança em atraso');
    expect(financeCard).not.toHaveTextContent('Ação:');
  });
});
