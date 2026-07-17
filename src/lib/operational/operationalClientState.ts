import type { ClientAnalysisProfile } from '../analysis/clientAnalysisProfile';
import type { DashboardPeriod } from '../performance/analyticsCapabilities';
import type {
  DataQualityContract,
  GlobalClientPerformance,
  GlobalClientStatus,
  GlobalMetricGroup,
  MetricContract,
  RunSummary,
} from '../performance/globalPerformanceDashboard';
import type { OperationalEntry } from '../../data/receivablesForecast';
import {
  explainOperationalSyncState,
  type OperationalSyncExplanation,
} from './operationalSyncState';

export type OperationalSection<T> =
  | { status: 'not_evaluated' }
  | { status: 'absent'; value: null }
  | { status: 'available'; value: T };

export type OperationalReadinessStatus =
  | 'ready'
  | 'limited'
  | 'blocked'
  | 'inactive'
  | 'absent'
  | 'not_evaluated';

export interface OperationalReadinessArea {
  status: OperationalReadinessStatus;
  reasons: string[];
  nextAction: string | null;
}

export interface OperationalReadinessState {
  overall: OperationalReadinessArea;
  analytics: OperationalReadinessArea;
  sync: OperationalReadinessArea;
  profile: OperationalReadinessArea;
  finance: OperationalReadinessArea;
}

export interface OperationalEvidence {
  source: 'input' | 'analysis_profile' | 'analytics_dashboard' | 'receivables';
  sourceId: string | null;
  period: DashboardPeriod | null;
  observedAt: string | null;
  confidence: 'trusted' | 'limited' | 'unknown';
}

export interface OperationalSyncEvidence {
  source: 'analytics_dashboard';
  selectedPeriod: DashboardPeriod;
  clientStatus: GlobalClientStatus;
  trustedRunId: string | null;
  latestAttemptId: string | null;
  dataQuality: DataQualityContract;
}

export interface OperationalSyncValue {
  clientStatus: GlobalClientStatus;
  trustedRun: RunSummary | null;
  latestAttempt: RunSummary | null;
  hasNewerPartial: boolean;
  hasNewerFailure: boolean;
  explanation: OperationalSyncExplanation;
  evidence: OperationalSyncEvidence;
}

export type OperationalSyncState =
  | { status: 'not_evaluated'; evidence: null }
  | { status: 'absent'; value: null; evidence: OperationalSyncEvidence | null }
  | ({ status: 'available' } & OperationalSyncValue);

export interface OperationalActualValue {
  metrics: Record<string, MetricContract>;
  metricGroups: GlobalMetricGroup[];
  dataQuality: DataQualityContract;
}

export type OperationalDiagnosisStatus = 'ready' | 'limited' | 'blocked' | 'not_evaluated';

export interface OperationalDiagnosis {
  status: OperationalDiagnosisStatus;
  mainMessage: string | null;
  reasons: string[];
  nextAction: string | null;
}

export interface OperationalClientState {
  clientId: string;
  clientName: string;
  selectedPeriod: DashboardPeriod;
  readiness: OperationalReadinessState;
  sync: OperationalSyncState;
  profile: OperationalSection<ClientAnalysisProfile>;
  actual: OperationalSection<OperationalActualValue>;
  diagnosis: OperationalDiagnosis;
  evidence: OperationalEvidence[];
}

export interface OperationalClientStateInput {
  clientId: string;
  clientName: string;
  selectedPeriod: DashboardPeriod;
  profile: ClientAnalysisProfile | null | undefined;
  performance: GlobalClientPerformance | null | undefined;
  receivables: OperationalEntry[] | null | undefined;
}

function section<T>(value: T | null | undefined): OperationalSection<T> {
  if (value === undefined) return { status: 'not_evaluated' };
  if (value === null) return { status: 'absent', value: null };
  return { status: 'available', value };
}

function readinessArea(
  status: OperationalReadinessStatus,
  reasons: string[] = [],
  nextAction: string | null = null,
): OperationalReadinessArea {
  return { status, reasons, nextAction };
}

