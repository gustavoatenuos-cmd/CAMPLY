import { describe, it, expect } from 'vitest';
import {
  evaluateClientOperationalReadiness,
  summarizeMetaReadinessAcrossClients,
  buildReadinessSummaryMessage,
  type ClientOperationalReadinessInput,
} from './clientOperationalReadiness';
import type { Client, Project } from '../../types';
import type { ClientAnalysisProfile } from '../analysis/clientAnalysisProfile';
import type { ClientMetaAccount } from '../meta/clientMetaAssetService';
import type { OperationalEntry } from '../../data/receivablesForecast';

const NOW = new Date('2026-07-15T12:00:00.000Z');

function baseClient(status: Client['status'] = 'active'): Client {
  return { id: 'client-1', name: 'Cliente Teste', status } as Client;
}

function baseProject(status: Project['status'] = 'active'): Project {
  return { id: 'project-1', status } as Project;
}

function baseProfile(overrides: Partial<ClientAnalysisProfile> = {}): ClientAnalysisProfile {
  return {
    clientId: 'client-1',
    vertical: 'varejo',
    subsegment: 'moda',
    customVertical: null,
    customSubsegment: null,
    operationType: 'online',
    salesModels: ['ecommerce_proprio'],
    secondaryChannel: null,
    secondaryConversionMetric: null,
    businessModel: '',
    primaryConversionMetric: 'purchases',
    secondaryMetrics: [],
    primaryChannel: 'site_ecommerce',
    budgetPeriod: 'monthly',
    plannedBudget: 5000,
    minimumEvaluationSpend: 100,
    minimumImpressions: 1000,
    minimumResults: 1,
    attributionDelayHours: 24,
    analysisEnabled: true,
    ...overrides,
  };
}

function makeAccount(overrides: Partial<ClientMetaAccount> = {}): ClientMetaAccount {
  return {
    clientMetaAssetId: 'link-1',
    metaAssetId: 'asset-1',
    integrationId: 'integration-1',
    adAccountId: 'act_1',
    accountName: 'Conta 1',
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    assetStatus: 'ACTIVE',
    linkedAt: '2026-07-01T00:00:00.000Z',
    availablePeriods: ['this_month'],
    lastAttempt: null,
    lastSuccess: null,
    ...overrides,
  };
}

function entry(overrides: Partial<OperationalEntry> = {}): OperationalEntry {
  return {
    id: 'entry-1',
    source: 'client',
    clientId: 'client-1',
    title: 'Cliente Teste',
    description: '',
    projectName: '',
    amount: 1000,
    dueDate: '2026-07-20',
    monthKey: '2026-07',
    status: 'pending',
    active: true,
    ...overrides,
  };
}

function baseInput(overrides: Partial<ClientOperationalReadinessInput> = {}): ClientOperationalReadinessInput {
  return {
    clientId: 'client-1',
    client: baseClient(),
    project: baseProject(),
    analysisProfile: baseProfile(),
    metaAccounts: [makeAccount({ lastSuccess: { id: 'run-1', status: 'success', period: 'this_month', level: 'campaign', scope: 'full_account', startedAt: '2026-07-15T11:00:00.000Z', finishedAt: '2026-07-15T11:05:00.000Z' } })],
    period: 'this_month',
    receivableEntries: [entry()],
    currentDate: NOW,
    ...overrides,
  };
}

