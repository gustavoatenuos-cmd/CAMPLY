import { CamplyData } from '../types';
import { normalizeData, sanitizeWorkspaceData } from './camplyStore';
import { getSupabaseSessionUserId, isSupabaseConfigured, supabaseData } from '../lib/supabase';
import { withTimeout } from '../lib/withTimeout';

type WorkspaceRow = {
  data: CamplyData;
  version: number;
};

export type RemoteLoadResult =
  | { status: 'ok'; data: CamplyData }
  | { status: 'empty' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

export type RemoteSaveResult =
  | { status: 'saved' }
  | { status: 'skipped' }
  | { status: 'conflict'; remoteData: CamplyData | null }
  | { status: 'error'; message: string };

const LOAD_TIMEOUT_MS = 12_000;
const SAVE_TIMEOUT_MS = 15_000;
const CONFIRM_TIMEOUT_MS = 10_000;

let remoteVersion: number | null = null;
let saveQueue: Promise<unknown> = Promise.resolve();
let lastSavedPayloadStr: string | null = null;
let pendingPayloadStr: string | null = null;

export const resetRemoteWorkspaceState = (): void => {
  remoteVersion = null;
  lastSavedPayloadStr = null;
  pendingPayloadStr = null;
};

export const loadRemoteData = async (): Promise<RemoteLoadResult> => {
  if (!isSupabaseConfigured || !supabaseData) return { status: 'unavailable' };
  const userId = getSupabaseSessionUserId();
  if (!userId) return { status: 'unavailable' };

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

  if (error) {
    console.warn('Camply Supabase load failed:', error.message);
    return { status: 'error', message: error.message };
  }

  if (!data?.data) {
    remoteVersion = data?.version ?? null;
    return { status: 'empty' };
  }

  remoteVersion = data.version;
  const normalized = normalizeData(data.data);
  lastSavedPayloadStr = JSON.stringify(sanitizeWorkspaceData(normalized));
  return { status: 'ok', data: normalized };
};

// Consulta leve usada ao voltar o foco para a aba: compara apenas a versão,
// sem baixar o workspace inteiro.
export const hasNewerRemoteVersion = async (): Promise<boolean> => {
  if (!isSupabaseConfigured || !supabaseData) return false;
  const userId = getSupabaseSessionUserId();
  if (!userId) return false;

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
  if (error || !data) return false;
  return remoteVersion === null || data.version > remoteVersion;
};

export const saveRemoteData = async (data: CamplyData): Promise<RemoteSaveResult> => {
  const payload = sanitizeWorkspaceData(data);
  const payloadStr = JSON.stringify(payload);

  if (payloadStr === lastSavedPayloadStr || payloadStr === pendingPayloadStr) {
    return { status: 'skipped' };
  }

  pendingPayloadStr = payloadStr;

  const operation = saveQueue.then(() => saveRemoteDataNow(payload, payloadStr));
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

const saveRemoteDataNow = async (payload: any, payloadStr: string): Promise<RemoteSaveResult> => {
  if (!isSupabaseConfigured || !supabaseData) {
    if (pendingPayloadStr === payloadStr) pendingPayloadStr = null;
    return { status: 'skipped' };
  }
  const userId = getSupabaseSessionUserId();
  if (!userId) {
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
    console.warn('Camply Supabase RPC save failed, attempting direct table upsert fallback:', error);
    try {
      const nextVersion = (remoteVersion || 0) + 1;
      const { error: upsertError } = await supabaseData
        .from('camply_workspace')
        .upsert({ id: userId, data: payload, version: nextVersion, updated_at: new Date().toISOString() });

      if (!upsertError) {
        remoteVersion = nextVersion;
        lastSavedPayloadStr = payloadStr;
        if (pendingPayloadStr === payloadStr) pendingPayloadStr = null;

        // Auto-upsert clients into client_identity table
        const clients = Array.isArray(payload?.clients) ? payload.clients : [];
        if (clients.length > 0) {
          void supabaseData
            .from('client_identity')
            .upsert(
              clients.map((c: any) => ({
                user_id: userId,
                client_id: String(c.id),
                display_name: String(c.name || c.company || c.id),
              })),
              { onConflict: 'user_id,client_id' }
            );
        }

        return { status: 'saved' };
      }
    } catch (fallbackError) {
      console.error('Camply Supabase fallback save failed:', fallbackError);
    }

    const message = error instanceof Error ? error.message : String(error);
    if (pendingPayloadStr === payloadStr) pendingPayloadStr = null;
    return { status: 'error', message };
  }
  
  if (pendingPayloadStr === payloadStr) pendingPayloadStr = null;

  const { data: rpcResult, error } = response;

  if (error) {
    console.warn('Camply Supabase save RPC error, attempting direct table upsert fallback:', error.message);
    try {
      const nextVersion = (remoteVersion || 0) + 1;
      const { error: upsertError } = await supabaseData
        .from('camply_workspace')
        .upsert({ id: userId, data: payload, version: nextVersion, updated_at: new Date().toISOString() });

      if (!upsertError) {
        remoteVersion = nextVersion;
        lastSavedPayloadStr = payloadStr;

        // Auto-upsert clients into client_identity table
        const clients = Array.isArray(payload?.clients) ? payload.clients : [];
        if (clients.length > 0) {
          void supabaseData
            .from('client_identity')
            .upsert(
              clients.map((c: any) => ({
                user_id: userId,
                client_id: String(c.id),
                display_name: String(c.name || c.company || c.id),
              })),
              { onConflict: 'user_id,client_id' }
            );
        }

        return { status: 'saved' };
      }
    } catch (fallbackError) {
      console.error('Camply Supabase fallback save failed:', fallbackError);
    }

    return { status: 'error', message: error.message };
  }

  if (rpcResult?.status === 'conflict') {
    if (import.meta.env?.DEV) {
      console.warn('Camply Supabase conflict, adopting remote version', rpcResult.current_version);
    }
    const row = await fetchRemoteWorkspaceRow(userId);
    if (row) {
      remoteVersion = row.version;
      const normalized = row.data ? normalizeData(row.data) : null;
      if (normalized) {
        lastSavedPayloadStr = JSON.stringify(sanitizeWorkspaceData(normalized));
      }
      return { status: 'conflict', remoteData: normalized };
    }
    return { status: 'conflict', remoteData: null };
  }

  if (rpcResult?.status === 'saved') {
    remoteVersion = Number(rpcResult.version);
    lastSavedPayloadStr = payloadStr;
    return { status: 'saved' };
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
  }
  
  const data = response?.data;
  if (data?.client_id === clientId) {
    return true;
  }

  // Auto-create client_identity row if not present
  try {
    const { error: upsertError } = await supabaseData
      .from('client_identity')
      .upsert({ user_id: userId, client_id: clientId, display_name: clientId }, { onConflict: 'user_id,client_id' });
    return !upsertError;
  } catch {
    return true;
  }
};

export const saveRemoteDataAndConfirmClient = async (
  data: CamplyData,
  clientId: string
): Promise<void> => {
  const result = await saveRemoteData(data);
  if (result.status === 'conflict') {
    throw new Error('Os dados foram alterados em outro dispositivo. Recarregue a página antes de salvar o cliente.');
  }

  const confirmed = await confirmClientIdentity(clientId);
  if (!confirmed) {
    console.warn('Client identity confirmation notice for:', clientId);
  }
};
