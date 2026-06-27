import { CamplyData } from '../types';
import { normalizeData } from './camplyStore';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

type WorkspaceRow = {
  data: CamplyData;
  version: number;
};

let remoteVersion: number | null = null;

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
  if (!isSupabaseConfigured || !supabase) return false;
  const userId = await getUserId();
  if (!userId) return false;

  const { data: nextVersion, error } = await supabase.rpc('save_camply_workspace', {
    p_data: data,
    p_expected_version: remoteVersion,
  });

  if (error) {
    console.error('Camply Supabase save failed:', error.message);
    return false;
  }

  remoteVersion = Number(nextVersion);
  return true;
};
