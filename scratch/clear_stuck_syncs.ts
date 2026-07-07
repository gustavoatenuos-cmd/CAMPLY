import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY);

async function fix() {
  const { data, error } = await supabase
    .from('meta_sync_runs')
    .update({ status: 'failed', termination_reason: 'timeout_cleared_by_system' })
    .eq('status', 'running');
    
  console.log('Cleared stuck syncs. Error:', error);
}

fix();
