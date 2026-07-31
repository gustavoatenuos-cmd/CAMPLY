import fs from 'fs';

// --- 1. App.tsx ---
let appCode = fs.readFileSync('src/App.tsx', 'utf-8');
// Replace the agentAlerts block
appCode = appCode.replace(/agentAlerts:\s*\(\(\) => \{[\s\S]*?return \{[\s\S]*?agentAlerts: syncResult\.signals,[\s\S]*?\};\s*\}\)\(\),/, 
`...(() => {
              const syncResult = syncOperationalSignals(
                current.agentAlerts,
                evaluateOperationalSignals(current.clients, current.campaigns, current.projects, current.tasks, current.agentRules)
              );
              
              const mappedTransitions = syncResult.transitions.map(t => ({
                id: \`log_\${Math.random().toString(36).substring(2, 9)}\`,
                relatedEntityId: t.signalId,
                relatedEntityType: 'task' as any, // fallback
                analysisType: 'signal_transition',
                classification: t.newStatus,
                reason: \`Signal \${t.deduplicationKey} transitioned from \${t.previousStatus} to \${t.newStatus} (occurrence: \${t.occurrenceCount})\`,
                createdAt: t.occurredAt
              }));
              
              return {
                agentAlerts: syncResult.signals,
                agentLogs: [...current.agentLogs, ...mappedTransitions]
              };
            })(),`);
// Handle the second empty call if exists
appCode = appCode.replace(/agentAlerts:\s*syncOperationalSignals\(\s*current\.agentAlerts,\s*evaluateOperationalSignals\(([^)]+)\)\s*\)\.signals,?/g, 
`...(() => {
              const syncResult = syncOperationalSignals(
                current.agentAlerts,
                evaluateOperationalSignals($1)
              );
              return {
                agentAlerts: syncResult.signals,
              };
            })(),`);
fs.writeFileSync('src/App.tsx', appCode);


// --- 2. evaluateOperationalSignals.test.ts ---
let evalTestCode = fs.readFileSync('src/lib/operational/evaluateOperationalSignals.test.ts', 'utf-8');

// Replace manual object fixtures with makeOperationalSignal
evalTestCode = `import { makeOperationalSignal } from '../../__tests__/helpers/operationalSignalBuilder';\n` + evalTestCode;

// Fix type errors where it uses raw object literals instead of makeOperationalSignal
// We'll replace the raw arrays with maps via makeOperationalSignal if needed, but for now we can just find and replace the problematic structures.
// Wait, the error is mainly in the `const previousSignals: OperationalSignal[] = [...]` block near line 290
evalTestCode = evalTestCode.replace(/const previousSignals: OperationalSignal\[\] = \[[\s\S]*?\];/g, 
`const previousSignals: OperationalSignal[] = [
      makeOperationalSignal({ id: '1', signalType: 'budget', status: 'active' }),
      makeOperationalSignal({ id: '2', signalType: 'budget', status: 'resolved' }),
      makeOperationalSignal({ id: '3', signalType: 'budget', status: 'dismissed' }),
      makeOperationalSignal({ id: '4', signalType: 'budget', status: 'active', severity: 'good' }),
    ];`);
    
// Replace `syncOperationalSignals(current, evaluated).signals[0]` where [0] is indexing incorrectly
// Oh wait, evaluateOperationalSignals returns OperationalSignal[] directly, NOT syncResult.
// Let's find exactly where I messed up the test: `syncOperationalSignals(evaluateOperationalSignals(...))`
evalTestCode = evalTestCode.replace(/expect\(syncOperationalSignals\(evaluateOperationalSignals\(([^)]+)\)\)\.signals\[0\]/g, 
  "expect(evaluateOperationalSignals($1)[0]");

// Some lines were like `expect(evaluateOperationalSignals(...)[0]` and got replaced blindly with `syncOperationalSignals`. Let's revert that.
evalTestCode = evalTestCode.replace(/syncOperationalSignals\(evaluateOperationalSignals/g, "evaluateOperationalSignals");
evalTestCode = evalTestCode.replace(/\.signals\[0\]/g, "[0]");
// Also fix any leftover .signals from the regex
evalTestCode = evalTestCode.replace(/expect\(evaluateOperationalSignals\(([^)]+)\)\)\.signals/g, "expect(evaluateOperationalSignals($1))");

fs.writeFileSync('src/lib/operational/evaluateOperationalSignals.test.ts', evalTestCode);


// --- 3. Fix operationalRuleRegistry.ts (and test) threshold -> thresholdValue if there are leftovers ---
let regCode = fs.readFileSync('src/lib/operational/operationalRuleRegistry.ts', 'utf-8');
regCode = regCode.replace(/threshold\?: number;/g, 'thresholdValue?: number;');
regCode = regCode.replace(/threshold: definition.defaultThreshold/g, 'thresholdValue: definition.defaultThreshold');
regCode = regCode.replace(/threshold: finalThreshold/g, 'thresholdValue: finalThreshold');
regCode = regCode.replace(/persisted.threshold/g, 'persisted.thresholdValue');
fs.writeFileSync('src/lib/operational/operationalRuleRegistry.ts', regCode);


