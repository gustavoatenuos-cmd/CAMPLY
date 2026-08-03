/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePerformanceDashboard } from './usePerformanceDashboard';
import { loadAnalyticsCapabilities } from './analyticsCapabilities';
import { loadGlobalPerformanceDashboard, type GlobalClientPerformance } from './globalPerformanceDashboard';
import type { CamplyData, Client, Project } from '../../types';

vi.mock('./analyticsCapabilities', () => ({
  loadAnalyticsCapabilities: vi.fn(),
}));

vi.mock('./globalPerformanceDashboard', () => ({
  loadGlobalPerformanceDashboard: vi.fn(),
}));

const loadAnalyticsCapabilitiesMock = vi.mocked(loadAnalyticsCapabilities);
const loadGlobalPerformanceDashboardMock = vi.mocked(loadGlobalPerformanceDashboard);

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: 'client-active',
    projectId: '',
    name: 'Cliente',
    company: 'Cliente',
    segment: '',
    structure: '',
    hasProject: false,
    contact: '',
    monthlyFee: 0,
    managementFeeType: 'recurring',
    dueDay: 1,
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
    id: 'project-active',
    projectType: 'traffic',
    clientId: 'client-active',
    ownerName: '',
    company: '',
    name: 'Projeto',
    role: '',
    status: 'active',
    progress: 0,
    dueDate: '',
    billingType: 'recurring',
    amountCharged: 0,
    amountReceived: 0,
    paymentStatus: 'pending',
    deliveredUrl: '',
    visibility: 'private',
    nextAction: '',
    createdAt: '',
    ...overrides,
  };
}

function makePerformance(overrides: Partial<GlobalClientPerformance> = {}): GlobalClientPerformance {
  return {
    clientId: 'client-active',
    clientName: 'Cliente',
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

describe('usePerformanceDashboard', () => {
  beforeEach(() => {
    loadAnalyticsCapabilitiesMock.mockReset();
    loadGlobalPerformanceDashboardMock.mockReset();
    loadAnalyticsCapabilitiesMock.mockResolvedValue({
      mode: 'analytics',
      capabilities: {
        contractVersion: 6,
        dashboardAvailable: true,
        dashboardRpc: 'get_global_performance_dashboard_v2',
        traceableMetrics: true,
        targetsAvailable: true,
        reconciliationAvailable: true,
        supportedLevels: ['campaign'],
        supportedPeriods: ['last_30d'],
      },
    });
  });

  it('excludes Analytics clients whose linked project is archived or done', async () => {
    loadGlobalPerformanceDashboardMock.mockResolvedValue([
      makePerformance({ clientId: 'client-active', clientName: 'Cliente Ativo' }),
      makePerformance({ clientId: 'client-archived', clientName: 'Cliente Arquivado' }),
      makePerformance({ clientId: 'client-done', clientName: 'Cliente Concluído' }),
    ]);

    const data = makeData({
      clients: [
        makeClient({ id: 'client-active', name: 'Cliente Ativo', projectId: 'project-active' }),
        makeClient({ id: 'client-archived', name: 'Cliente Arquivado', projectId: 'project-archived' }),
        makeClient({ id: 'client-done', name: 'Cliente Concluído', projectId: 'project-done' }),
      ],
      projects: [
        makeProject({ id: 'project-active', clientId: 'client-active', status: 'active' }),
        makeProject({ id: 'project-archived', clientId: 'client-archived', status: 'archived' }),
        makeProject({ id: 'project-done', clientId: 'client-done', status: 'done' }),
      ],
    });

    const { result } = renderHook(() => usePerformanceDashboard(data, 'last_30d'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.clients.map(client => client.clientId)).toEqual(['client-active']);
  });
});
