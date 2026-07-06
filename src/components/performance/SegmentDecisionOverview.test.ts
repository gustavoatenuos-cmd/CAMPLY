import { describe, expect, it } from 'vitest';
import type { Client } from '../../types';
import type { GlobalClientPerformance } from '../../lib/performance/globalPerformanceDashboard';
import { unavailableTraceableMetric } from '../../lib/performance/traceableMetrics';
import { buildSegmentSummaries } from './SegmentDecisionOverview';

const spendMetric = (value: number, currency: string) => ({
  ...unavailableTraceableMetric('spend'),
  value,
  available: true,
  currency,
  completenessStatus: 'complete' as const,
});

function client(
  clientId: string,
  overrides: Partial<GlobalClientPerformance> = {}
): GlobalClientPerformance {
  return {
    clientId,
    clientName: clientId,
    clientStatus: 'available',
    accounts: [],
    metrics: {},
    metricGroups: [],
    resolvedTargets: [],
    evaluations: [],
    budgetPacing: null,
    score: {
      value: 80,
      status: 'healthy',
      confidence: 80,
      coveragePercent: 100,
      summary: 'Operação saudável.',
      signals: [],
    },
    dataQuality: { status: 'complete', reason: null },
    lastSuccessfulRun: null,
    lastAttempt: null,
    hasNewerPartial: false,
    hasNewerFailure: false,
    ...overrides,
  };
}

