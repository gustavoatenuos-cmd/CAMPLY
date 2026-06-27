import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://ilcvydgogqumwjrpzzro.supabase.co', 'sb_publishable_njteejatxOX3GqJpiNffpg_Wiq95Umu');

async function run() {
  const { data, error } = await supabase.from('camply_workspace').select('id, updated_at, data');
  if (error) {
    console.error('Error fetching data:', error);
    return;
  }
  console.log('Workspaces found:');
  data.forEach(w => {
    console.log(`- ID: ${w.id}`);
    console.log(`  Updated: ${w.updated_at}`);
    console.log(`  Clients: ${w.data?.clients?.length || 0}`);
    console.log(`  Campaigns: ${w.data?.campaigns?.length || 0}`);
    console.log(`  Projects: ${w.data?.projects?.length || 0}`);
  });
}

run();
