const fs = require('fs');

let t = fs.readFileSync('src/lib/performance/clientDecisionState.test.ts', 'utf-8');
t = t.replace(/performance: p(,?)/g, 'performance: p as any$1');
fs.writeFileSync('src/lib/performance/clientDecisionState.test.ts', t);
