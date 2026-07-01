import { isSupabaseConfigured, supabase } from '../supabase';

export const ANALYTICS_CONTRACT_VERSION = 2;

export const dashboardPeriods = ['today', 'last_7d', 'last_30d'] as const;
export type DashboardPeriod = typeof dashboardPeriods[number];

export const analyticsLevels = ['campaign', 'adset', 'ad'] as const;
export type AnalyticsLevel = typeof analyticsLevels[number];

export interface AnalyticsCapabilities {
  contractVersion: number;
  dashboardAvailable: true;
  dashboardRpc: 'get_global_performance_dashboard_v2';
  supportedPeriods: DashboardPeriod[];
  supportedLevels: AnalyticsLevel[];
  targetsAvailable: boolean;
  reconciliationAvailable: boolean;
  traceableMetrics: true;
}

export type AnalyticsCompatibilityReason =
  | 'supabase_not_configured'
  | 'capability_contract_missing'
  | 'capability_contract_unavailable'
  | 'capability_contract_incompatible';

export type AnalyticsCapabilityState =
  | { mode: 'analytics'; capabilities: AnalyticsCapabilities }
  | { mode: 'compatibility'; reason: AnalyticsCompatibilityReason };

type CapabilityRpcResult = Promise<{
  data: unknown;
  error: { code?: string; message?: string } | null;
}>;

type CapabilityRpc = () => CapabilityRpcResult;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function supportedValues<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  if (!Array.isArray(value)) return [];
  const allowedSet = new Set<string>(allowed);
  return Array.from(new Set(value.filter((item): item is T => (
    typeof item === 'string' && allowedSet.has(item)
  ))));
}

export function parseAnalyticsCapabilities(value: unknown): AnalyticsCapabilityState {
  if (!isRecord(value)) {
    return { mode: 'compatibility', reason: 'capability_contract_incompatible' };
  }

  const contractVersion = Number(value.contractVersion);
  const supportedPeriods = supportedValues(value.supportedPeriods, dashboardPeriods);
  const supportedLevels = supportedValues(value.supportedLevels, analyticsLevels);

  if (
    !Number.isInteger(contractVersion)
    || contractVersion !== ANALYTICS_CONTRACT_VERSION
    || value.dashboardAvailable !== true
    || value.dashboardRpc !== 'get_global_performance_dashboard_v2'
    || value.traceableMetrics !== true
    || supportedPeriods.length === 0
    || supportedLevels.length === 0
  ) {
    return { mode: 'compatibility', reason: 'capability_contract_incompatible' };
  }

  return {
    mode: 'analytics',
    capabilities: {
      contractVersion,
      dashboardAvailable: true,
      dashboardRpc: 'get_global_performance_dashboard_v2',
      supportedPeriods,
      supportedLevels,
      targetsAvailable: value.targetsAvailable === true,
      reconciliationAvailable: value.reconciliationAvailable === true,
      traceableMetrics: true,
    },
  };
}

function isMissingCapabilityRpc(error: { code?: string; message?: string }): boolean {
  const message = (error.message || '').toLowerCase();
  return error.code === 'PGRST202'
    || message.includes('get_analytics_capabilities')
    || message.includes('schema cache')
    || message.includes('could not find the function');
}

export async function loadAnalyticsCapabilities(
  rpc: CapabilityRpc = async () => {
    if (!isSupabaseConfigured || !supabase) {
      return { data: null, error: { code: 'SUPABASE_NOT_CONFIGURED' } };
    }
    return supabase.rpc('get_analytics_capabilities');
  }
): Promise<AnalyticsCapabilityState> {
  try {
    const { data, error } = await rpc();
    if (error) {
      if (error.code === 'SUPABASE_NOT_CONFIGURED') {
        return { mode: 'compatibility', reason: 'supabase_not_configured' };
      }
      return {
        mode: 'compatibility',
        reason: isMissingCapabilityRpc(error)
          ? 'capability_contract_missing'
          : 'capability_contract_unavailable',
      };
    }
    return parseAnalyticsCapabilities(data);
  } catch {
    return { mode: 'compatibility', reason: 'capability_contract_unavailable' };
  }
}

export function compatibilityReasonMessage(reason: AnalyticsCompatibilityReason): string {
  const messages: Record<AnalyticsCompatibilityReason, string> = {
    supabase_not_configured: 'O backend analítico não está configurado neste ambiente.',
    capability_contract_missing: 'A versão segura do contrato analítico ainda não foi ativada neste banco.',
    capability_contract_unavailable: 'O contrato analítico não pôde ser verificado agora.',
    capability_contract_incompatible: 'A versão disponível do contrato analítico não é compatível com esta interface.',
  };
  return messages[reason];
}