describe('evaluateClientOperationalReadiness', () => {
  it('marks an inactive client as inactive globally, regardless of other data', () => {
    const readiness = evaluateClientOperationalReadiness(baseInput({ client: baseClient('paused') }));
    expect(readiness.finance.status).toBe('inactive');
    expect(readiness.globalStatus).toBe('inactive');
  });

  it('marks a client with an inactive (done) project as inactive', () => {
    const readiness = evaluateClientOperationalReadiness(baseInput({ project: baseProject('done') }));
    expect(readiness.finance.status).toBe('inactive');
    expect(readiness.globalStatus).toBe('inactive');
  });

  it('blocks analytics when there is no analysis profile', () => {
    const readiness = evaluateClientOperationalReadiness(baseInput({ analysisProfile: null }));
    expect(readiness.analytics.status).toBe('blocked');
    expect(readiness.analytics.action).toBe('Configurar metas do cliente');
    expect(readiness.analytics.missing).toContain('Perfil de análise não configurado');
  });

  it('blocks analytics and meta when the profile exists but no Meta account is linked', () => {
    const readiness = evaluateClientOperationalReadiness(baseInput({ metaAccounts: [] }));
    expect(readiness.meta.status).toBe('blocked');
    expect(readiness.meta.action).toBe('Vincular conta Meta');
    expect(readiness.analytics.status).toBe('blocked');
    expect(readiness.analytics.action).toBe('Vincular conta Meta');
    expect(readiness.campaigns.status).toBe('blocked');
  });

  it('blocks when the account is linked but the period was never synced', () => {
    const readiness = evaluateClientOperationalReadiness(
      baseInput({ metaAccounts: [makeAccount({ lastSuccess: null, lastAttempt: null })] })
    );
    expect(readiness.meta.status).toBe('blocked');
    expect(readiness.meta.action).toBe('Sincronizar Meta');
    expect(readiness.analytics.action).toBe('Sincronizar Meta');
  });

  it('treats a partial sync as limited/partial, never as full success', () => {
    const readiness = evaluateClientOperationalReadiness(
      baseInput({
        metaAccounts: [
          makeAccount({
            lastSuccess: null,
            lastAttempt: { id: 'run-2', status: 'partial', period: 'this_month', level: 'campaign', scope: 'full_account', startedAt: '2026-07-15T11:00:00.000Z', finishedAt: '2026-07-15T11:05:00.000Z' },
          }),
        ],
      })
    );
    expect(readiness.meta.status).toBe('partial');
    expect(readiness.meta.warnings).toContain('Leitura parcial — análise limitada');
    expect(readiness.analytics.status).toBe('limited');
    expect(readiness.campaigns.status).toBe('partial');
    expect(readiness.globalStatus).toBe('attention');
  });

  it('marks a successful but old sync as stale', () => {
    const readiness = evaluateClientOperationalReadiness(
      baseInput({
        metaAccounts: [
          makeAccount({
            lastSuccess: { id: 'run-3', status: 'success', period: 'this_month', level: 'campaign', scope: 'full_account', startedAt: '2026-07-12T11:00:00.000Z', finishedAt: '2026-07-12T11:05:00.000Z' },
          }),
        ],
      })
    );
    expect(readiness.meta.status).toBe('stale');
    expect(readiness.analytics.status).toBe('limited');
    expect(readiness.campaigns.status).toBe('stale');
  });

  it('waits instead of suggesting a duplicate sync when the only run for the period is still running', () => {
    const readiness = evaluateClientOperationalReadiness(
      baseInput({
        metaAccounts: [
          makeAccount({
            lastSuccess: null,
            lastAttempt: { id: 'run-running', status: 'running', period: 'this_month', level: 'campaign', scope: 'full_account', startedAt: '2026-07-15T11:00:00.000Z', finishedAt: null },
          }),
        ],
      })
    );
    expect(readiness.meta.status).toBe('blocked');
    expect(readiness.meta.action).toBe('Aguardar sincronização em andamento');
    expect(readiness.meta.warnings).toContain('Sincronização em andamento');
  });

  it('treats a null client (screen does not load the client record) as unknown, not inactive', () => {
    const readiness = evaluateClientOperationalReadiness(baseInput({ client: null, project: null }));
    expect(readiness.finance.status).not.toBe('inactive');
    expect(readiness.globalStatus).not.toBe('inactive');
  });

  it('blocks (not "failed") analytics/campaigns when the only run for the period failed', () => {
    const readiness = evaluateClientOperationalReadiness(
      baseInput({
        metaAccounts: [
          makeAccount({
            lastSuccess: null,
            lastAttempt: { id: 'run-4', status: 'failed', period: 'this_month', level: 'campaign', scope: 'full_account', startedAt: '2026-07-15T11:00:00.000Z', finishedAt: '2026-07-15T11:05:00.000Z' },
          }),
        ],
      })
    );
    expect(readiness.meta.status).toBe('failed');
    expect(readiness.analytics.status).toBe('blocked');
    expect(readiness.campaigns.status).toBe('blocked');
    expect(readiness.globalStatus).toBe('blocked');
  });

  it('is ready across the board when profile, account, and a fresh successful sync all exist', () => {
    const readiness = evaluateClientOperationalReadiness(baseInput());
    expect(readiness.meta.status).toBe('ready');
    expect(readiness.analytics.status).toBe('ready');
    expect(readiness.campaigns.status).toBe('ready');
    expect(readiness.finance.status).toBe('ready');
    expect(readiness.globalStatus).toBe('ready');
  });

  it('blocks finance when the client is active but has no current/next month billing entry', () => {
    const readiness = evaluateClientOperationalReadiness(baseInput({ receivableEntries: [] }));
    expect(readiness.finance.status).toBe('blocked');
    expect(readiness.finance.action).toBe('Configurar cobrança do cliente');
  });

  it('surfaces an overdue warning without blocking finance readiness', () => {
    const readiness = evaluateClientOperationalReadiness(
      baseInput({ receivableEntries: [entry({ status: 'overdue' })] })
    );
    expect(readiness.finance.status).toBe('ready');
    expect(readiness.finance.warnings).toContain('Cobrança em atraso');
  });

  it('ignores inactive entries when deciding whether finance is configured', () => {
    const readiness = evaluateClientOperationalReadiness(
      baseInput({ receivableEntries: [entry({ active: false })] })
    );
    expect(readiness.finance.status).toBe('blocked');
  });

  describe('with a precomputed analyticsDecision', () => {
    it('maps no_profile to blocked', () => {
      const readiness = evaluateClientOperationalReadiness(
        baseInput({ analyticsDecision: { status: 'no_profile' } })
      );
      expect(readiness.analytics.status).toBe('blocked');
      expect(readiness.analytics.action).toBe('Configurar metas do cliente');
    });

    it('maps no_data to blocked using the underlying meta reason', () => {
      const readiness = evaluateClientOperationalReadiness(
        baseInput({ metaAccounts: [], analyticsDecision: { status: 'no_data' } })
      );
      expect(readiness.analytics.status).toBe('blocked');
      expect(readiness.analytics.action).toBe('Vincular conta Meta');
    });

    it('maps stale_data to limited', () => {
      const readiness = evaluateClientOperationalReadiness(
        baseInput({ analyticsDecision: { status: 'stale_data' } })
      );
      expect(readiness.analytics.status).toBe('limited');
    });

    it('maps healthy/attention/critical to ready when the underlying sync is complete', () => {
      for (const status of ['healthy', 'attention', 'critical'] as const) {
        const readiness = evaluateClientOperationalReadiness(baseInput({ analyticsDecision: { status } }));
        expect(readiness.analytics.status).toBe('ready');
      }
    });

    it('downgrades to limited when the decision is healthy but the sync itself is partial', () => {
      const readiness = evaluateClientOperationalReadiness(
        baseInput({
          metaAccounts: [
            makeAccount({
              lastSuccess: null,
              lastAttempt: { id: 'run-5', status: 'partial', period: 'this_month', level: 'campaign', scope: 'full_account', startedAt: '2026-07-15T11:00:00.000Z', finishedAt: '2026-07-15T11:05:00.000Z' },
            }),
          ],
          analyticsDecision: { status: 'healthy' },
        })
      );
      expect(readiness.analytics.status).toBe('limited');
    });
  });
});

