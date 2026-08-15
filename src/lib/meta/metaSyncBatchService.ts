import { supabaseData } from '../supabase';
import { withTimeout } from '../withTimeout';
import type {
  BulkSyncAccountResult,
  BulkSyncAccountStatus,
  BulkSyncProgress,
} from './bulkSyncDiagnostics';

export interface PersistedMetaSyncBatchItem extends BulkSyncAccountResult {
  id: string;
}

export interface PersistedMetaSyncBatch {
  id: string;
  status: 'running' | 'success' | 'partial' | 'failed';
  period: string;
  total: number;
  completed: number;
  success: number;
  partial: number;
  failed: number;
  startedAt: string;
  finishedAt: string | null;
  items: PersistedMetaSyncBatchItem[];
}

type RpcError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BATCH_CONTRACT_MISSING_CODES = new Set(['PGRST202', '42883', '42P01']);

function contractIsNotInstalled(error: RpcError): boolean {
  if (error.code && BATCH_CONTRACT_MISSING_CODES.has(error.code)) return true;
  return /could not find the function|does not exist|relation .* does not exist/i.test(
    `${error.message || ''} ${error.details || ''}`
  );
}

function parseStatus(value: unknown): BulkSyncAccountStatus {
  return value === 'pending'
    || value === 'running'
    || value === 'success'
    || value === 'partial'
    || value === 'failed'
    || value === 'already_running'
    ? value
    : 'failed';
}

function parseBatch(value: unknown): PersistedMetaSyncBatch | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Record<string, unknown>;
  if (typeof payload.id !== 'string' || !UUID_PATTERN.test(payload.id)) return null;
  const status = payload.status;
  if (status !== 'running' && status !== 'success' && status !== 'partial' && status !== 'failed') return null;

  const items = Array.isArray(payload.items) ? payload.items : [];
  return {
    id: payload.id,
    status,
    period: typeof payload.period === 'string' ? payload.period : 'last_90d',
    total: Number(payload.total) || 0,
    completed: Number(payload.completed) || 0,
    success: Number(payload.success) || 0,
    partial: Number(payload.partial) || 0,
    failed: Number(payload.failed) || 0,
    startedAt: typeof payload.startedAt === 'string' ? payload.startedAt : new Date(0).toISOString(),
    finishedAt: typeof payload.finishedAt === 'string' ? payload.finishedAt : null,
    items: items.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      if (typeof row.id !== 'string' || typeof row.clientMetaAssetId !== 'string') return [];
      return [{
        id: row.id,
        clientId: typeof row.clientId === 'string' ? row.clientId : '',
        clientName: typeof row.clientName === 'string' ? row.clientName : 'Cliente',
        clientMetaAssetId: row.clientMetaAssetId,
        accountName: typeof row.accountName === 'string' ? row.accountName : 'Conta Meta',
        adAccountId: typeof row.adAccountId === 'string' ? row.adAccountId : '',
        status: parseStatus(row.status),
        runId: typeof row.runId === 'string' ? row.runId : null,
        message: typeof row.message === 'string' ? row.message : undefined,
        error: typeof row.error === 'string' ? row.error : undefined,
        errorCode: typeof row.errorCode === 'string' ? row.errorCode : null,
      } satisfies PersistedMetaSyncBatchItem];
    }),
  };
}

async function callBatchRpc(
  name: string,
  params?: Record<string, unknown>
): Promise<PersistedMetaSyncBatch | null> {
  if (!supabaseData) return null;
  const { data, error } = await withTimeout(
    supabaseData.rpc(name, params),
    8_000,
    'A persistência do lote de sincronização demorou mais que o esperado.'
  );
  if (error) {
    if (contractIsNotInstalled(error)) return null;
    throw new Error(error.message || 'Não foi possível persistir o lote de sincronização.');
  }
  return parseBatch(data);
}

export function loadLatestMetaSyncBatch(): Promise<PersistedMetaSyncBatch | null> {
  return callBatchRpc('get_latest_meta_sync_batch');
}

export function startMetaSyncBatch(clientMetaAssetIds: string[]): Promise<PersistedMetaSyncBatch | null> {
  return callBatchRpc('start_meta_sync_batch', {
    p_client_meta_asset_ids: clientMetaAssetIds,
    p_period: 'last_90d',
  });
}

export function markMetaSyncBatchItemRunning(
  batchId: string,
  itemId: string
): Promise<PersistedMetaSyncBatch | null> {
  return callBatchRpc('mark_meta_sync_batch_item_running', {
    p_batch_id: batchId,
    p_item_id: itemId,
  });
}

export function finishMetaSyncBatchItem(
  batchId: string,
  itemId: string,
  outcome: Pick<BulkSyncAccountResult, 'status' | 'runId' | 'message' | 'error' | 'errorCode'>
): Promise<PersistedMetaSyncBatch | null> {
  const terminalStatus = outcome.status === 'success'
    || outcome.status === 'partial'
    || outcome.status === 'failed'
    || outcome.status === 'already_running'
    ? outcome.status
    : 'failed';
  return callBatchRpc('finish_meta_sync_batch_item', {
    p_batch_id: batchId,
    p_item_id: itemId,
    p_status: terminalStatus,
    p_run_id: outcome.runId && UUID_PATTERN.test(outcome.runId) ? outcome.runId : null,
    p_message: outcome.message || null,
    p_error: outcome.error || null,
    p_error_code: outcome.errorCode || null,
  });
}

export function persistedBatchToProgress(batch: PersistedMetaSyncBatch): BulkSyncProgress {
  return {
    total: batch.total,
    completed: batch.completed,
    success: batch.success,
    partial: batch.partial,
    failed: batch.failed,
    running: false,
    results: batch.items.map(({ id: _itemId, ...item }) => item),
  };
}
