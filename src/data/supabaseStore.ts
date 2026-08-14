import { CamplyData } from '../types';
import { normalizeData, sanitizeWorkspaceData } from './camplyStore';
import { getSupabaseSessionUserId, isSupabaseConfigured, supabaseData } from '../lib/supabase';
import { withTimeout } from '../lib/withTimeout';

type WorkspaceRow = {
  data: CamplyData;
  version: number;
};

export type RemoteLoadResult =
  | { status: 'ok'; data: CamplyData; version: number }
  | { status: 'empty'; version: number | null }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

export type RemoteSaveResult =
  | { status: 'saved'; version: number }
  | { status: 'skipped' }
  | { status: 'conflict'; remoteData: CamplyData | null; remoteVersion: number | null }
  | { status: 'error'; message: string };

export type WorkspacePersistenceErrorCode =
  | 'WORKSPACE_CONFLICT'
  | 'WORKSPACE_SAVE_FAILED'
  | 'CLIENT_IDENTITY_NOT_CONFIRMED';

export class WorkspacePersistenceError extends Error {
  constructor(
    public readonly code: WorkspacePersistenceErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'WorkspacePersistenceError';
  }
}

const LOAD_TIMEOUT_MS = 12_000;
const SAVE_TIMEOUT_MS = 15_000;
const CONFIRM_TIMEOUT_MS = 10_000;

let remoteVersion: number | null = null;
let remoteUserId: string | null = null;
let saveQueue: Promise<unknown> = Promise.resolve();
let lastSavedPayloadStr: string | null = null;
let pendingPayloadStr: string | null = null;

export const resetRemoteWorkspaceState = (): void => {
  remoteUserId = null;
  remoteVersion = null;
  lastSavedPayloadStr = null;
  pendingPayloadStr = null;
};

const bindRemoteWorkspaceToUser = (userId: string): void => {
  if (remoteUserId === userId) return;
  remoteUserId = userId;
  remoteVersion = null;
  lastSavedPayloadStr = null;
  pendingPayloadStr = null;
};

