import { InvokeError } from '../invokeFunction';
import type { OperationalMetaSyncResult } from './metaSyncService';

export type BulkSyncAccountStatus = 'pending' | 'running' | 'success' | 'partial' | 'failed' | 'already_running';

export interface BulkSyncAccountResult {
  clientId: string;
  clientName: string;
  clientMetaAssetId: string;
  accountName: string;
  adAccountId: string;
  status: BulkSyncAccountStatus;
  runId?: string | null;
  message?: string;
  error?: string;
  errorCode?: string | null;
}

export interface BulkSyncProgress {
  total: number;
  completed: number;
  success: number;
  partial: number;
  failed: number;
  running: boolean;
  results: BulkSyncAccountResult[];
}

const ALREADY_RUNNING_FALLBACK_MESSAGE = 'Sincronização já em andamento.';
const PARTIAL_FALLBACK_MESSAGE = 'Sincronização parcial: alguns dados podem estar incompletos.';
const UNKNOWN_ERROR_MESSAGE = 'Falha desconhecida na sincronização.';
const ALREADY_RUNNING_PATTERN = /sincroniza[cç][aã]o j[aá] em andamento/i;

export interface BulkSyncAccountInput {
  clientId: string;
  clientName: string;
  clientMetaAssetId: string;
  accountName: string;
  adAccountId: string;
}

export function initializeBulkSyncProgress(accounts: BulkSyncAccountInput[]): BulkSyncProgress {
  return {
    total: accounts.length,
    completed: 0,
    success: 0,
    partial: 0,
    failed: 0,
    running: true,
    results: accounts.map((account) => ({ ...account, status: 'pending' })),
  };
}

/** Extracts a real, displayable message from whatever syncMetaAsset throws - never swallows it. */
export function extractSyncErrorMessage(error: unknown): string {
  if (error instanceof InvokeError) {
    return error.message || `Falha na sincronização (HTTP ${error.status}).`;
  }
  if (error instanceof Error) {
    return error.message || UNKNOWN_ERROR_MESSAGE;
  }
  return UNKNOWN_ERROR_MESSAGE;
}

/**
 * Maps a resolved (non-thrown) syncMetaAsset result onto a per-account status.
 * `partial` and `already_running` are explicitly NOT failures - only `failed`
 * (or a thrown error, handled separately) counts as one.
 */
export function classifySyncOutcome(
  result: OperationalMetaSyncResult
): Pick<BulkSyncAccountResult, 'status' | 'runId' | 'message' | 'error'> {
  if (result.status === 'running' || (result.message && ALREADY_RUNNING_PATTERN.test(result.message))) {
    return { status: 'already_running', runId: result.runId, message: result.message || ALREADY_RUNNING_FALLBACK_MESSAGE };
  }
  if (result.status === 'success') {
    return { status: 'success', runId: result.runId, message: result.message };
  }
  if (result.status === 'partial') {
    return { status: 'partial', runId: result.runId, message: result.message || PARTIAL_FALLBACK_MESSAGE };
  }
  const message = result.message || UNKNOWN_ERROR_MESSAGE;
  return { status: 'failed', runId: result.runId, message, error: message };
}

export function outcomeFromThrownError(error: unknown): Pick<BulkSyncAccountResult, 'status' | 'error' | 'runId' | 'errorCode'> {
  if (error instanceof InvokeError) {
    return {
      status: 'failed',
      error: extractSyncErrorMessage(error),
      runId: error.runId,
      errorCode: error.code,
    };
  }
  return { status: 'failed', error: extractSyncErrorMessage(error) };
}

function isTerminal(status: BulkSyncAccountStatus): boolean {
  return status === 'success' || status === 'partial' || status === 'failed' || status === 'already_running';
}

/**
 * Applies a per-account outcome patch immutably, keeping the aggregate
 * success/partial/failed/completed counters in sync with `results`.
 * `previousStatus` lets retries remove the old (failed) contribution before
 * adding the new one, instead of double counting.
 */
export function applyAccountOutcome(
  progress: BulkSyncProgress,
  clientMetaAssetId: string,
  patch: Partial<BulkSyncAccountResult> & { status: BulkSyncAccountStatus },
  previousStatus?: BulkSyncAccountStatus
): BulkSyncProgress {
  const results = progress.results.map((result) => (
    result.clientMetaAssetId === clientMetaAssetId ? { ...result, ...patch } : result
  ));

  let { completed, success, partial, failed } = progress;
  if (previousStatus && isTerminal(previousStatus)) {
    completed -= 1;
    if (previousStatus === 'success') success -= 1;
    else if (previousStatus === 'partial') partial -= 1;
    else if (previousStatus === 'failed') failed -= 1;
    // already_running only ever contributed to `completed`, nothing to undo here.
  }
  if (isTerminal(patch.status)) {
    completed += 1;
    if (patch.status === 'success') success += 1;
    else if (patch.status === 'partial') partial += 1;
    else if (patch.status === 'failed') failed += 1;
  }

  return { ...progress, results, completed, success, partial, failed };
}

function accountErrorText(result: BulkSyncAccountResult): string {
  return result.error || result.message || UNKNOWN_ERROR_MESSAGE;
}

/**
 * True only once the whole batch has finished and every single account
 * ended up failed. Requires `!running` and `completed === total` so accounts
 * still pending/running are never mistaken for failures.
 */
export function isBulkSyncAllFailed(progress: BulkSyncProgress): boolean {
  const alreadyRunning = progress.results.filter((result) => result.status === 'already_running').length;
  return !progress.running
    && progress.completed === progress.total
    && progress.completed > 0
    && progress.success === 0
    && progress.partial === 0
    && alreadyRunning === 0
    && progress.failed === progress.completed;
}

/** Builds the human-readable summary shown once the bulk sync finishes. */
export function buildBulkSyncSummaryMessage(progress: BulkSyncProgress): string {
  if (isBulkSyncAllFailed(progress)) {
    const distinctReasons = new Set(
      progress.results.filter((result) => result.status === 'failed').map(accountErrorText)
    );
    const base = 'Nenhuma conta foi sincronizada. Veja os erros abaixo.';
    return distinctReasons.size === 1
      ? `${base} Todas as contas falharam pelo mesmo motivo: ${Array.from(distinctReasons)[0]}`
      : base;
  }

  const alreadyRunning = progress.results.filter((result) => result.status === 'already_running').length;
  const parts = [`${progress.success} sucesso`];
  if (progress.partial > 0) parts.push(`${progress.partial} parcial`);
  if (alreadyRunning > 0) parts.push(`${alreadyRunning} em andamento`);
  if (progress.failed > 0) parts.push(`${progress.failed} falha`);
  return `Sincronização concluída: ${parts.join(', ')}.`;
}
