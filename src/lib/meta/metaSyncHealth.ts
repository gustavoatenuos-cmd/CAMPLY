import type { MetaRunSummary } from './clientMetaAssetService';
import type { BulkSyncAccountResult } from './bulkSyncDiagnostics';

export type MetaSyncHealthState = 'updated' | 'delayed' | 'needs_retry' | 'running' | 'not_synced';

export interface MetaSyncHealth {
  state: MetaSyncHealthState;
  label: string;
  detail: string;
  tone: 'success' | 'warning' | 'danger' | 'info' | 'muted';
  retryRecommended: boolean;
  lagDays: number | null;
  returnedDateStop: string | null;
  expectedDateStop: string | null;
}

type RunMetadata = {
  error_message?: unknown;
  collection_errors?: unknown;
  collection_warnings?: unknown;
  range_diagnostics_by_period?: Record<string, {
    expectedDateStop?: unknown;
    returnedDateStop?: unknown;
  }>;
  sync_reconciliation?: {
    range_diagnostics_by_period?: Record<string, {
      expectedDateStop?: unknown;
      returnedDateStop?: unknown;
    }>;
  };
};

const RANGE_LAG_PATTERN = /range differs from local expectation/i;
const HARD_COLLECTION_ERROR_PATTERN =
  /ad collection|meta api error|unknown error|timeout|timed out|rate[_ -]?limit|validation_error|failed to|network|fetch failed/i;

function metadataOf(run: MetaRunSummary): RunMetadata {
  return run.metadata && typeof run.metadata === 'object'
    ? run.metadata as RunMetadata
    : {};
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : [];
}

function parseIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function calendarDayDiff(expected: string | null, returned: string | null): number | null {
  if (!expected || !returned) return null;
  const [ey, em, ed] = expected.split('-').map(Number);
  const [ry, rm, rd] = returned.split('-').map(Number);
  const expectedMs = Date.UTC(ey, em - 1, ed);
  const returnedMs = Date.UTC(ry, rm - 1, rd);
  const diff = Math.round((expectedMs - returnedMs) / 86_400_000);
  return diff >= 0 ? diff : null;
}

