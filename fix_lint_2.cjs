const fs = require('fs');

// 1. Fix OverviewView.tsx
let ov = fs.readFileSync('src/components/OverviewView.tsx', 'utf8');
ov = ov.replace(/'vertical'/g, "'strategyType'");
fs.writeFileSync('src/components/OverviewView.tsx', ov, 'utf8');

// 2. Fix CommercialDecisionOverview.test.ts
let test = fs.readFileSync('src/components/performance/CommercialDecisionOverview.test.ts', 'utf8');
test = test.replace(/'vertical'/g, "'strategyType'");
test = test.replace(/summary\.subsegments/g, 'summary.strategyTypes');
fs.writeFileSync('src/components/performance/CommercialDecisionOverview.test.ts', test, 'utf8');

console.log('Final patch complete');
