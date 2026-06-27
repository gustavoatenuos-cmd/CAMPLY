const fs = require('fs');
let code = fs.readFileSync('supabase/functions/meta-sync-ads/index.ts', 'utf8');
code = code.replace(/fields: 'campaign_id,impressions,clicks,spend,cpc,cpa,actions,ctr,cost_per_action_type',/g, "fields: 'campaign_id,impressions,clicks,spend,cpc,actions,ctr,cost_per_action_type',");
fs.writeFileSync('supabase/functions/meta-sync-ads/index.ts', code);