function buildSyncState(
  performance: GlobalClientPerformance | null | undefined,
  selectedPeriod: DashboardPeriod,
): OperationalSyncState {
  if (performance === undefined) return { status: 'not_evaluated', evidence: null };
  if (performance === null) return { status: 'absent', value: null, evidence: null };

  const evidence: OperationalSyncEvidence = {
    source: 'analytics_dashboard',
    selectedPeriod,
    clientStatus: performance.clientStatus,
    trustedRunId: performance.lastSuccessfulRun?.id ?? null,
    latestAttemptId: performance.lastAttempt?.id ?? null,
    dataQuality: performance.dataQuality,
  };
  const firstAccount = performance.accounts[0];
  const explanation = explainOperationalSyncState({
    selectedPeriod,
    clientId: performance.clientId,
    clientName: performance.clientName,
    accounts: performance.accounts.map((account) => ({
      clientMetaAssetId: account.clientMetaAssetId,
      accountName: account.accountName,
    })),
    lastSuccessfulRun: performance.lastSuccessfulRun,
    lastAttempt: performance.lastAttempt,
    dataQuality: performance.dataQuality,
    requestedPeriod: selectedPeriod,
    exactRange: firstAccount
      ? { dateStart: firstAccount.dateStart, dateStop: firstAccount.dateStop }
      : null,
    metrics: performance.metrics,
  });

  return {
    status: 'available',
    clientStatus: performance.clientStatus,
    trustedRun: performance.lastSuccessfulRun,
    latestAttempt: performance.lastAttempt,
    hasNewerPartial: performance.hasNewerPartial,
    hasNewerFailure: performance.hasNewerFailure,
    explanation,
    evidence,
  };
}

function syncReadiness(sync: OperationalSyncState): OperationalReadinessArea {
  if (sync.status === 'not_evaluated') return readinessArea('not_evaluated');
  if (sync.status === 'absent') return readinessArea('absent', ['sync_absent'], 'Vincular ou sincronizar a conta Meta');

  switch (sync.explanation.status) {
    case 'success':
      return readinessArea('ready');
    case 'no_account':
      return readinessArea('blocked', ['sync_no_account'], sync.explanation.action);
    case 'not_synced':
      return readinessArea('blocked', ['sync_not_synced'], sync.explanation.action);
    case 'partial':
    case 'stale':
      return readinessArea('limited', [`sync_${sync.explanation.status}`], sync.explanation.action);
    case 'failed':
    default:
      return readinessArea('blocked', ['sync_failed'], sync.explanation.action);
  }
}
function profileReadiness(profile: OperationalSection<ClientAnalysisProfile>): OperationalReadinessArea {
  if (profile.status === 'not_evaluated') return readinessArea('not_evaluated');
  if (profile.status === 'absent') return readinessArea('absent', ['profile_absent'], 'Configurar metas do cliente');
  if (!profile.value.analysisEnabled || !profile.value.primaryConversionMetric) {
    return readinessArea('blocked', ['profile_incomplete'], 'Completar o perfil de análise');
  }
  return readinessArea('ready');
}

function financeReadiness(
  receivables: OperationalEntry[] | null | undefined,
): OperationalReadinessArea {
  if (receivables === undefined) return readinessArea('not_evaluated');
  if (receivables === null) return readinessArea('absent', ['receivables_absent'], 'Configurar recebimentos');
  if (receivables.filter((entry) => entry.active).length === 0) {
    return readinessArea('blocked', ['receivables_empty'], 'Configurar recebimentos');
  }
  return readinessArea('ready');
}

function analyticsReadiness(
  profile: OperationalReadinessArea,
  sync: OperationalReadinessArea,
): OperationalReadinessArea {
  if (profile.status === 'not_evaluated' || sync.status === 'not_evaluated') {
    return readinessArea('not_evaluated');
  }
  if (profile.status === 'absent' || profile.status === 'blocked') return profile;
  if (sync.status === 'absent' || sync.status === 'blocked') return sync;
  if (sync.status === 'limited') return readinessArea('limited', sync.reasons, sync.nextAction);
  return readinessArea('ready');
}

