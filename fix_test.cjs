const fs = require('fs');
let test = fs.readFileSync('src/components/performance/CommercialDecisionOverview.test.ts', 'utf8');
test = test.replace(/subsegments/g, 'strategyTypes');
fs.writeFileSync('src/components/performance/CommercialDecisionOverview.test.ts', test, 'utf8');
console.log('Fixed test file');