function brDate(value: string | null): string | null {
  if (!value) return null;
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function rangeForRun(run: MetaRunSummary): {
  expectedDateStop: string | null;
  returnedDateStop: string | null;
} {
  const metadata = metadataOf(run);
  const primary = metadata.range_diagnostics_by_period?.[run.period];
  const fallback = metadata.sync_reconciliation?.range_diagnostics_by_period?.[run.period];
  return {
    expectedDateStop: parseIsoDate(primary?.expectedDateStop ?? fallback?.expectedDateStop ?? run.dateStop),
    returnedDateStop: parseIsoDate(primary?.returnedDateStop ?? fallback?.returnedDateStop ?? run.dateStop),
  };
}

function runMessages(run: MetaRunSummary): {
  errorMessage: string;
  warnings: string[];
  errors: string[];
} {
  const metadata = metadataOf(run);
  return {
    errorMessage: run.errorMessage || textValue(metadata.error_message),
    warnings: stringArray(metadata.collection_warnings),
    errors: stringArray(metadata.collection_errors),
  };
}

function isRangeLagOnly(run: MetaRunSummary): boolean {
  const { errorMessage, warnings, errors } = runMessages(run);
  const combined = [errorMessage, ...warnings].join(' ');
  if (!RANGE_LAG_PATTERN.test(combined)) return false;
  if (errors.length > 0) return false;
  if (HARD_COLLECTION_ERROR_PATTERN.test(combined.replace(RANGE_LAG_PATTERN, ''))) return false;

  const { expectedDateStop, returnedDateStop } = rangeForRun(run);
  const lagDays = calendarDayDiff(expectedDateStop, returnedDateStop);
  return lagDays !== null && lagDays > 0;
}

function delayedHealth(run: MetaRunSummary): MetaSyncHealth {
  const { expectedDateStop, returnedDateStop } = rangeForRun(run);
  const lagDays = calendarDayDiff(expectedDateStop, returnedDateStop);
  const returnedLabel = brDate(returnedDateStop);
  const expectedLabel = brDate(expectedDateStop);

  return {
    state: 'delayed',
    label: lagDays === 1
      ? 'Atualizada até ontem'
      : lagDays && lagDays > 1
        ? `Meta com atraso de ${lagDays} dias`
        : 'Meta ainda consolidando dados',
    detail: returnedLabel && expectedLabel
      ? `Dados disponíveis até ${returnedLabel}. A Meta ainda não entregou ${expectedLabel}.`
      : 'A Meta ainda está consolidando o fim do período. Os dados já recebidos permanecem disponíveis.',
    tone: 'warning',
    retryRecommended: false,
    lagDays,
    returnedDateStop,
    expectedDateStop,
  };
}

function retryHealth(run: MetaRunSummary): MetaSyncHealth {
  const { errorMessage, errors } = runMessages(run);
  const isCreativeDepth = ['ad', 'creative'].includes((run.level || '').toLowerCase());
  const rawReason = errors[0] || errorMessage || run.terminationReason || 'A coleta não foi concluída.';

  return {
    state: 'needs_retry',
    label: isCreativeDepth ? 'Criativos precisam de nova tentativa' : 'Coleta precisa de nova tentativa',
    detail: HARD_COLLECTION_ERROR_PATTERN.test(rawReason)
      ? rawReason
      : 'A coleta terminou incompleta. Tente novamente para completar os dados.',
    tone: 'danger',
    retryRecommended: true,
    lagDays: null,
    returnedDateStop: rangeForRun(run).returnedDateStop,
    expectedDateStop: rangeForRun(run).expectedDateStop,
  };
}

export function describeMetaRunHealth(run: MetaRunSummary | null): MetaSyncHealth {
  if (!run) {
    return {
      state: 'not_synced',
      label: 'Aguardando primeira atualização',
      detail: 'Ainda não existe uma coleta registrada para esta conta.',
      tone: 'muted',
      retryRecommended: false,
      lagDays: null,
      returnedDateStop: null,
      expectedDateStop: null,
    };
  }

  if (run.status === 'running') {
    return {
      state: 'running',
      label: 'Atualizando agora',
      detail: 'O CAMPLY está buscando os dados mais recentes em segundo plano.',
      tone: 'info',
      retryRecommended: false,
      lagDays: null,
      returnedDateStop: rangeForRun(run).returnedDateStop,
      expectedDateStop: rangeForRun(run).expectedDateStop,
    };
  }

  if (isRangeLagOnly(run)) return delayedHealth(run);

  if (run.status === 'partial' || run.status === 'failed') return retryHealth(run);

  return {
    state: 'updated',
    label: 'Atualizada',
    detail: run.finishedAt
      ? `Última atualização concluída em ${new Date(run.finishedAt).toLocaleString('pt-BR')}.`
      : 'A última atualização foi concluída.',
    tone: 'success',
    retryRecommended: false,
    lagDays: 0,
    returnedDateStop: rangeForRun(run).returnedDateStop,
    expectedDateStop: rangeForRun(run).expectedDateStop,
  };
}

export function describeBulkSyncResult(result: BulkSyncAccountResult): MetaSyncHealth {
  if (result.status === 'running' || result.status === 'already_running') {
    return {
      state: 'running',
      label: 'Atualizando agora',
      detail: result.message || 'A sincronização está em andamento.',
      tone: 'info',
      retryRecommended: false,
      lagDays: null,
      returnedDateStop: null,
      expectedDateStop: null,
    };
  }

  const message = result.error || result.message || '';
  if (
    result.status === 'partial'
    && RANGE_LAG_PATTERN.test(message)
    && !HARD_COLLECTION_ERROR_PATTERN.test(message.replace(RANGE_LAG_PATTERN, ''))
  ) {
    return {
      state: 'delayed',
      label: 'Meta ainda consolidando dados',
      detail: message,
      tone: 'warning',
      retryRecommended: false,
      lagDays: null,
      returnedDateStop: null,
      expectedDateStop: null,
    };
  }

  if (result.status === 'failed' || result.status === 'partial') {
    const isCreativeError = /ad collection|creative/i.test(message);
    return {
      state: 'needs_retry',
      label: isCreativeError ? 'Criativos precisam de nova tentativa' : 'Coleta precisa de nova tentativa',
      detail: message || 'A coleta não foi concluída.',
      tone: 'danger',
      retryRecommended: true,
      lagDays: null,
      returnedDateStop: null,
      expectedDateStop: null,
    };
  }

  return {
    state: 'updated',
    label: 'Atualizada',
    detail: result.message || 'Atualização concluída.',
    tone: 'success',
    retryRecommended: false,
    lagDays: 0,
    returnedDateStop: null,
    expectedDateStop: null,
  };
}