function overallReadiness(areas: OperationalReadinessArea[]): OperationalReadinessArea {
  const evaluated = areas.filter((area) => area.status !== 'not_evaluated');
  if (evaluated.length === 0) return readinessArea('not_evaluated');

  const blocked = evaluated.find((area) => area.status === 'blocked' || area.status === 'absent');
  if (blocked) return readinessArea('blocked', blocked.reasons, blocked.nextAction);

  const limited = evaluated.find((area) => area.status === 'limited');
  if (limited) return readinessArea('limited', limited.reasons, limited.nextAction);

  return readinessArea('ready');
}

function buildDiagnosis(readiness: OperationalReadinessState): OperationalDiagnosis {
  if (readiness.analytics.status === 'not_evaluated' && readiness.sync.status === 'not_evaluated') {
    return { status: 'not_evaluated', mainMessage: null, reasons: [], nextAction: null };
  }

  const reasons = Array.from(new Set([
    ...readiness.profile.reasons,
    ...readiness.sync.reasons,
    ...readiness.analytics.reasons,
  ]));
  if (readiness.analytics.status === 'blocked' || readiness.analytics.status === 'absent') {
    return {
      status: 'blocked',
      mainMessage: 'O cliente ainda não está pronto para análise.',
      reasons,
      nextAction: readiness.analytics.nextAction,
    };
  }
  if (readiness.analytics.status === 'limited') {
    return {
      status: 'limited',
      mainMessage: 'A análise está disponível com limitações.',
      reasons,
      nextAction: readiness.analytics.nextAction,
    };
  }
  if (readiness.analytics.status === 'ready') {
    return { status: 'ready', mainMessage: 'Cliente pronto para análise.', reasons, nextAction: null };
  }
  return { status: 'not_evaluated', mainMessage: null, reasons, nextAction: null };
}

function collectEvidence(
  input: OperationalClientStateInput,
  sync: OperationalSyncState,
): OperationalEvidence[] {
  const evidence: OperationalEvidence[] = [{
    source: 'input',
    sourceId: input.clientId,
    period: input.selectedPeriod,
    observedAt: null,
    confidence: 'trusted',
  }];

  if (input.profile !== undefined) {
    evidence.push({
      source: 'analysis_profile',
      sourceId: input.profile?.clientId ?? null,
      period: null,
      observedAt: null,
      confidence: input.profile === null ? 'trusted' : 'trusted',
    });
  }
  if (sync.status === 'available') {
    evidence.push({
      source: 'analytics_dashboard',
      sourceId: sync.trustedRun?.id ?? sync.latestAttempt?.id ?? null,
      period: input.selectedPeriod,
      observedAt: sync.latestAttempt?.finishedAt ?? sync.latestAttempt?.startedAt ?? null,
      confidence: sync.evidence.dataQuality.status === 'complete' ? 'trusted' : 'limited',
    });
  }
  if (input.receivables !== undefined) {
    evidence.push({
      source: 'receivables',
      sourceId: null,
      period: null,
      observedAt: null,
      confidence: 'trusted',
    });
  }
  return evidence;
}

export function buildOperationalClientState(
  input: OperationalClientStateInput,
): OperationalClientState {
  if (!input.selectedPeriod) throw new Error('selectedPeriod is required');

  const profile = section(input.profile);
  const sync = buildSyncState(input.performance, input.selectedPeriod);
  const actual = input.performance === undefined
    ? section<OperationalActualValue>(undefined)
    : input.performance === null
      ? section<OperationalActualValue>(null)
      : section<OperationalActualValue>({
          metrics: input.performance.metrics,
          metricGroups: input.performance.metricGroups,
          dataQuality: input.performance.dataQuality,
        });

  const profileArea = profileReadiness(profile);
  const syncArea = syncReadiness(sync);
  const financeArea = financeReadiness(input.receivables);
  const analyticsArea = analyticsReadiness(profileArea, syncArea);
  const readiness: OperationalReadinessState = {
    profile: profileArea,
    sync: syncArea,
    analytics: analyticsArea,
    finance: financeArea,
    overall: overallReadiness([analyticsArea, syncArea, profileArea, financeArea]),
  };

  return {
    clientId: input.clientId,
    clientName: input.clientName,
    selectedPeriod: input.selectedPeriod,
    readiness,
    sync,
    profile,
    actual,
    diagnosis: buildDiagnosis(readiness),
    evidence: collectEvidence(input, sync),
  };
}
