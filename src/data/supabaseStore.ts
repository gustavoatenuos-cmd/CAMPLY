import { CamplyData } from '../types';
import { normalizeData, sanitizeWorkspaceData } from './camplyStore';
import { getSupabaseSessionUserId, isSupabaseConfigured, supabaseData } from '../lib/supabase';
import { withTimeout } from '../lib/withTimeout';
import type { ClientAnalysisProfile } from '../lib/analysis/clientAnalysisProfile';

type WorkspaceRow = {
  data: CamplyData;
  version: number;
};

let remoteVersion: number | null = null;
let saveQueue: Promise<unknown> = Promise.resolve();

export const resetRemoteWorkspaceState = (): void => {
  remoteVersion = null;
};

export const loadRemoteData = async (): Promise<CamplyData | null> => {
  if (!isSupabaseConfigured || !supabaseData) return null;
  const userId = getSupabaseSessionUserId();
  if (!userId) return null;

  let response;
  try {
    response = await withTimeout(
      supabaseData
        .from('camply_workspace')
        .select('data, version')
        .eq('id', userId)
        .maybeSingle<WorkspaceRow>(),
      12_000,
      'A leitura do workspace demorou mais que o esperado.'
    );
  } catch (error) {
    console.warn('Camply Supabase load skipped:', error instanceof Error ? error.message : String(error));
    return null;
  }
  const { data, error } = response;

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
  if (!isSupabaseConfigured || !supabaseData) return false;
  const userId = getSupabaseSessionUserId();
  if (!userId) return false;

  let response;
  try {
    response = await withTimeout(
      supabaseData.rpc('save_camply_workspace_with_client_registry', {
        p_data: sanitizeWorkspaceData(data),
        p_expected_version: remoteVersion,
      }),
      15_000,
      'A gravação do workspace demorou mais que o esperado.'
    );
  } catch (error) {
    console.error('Camply Supabase save failed:', error instanceof Error ? error.message : String(error));
    return false;
  }
  const { data: nextVersion, error } = response;

  if (error) {
    console.error('Camply Supabase save failed:', error.message);
    return false;
  }

  remoteVersion = Number(nextVersion);
  return true;
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
      10_000,
      'A confirmação do cliente demorou mais que o esperado.'
    );
  } catch (error) {
    console.error('Camply client identity confirmation failed:', error instanceof Error ? error.message : String(error));
    return false;
  }
  const { data, error } = response;

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

export const saveClientConfiguration = async (
  data: CamplyData,
  clientId: string,
  profile: ClientAnalysisProfile,
  idempotencyKey: string
): Promise<void> => {
  if (!isSupabaseConfigured || !supabaseData) throw new Error('Supabase não está configurado. O cliente não foi salvo.');
  const client = data.clients.find((item) => item.id === clientId);
  if (!client) throw new Error('O cliente não está presente no payload de confirmação.');
  const response = await withTimeout(
    supabaseData.rpc('create_client_with_configuration_v1', {
      p_client: client,
      p_project_id: client.projectId || null,
      p_profile: profile,
      p_targets: profile.performanceGoals || [],
      p_idempotency_key: idempotencyKey,
      p_workspace: sanitizeWorkspaceData(data),
      p_expected_version: remoteVersion,
    }),
    20_000,
    'A transação do cliente demorou mais que o esperado.'
  );
  if (response.error) throw new Error(`Não foi possível confirmar o cliente no banco: ${response.error.message}`);
  const payload = response.data as { workspaceVersion?: number } | null;
  if (!payload?.workspaceVersion) throw new Error('O banco não confirmou a versão do cadastro.');
  remoteVersion = Number(payload.workspaceVersion);
  const confirmed = await confirmClientIdentity(clientId);
  if (!confirmed) throw new Error('A transação terminou sem confirmar a identidade analítica do cliente.');
};
