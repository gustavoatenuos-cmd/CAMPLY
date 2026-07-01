import type { DashboardPeriod } from '../performance/analyticsCapabilities';
import { unavailableTraceableMetric, type TraceableMetric } from '../performance/traceableMetrics';
import type { CamplyData } from '../../types';

export const isMetaE2EMode = import.meta.env.VITE_META_E2E_MODE === 'true';

export const E2E_USER_ID = '00000000-0000-0000-0000-00000000e2e0';
export const E2E_CLIENT_ID = 'client-e2e';
export const E2E_LINK_ID = '10000000-0000-0000-0000-00000000e2e0';
export const E2E_ASSET_ID = '20000000-0000-0000-0000-00000000e2e0';

export const metaE2EWorkspace: CamplyData = {
  clients: [{
    id: E2E_CLIENT_ID,
    projectId: '',
    name: 'Marina',
    company: 'Clínica Mock',
    segment: 'Saúde',
    structure: 'WhatsApp e landing page',
    hasProject: false,
    contact: 'mock@camply.test',
    monthlyFee: 1500,
    managementFeeType: 'recurring',
    dueDay: 10,
    adInvestmentPeriod: 'monthly',
    adInvestmentMeta: 3000,
    adInvestmentGoogle: 0,
    adInvestmentYoutube: 0,
    adInvestmentTikTok: 0,
    status: 'active',
    notes: 'Fixture determinística de navegador.',
  }],
  campaigns: [],
  receivables: [],
  projects: [],
  tasks: [],
  activityLogs: [],
  agentRules: [],
  agentAlerts: [],
  agentLogs: [],
};

type E2EState = {
  linked: boolean;
  syncedPeriods: Set<DashboardPeriod>;
  targets: Array<Record<string, unknown>>;
};

export const metaE2EState: E2EState = {
  linked: false,
  syncedPeriods: new Set<DashboardPeriod>(['this_month']),
  targets: [],
};

export function resetMetaE2EState() {
  metaE2EState.linked = false;
  metaE2EState.syncedPeriods = new Set<DashboardPeriod>(['this_month']);
  metaE2EState.targets = [];
}

export function e2eMetric(
  metricId: string,
  value: number,
  level: 'account' | 'campaign' | 'adset' | 'ad',
  ids: { campaignId?: string; adsetId?: string; adId?: string } = {}
): TraceableMetric {
  return {
    ...unavailableTraceableMetric(metricId),
    metricId,
    value,
    available: true,
    currency: 'BRL',
    dateStart: '2026-07-01',
    dateStop: '2026-07-01',
    timezone: 'America/Sao_Paulo',
    sourceLevel: level,
    attributionSetting: '7d_click_1d_view',
    classifiedObjective: 'LEADS',
    destinationType: 'WHATSAPP',
    syncRunId: '30000000-0000-0000-0000-00000000e2e0',
    completenessStatus: 'complete',
    collectedAt: '2026-07-01T18:00:00.000Z',
    clientMetaAssetId: E2E_LINK_ID,
    accountId: 'act_e2e',
    accountName: 'Conta Meta Mock',
    campaignId: ids.campaignId || null,
    adsetId: ids.adsetId || null,
    adId: ids.adId || null,
    unavailableReason: null,
  };
}
