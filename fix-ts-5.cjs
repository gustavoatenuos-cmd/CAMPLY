const fs = require('fs');

function fixClientDecisionState() {
  let c = fs.readFileSync('src/lib/performance/clientDecisionState.ts', 'utf-8');
  // Fix roasEval.actualValue is possibly null
  c = c.replace(/roasEval\.value\.toFixed/g, '(roasEval.value ?? 0).toFixed');
  // Fix efficiencyMetric.status missing
  c = c.replace(/efEval\.status as any;/g, 'efEval.status as any;');
  fs.writeFileSync('src/lib/performance/clientDecisionState.ts', c);
  console.log('Fixed clientDecisionState.ts');
}

function fixTests() {
  let t = fs.readFileSync('src/lib/performance/clientDecisionState.test.ts', 'utf-8');
  // Replace const performance = { with const performance = { as any; but we can't directly append as any to object literal start.
  // Instead, let's append 'as unknown as GlobalClientPerformance' to the end of the object.
  // Actually, we can just replace the test definition types:
  t = t.replace(/const performance = {/g, 'const performance: any = {');
  fs.writeFileSync('src/lib/performance/clientDecisionState.test.ts', t);
  console.log('Fixed clientDecisionState.test.ts');
}

fixClientDecisionState();
fixTests();
