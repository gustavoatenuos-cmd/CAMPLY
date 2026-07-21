import { isSupabaseConfigured } from '../supabase';
import { isMetaE2EMode } from '../meta/metaE2ERuntime';
import { withTimeout } from '../withTimeout';
import { invokeFunction } from '../invokeFunction';

export const ANALYTICS_CONTRACT_VERSION = 5;

export const dashboardPeriods = ['today', 'yesterday', 'today_and_yesterday', 'last_7d', 'last_30d', 'last_90d'] as const;
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
  | { mode: 'compatibility'; reason: AnalyticsCompatibilityReason; technicalMessage?: string };

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
    return {
      mode: 'compatibility',
      reason: 'capability_contract_incompatible',
      technicalMessage: 'O valor retornado pelo backend não é um objeto JSON válido.',
    };
  }

  const contractVersion = Number(value.contractVersion);
  const supportedPeriods = supportedValues(value.supportedPeriods, dashboardPeriods);
  const supportedLevels = supportedValues(value.supportedLevels, analyticsLevels);

  const errors: string[] = [];
  if (!Number.isInteger(contractVersion)) errors.push('contractVersion não é um inteiro');
  else if (contractVersion !== ANALYTICS_CONTRACT_VERSION) {
    errors.push(`contractVersion incompatível: esperado ${ANALYTICS_CONTRACT_VERSION}, recebido ${contractVersion}`);
  }
  if (value.dashboardAvailable !== true) errors.push('dashboardAvailable não é true');
  if (value.dashboardRpc !== 'get_global_performance_dashboard_v2') {
    errors.push(`dashboardRpc incompatível: esperado get_global_performance_dashboard_v2, recebido ${String(value.dashboardRpc)}`);
  }
  if (value.traceableMetrics !== true) errors.push('traceableMetrics não é true');
  if (supportedPeriods.length === 0) errors.push('Nenhum período de dashboard suportado correspondente');
  if (supportedLevels.length === 0) errors.push('Nenhum nível analítico suportado correspondente');

  if (errors.length > 0) {
    return {
      mode: 'compatibility',
      reason: 'capability_contract_incompatible',
      technicalMessage: `Incompatibilidades de contrato: ${errors.join(', ')}`,
    };
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
    if (!isSupabaseConfigured) {
      return { data: null, error: { code: 'SUPABASE_NOT_CONFIGURED' } };
    }
    try {
      const response = await invokeFunction<{ capabilities: unknown }>(
        'analytics-dashboard',
        { action: 'capabilities' },
        12_000
      );
      return { data: response.capabilities, error: null };
    } catch (error) {
      return {
        data: null,
        error: {
          code: 'ANALYTICS_EDGE_UNAVAILABLE',
          message: error instanceof Error ? error.message : 'Analytics Edge unavailable',
        },
      };
    }
  },
  timeoutMs = 15_000
): Promise<AnalyticsCapabilityState> {
  if (isMetaE2EMode) {
    return parseAnalyticsCapabilities({
      contractVersion: ANALYTICS_CONTRACT_VERSION,
      dashboardAvailable: true,
      dashboardRpc: 'get_global_performance_dashboard_v2',
      supportedPeriods: dashboardPeriods,
      supportedLevels: analyticsLevels,
      targetsAvailable: true,
      reconciliationAvailable: true,
      traceableMetrics: true,
    });
  }
  try {
    const { data, error } = await withTimeout(
      rpc(),
      timeoutMs,
      'A verificação do contrato analítico demorou mais que o esperado.'
    );
    if (error) {
      if (error.code === 'SUPABASE_NOT_CONFIGURED') {
        return {
          mode: 'compatibility',
          reason: 'supabase_not_configured',
          technicalMessage: 'Erro: Supabase não está configurado localmente.',
        };
      }
      return {
        mode: 'compatibility',
        reason: isMissingCapabilityRpc(error)
          ? 'capability_contract_missing'
          : 'capability_contract_unavailable',
        technicalMessage: `Erro do banco: ${error.code || 'sem código'} · ${error.message || 'sem mensagem'}`,
      };
    }
    return parseAnalyticsCapabilities(data);
  } catch (err) {
    return {
      mode: 'compatibility',
      reason: 'capability_contract_unavailable',
      technicalMessage: `Exceção capturada: ${err instanceof Error ? err.message : String(err)}`,
    };
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
