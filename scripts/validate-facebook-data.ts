import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import * as path from 'path';

// Load .env
config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or Key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log('Fetching clients and metrics...');

  const { data: clients, error: clientErr } = await supabase
    .from('workspace_clients')
    .select(`
      id, name,
      meta_sync_runs (
        id, meta_asset_id, period, status,
        metrics, started_at, completed_at
      )
    `)
    .eq('meta_sync_runs.status', 'success');

  if (clientErr) {
    console.error('Error fetching clients:', clientErr);
    return;
  }

  const rows: any[] = [];

  for (const client of clients || []) {
    // Apenas clientes que o user pediu: Donatellus, TDAH CONSTANTE, ORAL UNIC TOLEDO etc.
    // Mas vamos processar todos que tm run
    if (!client.meta_sync_runs || client.meta_sync_runs.length === 0) continue;

    for (const run of client.meta_sync_runs) {
      if (!run.metrics || !run.metrics.results) continue;
      const m = run.metrics.results;

      const spend = m.spend?.value ?? 0;
      const purchases = m.purchases?.value ?? 0;
      const leads = m.leads?.value ?? 0;
      const convs = m.messaging_conversations_started_total?.value ?? 0;

      const groups = run.metrics.groups || [];
      let salesSpend = 0, messagingSpend = 0, leadsSpend = 0;
      for (const g of groups) {
        const obj = g.classifiedObjective || g.objective;
        const gSpend = g.spend || g.metrics?.spend?.value || 0;
        if (obj === 'SALES') salesSpend += gSpend;
        else if (obj === 'MESSAGING') messagingSpend += gSpend;
        else if (obj === 'LEADS') leadsSpend += gSpend;
      }
      
      const cpa = purchases > 0 ? salesSpend / purchases : null;
      const cpc = convs > 0 ? messagingSpend / convs : null;
      const cpl = leads > 0 ? leadsSpend / leads : null;

      rows.push({
        Cliente: client.name,
        'Conta Meta (Asset ID)': run.meta_asset_id,
        Perodo: run.period,
        'Spend Total': `R$ ${spend.toFixed(2)}`,
        'Sales Spend': `R$ ${salesSpend.toFixed(2)}`,
        'Messaging Spend': `R$ ${messagingSpend.toFixed(2)}`,
        'Leads Spend': `R$ ${leadsSpend.toFixed(2)}`,
        Purchases: purchases,
        Conversations: convs,
        Leads: leads,
        'CPA Scoped': cpa !== null ? `R$ ${cpa.toFixed(2)}` : '-',
        'Custo por Conv. Scoped': cpc !== null ? `R$ ${cpc.toFixed(2)}` : '-',
        'CPL Scoped': cpl !== null ? `R$ ${cpl.toFixed(2)}` : '-',
        Moeda: m.currency?.value || '-',
        Timezone: m.timezone?.value || '-',
        'Data Quality': run.metrics.data_quality?.completeness_score ?? '-',
        'Last Run': run.completed_at ? new Date(run.completed_at).toLocaleString('pt-BR') : '-'
      });
    }
  }

  console.table(rows);
}

run().catch(console.error);
