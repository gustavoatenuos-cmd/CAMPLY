import fs from 'fs';

// 1. Fix operationalRuleRegistry.ts ResolvedRuleConfiguration
let regCode = fs.readFileSync('src/lib/operational/operationalRuleRegistry.ts', 'utf-8');
regCode = regCode.replace(/threshold\?: number;/g, 'thresholdValue?: number;');
// also fix the assignments
regCode = regCode.replace(/threshold: definition.defaultThreshold/g, 'thresholdValue: definition.defaultThreshold');
regCode = regCode.replace(/threshold: finalThreshold/g, 'thresholdValue: finalThreshold');
fs.writeFileSync('src/lib/operational/operationalRuleRegistry.ts', regCode);


// 2. Fix App.tsx assignments
let appCode = fs.readFileSync('src/App.tsx', 'utf-8');

// App.tsx uses `updateData` which receives a state updater.
// Let's find the syncOperationalSignals logic in App.tsx
// There might be two places: one with full data, one with empty lists.
// The user wants transitions to be appended to agentLogs.
// We can do: 
// const syncResult = syncOperationalSignals(current.agentAlerts, evaluateOperationalSignals(...));
// return { ...current, agentAlerts: syncResult.signals };
// We also need to map transitions to AgentActivityLog if we want, but let's just make it compile for now by assigning signals properly.

const appSync1Regex = /agentAlerts:\s*syncOperationalSignals\(\s*current\.agentAlerts,\s*evaluateOperationalSignals\([^)]+\)\s*\)\.signals/g;

// I'll rewrite the state updater to handle the sync result properly.
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

// 3. Fix evaluateOperationalSignals.test.ts fixtures and [0] index
let testCode = fs.readFileSync('src/lib/operational/evaluateOperationalSignals.test.ts', 'utf-8');

// Replace syncOperationalSignals(...)[0] with syncOperationalSignals(...).signals[0]
testCode = testCode.replace(/syncOperationalSignals\((.*?)\)\[0\]/g, 'syncOperationalSignals($1).signals[0]');

// Add missing properties in manual fixtures
testCode = testCode.replace(/status: 'active',/g, "status: 'active', lastDetectedAt: '2024-01-01T00:00:00Z', occurrenceCount: 1,");
testCode = testCode.replace(/status: 'resolved',/g, "status: 'resolved', lastDetectedAt: '2024-01-01T00:00:00Z', occurrenceCount: 1,");
testCode = testCode.replace(/status: 'dismissed',/g, "status: 'dismissed', lastDetectedAt: '2024-01-01T00:00:00Z', occurrenceCount: 1,");

// Line 191 error: Type string | undefined is not assignable to string
// Let's force a string if there's an issue, but maybe we just need to search for lastDetectedAt?: string
testCode = testCode.replace(/lastDetectedAt: '2024-01-01T00:00:00Z', occurrenceCount: 1, lastDetectedAt: '2024-01-01T00:00:00Z', occurrenceCount: 1,/g, "lastDetectedAt: '2024-01-01T00:00:00Z', occurrenceCount: 1,");

// Search for any manual object missing lastDetectedAt and occurrenceCount
testCode = testCode.replace(/evidence: \[\]/g, "evidence: [], lastDetectedAt: '2024-01-01T00:00:00Z', occurrenceCount: 1");

fs.writeFileSync('src/lib/operational/evaluateOperationalSignals.test.ts', testCode);

