const fs = require('fs');

// Fix the Component
let grid = fs.readFileSync('src/components/performance/ClientPerformanceCardGrid.tsx', 'utf8');

grid = grid.replace(/client\.dataQuality\.latestSync/g, "client.lastSuccessfulRun?.timestamp");
grid = grid.replace(/client\.dataQuality\.stale/g, "!client.lastSuccessfulRun");
grid = grid.replace(/acc\.accountId/g, "acc.adAccountId");
grid = grid.replace(/syncMetaAsset\(acc\.adAccountId, period\)/g, "syncMetaAsset({ metaAssetId: acc.metaAssetId, period, requestedLevel: 'campaign' })");
grid = grid.replace(
  "evaluation={{ status: macroStatus === 'saudavel' ? 'healthy' : macroStatus === 'atencao' ? 'attention' : macroStatus === 'critico' ? 'critical' : 'no_data' }}",
  "status={macroStatus === 'saudavel' ? 'on_track' : macroStatus === 'atencao' ? 'attention' : macroStatus === 'critico' ? 'critical' : 'insufficient_data'}"
);
grid = grid.replace(
  "decision.operationalProfile",
  "(client.analysisProfile)"
);
grid = grid.replace(
  "strategyType === 'leads_whatsapp' || strategyType === 'leads_formulario'",
  "strategyType === 'leads_whatsapp' || strategyType === 'loja_fisica'"
);
grid = grid.replace(
  "strategyType === 'distribuicao_conteudo'",
  "strategyType === 'alcance'"
);
grid = grid.replace(
  "<CampaignHierarchicalTable client={client} period={period} />",
  "<CampaignHierarchicalTable accounts={client.accounts} period={period} />"
);

fs.writeFileSync('src/components/performance/ClientPerformanceCardGrid.tsx', grid, 'utf8');

// Fix the Tests
let gridTest = fs.readFileSync('src/components/performance/ClientPerformanceCardGrid.test.tsx', 'utf8');
gridTest = gridTest.replace(
  "dataQuality: { stale: false, partial: false, issues: [] },",
  "dataQuality: { status: 'complete', reason: null },"
);
gridTest = gridTest.replace(
  "score: { score: 100, signals: [], breakdown: { conversion: 0, cost: 0, volume: 0, quality: 0 } },",
  ""
);
gridTest = gridTest.replace(
  "hasProject: false,",
  "hasProject: false,\n      segment: 'Retail',\n      structure: 'B2C',\n      contact: 'test@example.com',"
);
fs.writeFileSync('src/components/performance/ClientPerformanceCardGrid.test.tsx', gridTest, 'utf8');
