import '@testing-library/jest-dom/vitest';
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ClientReadinessBanner } from './ClientReadinessBanner';
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

describe('ClientReadinessBanner', () => {
  afterEach(() => cleanup());

  it('shows "Pronto" and a plain ready message when everything is ready', () => {
    render(<ClientReadinessBanner readiness={baseReadiness()} />);
    expect(screen.getByText('Pronto')).toBeInTheDocument();
    expect(screen.getByText('Cliente pronto para análise.')).toBeInTheDocument();
    expect(screen.getByTestId('client-readiness-banner')).toHaveAttribute('data-status', 'ready');
  });

  it('shows "Bloqueado" and lists what is missing', () => {
    const readiness = baseReadiness({
      globalStatus: 'blocked',
      analytics: { status: 'blocked', missing: ['Perfil de análise não configurado'], warnings: [], action: 'Configurar metas do cliente' },
    });
    render(<ClientReadinessBanner readiness={readiness} />);
    expect(screen.getByText('Bloqueado')).toBeInTheDocument();
    expect(screen.getByText(/Este cliente ainda não pode ser analisado/)).toBeInTheDocument();
    expect(screen.getByText(/perfil de análise não configurado/)).toBeInTheDocument();
  });

  it('shows "Atenção" and surfaces warnings for partial data', () => {
    const readiness = baseReadiness({
      globalStatus: 'attention',
      meta: { status: 'partial', missing: [], warnings: ['Leitura parcial — análise limitada'], action: 'Revisar sincronização parcial' },
    });
    render(<ClientReadinessBanner readiness={readiness} />);
    expect(screen.getByText('Atenção')).toBeInTheDocument();
    expect(screen.getByText(/Leitura parcial/)).toBeInTheDocument();
  });

  it('shows "Inativo" distinctly from blocked/attention', () => {
    const readiness = baseReadiness({ globalStatus: 'inactive', finance: readyArea('inactive') });
    render(<ClientReadinessBanner readiness={readiness} />);
    expect(screen.getByText('Inativo')).toBeInTheDocument();
    expect(screen.getByText(/fora da operação principal/)).toBeInTheDocument();
  });
});
