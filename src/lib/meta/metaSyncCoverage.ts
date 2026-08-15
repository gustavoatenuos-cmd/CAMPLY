import type { MetaRunSummary } from './clientMetaAssetService';

export interface MetaSyncCoverageView {
  dateStart: string | null;
  dateStop: string | null;
  coveredDays: number | null;
  lastSuccessfulAt: string | null;
  lastAttemptAt: string | null;
  status: 'complete' | 'partial' | 'failed' | 'running' | 'unknown';
  qualityLabel: string;
  limitationReason: string | null;
}
function isoDateValue(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = new Date(`${value}T12:00:00.000Z`).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function inclusiveDateRangeDays(dateStart: string | null | undefined, dateStop: string | null | undefined): number | null {
  const start = isoDateValue(dateStart);
  const stop = isoDateValue(dateStop);
  if (start === null || stop === null || stop < start) return null;
  return Math.floor((stop - start) / 86_400_000) + 1;
}

function effectiveTimestamp(run: MetaRunSummary | null): string | null {
  return run?.finishedAt || run?.startedAt || null;
}

export function buildMetaSyncCoverageView(
  lastSuccess: MetaRunSummary | null,
  lastAttempt: MetaRunSummary | null
): MetaSyncCoverageView {
  const latestStatus = lastAttempt?.status || lastSuccess?.status || 'unknown';
  const status = latestStatus === 'success' ? 'complete' : latestStatus;
  const newerIncomplete = Boolean(
    lastSuccess
    && lastAttempt
    && lastAttempt.id !== lastSuccess.id
    && new Date(effectiveTimestamp(lastAttempt) || 0).getTime() > new Date(effectiveTimestamp(lastSuccess) || 0).getTime()
    && lastAttempt.status !== 'success'
  );
  const limitationReason = newerIncomplete
    ? lastAttempt?.terminationReason || 'A tentativa mais recente não terminou completamente; o último intervalo confiável foi preservado.'
    : status !== 'complete'
      ? lastAttempt?.terminationReason || null
      : null;

  return {
    dateStart: lastSuccess?.dateStart ?? null,
    dateStop: lastSuccess?.dateStop ?? null,
    coveredDays: inclusiveDateRangeDays(lastSuccess?.dateStart, lastSuccess?.dateStop),
    lastSuccessfulAt: effectiveTimestamp(lastSuccess),
    lastAttemptAt: effectiveTimestamp(lastAttempt),
    status: newerIncomplete ? 'partial' : status,
    qualityLabel: newerIncomplete
      ? 'Último snapshot confiável preservado'
      : status === 'complete'
        ? 'Cobertura completa do run'
        : status === 'running'
          ? 'Sincronização em andamento'
          : status === 'partial'
            ? 'Cobertura parcial'
            : status === 'failed'
              ? 'Última tentativa falhou'
              : 'Sem cobertura validada',
    limitationReason,
  };
}
