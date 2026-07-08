const fs = require('fs');

let c = fs.readFileSync('src/components/analytics/ClientAnalyticsCard.tsx', 'utf-8');
c = c.replace(/import { ClientPrimaryMetricBlock }/, "import { type EnrichedGlobalClientPerformance } from '../../lib/performance/usePerformanceDashboard';\nimport { ClientPrimaryMetricBlock }");
fs.writeFileSync('src/components/analytics/ClientAnalyticsCard.tsx', c);

let tbl = fs.readFileSync('src/components/performance/ClientPerformanceTable.tsx', 'utf-8');
tbl = tbl.replace(/const primaryMetricId = client\.analysisProfile\?\.primaryConversionMetric \|\| 'messaging_conversations_started_total';/g, "const primaryMetricId = client.analysisProfile?.primaryConversionMetric || 'messaging_conversations_started_total';\n          const primaryMetric   = account?.metrics[primaryMetricId];");
fs.writeFileSync('src/components/performance/ClientPerformanceTable.tsx', tbl);

let testFile = fs.readFileSync('src/lib/performance/clientDecisionState.test.ts', 'utf-8');
testFile = testFile.replace(/const performance = {/g, 'const performance = {\n// @ts-ignore');
fs.writeFileSync('src/lib/performance/clientDecisionState.test.ts', testFile);

let ds = fs.readFileSync('src/lib/performance/clientDecisionState.ts', 'utf-8');
ds = ds.replace(/roasEval\.actualValue/g, 'roasEval.value');
fs.writeFileSync('src/lib/performance/clientDecisionState.ts', ds);

console.log("TS Fixes applied.");