describe('buildSegmentSummaries', () => {
  it('groups by configured profile and keeps currencies separated', () => {
    const clients = [
      client('clinica-a', {
        accounts: [{
          clientMetaAssetId: 'link-brl',
          metaAssetId: 'asset-brl',
          integrationId: 'integration',
          adAccountId: 'act_1',
          accountName: 'Conta BRL',
          currency: 'BRL',
          timezone: 'America/Sao_Paulo',
          dateStart: '2026-07-01',
          dateStop: '2026-07-02',
          metrics: { spend: spendMetric(100, 'BRL') },
          budgetPacing: {
            clientMetaAssetId: 'link-brl',
            actualSpend: 100,
            targetDailyBudget: 100,
            expectedSpendUntilNow: 400,
            actualDailyAverage: 25,
            projectedMonthlySpend: 175,
            differenceValue: -300,
            differencePercent: -75,
            status: 'critical',
            currency: 'BRL',
            elapsedDays: 4,
            totalDays: 7,
          },
          dataQuality: { status: 'complete', reason: null },
          lastSuccessfulRun: null,
          lastAttempt: null,
        }],
        analysisProfile: {
          clientId: 'clinica-a',
          vertical: 'Saúde',
          subsegment: 'Odontologia',
          customVertical: null,
          customSubsegment: null,
          businessModel: 'negócio local',
          primaryConversionMetric: 'messaging_conversations_started_total',
          secondaryMetrics: ['cost_per_messaging_conversation'],
          primaryChannel: 'WhatsApp',
          budgetPeriod: 'weekly',
          plannedBudget: 700,
          minimumEvaluationSpend: 0,
          minimumImpressions: 0,
          minimumResults: 0,
          attributionDelayHours: 24,
          analysisEnabled: true,
        },
      }),
      client('clinica-b', {
        accounts: [{
          clientMetaAssetId: 'link-usd',
          metaAssetId: 'asset-usd',
          integrationId: 'integration',
          adAccountId: 'act_2',
          accountName: 'Conta USD',
          currency: 'USD',
          timezone: 'America/Sao_Paulo',
          dateStart: '2026-07-01',
          dateStop: '2026-07-02',
          metrics: { spend: spendMetric(50, 'USD') },
          budgetPacing: null,
          dataQuality: { status: 'complete', reason: null },
          lastSuccessfulRun: null,
          lastAttempt: null,
        }],
        analysisProfile: {
          clientId: 'clinica-b',
          vertical: 'Saúde',
          subsegment: 'Estética',
          customVertical: null,
          customSubsegment: null,
          businessModel: 'negócio local',
          primaryConversionMetric: 'leads',
          secondaryMetrics: ['cost_per_lead'],
          primaryChannel: 'Site',
          budgetPeriod: 'monthly',
          plannedBudget: 1000,
          minimumEvaluationSpend: 0,
          minimumImpressions: 0,
          minimumResults: 0,
          attributionDelayHours: 24,
          analysisEnabled: true,
        },
      }),
      client('sem-config', {
        analysisProfile: {
          clientId: 'sem-config',
          vertical: 'Varejo local',
          subsegment: '',
          customVertical: null,
          customSubsegment: null,
          businessModel: 'modelo misto',
          primaryConversionMetric: 'purchases',
          secondaryMetrics: [],
          primaryChannel: 'Misto',
          budgetPeriod: 'monthly',
          plannedBudget: null,
          minimumEvaluationSpend: 0,
          minimumImpressions: 0,
          minimumResults: 0,
          attributionDelayHours: 24,
          analysisEnabled: true,
        },
      }),
      client('custom-segment', {
        analysisProfile: {
          clientId: 'custom-segment',
          vertical: 'Outros',
          subsegment: 'Outros',
          customVertical: 'Turismo',
          customSubsegment: 'Agência de viagens',
          businessModel: 'geração de leads',
          primaryConversionMetric: 'leads',
          secondaryMetrics: ['cost_per_lead'],
          primaryChannel: 'Site',
          budgetPeriod: 'monthly',
          plannedBudget: 2000,
          minimumEvaluationSpend: 0,
          minimumImpressions: 0,
          minimumResults: 0,
          attributionDelayHours: 24,
          analysisEnabled: true,
        },
      }),
    ];

    const { summaries, pending, pendingByClient } = buildSegmentSummaries(clients, [] as Client[]);
    const saude = summaries.find((summary) => summary.vertical === 'Saúde');

    expect(saude?.clients).toHaveLength(2);
    expect(saude?.subsegments).toEqual(new Set(['Odontologia', 'Estética']));
    expect(saude?.plannedBudgetByCurrency.get('BRL')).toBe(700);
    expect(saude?.plannedBudgetByCurrency.get('USD')).toBe(1000);
    expect(saude?.spendByCurrency.get('BRL')).toBe(100);
    expect(saude?.spendByCurrency.get('USD')).toBe(50);
    expect(saude?.expectedSpendByCurrency.get('BRL')).toBe(400);
    expect(saude?.projectedSpendByCurrency.get('BRL')).toBe(175);
    expect(saude?.primaryMetrics).toEqual(new Set(['messaging_conversations_started_total', 'leads']));
    expect(summaries.find((summary) => summary.vertical === 'Turismo')?.subsegments).toEqual(new Set(['Agência de viagens']));
    expect(pending.map((item) => item.clientId)).toEqual(['clinica-a', 'clinica-b', 'sem-config', 'custom-segment']);
    expect(pendingByClient.get('clinica-a')).toContain('Sem metas');
    expect(pendingByClient.get('sem-config')).toEqual(expect.arrayContaining(['Sem subsegmento', 'Sem orçamento planejado', 'Sem conta Meta']));
  });

  it('uses manual client segment as a resolver fallback without hiding pending configuration', () => {
    const clients = [
      client('manual-clinic', {
        clientStatus: 'not_connected',
        dataQuality: { status: 'unavailable', reason: 'meta_account_not_linked' },
        score: {
          value: null,
          status: 'unavailable',
          confidence: 0,
          coveragePercent: 0,
          summary: 'Score indisponível.',
          signals: [],
        },
      }),
    ];
    const workspaceClients = [{
      id: 'manual-clinic',
      projectId: '',
      name: 'Dra. Ana',
      company: 'Clínica Odonto Sorriso',
      segment: 'Saúde',
      structure: 'WhatsApp',
      hasProject: false,
      contact: '',
      monthlyFee: 0,
      managementFeeType: 'recurring',
      dueDay: 10,
      adInvestmentPeriod: 'monthly',
      adInvestmentMeta: 0,
      adInvestmentGoogle: 0,
      adInvestmentYoutube: 0,
      adInvestmentTikTok: 0,
      status: 'active',
      notes: '',
    }] as Client[];

    const { summaries, pending, pendingByClient } = buildSegmentSummaries(clients, workspaceClients);
    const saude = summaries.find((summary) => summary.vertical === 'Saúde');

    expect(saude?.clients.map((item) => item.clientId)).toEqual(['manual-clinic']);
    expect(saude?.subsegments).toEqual(new Set(['Odontologia']));
    expect(saude?.noData).toBe(1);
    expect(pending.map((item) => item.clientId)).toEqual(['manual-clinic']);
    expect(pendingByClient.get('manual-clinic')).toEqual(expect.arrayContaining([
      'Sem perfil de análise',
      'Sem conta Meta',
      'Sem metas',
    ]));
    expect(pendingByClient.get('manual-clinic')).not.toEqual(expect.arrayContaining([
      'Sem segmento',
      'Sem subsegmento',
    ]));
  });

  it('keeps an unclassified client exclusively in pending configuration', () => {
    const unclassified = client('unclassified', {
      clientStatus: 'not_connected',
      dataQuality: { status: 'unavailable', reason: 'meta_account_not_linked' },
      score: {
        value: null,
        status: 'unavailable',
        confidence: 0,
        coveragePercent: 0,
        summary: 'Score indisponível.',
        signals: [],
      },
    });

    const { summaries, pending, pendingByClient } = buildSegmentSummaries([unclassified], []);

    expect(summaries.flatMap((summary) => summary.clients)).not.toContain(unclassified);
    expect(summaries.some((summary) => summary.key === 'Configuração pendente')).toBe(false);
    expect(pending.map((item) => item.clientId)).toEqual(['unclassified']);
    expect(pendingByClient.get('unclassified')).toEqual(expect.arrayContaining([
      'Sem segmento',
      'Sem subsegmento',
    ]));
  });

  it('never classifies an unavailable score as healthy', () => {
    const unavailable = client('no-score', {
      score: {
        value: null,
        status: 'unavailable',
        confidence: 0,
        coveragePercent: 0,
        summary: 'Score indisponível.',
        signals: [],
      },
      analysisProfile: {
        clientId: 'no-score',
        vertical: 'Saúde',
        subsegment: 'Odontologia',
        customVertical: null,
        customSubsegment: null,
        businessModel: 'negócio local',
        primaryConversionMetric: 'leads',
        secondaryMetrics: [],
        primaryChannel: 'Site',
        budgetPeriod: 'monthly',
        plannedBudget: 1000,
        minimumEvaluationSpend: 0,
        minimumImpressions: 0,
        minimumResults: 0,
        attributionDelayHours: 24,
        analysisEnabled: true,
      },
    });

    const { summaries } = buildSegmentSummaries([unavailable], []);
    const saude = summaries.find((summary) => summary.key === 'Saúde');

    expect(saude?.healthy).toBe(0);
    expect(saude?.noData).toBe(1);
  });
});
