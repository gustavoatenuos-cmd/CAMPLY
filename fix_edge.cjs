const fs = require('fs');
let code = fs.readFileSync('supabase/functions/meta-sync-ads/index.ts', 'utf8');
code = code.replace(/const activeCampaigns = campaignsData\.data \|\| \[\];[\s\S]*?(?=\/\/ Log sync)/, `const activeCampaigns = campaignsData.data || [];

    // 2. Fetch all active ads for the account in one call
    let allAds = [];
    try {
      const adsRes = await fetchMetaGraph({
        endpoint: \`/\${adAccountId}/ads\`,
        accessToken,
        appSecret,
        params: {
          fields: 'campaign_id,id,name,status,adset{id,name,status}',
          filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]),
          limit: '500'
        }
      });
      allAds = adsRes.data || [];
    } catch (e: any) {
      console.warn('Failed to fetch ads for account', e.message);
    }

    // Group ads by campaign
    const adsByCampaign = new Map();
    allAds.forEach((ad: any) => {
      const cid = ad.campaign_id;
      if (!adsByCampaign.has(cid)) adsByCampaign.set(cid, []);
      adsByCampaign.get(cid).push(ad);
    });

    // 3. Fetch insights for all campaigns in 7 calls
    const periods = ['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d', 'maximum'];
    const accountInsightsByPeriod: Record<string, any[]> = {};
    
    for (const preset of periods) {
      try {
        const res = await fetchMetaGraph({
          endpoint: \`/\${adAccountId}/insights\`,
          accessToken,
          appSecret,
          params: {
            level: 'campaign',
            fields: 'campaign_id,impressions,clicks,spend,cpc,cpa,actions,ctr,cost_per_action_type',
            date_preset: preset,
            limit: '500'
          }
        });
        accountInsightsByPeriod[preset] = res.data || [];
      } catch (e: any) {
        console.warn(\`Failed account insights for \${preset}\`, e.message);
        accountInsightsByPeriod[preset] = [];
      }
    }

    // 4. Assemble campaignsWithInsights
    const campaignsWithInsights = [];
    for (const campaign of activeCampaigns) {
      // Build activeAdSets from grouped ads
      const campaignAds = adsByCampaign.get(campaign.id) || [];
      const adSetsMap = new Map();
      campaignAds.forEach((ad: any) => {
        const adsetId = ad.adset?.id || 'unknown';
        if (!adSetsMap.has(adsetId)) {
          adSetsMap.set(adsetId, {
            id: adsetId,
            name: ad.adset?.name || 'Grupo Desconhecido',
            status: ad.adset?.status || 'ACTIVE',
            ads: []
          });
        }
        adSetsMap.get(adsetId).ads.push({
          id: ad.id,
          name: ad.name,
          status: ad.status
        });
      });
      const activeAdSets = Array.from(adSetsMap.values());

      // Build insightsByPeriod
      const insightsByPeriod: Record<string, any> = {};
      for (const preset of periods) {
        const row = accountInsightsByPeriod[preset].find((r: any) => r.campaign_id === campaign.id);
        insightsByPeriod[preset] = row || null;
      }

      campaignsWithInsights.push({
        ...campaign,
        insightsByPeriod,
        activeAdSets
      });
    }
`);
fs.writeFileSync('supabase/functions/meta-sync-ads/index.ts', code);
