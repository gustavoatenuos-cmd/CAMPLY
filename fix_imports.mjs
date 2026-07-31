import fs from 'fs';

function fixTypesImport(file) {
  let content = fs.readFileSync(file, 'utf-8');
  content = content.replace(/from '\.\.\/types'/g, "from '../../types'");
  fs.writeFileSync(file, content);
}

fixTypesImport('src/lib/operational/normalizeOperationalSignal.ts');
fixTypesImport('src/lib/operational/dismissOperationalSignal.ts');
fixTypesImport('src/lib/operational/syncOperationalSignals.ts');
fixTypesImport('src/lib/operational/operationalRuleRegistry.ts');

let appContent = fs.readFileSync('src/App.tsx', 'utf-8');
appContent = appContent.replace(/agentAlerts: syncOperationalSignals\([\s\S]*?\)/, `agentAlerts: syncOperationalSignals(
            current.agentAlerts,
            evaluateOperationalSignals(current.clients, current.campaigns, current.projects, current.tasks, current.agentRules)
          ).signals`);
fs.writeFileSync('src/App.tsx', appContent);

let testContent = fs.readFileSync('src/lib/operational/evaluateOperationalSignals.test.ts', 'utf-8');
// Fix missing fields in fixtures
testContent = testContent.replace(/triggeredAt: '2024-01-01T00:00:00Z'/g, "triggeredAt: '2024-01-01T00:00:00Z', lastDetectedAt: '2024-01-01T00:00:00Z', occurrenceCount: 1");
// Fix syncOperationalSignals call that expects array
testContent = testContent.replace(/const synced = syncOperationalSignals\(/g, "const { signals: synced } = syncOperationalSignals(");
// Fix implicit 0 index on syncOperationalSignals because it was returning array directly before? No, `synced[0]` was used. But wait, `synced` might have been the direct result. Let's make sure it's extracted properly.
testContent = testContent.replace(/expect\(syncOperationalSignals\((.*?)\)\[0\]/g, "expect(syncOperationalSignals($1).signals[0]");
fs.writeFileSync('src/lib/operational/evaluateOperationalSignals.test.ts', testContent);

// Fix evaluateOperationalSignals.ts import
let evalCode = fs.readFileSync('src/lib/operational/evaluateOperationalSignals.ts', 'utf-8');
evalCode = evalCode.replace(/import \{ operationalRuleRegistry \} from '\.\/operationalRuleRegistry';/g, "import { resolveRuleConfiguration } from './operationalRuleRegistry';");
fs.writeFileSync('src/lib/operational/evaluateOperationalSignals.ts', evalCode);
