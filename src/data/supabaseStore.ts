import { CamplyData } from '../types';
import { normalizeData } from './camplyStore';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

type WorkspaceRow = {
  id: string;
  data: CamplyData;
  updated_at: string;
};

const WORKSPACE_ID = 'gustavo-camply';

export const loadRemoteData = async (): Promise<CamplyData | null> => {
  if (!isSupabaseConfigured || !supabase) return null;

  const { data, error } = await supabase
    .from('camply_workspace')
    .select('data')
    .eq('id', WORKSPACE_ID)
    .maybeSingle<Pick<WorkspaceRow, 'data'>>();

  if (error) {
    console.warn('Camply Supabase load skipped:', error.message);
    return null;
  }

  return data?.data ? normalizeData(data.data) : null;
};

export const saveRemoteData = async (data: CamplyData): Promise<boolean> => {
  if (!isSupabaseConfigured || !supabase) return false;

  const { error } = await supabase.from('camply_workspace').upsert({
    id: WORKSPACE_ID,
    data,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.warn('Camply Supabase save skipped:', error.message);
    return false;
  }

  return true;
};
