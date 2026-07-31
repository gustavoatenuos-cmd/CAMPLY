import fs from 'fs';

let evalCode = fs.readFileSync('src/lib/operational/evaluateOperationalSignals.ts', 'utf-8');
evalCode = evalCode.replace(/\.threshold/g, '.thresholdValue');
evalCode = evalCode.replace(/import \{ operationalRuleRegistry \} from '\.\/operationalRuleRegistry';/g, "import { resolveRuleConfiguration } from './operationalRuleRegistry';");
fs.writeFileSync('src/lib/operational/evaluateOperationalSignals.ts', evalCode);

// I will write a simple test fixer that removes duplicates.
let testCode = fs.readFileSync('src/lib/operational/evaluateOperationalSignals.test.ts', 'utf-8');
testCode = testCode.replace(/lastDetectedAt: '2024-01-01T00:00:00Z', occurrenceCount: 1, lastDetectedAt: '2024-01-01T00:00:00Z', occurrenceCount: 1,/g, "lastDetectedAt: '2024-01-01T00:00:00Z', occurrenceCount: 1,");
testCode = testCode.replace(/lastDetectedAt: '2024-01-01T00:00:00Z', occurrenceCount: 1, lastDetectedAt: '2024-01-01T00:00:00Z', occurrenceCount: 1/g, "lastDetectedAt: '2024-01-01T00:00:00Z', occurrenceCount: 1");
testCode = testCode.replace(/, lastDetectedAt: '2024-01-01T00:00:00Z', occurrenceCount: 1, lastDetectedAt: '2024-01-01T00:00:00Z', occurrenceCount: 1/g, ", lastDetectedAt: '2024-01-01T00:00:00Z', occurrenceCount: 1");

// The "syncOperationalSignals(...)[0]" error means it's still there.
testCode = testCode.replace(/syncOperationalSignals\((.*?)\)\[0\]/g, 'syncOperationalSignals($1).signals[0]');
fs.writeFileSync('src/lib/operational/evaluateOperationalSignals.test.ts', testCode);

