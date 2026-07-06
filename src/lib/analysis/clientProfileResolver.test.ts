import { describe, expect, it } from 'vitest';
import type { Client } from '../../types';
import type { GlobalClientPerformance } from '../performance/globalPerformanceDashboard';
import { resolveClientProfile } from './clientProfileResolver';

function performance(overrides: Partial<GlobalClientPerformance> = {}): GlobalClientPerformance {
  return {
    clientId: 'client_1',
    clientName: 'Cliente sem contexto',
    clientStatus: 'not_connected',
    accounts: [],
    metrics: {},
    metricGroups: [],
    resolvedTargets: [],
    evaluations: [],
    budgetPacing: null,
    score: {
      value: null,
      status: 'unavailable',
      confidence: 0,
      coveragePercent: 0,
      summary: 'Score indisponível.',
      signals: [],
    },
    dataQuality: { status: 'unavailable', reason: 'meta_account_not_linked' },
    lastSuccessfulRun: null,
    lastAttempt: null,
    hasNewerPartial: false,
    hasNewerFailure: false,
    analysisProfile: null,
    ...overrides,
  };
}

function workspaceClient(overrides: Partial<Client> = {}): Client {
  return {
    id: 'client_1',
    projectId: '',
    name: 'Responsável',
    company: 'Empresa',
    segment: '',
    structure: '',
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
    ...overrides,
  };
}

describe('resolveClientProfile', () => {
  it('confirms segment from the official analysis profile', () => {
    const result = resolveClientProfile(performance({
      analysisProfile: {
        clientId: 'client_1',
        vertical: 'Saúde',
        subsegment: 'Odontologia',
        customVertical: null,
        customSubsegment: null,
        businessModel: 'negócio local',
        primaryConversionMetric: 'messaging_conversations_started_total',
        secondaryMetrics: [],
        primaryChannel: 'WhatsApp',
        budgetPeriod: 'monthly',
        plannedBudget: 1000,
        minimumEvaluationSpend: 0,
        minimumImpressions: 0,
        minimumResults: 0,
        attributionDelayHours: 24,
        analysisEnabled: true,
      },
    }));

    expect(result).toMatchObject({
      detectedSegment: 'Saúde',
      detectedSubsegment: 'Odontologia',
      confidence: 1,
      source: 'analysis_profile',
      status: 'confirmed',
    });
  });

  it('suggests odontology from Meta account name', () => {
    const result = resolveClientProfile(performance({
      accounts: [{
        clientMetaAssetId: 'link_1',
        metaAssetId: 'asset_1',
        integrationId: 'integration_1',
        adAccountId: 'act_1',
        accountName: 'Odonto Implantes Premium',
        currency: 'BRL',
        timezone: 'America/Sao_Paulo',
        dateStart: null,
        dateStop: null,
        metrics: {},
        budgetPacing: null,
        dataQuality: { status: 'unavailable', reason: 'sync_not_started' },
        lastSuccessfulRun: null,
        lastAttempt: null,
      }],
    }));

    expect(result).toMatchObject({
      detectedSegment: 'Saúde',
      detectedSubsegment: 'Odontologia',
      source: 'meta_account_name',
      status: 'suggested',
    });
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('uses campaign keywords as a suggested source', () => {
    const result = resolveClientProfile(performance({
      metricGroups: [{
        clientMetaAssetId: 'link_1',
        metaAssetId: 'asset_1',
        currency: 'BRL',
        campaignId: 'campaign_1',
        campaignName: 'Avaliação para implante e prótese',
        classifiedObjective: 'LEADS',
        destinationType: 'WHATSAPP',
        attributionSetting: '7d_click_1d_view',
        spend: null,
        completenessStatus: null,
        metrics: {},
      }],
    }));

    expect(result).toMatchObject({
      detectedSegment: 'Saúde',
      detectedSubsegment: 'Odontologia',
      source: 'campaign_name',
      status: 'suggested',
    });
  });

  it('keeps insufficient information pending instead of guessing', () => {
    const result = resolveClientProfile(
      performance({ clientName: 'Cliente institucional' }),
      workspaceClient({ company: 'ABC Consultoria', segment: '' })
    );

    expect(result).toMatchObject({
      detectedSegment: null,
      detectedSubsegment: null,
      confidence: 0,
      source: 'missing',
      status: 'pending',
    });
    expect(result.missingReasons).toContain('Cliente sem segmento/subsegmento definido');
  });
});
