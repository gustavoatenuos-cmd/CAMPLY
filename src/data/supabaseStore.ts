import { CamplyData } from '../types';
import { normalizeData, sanitizeWorkspaceData } from './camplyStore';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

type WorkspaceRow = {
  data: CamplyData;
  version: number;
};

let remoteVersion: number | null = null;
let saveQueue: Promise<unknown> = Promise.resolve();

export const resetRemoteWorkspaceState = (): void => {
  remoteVersion = null;
};

const getUserId = async (): Promise<string | null> => {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id || null;
};

export const loadRemoteData = async (): Promise<CamplyData | null> => {
  if (!isSupabaseConfigured || !supabase) return null;
  const userId = await getUserId();
  if (!userId) return null;

  const { data, error } = await supabase
    .from('camply_workspace')
    .select('data, version')
    .eq('id', userId)
    .maybeSingle<WorkspaceRow>();

  if (error) {
    console.warn('Camply Supabase load skipped:', error.message);
    return null;
  }

  remoteVersion = data?.version ?? null;
  return data?.data ? normalizeData(data.data) : null;
};

export const saveRemoteData = async (data: CamplyData): Promise<boolean> => {
  const operation = saveQueue.then(() => saveRemoteDataNow(data));
  saveQueue = operation.catch(() => undefined);
  return operation;
};

const saveRemoteDataNow = async (data: CamplyData): Promise<boolean> => {
  if (!isSupabaseConfigured || !supabase) return false;
  const userId = await getUserId();
  if (!userId) return false;

  const { data: nextVersion, error } = await supabase.rpc('save_camply_workspace_with_client_registry', {
    p_data: sanitizeWorkspaceData(data),
    p_expected_version: remoteVersion,
  });

  if (error) {
    console.error('Camply Supabase save failed:', error.message);
    return false;
  }

  remoteVersion = Number(nextVersion);
  return true;
};

export const confirmClientIdentity = async (clientId: string): Promise<boolean> => {
  if (!isSupabaseConfigured || !supabase) return false;
  const userId = await getUserId();
  if (!userId) return false;

  const { data, error } = await supabase
    .from('client_identity')
    .select('client_id')
    .eq('user_id', userId)
    .eq('client_id', clientId)
    .is('archived_at', null)
    .maybeSingle<{ client_id: string }>();

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
  const saved = await saveRemoteData(data);
  if (!saved) {
    throw new Error('Não foi possível salvar o cliente no banco. Recarregue e tente novamente.');
  }

  const confirmed = await confirmClientIdentity(clientId);
  if (!confirmed) {
    throw new Error('O cliente foi salvo, mas ainda não apareceu no índice analítico. Tente novamente antes de vincular uma conta Meta.');
  }
};
