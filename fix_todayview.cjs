const fs = require('fs');
let content = fs.readFileSync('src/components/TodayView.tsx', 'utf8');

// 1. Add syncingClientId state
if (!content.includes('syncingClientId')) {
  content = content.replace(
    'const [dashboardPeriod, setDashboardPeriod] = useState<string>(\'last_7d\');',
    `const [dashboardPeriod, setDashboardPeriod] = useState<string>('last_7d');\n  const [syncingClientId, setSyncingClientId] = useState<string | null>(null);`
  );
}

// 2. Add handleSyncClient function
const syncFunc = `
  const handleSyncClient = async (client: any) => {
    if (!client.metaAdAccountId || !supabase) return;
    setSyncingClientId(client.id);
    try {
      const { data, error } = await supabase.functions.invoke('meta-sync-ads', {
        body: { adAccountId: client.metaAdAccountId }
      });
      if (error || !data?.campaigns) throw new Error();

      const fetchedCampaigns = data.campaigns.map((c: any) => {
        const isConversion = (type: string) => type === 'lead' || type === 'purchase' || type.includes('conversion') || type.includes('messaging');
        const spend = Number(c.insights?.spend || 0);
        const results = c.insights?.actions?.filter((a: any) => isConversion(a.action_type)).reduce((sum: number, a: any) => sum + Number(a.value), 0) || 0;
        
        const metricsByPeriod: Record<string, any> = {};
        if (c.insightsByPeriod) {
          for (const [period, pInsights] of Object.entries(c.insightsByPeriod)) {
            if (!pInsights) continue;
            const pSpend = Number((pInsights as any).spend || 0);
            const pResults = (pInsights as any).actions?.filter((a: any) => isConversion(a.action_type)).reduce((sum: number, a: any) => sum + Number(a.value), 0) || 0;
            metricsByPeriod[period] = {
              spent: pSpend,
              results: pResults,
              ctr: Number((pInsights as any).ctr || 0),
              cpc: Number((pInsights as any).cpc || 0),
              cpr: pResults > 0 ? pSpend / pResults : 0,
              pageViews: Number((pInsights as any).actions?.find((a: any) => a.action_type === 'landing_page_view' || a.action_type === 'view_content')?.value || 0),
              checkouts: Number((pInsights as any).actions?.find((a: any) => a.action_type === 'initiate_checkout')?.value || 0),
              purchases: Number((pInsights as any).actions?.find((a: any) => a.action_type === 'purchase')?.value || 0),
              impressions: Number((pInsights as any).impressions || 0)
            };
          }
        }
        
        return {
          id: makeId('campaign'),
          clientId: client.id,
          name: c.name,
          platform: 'Meta Ads',
          status: 'live',
          objective: c.objective,
          budget: Number(c.lifetime_budget || c.daily_budget || 0) / 100,
          spent: spend,
          results: results,
          ctr: Number(c.insights?.ctr || 0),
          cpc: Number(c.insights?.cpc || 0),
          cpr: results > 0 ? spend / results : 0,
          pageViews: Number(c.insights?.actions?.find((a: any) => a.action_type === 'landing_page_view' || a.action_type === 'view_content')?.value || 0),
          checkouts: Number(c.insights?.actions?.find((a: any) => a.action_type === 'initiate_checkout')?.value || 0),
          purchases: Number(c.insights?.actions?.find((a: any) => a.action_type === 'purchase')?.value || 0),
          metricsByPeriod,
          activeCreatives: c.activeAdSets?.reduce((acc: number, set: any) => acc + (set.ads?.length || 0), 0) || 0,
          lastOptimizedAt: new Date().toISOString().slice(0, 10),
          nextAction: '',
          priority: 'medium',
          metaCampaignId: c.id,
          activeAdSets: c.activeAdSets || []
        };
      });

      updateData(curr => {
        const updatedCampaigns = curr.campaigns.map((c: any) => {
          if (c.clientId === client.id && c.platform === 'Meta Ads') {
            const fc = fetchedCampaigns.find((f: any) => f.metaCampaignId === c.metaCampaignId);
            if (fc) {
               return { ...fc, id: c.id, status: c.status !== 'launching' ? c.status : fc.status };
            } else {
               return { ...c, status: 'paused' };
            }
          }
          return c;
        });
        
        const newCampaignsToInsert = fetchedCampaigns
          .filter((fc: any) => !curr.campaigns.some((c: any) => c.metaCampaignId === fc.metaCampaignId))
          .map((fc: any) => ({ ...fc, id: makeId('campaign'), clientId: client.id }));
          
        return {
          ...curr,
          campaigns: [...newCampaignsToInsert, ...updatedCampaigns]
        };
      });
    } catch(err) {
      console.error(err);
    }
    setSyncingClientId(null);
  };
`;
if (!content.includes('handleSyncClient')) {
  content = content.replace(
    'const amountToReceive = pendingPayments.reduce((sum, item) => sum + item.amount, 0);',
    'const amountToReceive = pendingPayments.reduce((sum, item) => sum + item.amount, 0);\n' + syncFunc
  );
}

// 3. Fix metrics fallback
content = content.replace(
  'const metrics = c.metricsByPeriod?.[dashboardPeriod] || c;',
  'const metrics = c.metricsByPeriod?.[dashboardPeriod] || (dashboardPeriod === \'maximum\' ? c : { spent: 0, results: 0, purchases: 0, impressions: 0 });'
);

// 4. Add sync button and RefreshCw to imports
if (!content.includes('RefreshCw')) {
  content = content.replace(
    'import { Activity,',
    'import { Activity, RefreshCw,'
  );
}
if (!content.includes('supabase')) {
  content = content.replace(
    'import { clientDisplayName } from \'./ClientsView\';',
    'import { clientDisplayName } from \'./ClientsView\';\nimport { supabase } from \'../lib/supabase\';'
  );
}

// 5. Add Sync Button UI
const titleBlock = '<h3 className="font-bold text-white">{client.name}</h3>';
const titleBlockReplacement = `
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-white">{client.name}</h3>
                    {client.metaAdAccountId && (
                      <button 
                        onClick={() => handleSyncClient(client)}
                        disabled={syncingClientId === client.id}
                        className="text-brand-muted hover:text-brand-green transition"
                        title="Sincronizar com Facebook Ads"
                      >
                        <RefreshCw size={14} className={syncingClientId === client.id ? 'animate-spin text-brand-green' : ''} />
                      </button>
                    )}
                  </div>
`;
content = content.replace(titleBlock, titleBlockReplacement);

fs.writeFileSync('src/components/TodayView.tsx', content);
