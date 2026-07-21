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

const E2E_STATE_KEY = 'camply:meta-e2e:runtime';

function initialMetaE2EState(): E2EState {
  return {
    linked: false,
    syncedPeriods: new Set<DashboardPeriod>(['last_90d']),
    targets: [],
  };
}

function storedMetaE2EState(): E2EState | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(E2E_STATE_KEY) || 'null') as {
      linked?: boolean;
      syncedPeriods?: DashboardPeriod[];
      targets?: Array<Record<string, unknown>>;
    } | null;
    if (!stored) return null;
    return {
      linked: stored.linked === true,
      syncedPeriods: new Set(stored.syncedPeriods?.length ? stored.syncedPeriods : ['last_90d']),
      targets: Array.isArray(stored.targets) ? stored.targets : [],
    };
  } catch {
    return null;
  }
}

export const metaE2EState: E2EState = {
  ...(storedMetaE2EState() ?? initialMetaE2EState()),
};

export function resetMetaE2EState() {
  const initial = initialMetaE2EState();
  metaE2EState.linked = initial.linked;
  metaE2EState.syncedPeriods = initial.syncedPeriods;
  metaE2EState.targets = initial.targets;
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(E2E_STATE_KEY);
}

export function restoreMetaE2EState() {
  const stored = storedMetaE2EState();
  if (!stored) return;
  metaE2EState.linked = stored.linked;
  metaE2EState.syncedPeriods = stored.syncedPeriods;
  metaE2EState.targets = stored.targets;
}

export function persistMetaE2EState() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(E2E_STATE_KEY, JSON.stringify({
    linked: metaE2EState.linked,
    syncedPeriods: Array.from(metaE2EState.syncedPeriods),
    targets: metaE2EState.targets,
  }));
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