describe('evaluateClientOperationalReadiness with globalClientStatus fallback', () => {
  it('derives blocked/"Vincular conta Meta" from not_connected when metaAccounts is omitted', () => {
    const readiness = evaluateClientOperationalReadiness(
      baseInput({ metaAccounts: undefined, globalClientStatus: 'not_connected' })
    );
    expect(readiness.meta.status).toBe('blocked');
    expect(readiness.meta.action).toBe('Vincular conta Meta');
  });

  it('derives partial from the aggregated partial status', () => {
    const readiness = evaluateClientOperationalReadiness(
      baseInput({ metaAccounts: undefined, globalClientStatus: 'partial' })
    );
    expect(readiness.meta.status).toBe('partial');
    expect(readiness.analytics.status).toBe('limited');
  });

  it('derives ready from available', () => {
    const readiness = evaluateClientOperationalReadiness(
      baseInput({ metaAccounts: undefined, globalClientStatus: 'available' })
    );
    expect(readiness.meta.status).toBe('ready');
  });

  it('derives stale from the aggregated stale status', () => {
    const readiness = evaluateClientOperationalReadiness(
      baseInput({ metaAccounts: undefined, globalClientStatus: 'stale' })
    );
    expect(readiness.meta.status).toBe('stale');
    expect(readiness.campaigns.status).toBe('stale');
  });

  it('prefers explicit metaAccounts over globalClientStatus when both are given', () => {
    const readiness = evaluateClientOperationalReadiness(
      baseInput({ metaAccounts: [], globalClientStatus: 'available' })
    );
    expect(readiness.meta.status).toBe('blocked');
    expect(readiness.meta.action).toBe('Vincular conta Meta');
  });
});

