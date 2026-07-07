import { createClient } from '@supabase/supabase-js';

// Esse script deve ser rodado para validar se há dados de anúncios no Supabase
async function validateData() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Configurações do Supabase não encontradas. Certifique-se de definir VITE_SUPABASE_URL e VITE_SUPABASE_SERVICE_ROLE_KEY ou VITE_SUPABASE_ANON_KEY.");
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('Verificando dados no Supabase...\n');

  const { data: runs, error: runsError } = await supabase
    .from('meta_sync_runs')
    .select('id, status, started_at, records_fetched, requested_period')
    .order('started_at', { ascending: false })
    .limit(5);

  if (runsError) {
    console.error("Erro ao buscar meta_sync_runs:", runsError);
  } else {
    console.log("Últimas 5 execuções de sincronização (meta_sync_runs):");
    console.table(runs);
  }

  const { count: campaignsCount } = await supabase.from('meta_campaign_snapshots').select('*', { count: 'exact', head: true });
  const { count: adsetsCount } = await supabase.from('meta_adset_snapshots').select('*', { count: 'exact', head: true });
  const { count: adsCount } = await supabase.from('meta_ad_snapshots').select('*', { count: 'exact', head: true });

  console.log('\n--- Resumo de Dados (Snapshots) ---');
  console.log(`Campanhas encontradas: ${campaignsCount || 0}`);
  console.log(`Conjuntos (Adsets) encontrados: ${adsetsCount || 0}`);
  console.log(`Anúncios encontrados: ${adsCount || 0}`);

  if (adsCount && adsCount > 0) {
    console.log("\n✅ DADOS VALIDADOS: O sistema conseguiu extrair os dados e inseri-los no banco!");
  } else {
    console.log("\n❌ DADOS INSUFICIENTES: Ainda não há dados de anúncios sincronizados.");
  }
}

validateData();