export const loadRemoteData = async (): Promise<RemoteLoadResult> => {
  if (!isSupabaseConfigured || !supabaseData) return { status: 'unavailable' };
  const userId = getSupabaseSessionUserId();
  if (!userId) return { status: 'unavailable' };
  bindRemoteWorkspaceToUser(userId);

  let response;
  try {
    response = await withTimeout(
      supabaseData
        .from('camply_workspace')
        .select('data, version')
        .eq('id', userId)
        .maybeSingle<WorkspaceRow>(),
      LOAD_TIMEOUT_MS,
      'A leitura do workspace demorou mais que o esperado.'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('Camply Supabase load failed:', message);
    return { status: 'error', message };
  }
  const { data, error } = response;

  if (getSupabaseSessionUserId() !== userId) return { status: 'unavailable' };

  if (error) {
    console.warn('Camply Supabase load failed:', error.message);
    return { status: 'error', message: error.message };
  }

  if (!data?.data) {
    remoteVersion = data?.version ?? null;
    return { status: 'empty', version: remoteVersion };
  }

  remoteVersion = data.version;
  const normalized = normalizeData(data.data);
  lastSavedPayloadStr = JSON.stringify(sanitizeWorkspaceData(normalized));
  return { status: 'ok', data: normalized, version: data.version };
};

// Consulta leve usada ao voltar o foco para a aba: compara apenas a versão,
// sem baixar o workspace inteiro.
export const hasNewerRemoteVersion = async (): Promise<boolean> => {
  if (!isSupabaseConfigured || !supabaseData) return false;
  const userId = getSupabaseSessionUserId();
  if (!userId) return false;
  bindRemoteWorkspaceToUser(userId);

  let response;
  try {
    response = await withTimeout(
      supabaseData
        .from('camply_workspace')
        .select('version')
        .eq('id', userId)
        .maybeSingle<{ version: number }>(),
      LOAD_TIMEOUT_MS,
      'A verificação de versão do workspace demorou mais que o esperado.'
    );
  } catch {
    return false;
  }
  const { data, error } = response;
  if (getSupabaseSessionUserId() !== userId || remoteUserId !== userId) return false;
  if (error || !data) return false;
  return remoteVersion === null || data.version > remoteVersion;
};

export const saveRemoteData = async (data: CamplyData): Promise<RemoteSaveResult> => {
  if (!isSupabaseConfigured || !supabaseData) return { status: 'skipped' };
  const userId = getSupabaseSessionUserId();
  if (!userId) return { status: 'skipped' };
  bindRemoteWorkspaceToUser(userId);

  const payload = sanitizeWorkspaceData(data);
  const payloadStr = JSON.stringify(payload);

  if (payloadStr === lastSavedPayloadStr || payloadStr === pendingPayloadStr) {
    return { status: 'skipped' };
  }

  pendingPayloadStr = payloadStr;

  const operation = saveQueue.then(() =>
    saveRemoteDataNow(payload, payloadStr, userId)
  );
  saveQueue = operation.catch(() => undefined);
  return operation;
};

const fetchRemoteWorkspaceRow = async (userId: string): Promise<WorkspaceRow | null> => {
  if (!supabaseData) return null;
  const { data, error } = await supabaseData
    .from('camply_workspace')
    .select('data, version')
    .eq('id', userId)
    .maybeSingle<WorkspaceRow>();
  if (error || !data) return null;
  return data;
};

const saveRemoteDataNow = async (
  payload: any,
  payloadStr: string,
  userId: string
): Promise<RemoteSaveResult> => {
  if (!supabaseData || getSupabaseSessionUserId() !== userId) {
    if (pendingPayloadStr === payloadStr) pendingPayloadStr = null;
    return { status: 'skipped' };
  }

  let response;
  try {
    response = await withTimeout(
      supabaseData.rpc('try_save_camply_workspace_with_client_registry', {
        p_data: payload,
        p_expected_version: remoteVersion,
      }),
      SAVE_TIMEOUT_MS,
      'A gravação do workspace demorou mais que o esperado.'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Camply Supabase save failed:', message);
    if (pendingPayloadStr === payloadStr) pendingPayloadStr = null;
    return { status: 'error', message };
  }
  
  if (pendingPayloadStr === payloadStr) pendingPayloadStr = null;

  const { data: rpcResult, error } = response;

  if (getSupabaseSessionUserId() !== userId || remoteUserId !== userId) {
    return { status: 'skipped' };
  }

  if (error) {
    console.error('Camply Supabase save failed:', error.message);
    return { status: 'error', message: error.message };
  }

  if (rpcResult?.status === 'conflict') {
    if (import.meta.env?.DEV) {
      console.warn('Camply Supabase conflict, adopting remote version', rpcResult.current_version);
    }
    const row = await fetchRemoteWorkspaceRow(userId);
    if (getSupabaseSessionUserId() !== userId || remoteUserId !== userId) {
      return { status: 'skipped' };
    }
    if (row) {
      remoteVersion = row.version;
      const normalized = row.data ? normalizeData(row.data) : null;
      if (normalized) {
        lastSavedPayloadStr = JSON.stringify(sanitizeWorkspaceData(normalized));
      }
      return { status: 'conflict', remoteData: normalized, remoteVersion: row.version };
    }
    const currentVersion = Number(rpcResult.current_version);
    return {
      status: 'conflict',
      remoteData: null,
      remoteVersion: Number.isFinite(currentVersion) ? currentVersion : null,
    };
  }

  if (rpcResult?.status === 'saved') {
    const savedVersion = Number(rpcResult.version);
    if (!Number.isFinite(savedVersion)) {
      return { status: 'error', message: 'RPC returned an invalid workspace version' };
    }
    remoteVersion = savedVersion;
    lastSavedPayloadStr = payloadStr;
    return { status: 'saved', version: savedVersion };
  }

  return { status: 'error', message: 'Unknown RPC result' };
};

export const confirmClientIdentity = async (clientId: string): Promise<boolean> => {
  if (!isSupabaseConfigured || !supabaseData) return false;
  const userId = getSupabaseSessionUserId();
  if (!userId) return false;

  let response;
  try {
    response = await withTimeout(
      supabaseData
        .from('client_identity')
        .select('client_id')
        .eq('user_id', userId)
        .eq('client_id', clientId)
        .is('archived_at', null)
        .maybeSingle<{ client_id: string }>(),
      CONFIRM_TIMEOUT_MS,
      'A confirmação do cliente demorou mais que o esperado.'
    );
  } catch (error) {
    console.error('Camply client identity confirmation failed:', error instanceof Error ? error.message : String(error));
    return false;
  }
  const { data, error } = response;

  if (getSupabaseSessionUserId() !== userId) return false;

  if (error) {
    console.error('Camply client identity confirmation failed:', error.message);
    return false;
  }

  return data?.client_id === clientId;
};

export const saveRemoteDataAndConfirmClient = async (
  data: CamplyData,
  clientId: string
): Promise<void> => {
  const result = await saveRemoteData(data);
  if (result.status === 'conflict') {
    throw new WorkspacePersistenceError(
      'WORKSPACE_CONFLICT',
      'Os dados foram alterados em outro dispositivo. Recarregue a página antes de salvar o cliente.'
    );
  }
  if (result.status !== 'saved') {
    throw new WorkspacePersistenceError(
      'WORKSPACE_SAVE_FAILED',
      'Não foi possível salvar o cliente no banco. Recarregue e tente novamente.'
    );
  }

  const confirmed = await confirmClientIdentity(clientId);
  if (!confirmed) {
    throw new WorkspacePersistenceError(
      'CLIENT_IDENTITY_NOT_CONFIRMED',
      'O cliente foi salvo, mas ainda não apareceu no índice analítico. Tente novamente antes de vincular uma conta Meta.'
    );
  }
};