describe('summarizeMetaReadinessAcrossClients', () => {
  it('flags allDegraded only when nobody is ready', () => {
    const summary = summarizeMetaReadinessAcrossClients([
      { status: 'partial', warnings: ['Leitura parcial — análise limitada'] },
      { status: 'failed', warnings: ['Última sincronização falhou'] },
    ]);
    expect(summary.allDegraded).toBe(true);
    expect(summary.partialCount).toBe(1);
    expect(summary.failedCount).toBe(1);
  });

  it('is not allDegraded when at least one client is ready', () => {
    const summary = summarizeMetaReadinessAcrossClients([
      { status: 'ready', warnings: [] },
      { status: 'partial', warnings: ['Leitura parcial — análise limitada'] },
    ]);
    expect(summary.allDegraded).toBe(false);
  });

  it('picks the most frequent warning as the dominant cause', () => {
    const summary = summarizeMetaReadinessAcrossClients([
      { status: 'partial', warnings: ['Leitura parcial — análise limitada'] },
      { status: 'partial', warnings: ['Leitura parcial — análise limitada'] },
      { status: 'failed', warnings: ['Última sincronização falhou'] },
    ]);
    expect(summary.dominantCause).toBe('Leitura parcial — análise limitada');
  });
});

describe('buildReadinessSummaryMessage', () => {
  it('lists missing prerequisites when blocked', () => {
    const readiness = evaluateClientOperationalReadiness(
      baseInput({ analysisProfile: null, metaAccounts: [] })
    );
    const message = buildReadinessSummaryMessage(readiness);
    expect(message).toContain('Este cliente ainda não pode ser analisado');
    expect(message).toContain('perfil de análise não configurado');
  });

  it('surfaces warnings when in attention state', () => {
    const readiness = evaluateClientOperationalReadiness(
      baseInput({
        metaAccounts: [
          makeAccount({
            lastSuccess: null,
            lastAttempt: { id: 'run-6', status: 'partial', period: 'this_month', level: 'campaign', scope: 'full_account', startedAt: '2026-07-15T11:00:00.000Z', finishedAt: '2026-07-15T11:05:00.000Z' },
          }),
        ],
      })
    );
    const message = buildReadinessSummaryMessage(readiness);
    expect(message).toContain('Leitura parcial');
  });

  it('reports readiness plainly when everything is ready', () => {
    const readiness = evaluateClientOperationalReadiness(baseInput());
    expect(buildReadinessSummaryMessage(readiness)).toBe('Cliente pronto para análise.');
  });

  it('reports inactive clients distinctly', () => {
    const readiness = evaluateClientOperationalReadiness(baseInput({ client: baseClient('paused') }));
    expect(buildReadinessSummaryMessage(readiness)).toBe('Cliente ou projeto inativo — fora da operação principal.');
  });
});
