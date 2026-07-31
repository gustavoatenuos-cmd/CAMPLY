import fs from 'fs';

let testContent = fs.readFileSync('src/lib/operational/evaluateOperationalSignals.test.ts', 'utf-8');
testContent = testContent.replace(/triggeredAt: '2024-01-01T00:00:00Z'/g, "triggeredAt: '2024-01-01T00:00:00Z', lastDetectedAt: '2024-01-01T00:00:00Z', occurrenceCount: 1");
fs.writeFileSync('src/lib/operational/evaluateOperationalSignals.test.ts', testContent);

let regContent = fs.readFileSync('src/lib/operational/operationalRuleRegistry.ts', 'utf-8');
regContent = regContent.replace(/\.isActive/g, '.enabled');
regContent = regContent.replace(/\.threshold/g, '.thresholdValue');
fs.writeFileSync('src/lib/operational/operationalRuleRegistry.ts', regContent);

let regTestContent = fs.readFileSync('src/lib/operational/operationalRuleRegistry.test.ts', 'utf-8');
regTestContent = regTestContent.replace(/\.isActive/g, '.enabled');
regTestContent = regTestContent.replace(/\.threshold/g, '.thresholdValue');
regTestContent = regTestContent.replace(/threshold: /g, 'thresholdValue: ');
fs.writeFileSync('src/lib/operational/operationalRuleRegistry.test.ts', regTestContent);

let appContent = fs.readFileSync('src/App.tsx', 'utf-8');
// In App.tsx, the call is:
// agentAlerts: syncOperationalSignals(current.agentAlerts, evaluateOperationalSignals(...))
appContent = appContent.replace(/agentAlerts: syncOperationalSignals\([\s\S]*?\),/, `agentAlerts: syncOperationalSignals(
            current.agentAlerts,
            evaluateOperationalSignals(current.clients, current.campaigns, current.projects, current.tasks, current.agentRules)
          ).signals,`);
appContent = appContent.replace(/agentAlerts: syncOperationalSignals\([\s\S]*?\]\),/, `agentAlerts: syncOperationalSignals(
            current.agentAlerts,
            evaluateOperationalSignals(current.clients, current.campaigns, [], [], current.agentRules)
          ).signals,`);
fs.writeFileSync('src/App.tsx', appContent);

