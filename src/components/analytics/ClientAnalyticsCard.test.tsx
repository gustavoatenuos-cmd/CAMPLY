import '@testing-library/jest-dom/vitest';
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClientAnalyticsCard } from './ClientAnalyticsCard';
import type { EnrichedGlobalClientPerformance } from '../../lib/performance/usePerformanceDashboard';

describe('ClientAnalyticsCard', () => {
  it('reads the commercial profile from performance.analysisProfile, not from performance.client', () => {
    const mockPerformance = {
      clientId: 'c1',
      clientName: 'Cliente Teste',
      clientStatus: 'available',
      accounts: [],
      metrics: {
        spend: { value: 1000, available: true },
      },
      metricGroups: [],
      score: { value: 72 },
      dataQuality: { status: 'complete', reason: null },
      // O perfil comercial real vem daqui, populado a partir de client_analysis_profiles.
      analysisProfile: {
        clientId: 'c1',
        vertical: 'Saúde',
        subsegment: 'Odontologia',
        customVertical: null,
        customSubsegment: null,
        operationType: 'Consultório local',
        salesModels: ['Assinatura recorrente'],
        secondaryChannel: null,
        secondaryConversionMetric: null,
        businessModel: 'clínica local',
        primaryConversionMetric: 'messaging_conversations_started_total',
        secondaryMetrics: [],
        primaryChannel: 'WhatsApp',
        budgetPeriod: 'monthly',
        plannedBudget: 1500,
        minimumEvaluationSpend: 0,
        minimumImpressions: 0,
        minimumResults: 0,
        attributionDelayHours: 0,
        analysisEnabled: true,
      },
      // Registro local do workspace: propositalmente SEM analysisProfile, para
      // provar que o card não depende mais deste caminho quebrado.
      client: { id: 'c1', name: 'Cliente do Workspace', company: 'Empresa X' },
    } as unknown as EnrichedGlobalClientPerformance;

    render(
      <ClientAnalyticsCard
        performance={mockPerformance}
        onOpenCampaigns={vi.fn()}
        onOpenDetails={vi.fn()}
      />
    );

    // Objetivo/operação principal do perfil comercial.
    expect(screen.getByText('Consultório local')).toBeInTheDocument();
    // Métrica principal: KPI de conversas (ClientPrimaryMetricBlock não deve
    // cair no fallback "Meta principal não configurada").
    expect(screen.queryByText('Meta principal não configurada')).not.toBeInTheDocument();
    expect(screen.getAllByText('Conversas').length).toBeGreaterThan(0);
    // Orçamento/metas: o card não pode dizer "Orçamento não configurado"
    // quando plannedBudget e budgetPeriod existem no perfil.
    expect(screen.queryByText('Orçamento não configurado')).not.toBeInTheDocument();
    expect(screen.getByText('Planejado')).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*1\.500,00/)).toBeInTheDocument();
  });

  it('falls back to the unconfigured state when there is no analysis profile at all', () => {
    const mockPerformance = {
      clientId: 'c2',
      clientName: 'Cliente Sem Perfil',
      clientStatus: 'available',
      accounts: [],
      metrics: {},
      metricGroups: [],
      score: { value: null },
      dataQuality: { status: 'unavailable', reason: null },
      analysisProfile: null,
      client: { id: 'c2', name: 'Cliente Sem Perfil' },
    } as unknown as EnrichedGlobalClientPerformance;

    render(
      <ClientAnalyticsCard
        performance={mockPerformance}
        onOpenCampaigns={vi.fn()}
        onOpenDetails={vi.fn()}
      />
    );

    expect(screen.getByText('Meta principal não configurada')).toBeInTheDocument();
    expect(screen.getAllByText('Orçamento não configurado').length).toBeGreaterThan(0);
  });
});
